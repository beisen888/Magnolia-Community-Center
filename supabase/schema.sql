-- Magnolia Shift Board — database setup
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run once on a fresh project.

-- ---------- tables ----------
create table if not exists public.profiles (
  id         uuid primary key references auth.users on delete cascade,
  name       text not null default '' check (char_length(name) <= 40),
  is_admin   boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.signups (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  shift_date date not null,
  shift_id   text not null check (char_length(shift_id) <= 12),
  lane       smallint not null check (lane between 0 and 4),
  created_at timestamptz not null default now(),
  -- The database itself guarantees: one person per lane, one lane per person per shift.
  unique (shift_date, shift_id, lane),
  unique (user_id, shift_date, shift_id)
);
create index if not exists signups_date_idx on public.signups (shift_date);

create table if not exists public.settings (
  id     int primary key default 1 check (id = 1),
  groups text[] not null default array['Group A','Group B','Group C','Group D','Group E']
);
insert into public.settings (id) values (1) on conflict do nothing;

-- ---------- helpers ----------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- "Today" in the organization's time zone (change if you're not on Central time).
create or replace function public.org_today() returns date
language sql stable as $$ select (now() at time zone 'America/Chicago')::date $$;

-- Every new login gets a profile row automatically.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, name)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', ''))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- row level security ----------
alter table public.profiles enable row level security;
alter table public.signups  enable row level security;
alter table public.settings enable row level security;

-- profiles: signed-in people can see names; you can only edit your own name (never is_admin).
drop policy if exists "profiles readable" on public.profiles;
create policy "profiles readable" on public.profiles
  for select to authenticated using (true);
drop policy if exists "edit own profile" on public.profiles;
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant update (name) on public.profiles to authenticated;

-- signups: signed-in people see the board; you add/move/drop only your own, and not in the past.
drop policy if exists "read signups" on public.signups;
create policy "read signups" on public.signups
  for select to authenticated using (true);
drop policy if exists "sign self up" on public.signups;
create policy "sign self up" on public.signups
  for insert to authenticated
  with check (user_id = auth.uid() and shift_date >= public.org_today());
drop policy if exists "move own lane" on public.signups;
create policy "move own lane" on public.signups
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and shift_date >= public.org_today());
drop policy if exists "drop own or admin" on public.signups;
create policy "drop own or admin" on public.signups
  for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- settings: anyone can read group names; only admins can rename.
drop policy if exists "read settings" on public.settings;
create policy "read settings" on public.settings
  for select to anon, authenticated using (true);
drop policy if exists "admins edit settings" on public.settings;
create policy "admins edit settings" on public.settings
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- Signed-out visitors see which lanes are taken, but not who took them.
create or replace view public.lane_status as
  select shift_date, shift_id, lane from public.signups;
grant select on public.lane_status to anon, authenticated;

-- ---------- live updates ----------
do $$ begin
  alter publication supabase_realtime add table public.signups;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table public.settings;
exception when duplicate_object then null; end $$;

-- ---------- make yourself an admin (run after you sign in once) ----------
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
