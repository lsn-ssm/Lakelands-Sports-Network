import Stripe from 'stripe';
import { supabaseAdmin, getUserFromRequest } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Step 2 of the embedded card-collection flow. Takes the payment method confirmed
// via Stripe Elements (stripe.confirmCardSetup on the client), attaches it as the
// customer's default, then starts the subscription with the 7-day trial. If a Stripe
// promotion code was validated on the sign-up page (via /api/validate-code), pass its
// code string along here and it gets applied as a discount on the subscription.
// POST { payment_method_id, promo_code? }  with header  Authorization: Bearer <access_token>
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

    // Re-look-up the promotion code server-side rather than trusting a client-sent ID —
    // the client only ever sees the human-typed code string, never Stripe's internal id.
    let discounts;
    const promoCodeRaw = (req.body?.promo_code || '').trim();
    if (promoCodeRaw) {
      const promoList = await stripe.promotionCodes.list({ code: promoCodeRaw, active: true, limit: 1 });
      const promo = promoList.data[0];
      if (promo) discounts = [{ promotion_code: promo.id }];
      // If the code is no longer valid by the time they get here (edge case — expired or
      // used up between validating and paying), we simply don't apply a discount rather
      // than blocking the subscription entirely.
    }

    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [{ price: process.env.STRIPE_PRICE_ID }],
      trial_period_days: 7,
      default_payment_method: paymentMethodId,
      ...(discounts ? { discounts } : {}),
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
