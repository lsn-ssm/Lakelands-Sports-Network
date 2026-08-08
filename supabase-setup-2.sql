-- Run this in Supabase's SQL Editor. Adds what's needed for:
--   - storing favorite teams chosen at signup
--   - the 3-devices-per-account login limit

-- 1. Favorite teams, chosen on the sign-up page. Stored as a JSON array of team ids,
--    e.g. ["greenwood","emerald"].
alter table public.profiles
  add column if not exists favorite_teams jsonb not null default '[]'::jsonb;

-- 2. Devices table — tracks up to 3 signed-in devices per account.
--    Nothing in the client talks to this table directly; it's only ever read/written
--    by the /api/register-device and /api/remove-device serverless functions using the
--    service_role key, so RLS is left with no policies at all (blocks all direct access,
--    including from the anon/authenticated client roles).
create table if not exists public.devices (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  device_id text not null,
  device_label text not null default 'Unknown device',
  last_seen timestamp with time zone not null default now(),
  created_at timestamp with time zone not null default now(),
  unique (user_id, device_id)
);

alter table public.devices enable row level security;
-- (intentionally no policies — only the service_role key, used server-side, can touch this table)
