import Stripe from 'stripe';
import { supabaseAdmin, getUserFromRequest } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Step 2 of the embedded card-collection flow. Takes the payment method confirmed
// via Stripe Elements (stripe.confirmCardSetup on the client), attaches it as the
// customer's default, then starts the subscription with the 7-day trial.
// POST { payment_method_id }  with header  Authorization: Bearer <access_token>
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    const paymentMethodId = req.body?.payment_method_id;
    if (!paymentMethodId) return res.status(400).json({ error: 'Missing payment method' });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    const customerId = profile?.stripe_customer_id;
    if (!customerId) return res.status(400).json({ error: 'No Stripe customer on file yet — call create-setup-intent first' });

    await stripe.paymentMethods.attach(paymentMethodId, { customer: customerId }).catch((err) => {
      // Already attached is fine (can happen on retry) — anything else, rethrow
      if (!String(err.message || '').includes('already been attached')) throw err;
    });

    await stripe.customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
      trial_period_days: 7,
      default_payment_method: paymentMethodId,
    });

    // Update right away rather than waiting on the webhook, so the UI can reflect
    // "trialing" immediately. The webhook (customer.subscription.created/updated)
    // will keep this in sync going forward as a backup.
    await supabaseAdmin
      .from('profiles')
      .update({ subscription_status: subscription.status, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    return res.status(200).json({ status: subscription.status });
  } catch (err) {
    console.error('create-subscription error:', err);
    return res.status(500).json({ error: err.message || 'Could not start subscription' });
  }
}
