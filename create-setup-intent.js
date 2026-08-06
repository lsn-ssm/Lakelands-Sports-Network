import Stripe from 'stripe';
import { supabaseAdmin, getUserFromRequest } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Step 1 of the embedded card-collection flow.
// Finds (or creates) a Stripe Customer for this Supabase user, saves the
// stripe_customer_id on their profile right away (doesn't wait for a webhook),
// then creates a SetupIntent so the browser can securely collect a card with
// Stripe Elements. No charge happens here — that's what create-subscription is for.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('stripe_customer_id')
      .eq('id', user.id)
      .maybeSingle();

    let customerId = profile?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: { supabase_user_id: user.id },
      });
      customerId = customer.id;

      await supabaseAdmin
        .from('profiles')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('id', user.id);
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
    });

    return res.status(200).json({ clientSecret: setupIntent.client_secret });
  } catch (err) {
    console.error('create-setup-intent error:', err);
    return res.status(500).json({ error: 'Could not start card setup' });
  }
}
