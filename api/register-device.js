import { supabaseAdmin, getUserFromRequest } from './_auth.js';

const DEVICE_LIMIT = 3;

// Called right after a successful sign-in or sign-up.
// POST { device_id, device_label }  with header  Authorization: Bearer <access_token>
//
// - If this device is already registered to the account, just bumps last_seen.
// - If it's new and they're under the 3-device limit, registers it.
// - If it's new and they're already at 3, returns their current devices so the
//   front end can show a "pick one to remove" screen instead of registering it.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const user = await getUserFromRequest(req);
    if (!user) return res.status(401).json({ error: 'Not signed in' });

    const deviceId = (req.body?.device_id || '').trim();
    const deviceLabel = (req.body?.device_label || 'Unknown device').trim().slice(0, 80);
    if (!deviceId) return res.status(400).json({ error: 'Missing device id' });

    const { data: existing } = await supabaseAdmin
      .from('devices')
      .select('id')
      .eq('user_id', user.id)
      .eq('device_id', deviceId)
      .maybeSingle();

    if (existing) {
      await supabaseAdmin
        .from('devices')
        .update({ last_seen: new Date().toISOString(), device_label: deviceLabel })
        .eq('id', existing.id);
      return res.status(200).json({ ok: true });
    }

    const { data: currentDevices, error: listErr } = await supabaseAdmin
      .from('devices')
      .select('id, device_label, last_seen')
      .eq('user_id', user.id)
      .order('last_seen', { ascending: true });

    if (listErr) throw listErr;

    if ((currentDevices || []).length >= DEVICE_LIMIT) {
      return res.status(200).json({
        needsDeviceChoice: true,
        devices: currentDevices,
      });
    }

    const { error: insertErr } = await supabaseAdmin.from('devices').insert({
      user_id: user.id,
      device_id: deviceId,
      device_label: deviceLabel,
      last_seen: new Date().toISOString(),
    });
    if (insertErr) throw insertErr;

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('register-device error:', err);
    return res.status(500).json({ error: 'Could not register this device' });
  }
}
