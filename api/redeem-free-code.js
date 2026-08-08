import { supabaseAdmin, getUserFromRequest } from './_auth.js';

// Redeems a "free membership" comp code for the signed-in user — no Stripe customer or
// subscription is ever created. Marks profiles.subscription_status = 'comped', which
// isPlusMember() (client) and is_lsn_plus_member() (SQL, for Board RLS) both treat as a
// full LSN+ member.
// POST { code: string }  with header  Authorization: Bearer <access_token>
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    const raw = (req.body?.code || '').trim();
    if (!raw) return res.status(400).json({ error: 'Missing code' });

    const { data, error } = await supabaseAdmin.rpc('redeem_comp_code', {
      p_code: raw,
      p_user_id: user.id,
    });
    if (error) throw error;

    const result = Array.isArray(data) ? data[0] : data;
    if (!result || !result.ok) {
      return res.status(410).json({ error: (result && result.message) || 'Could not redeem this code.' });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('redeem-free-code error:', err);
    return res.status(500).json({ error: 'Could not redeem this code.' });
  }
}
