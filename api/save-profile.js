import { supabaseAdmin, getUserFromRequest } from './_auth.js';

// Saves the favorite team(s) picked on the sign-up page.
// POST { favorite_teams: string[] }  with header  Authorization: Bearer <access_token>
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    const favoriteTeams = Array.isArray(req.body?.favorite_teams) ? req.body.favorite_teams : [];

    const { error } = await supabaseAdmin
      .from('profiles')
      .update({ favorite_teams: favoriteTeams, updated_at: new Date().toISOString() })
      .eq('id', user.id);

    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('save-profile error:', err);
    return res.status(500).json({ error: 'Could not save favorite teams' });
  }
}
