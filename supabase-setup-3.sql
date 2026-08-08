-- Run this in Supabase's SQL Editor. Adds the LSN+ Members Board:
--   - a chosen username per account
--   - posts, replies, poll votes, and reports tables
--   - a private image-storage bucket for post/reply pictures
--
-- Everything here is locked to active/trialing LSN+ members only, for both reading
-- and writing. Free accounts and logged-out visitors cannot see the board exists.

-- 1. Username, chosen by the member the first time they visit the Board.
--    NOT server-writable except through /api/save-username.js (service_role) — there is
--    deliberately no client-side UPDATE policy on profiles, so nobody can use the browser
--    console to rewrite their own subscription_status or stripe_customer_id.
alter table public.profiles
  add column if not exists username text unique;

-- 2. Helper used by every RLS policy below: "is the current logged-in user an active or
--    trialing LSN+ member?" security definer so it can read profiles regardless of the
--    caller's own row-level access.
create or replace function public.is_lsn_plus_member()
returns boolean
language sql
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and subscription_status in ('active', 'trialing')
  );
$$;

-- 3. Posts (top-level threads on the general board).
create table if not exists public.board_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  body text not null default '',
  image_path text,
  link_url text,
  poll_question text,
  poll_options jsonb,          -- array of option strings, e.g. ["Greenwood","Emerald"]; null = not a poll
  created_at timestamp with time zone not null default now()
);

alter table public.board_posts enable row level security;

create policy "board_posts_select_members" on public.board_posts
  for select using (public.is_lsn_plus_member());
create policy "board_posts_insert_members" on public.board_posts
  for insert with check (public.is_lsn_plus_member() and user_id = auth.uid());
create policy "board_posts_delete_own" on public.board_posts
  for delete using (user_id = auth.uid());

-- 4. Replies (flat, chronological — no nested reply-to-reply).
create table if not exists public.board_replies (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.board_posts(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  username text not null,
  body text not null default '',
  image_path text,
  link_url text,
  created_at timestamp with time zone not null default now()
);

alter table public.board_replies enable row level security;

create policy "board_replies_select_members" on public.board_replies
  for select using (public.is_lsn_plus_member());
create policy "board_replies_insert_members" on public.board_replies
  for insert with check (public.is_lsn_plus_member() and user_id = auth.uid());
create policy "board_replies_delete_own" on public.board_replies
  for delete using (user_id = auth.uid());

-- 5. Poll votes. Multiple-choice is allowed: a member can vote for more than one option
--    on the same poll, but not the same option twice. option_index refers to the position
--    in board_posts.poll_options.
create table if not exists public.board_poll_votes (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.board_posts(id) on delete cascade,
  option_index int not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamp with time zone not null default now(),
  unique (post_id, option_index, user_id)
);

alter table public.board_poll_votes enable row level security;

create policy "board_poll_votes_select_members" on public.board_poll_votes
  for select using (public.is_lsn_plus_member());
create policy "board_poll_votes_insert_members" on public.board_poll_votes
  for insert with check (public.is_lsn_plus_member() and user_id = auth.uid());
create policy "board_poll_votes_delete_own" on public.board_poll_votes
  for delete using (user_id = auth.uid());

-- 6. Reports. Members can flag a post or reply; nobody can read reports from the client —
--    review and act on them yourself in Supabase's Table Editor (Table Editor → board_reports),
--    then delete the offending row from board_posts / board_replies and, if needed, ban the
--    user by clearing their devices row or disabling them in Authentication → Users.
create table if not exists public.board_reports (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.board_posts(id) on delete cascade,
  reply_id uuid references public.board_replies(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text,
  created_at timestamp with time zone not null default now()
);

alter table public.board_reports enable row level security;

create policy "board_reports_insert_members" on public.board_reports
  for insert with check (public.is_lsn_plus_member() and reporter_id = auth.uid());
-- (intentionally no select policy — reports are only visible to you, via the Supabase
-- dashboard, which reads with the service_role key and bypasses RLS entirely)

-- 7. Private image bucket for post/reply pictures. Uploads and downloads both require
--    active LSN+ membership, so images are just as locked-down as the text content.
insert into storage.buckets (id, name, public)
values ('board-images', 'board-images', false)
on conflict (id) do nothing;

create policy "board_images_select_members" on storage.objects
  for select using (bucket_id = 'board-images' and public.is_lsn_plus_member());
create policy "board_images_insert_members" on storage.objects
  for insert with check (bucket_id = 'board-images' and public.is_lsn_plus_member());
create policy "board_images_delete_own" on storage.objects
  for delete using (bucket_id = 'board-images' and owner = auth.uid());
