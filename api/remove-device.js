import { supabaseAdmin, getUserFromRequest } from './_auth.js';

// Called after the user picks which of their 3 existing devices to sign out,
// making room for the new one they're currently logging in from.
// POST { remove_device_row_id, new_device_id, new_device_label }
// with header  Authorization: Bearer <access_token>
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    const removeId = req.body?.remove_device_row_id;
    const newDeviceId = (req.body?.new_device_id || '').trim();
    const newDeviceLabel = (req.body?.new_device_label || 'Unknown device').trim().slice(0, 80);
    if (!removeId || !newDeviceId) return res.status(400).json({ error: 'Missing device info' });

    // Scoped to this user's own id as a safety check — can't remove someone else's device row
    const { error: deleteErr } = await supabaseAdmin
      .from('devices')
      .delete()
      .eq('id', removeId)
      .eq('user_id', user.id);
    if (deleteErr) throw deleteErr;

    const { error: insertErr } = await supabaseAdmin.from('devices').insert({
      user_id: user.id,
      device_id: newDeviceId,
      device_label: newDeviceLabel,
      last_seen: new Date().toISOString(),
    });
    if (insertErr) throw insertErr;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('remove-device error:', err);
    return res.status(500).json({ error: 'Could not switch devices' });
  }
}
