const express = require('express');
const router = express.Router();
const { tenantIsolationMiddleware } = require('../middleware/tenantIsolation');
const { rbacMiddleware } = require('../middleware/authMiddleware');
const billingService = require('../services/billingService');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'sk_test_mock_key');

const authenticateToken = tenantIsolationMiddleware;

/**
 * POST /api/billing/checkout
 * Starts a Stripe checkout session for plan upgrade.
 */
router.post('/checkout', authenticateToken, rbacMiddleware(['admin']), async (req, res) => {
  const { tenantId } = req.user;
  const { planType, successUrl, cancelUrl } = req.body;

  if (!planType || !successUrl || !cancelUrl) {
    return res.status(400).json({ error: 'Missing planType, successUrl, or cancelUrl.' });
  }

  try {
    const session = await billingService.createCheckoutSession(tenantId, planType, successUrl, cancelUrl);
    res.json({ checkoutUrl: session.url });
  } catch (err) {
    console.error('Checkout error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to initiate checkout session.' });
  }
});

/**
 * POST /api/billing/portal
 * Generates a Stripe billing portal session for customer account management.
 */
router.post('/portal', authenticateToken, rbacMiddleware(['admin']), async (req, res) => {
  const { tenantId } = req.user;
  const { returnUrl } = req.body;

  if (!returnUrl) {
    return res.status(400).json({ error: 'Missing returnUrl.' });
  }

  try {
    const session = await billingService.createPortalSession(tenantId, returnUrl);
    res.json({ portalUrl: session.url });
  } catch (err) {
    console.error('Portal session error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to initiate billing portal.' });
  }
});

/**
 * POST /api/billing/webhook
 * Receives subscription state hooks from Stripe.
 */
router.post('/webhook', async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    if (webhookSecret && sig) {
      // Production mode with signature validation (requires req.rawBody)
      event = stripe.webhooks.constructEvent(req.rawBody, sig, webhookSecret);
    } else {
      // Mock/Test mode
      event = req.body;
    }

    await billingService.handleWebhook(event);
    res.json({ received: true });
  } catch (err) {
    console.error('Stripe Webhook Processing Error:', err.message);
    res.status(400).json({ error: `Webhook processing failed: ${err.message}` });
  }
});

module.exports = router;
