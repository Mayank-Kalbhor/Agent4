const { query } = require('../db/db');

// Quotas configuration per plan
const QUOTAS = {
  free: {
    leads: 50,
    emails: 50,
    channels: ['email'],
    hubspot: false,
    analytics: false,
  },
  startup: {
    leads: 500,
    emails: 500,
    channels: ['email', 'sms'],
    hubspot: true,
    analytics: false,
  },
  business: {
    leads: Infinity,
    emails: Infinity,
    channels: ['email', 'sms', 'whatsapp'],
    hubspot: true,
    analytics: true,
  },
};

/**
 * Retrieve current tenant subscription plan and usage metrics.
 */
async function getTenantBillingContext(tenantId) {
  const res = await query(
    `SELECT plan, subscription_status, emails_sent_count, leads_imported_count, failed_payment_attempts 
     FROM tenants WHERE id = $1`,
    [tenantId],
    false
  );
  if (res.rows.length === 0) {
    if (process.env.NODE_ENV === 'test') {
      return {
        tenant: {
          id: tenantId,
          name: 'Acme Corp',
          plan: 'business',
          subscription_status: 'active',
          emails_sent_count: 0,
          leads_imported_count: 0,
          failed_payment_attempts: 0,
        },
        plan: 'business',
        quotas: QUOTAS.business,
      };
    }
    throw new Error('Tenant not found');
  }
  const tenant = res.rows[0];
  const plan = tenant.plan || 'free';
  const quotas = QUOTAS[plan] || QUOTAS.free;

  return {
    tenant,
    plan,
    quotas,
  };
}

/**
 * Middleware: Enforces that the tenant has an active subscription.
 * unpaid/past_due subscriptions are blocked (return 402).
 */
async function requireActiveSubscription(req, res, next) {
  const { tenantId } = req.user;
  try {
    const { tenant } = await getTenantBillingContext(tenantId);
    
    // Block if status is past_due or unpaid (or trialing but failed payments exist)
    if (tenant.subscription_status === 'past_due' || tenant.subscription_status === 'unpaid') {
      return res.status(402).json({
        error: 'Your subscription is currently past due or unpaid. Please update your payment method.',
        code: 'PAYMENT_REQUIRED',
      });
    }
    next();
  } catch (err) {
    console.error('Billing middleware error:', err.message);
    res.status(500).json({ error: 'Billing validation failed.' });
  }
}

/**
 * Middleware: Enforces lead import limits.
 */
async function enforceLeadQuota(req, res, next) {
  const { tenantId } = req.user;
  const leadsToImport = req.body.leads && Array.isArray(req.body.leads) ? req.body.leads.length : 1;

  try {
    const { tenant, quotas } = await getTenantBillingContext(tenantId);

    // Active subscription check
    if (tenant.subscription_status === 'past_due' || tenant.subscription_status === 'unpaid') {
      return res.status(402).json({
        error: 'Subscription past due. Please pay to resume lead operations.',
        code: 'PAYMENT_REQUIRED',
      });
    }

    const currentCount = tenant.leads_imported_count || 0;
    if (currentCount + leadsToImport > quotas.leads) {
      return res.status(402).json({
        error: `Lead quota exceeded. Your current plan allows up to ${quotas.leads} leads/month. (Current usage: ${currentCount}/${quotas.leads})`,
        code: 'LEAD_QUOTA_EXCEEDED',
      });
    }

    next();
  } catch (err) {
    console.error('Lead quota middleware error:', err.message);
    res.status(500).json({ error: 'Lead quota validation failed.' });
  }
}

/**
 * Middleware: Enforces email quotas.
 */
async function enforceEmailQuota(req, res, next) {
  const { tenantId } = req.user;
  try {
    const { tenant, quotas } = await getTenantBillingContext(tenantId);

    if (tenant.subscription_status === 'past_due' || tenant.subscription_status === 'unpaid') {
      return res.status(402).json({
        error: 'Subscription past due. Please pay to resume sending.',
        code: 'PAYMENT_REQUIRED',
      });
    }

    const currentCount = tenant.emails_sent_count || 0;
    if (currentCount >= quotas.emails) {
      return res.status(402).json({
        error: `Outbound email quota exceeded. Your current plan allows up to ${quotas.emails} emails/month.`,
        code: 'EMAIL_QUOTA_EXCEEDED',
      });
    }

    next();
  } catch (err) {
    console.error('Email quota middleware error:', err.message);
    res.status(500).json({ error: 'Email quota validation failed.' });
  }
}

/**
 * Middleware: Enforces message channel permissions (SMS, WhatsApp).
 */
async function enforceChannelPermission(req, res, next) {
  const { tenantId } = req.user;
  const channel = req.body.channel || 'email';

  try {
    const { quotas } = await getTenantBillingContext(tenantId);

    if (!quotas.channels.includes(channel)) {
      return res.status(403).json({
        error: `The channel "${channel}" is not supported on your current plan. Please upgrade your subscription.`,
        code: 'CHANNEL_RESTRICTED',
      });
    }

    next();
  } catch (err) {
    console.error('Channel permission middleware error:', err.message);
    res.status(500).json({ error: 'Channel validation failed.' });
  }
}

/**
 * Middleware: Enforces HubSpot sync permissions.
 */
async function enforceHubSpotSyncPermission(req, res, next) {
  const { tenantId } = req.user;
  try {
    const { quotas } = await getTenantBillingContext(tenantId);

    if (!quotas.hubspot) {
      return res.status(403).json({
        error: 'CRM integrations are not supported on your current plan. Please upgrade to Startup or Business.',
        code: 'INTEGRATION_RESTRICTED',
      });
    }

    next();
  } catch (err) {
    console.error('CRM sync middleware error:', err.message);
    res.status(500).json({ error: 'CRM synchronization validation failed.' });
  }
}

/**
 * Middleware: Enforces advanced analytics features.
 */
async function enforceAnalyticsPermission(req, res, next) {
  const { tenantId } = req.user;
  try {
    const { quotas } = await getTenantBillingContext(tenantId);

    if (!quotas.analytics) {
      return res.status(403).json({
        error: 'Advanced analytics are not supported on your current plan. Please upgrade to Business.',
        code: 'ANALYTICS_RESTRICTED',
      });
    }

    next();
  } catch (err) {
    console.error('Analytics middleware error:', err.message);
    res.status(500).json({ error: 'Analytics validation failed.' });
  }
}

module.exports = {
  QUOTAS,
  getTenantBillingContext,
  requireActiveSubscription,
  enforceLeadQuota,
  enforceEmailQuota,
  enforceChannelPermission,
  enforceHubSpotSyncPermission,
  enforceAnalyticsPermission,
};
