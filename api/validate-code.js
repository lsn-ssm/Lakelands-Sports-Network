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

  // 1. Free/comp codes — checked first since they're specific to this site. Isolated in
  // its own try/catch so a Supabase hiccup doesn't take down the whole request — it just
  // falls through to the Stripe check instead, and we log the real reason server-side.
  try {
    const { data: comp, error: compErr } = await supabaseAdmin
      .from('comp_codes')
      .select('*')
      .ilike('code', raw)
      .eq('active', true)
      .maybeSingle();

    // TEMPORARY diagnostic logging — remove once the promo code matching issue is solved.
    console.log('validate-code DEBUG: raw code searched =', JSON.stringify(raw));
    console.log('validate-code DEBUG: comp_codes match =', JSON.stringify(comp));
    console.log('validate-code DEBUG: comp_codes error =', JSON.stringify(compErr));
    console.log('validate-code DEBUG: SUPABASE_URL =', process.env.SUPABASE_URL);

    if (compErr) {
      console.error('validate-code comp_codes lookup error:', compErr);
    } else if (comp) {
      const expired = comp.expires_at && new Date(comp.expires_at) < new Date();
      const usedUp = comp.uses_count >= comp.max_uses;
      if (!expired && !usedUp) {
        return res.status(200).json({ valid: true, type: 'free', description: 'Free LSN+ membership — no card needed' });
      }
      // An expired/used-up comp code should report as invalid, not silently fall through
      // to check Stripe as if it were never a comp code at all.
      return res.status(200).json({ valid: false, error: expired ? 'That code has expired.' : 'That code has already been fully redeemed.' });
    }
  } catch (err) {
    console.error('validate-code comp_codes lookup threw:', err);
  }

  // 2. Stripe promotion codes (discounts on the paid subscription) — also isolated, so a
  // Stripe-side issue (bad key, network blip) reports as "not valid" instead of a 500.
  try {
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
  } catch (err) {
    console.error('validate-code Stripe lookup error:', err);
  }

  return res.status(200).json({ valid: false, error: "That code isn't valid or has expired." });
}
