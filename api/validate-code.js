import Stripe from 'stripe';
import { supabaseAdmin } from './_auth.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

// Checks a promo code typed on the Sign Up page against both code systems:
//   1. Our own "free membership" comp_codes table (no Stripe involved at all).
//   2. Stripe's promotion codes (for %/$ discounts on the real subscription).
// No login required — this is a read-only check so the signup page can show the
// member what the code does before they create an account.
// POST { code: string }
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const raw = (req.body?.code || '').trim();
  if (!raw) {
    return res.status(400).json({ valid: false, error: 'Enter a code.' });
  }

  try {
    // 1. Free/comp codes — checked first since they're specific to this site.
    const { data: comp } = await supabaseAdmin
      .from('comp_codes')
      .select('*')
      .ilike('code', raw)
      .eq('active', true)
      .maybeSingle();

    if (comp) {
      const expired = comp.expires_at && new Date(comp.expires_at) < new Date();
      const usedUp = comp.uses_count >= comp.max_uses;
      if (!expired && !usedUp) {
        return res.status(200).json({ valid: true, type: 'free', description: 'Free LSN+ membership — no card needed' });
      }
      // Fall through to the Stripe check below only if it's genuinely not a free code —
      // an expired/used-up comp code should just report as invalid, not silently check Stripe.
      return res.status(200).json({ valid: false, error: expired ? 'That code has expired.' : 'That code has already been fully redeemed.' });
    }

    // 2. Stripe promotion codes (discounts on the paid subscription).
    const list = await stripe.promotionCodes.list({ code: raw, active: true, limit: 1 });
    const promo = list.data[0];
    if (promo && promo.coupon && promo.coupon.valid) {
      const coupon = promo.coupon;
      let description = coupon.percent_off
        ? coupon.percent_off + '% off'
        : coupon.amount_off
          ? '$' + (coupon.amount_off / 100).toFixed(2) + ' off'
          : 'Discount applied';
      if (coupon.duration === 'forever') description += ', every month';
      else if (coupon.duration === 'repeating') description += ' for ' + coupon.duration_in_months + ' month' + (coupon.duration_in_months === 1 ? '' : 's');
      else if (coupon.duration === 'once') description += ' your first payment';
      return res.status(200).json({ valid: true, type: 'discount', description });
    }

    return res.status(200).json({ valid: false, error: "That code isn't valid or has expired." });
  } catch (err) {
    console.error('validate-code error:', err);
    return res.status(500).json({ valid: false, error: 'Could not check that code right now.' });
  }
}
