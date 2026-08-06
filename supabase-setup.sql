-- Run this in Supabase's SQL Editor AFTER you've already created the `profiles` table.
-- It auto-creates a profiles row the moment someone signs up, so the Stripe webhook
-- always has a row to update (belt-and-suspenders — the webhook also upserts as a backup).

create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
