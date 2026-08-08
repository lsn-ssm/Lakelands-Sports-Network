import { supabaseAdmin, getUserFromRequest } from './_auth.js';

// Sets the member's Board username. Done server-side with the service_role key on purpose —
// there's no client-side UPDATE policy on profiles at all, so nobody can open dev tools and
// rewrite their own subscription_status or stripe_customer_id along with their username.
// POST { username: string }  with header  Authorization: Bearer <access_token>
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    const raw = (req.body?.username || '').trim();

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(raw)) {
      return res.status(400).json({
        error: 'Usernames must be 3-20 characters — letters, numbers, and underscores only.',
      });
    }

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ username: raw, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (error) {
      // Postgres unique-violation code
      if (error.code === '23505') {
        return res.status(409).json({ error: 'That username is already taken. Try another.' });
      }
      throw error;
    }

    return res.status(200).json({ ok: true, username: raw });
  } catch (err) {
    console.error('save-username error:', err);
    return res.status(500).json({ error: 'Could not save username' });
  }
}
