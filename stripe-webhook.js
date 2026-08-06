import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Stripe needs the raw, untouched request body to verify the webhook signature,
// so we turn off Vercel's automatic JSON body parsing for this function only.
export const config = { api: { bodyParser: false } };

function buffer(readable) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    readable.on('data', (chunk) => chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk));
    readable.on('end', () => resolve(Buffer.concat(chunks)));
    readable.on('error', reject);
  });
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).end();
  }

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    const rawBody = await buffer(req);
    event = stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      // Fires right after someone completes Stripe Checkout (including starting a trial)
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId = session.client_reference_id;
        const customerId = session.customer;

        let status = 'active';
        if (session.subscription) {
          const sub = await stripe.subscriptions.retrieve(session.subscription);
          status = sub.status; // 'trialing' during the 7-day trial, 'active' once it converts
        }

        if (userId) {
          // upsert (not update) so this still works even if the profiles-row-on-signup
          // trigger hasn't run yet for some reason
          await supabaseAdmin.from('profiles').upsert({
            id: userId,
            stripe_customer_id: customerId,
            subscription_status: status,
            updated_at: new Date().toISOString(),
          });
        }
        break;
      }

      // Fires on renewals, trial ending, payment failures, plan changes, etc.
      case 'customer.subscription.updated': {
        const sub = event.data.object;
        await supabaseAdmin
          .from('profiles')
          .update({
            subscription_status: sub.status, // 'active' | 'trialing' | 'past_due' | 'unpaid' | ...
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', sub.customer);
        break;
      }

      // Fires when a subscription is fully canceled
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await supabaseAdmin
          .from('profiles')
          .update({
            subscription_status: 'canceled',
            updated_at: new Date().toISOString(),
          })
          .eq('stripe_customer_id', sub.customer);
        break;
      }

      default:
        // Ignore anything else — Stripe sends a lot of event types we don't need
        break;
    }

    return res.status(200).json({ received: true });
  } catch (err) {
    console.error('Webhook handler error:', err);
    return res.status(500).json({ error: 'Webhook handler failed' });
  }
}
