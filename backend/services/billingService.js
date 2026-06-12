const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_mock_key');
const { query, tenantStorage } = require('../db/db');

// Map Price IDs to Plans
const PRICE_STARTUP = process.env.STRIPE_PRICE_STARTUP || 'price_startup_mock';
const PRICE_BUSINESS = process.env.STRIPE_PRICE_BUSINESS || 'price_business_mock';

function getPlanFromPriceId(priceId) {
  if (priceId === PRICE_STARTUP) return 'startup';
  if (priceId === PRICE_BUSINESS) return 'business';
  return 'free'; // fallback
}

/**
 * Creates a Stripe Checkout Session for a tenant to upgrade their plan.
 */
async function createCheckoutSession(tenantId, planType, successUrl, cancelUrl) {
  const tenantRes = await query('SELECT * FROM tenants WHERE id = $1', [tenantId], false);
  if (tenantRes.rows.length === 0) {
    throw new Error('Tenant not found');
  }
  const tenant = tenantRes.rows[0];

  let priceId;
  if (planType === 'startup') {
    priceId = PRICE_STARTUP;
  } else if (planType === 'business') {
    priceId = PRICE_BUSINESS;
  } else {
    throw new Error('Invalid plan type for billing checkout');
  }

  const sessionOptions = {
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    client_reference_id: tenantId,
  };

  if (tenant.stripe_customer_id) {
    sessionOptions.customer = tenant.stripe_customer_id;
  } else {
    sessionOptions.customer_email = tenant.settings?.billing_email || `${tenant.name.toLowerCase().replace(/\s+/g, '')}@test.com`;
  }

  const session = await stripe.checkout.sessions.create(sessionOptions);
  return session;
}

/**
 * Creates a Stripe Customer Portal Session for self-serve management.
 */
async function createPortalSession(tenantId, returnUrl) {
  const tenantRes = await query('SELECT stripe_customer_id FROM tenants WHERE id = $1', [tenantId], false);
  if (tenantRes.rows.length === 0 || !tenantRes.rows[0].stripe_customer_id) {
    throw new Error('Tenant has no associated Stripe customer record');
  }
  const customerId = tenantRes.rows[0].stripe_customer_id;

  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session;
}

/**
 * Stripe Webhook Handler
 */
async function handleWebhook(event) {
  const { type, data } = event;

  switch (type) {
    case 'checkout.session.completed': {
      const session = data.object;
      const tenantId = session.client_reference_id;
      const customerId = session.customer;
      const subscriptionId = session.subscription;

      if (!tenantId) {
        console.warn('⚠️ Stripe Webhook: checkout.session.completed missed client_reference_id');
        break;
      }

      // Fetch subscription details to map plan and billing period
      const subscription = await stripe.subscriptions.retrieve(subscriptionId);
      const priceId = subscription.items.data[0].price.id;
      const plan = getPlanFromPriceId(priceId);

      await query(
        `UPDATE tenants SET 
          stripe_customer_id = $1, 
          stripe_subscription_id = $2, 
          plan = $3, 
          subscription_status = $4,
          current_period_start = to_timestamp($5),
          current_period_end = to_timestamp($6),
          emails_sent_count = 0,
          failed_payment_attempts = 0
        WHERE id = $7`,
        [
          customerId,
          subscriptionId,
          plan,
          subscription.status,
          subscription.current_period_start,
          subscription.current_period_end,
          tenantId
        ],
        false
      );

      // Audit Log
      await query(
        `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, NULL, 'BILLING_UPGRADE', 'tenants', $1, $2)`,
        [tenantId, JSON.stringify({ plan, subscriptionId, customerId })],
        false
      );
      console.log(`✅ Subscription created for tenant ${tenantId} (Plan: ${plan})`);
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = data.object;
      const customerId = subscription.customer;
      const subscriptionId = subscription.id;
      const status = subscription.status;
      const priceId = subscription.items.data[0].price.id;
      const plan = getPlanFromPriceId(priceId);

      // Find tenant by customer or subscription id
      const tenantRes = await query(
        'SELECT id, plan FROM tenants WHERE stripe_customer_id = $1 OR stripe_subscription_id = $2',
        [customerId, subscriptionId],
        false
      );

      if (tenantRes.rows.length > 0) {
        const tenantId = tenantRes.rows[0].id;
        const oldPlan = tenantRes.rows[0].plan;

        await query(
          `UPDATE tenants SET 
            plan = $1,
            subscription_status = $2,
            current_period_start = to_timestamp($3),
            current_period_end = to_timestamp($4),
            stripe_subscription_id = $5
          WHERE id = $6`,
          [
            plan,
            status,
            subscription.current_period_start,
            subscription.current_period_end,
            subscriptionId,
            tenantId
          ],
          false
        );

        // Audit Log
        if (oldPlan !== plan) {
          await query(
            `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
             VALUES ($1, NULL, 'BILLING_PLAN_CHANGE', 'tenants', $1, $2)`,
            [tenantId, JSON.stringify({ oldPlan, newPlan: plan, status })],
            false
          );
        }
        console.log(`🔄 Subscription updated for tenant ${tenantId} (Plan: ${plan}, Status: ${status})`);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = data.object;
      const subscriptionId = subscription.id;

      const tenantRes = await query(
        'SELECT id FROM tenants WHERE stripe_subscription_id = $1',
        [subscriptionId],
        false
      );

      if (tenantRes.rows.length > 0) {
        const tenantId = tenantRes.rows[0].id;

        // Revert to Free plan, pause active sequences
        await query(
          `UPDATE tenants SET 
            plan = 'free', 
            subscription_status = 'active', 
            stripe_subscription_id = NULL
          WHERE id = $1`,
          [tenantId],
          false
        );

        await tenantStorage.run({ tenantId }, async () => {
          await query("UPDATE leads SET sequence_paused = TRUE");
        });

        // Audit Log
        await query(
          `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
           VALUES ($1, NULL, 'BILLING_CANCELED', 'tenants', $1, $2)`,
          [tenantId, JSON.stringify({ subscriptionId })],
          false
        );
        console.log(`❌ Subscription canceled. Tenant ${tenantId} downgraded to Free.`);
      }
      break;
    }

    case 'invoice.payment_failed': {
      const invoice = data.object;
      const customerId = invoice.customer;

      const tenantRes = await query(
        'SELECT id, failed_payment_attempts, plan FROM tenants WHERE stripe_customer_id = $1',
        [customerId],
        false
      );

      if (tenantRes.rows.length > 0) {
        const tenant = tenantRes.rows[0];
        const tenantId = tenant.id;
        const nextFailedAttempts = (tenant.failed_payment_attempts || 0) + 1;

        console.warn(`⚠️ Payment failure detected for tenant ${tenantId}. Attempt ${nextFailedAttempts} of 3.`);

        if (nextFailedAttempts >= 3) {
          // Downgrade to Free
          await query(
            `UPDATE tenants SET 
              plan = 'free', 
              subscription_status = 'active', 
              stripe_subscription_id = NULL,
              failed_payment_attempts = 0
            WHERE id = $1`,
            [tenantId],
            false
          );

          await tenantStorage.run({ tenantId }, async () => {
            await query("UPDATE leads SET sequence_paused = TRUE");
          });

          // Audit Log
          await query(
            `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
             VALUES ($1, NULL, 'DUNNING_DOWNGRADE', 'tenants', $1, $2)`,
            [tenantId, JSON.stringify({ failedAttempts: nextFailedAttempts, previousPlan: tenant.plan })],
            false
          );
        } else {
          // Keep plan but increment attempts and pause sequences during grace period
          await query(
            'UPDATE tenants SET failed_payment_attempts = $1 WHERE id = $2',
            [nextFailedAttempts, tenantId],
            false
          );

          await tenantStorage.run({ tenantId }, async () => {
            await query("UPDATE leads SET sequence_paused = TRUE");
          });

          // Audit Log
          await query(
            `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
             VALUES ($1, NULL, 'DUNNING_GRACE_PERIOD_WARN', 'tenants', $1, $2)`,
            [tenantId, JSON.stringify({ failedAttempts: nextFailedAttempts })],
            false
          );
        }
      }
      break;
    }
  }
}

/**
 * Background Scheduler Job: Evaluates trial tenants daily.
 * Alerts on Day 12, auto-downgrades on Day 14.
 */
async function checkTrials() {
  // Find all tenants on Startup/Business trials
  const res = await query(
    "SELECT id, name, plan, trial_start, trial_end FROM tenants WHERE subscription_status = 'trialing'",
    [],
    false
  );
  const tenants = res.rows;

  for (const tenant of tenants) {
    if (!tenant.trial_start) continue;

    const msElapsed = Date.now() - new Date(tenant.trial_start).getTime();
    const daysElapsed = Math.floor(msElapsed / (24 * 3600 * 1000));

    if (daysElapsed === 12) {
      console.warn(`🔔 [Trial Reminder] Tenant ${tenant.name} (${tenant.id}) trial ends in 2 days (Day 12 reminder).`);
      
      // Audit log notification entry
      await query(
        `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, NULL, 'TRIAL_EXPIRATION_WARNING', 'tenants', $1, $2)`,
        [tenant.id, JSON.stringify({ daysRemaining: 2 })],
        false
      );
    } else if (daysElapsed >= 14) {
      console.warn(`🚨 [Trial Expired] Downgrading Tenant ${tenant.name} (${tenant.id}) to Free (Day 14).`);

      // Auto-downgrade to Free
      await query(
        `UPDATE tenants SET 
          plan = 'free', 
          subscription_status = 'active', 
          stripe_subscription_id = NULL
        WHERE id = $1`,
        [tenant.id],
        false
      );

      // Pause active sequences
      await tenantStorage.run({ tenantId: tenant.id }, async () => {
        await query("UPDATE leads SET sequence_paused = TRUE");
      });

      // Audit log
      await query(
        `INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata)
         VALUES ($1, NULL, 'TRIAL_EXPIRED_DOWNGRADE', 'tenants', $1, $2)`,
        [tenant.id, JSON.stringify({ previousPlan: tenant.plan })],
        false
      );
    }
  }
}

module.exports = {
  createCheckoutSession,
  createPortalSession,
  handleWebhook,
  checkTrials,
  PRICE_STARTUP,
  PRICE_BUSINESS,
};
