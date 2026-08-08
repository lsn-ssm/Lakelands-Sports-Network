import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Creates a Stripe Checkout session (subscription mode) for the signed-in Supabase user
// and hands back the URL to redirect them to. Called from the site with:
//   fetch('/api/create-checkout-session', { method: 'POST', headers: { Authorization: 'Bearer <access_token>' } })
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '');
    if (!token) {
      return res.status(401).json({ error: 'Not signed in' });
    }

    // Verify the Supabase session token belongs to a real, signed-in user
    const { data: { user }, error: userError } = await supabaseAdmin.auth.getUser(token);
    if (userError || !user) {
      return res.status(401).json({ error: 'Invalid session' });
    }

    const origin = req.headers.origin || `https://${req.headers.host}`;

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: process.env.STRIPE_PRICE_ID, quantity: 1 }],
      subscription_data: {
        trial_period_days: 7,
      },
      // Ties the Stripe session back to the Supabase user so the webhook knows who to update
      client_reference_id: user.id,
      customer_email: user.email,
      success_url: `${origin}/?lsnplus=success`,
      cancel_url: `${origin}/?lsnplus=cancelled`,
    });

    return res.status(200).json({ url: session.url });
  } catch (err) {
    console.error('create-checkout-session error:', err);
    return res.status(500).json({ error: 'Something went wrong creating checkout session' });
  }
}
