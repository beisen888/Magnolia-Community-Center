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

-- ---------- table access (explicit, so it works even if "auto-expose tables" is off) ----------
grant usage on schema public to anon, authenticated;
grant select on public.profiles to authenticated;
grant select, insert, update, delete on public.signups to authenticated;
grant select on public.settings to anon, authenticated;
grant update on public.settings to authenticated;
grant execute on function public.is_admin(), public.org_today() to anon, authenticated;

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

-- ---------- announcement (admins edit it from the Admin tab) ----------
alter table public.settings add column if not exists announcement text not null default ''
  check (char_length(announcement) <= 280);

-- ---------- waitlist ----------
create table if not exists public.waitlist (
  id         bigint generated always as identity primary key,
  user_id    uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  shift_date date not null,
  shift_id   text not null check (char_length(shift_id) <= 12),
  created_at timestamptz not null default now(),
  unique (user_id, shift_date, shift_id)
);
grant select, insert, delete on public.waitlist to authenticated;
alter table public.waitlist enable row level security;
drop policy if exists "read waitlist" on public.waitlist;
create policy "read waitlist" on public.waitlist for select to authenticated using (true);
drop policy if exists "join waitlist" on public.waitlist;
create policy "join waitlist" on public.waitlist for insert to authenticated
  with check (user_id = auth.uid() and shift_date >= public.org_today());
drop policy if exists "leave waitlist" on public.waitlist;
create policy "leave waitlist" on public.waitlist for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- When a lane opens up (someone drops or switches lanes), give it to the first person waiting.
create or replace function public.fill_from_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record;
begin
  if tg_op = 'UPDATE' and old.lane = new.lane and old.shift_date = new.shift_date and old.shift_id = new.shift_id then
    return new;
  end if;
  if old.shift_date >= public.org_today() then
    select * into w from public.waitlist wl
      where wl.shift_date = old.shift_date and wl.shift_id = old.shift_id
        and not exists (select 1 from public.signups s
                        where s.user_id = wl.user_id and s.shift_date = wl.shift_date and s.shift_id = wl.shift_id)
      order by wl.created_at limit 1 for update skip locked;
    if found then
      insert into public.signups (user_id, shift_date, shift_id, lane)
        values (w.user_id, old.shift_date, old.shift_id, old.lane) on conflict do nothing;
      delete from public.waitlist where id = w.id;
    end if;
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists signups_fill_waitlist on public.signups;
create trigger signups_fill_waitlist after delete or update on public.signups
  for each row execute function public.fill_from_waitlist();

-- Taking a lane directly removes you from that shift's waitlist.
create or replace function public.clear_own_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.waitlist where user_id = new.user_id and shift_date = new.shift_date and shift_id = new.shift_id;
  return new;
end $$;
drop trigger if exists signups_clear_waitlist on public.signups;
create trigger signups_clear_waitlist after insert on public.signups
  for each row execute function public.clear_own_waitlist();

do $$ begin
  alter publication supabase_realtime add table public.waitlist;
exception when duplicate_object then null; end $$;

-- ---------- admin management (used by the Admin tab) ----------
-- Admins can see everyone's name + email and promote/demote other admins.
create or replace function public.admin_people()
returns table (id uuid, name text, email text, is_admin boolean, created_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  return query
    select p.id, p.name, u.email::text, p.is_admin, p.created_at
    from public.profiles p join auth.users u on u.id = p.id
    order by p.created_at;
end $$;

create or replace function public.set_admin(target uuid, make_admin boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'Admins only' using errcode = '42501'; end if;
  if target = auth.uid() and not make_admin then
    raise exception 'You can''t remove your own admin access' using errcode = '42501';
  end if;
  update public.profiles set is_admin = make_admin where id = target;
end $$;

-- First person to sign in on a brand-new board can claim admin. Does nothing once an admin exists.
create or replace function public.claim_first_admin()
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then return false; end if;
  perform pg_advisory_xact_lock(4242);
  if exists (select 1 from public.profiles where is_admin) then return false; end if;
  update public.profiles set is_admin = true where id = auth.uid();
  return true;
end $$;

create or replace function public.has_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where is_admin)
$$;

revoke execute on function public.admin_people(), public.set_admin(uuid, boolean),
  public.claim_first_admin() from public, anon;
grant execute on function public.admin_people(), public.set_admin(uuid, boolean),
  public.claim_first_admin(), public.has_admin() to authenticated;

-- ---------- email reminders (sent nightly by /api/remind on Vercel) ----------
alter table public.profiles add column if not exists reminders boolean not null default true;
grant update (name, reminders) on public.profiles to authenticated;

-- Everyone working on a given day who wants reminders. Only the server (secret key) can call this.
create or replace function public.reminder_list(day date)
returns table (email text, name text, shift_id text, lane smallint)
language sql stable security definer set search_path = public as $$
  select u.email::text, p.name, s.shift_id, s.lane
  from public.signups s
  join public.profiles p on p.id = s.user_id
  join auth.users u on u.id = s.user_id
  where s.shift_date = day and p.reminders and u.email is not null
  order by u.email, s.shift_id
$$;
revoke execute on function public.reminder_list(date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.reminder_list(date) to service_role;
  end if;
end $$;

-- ---------- admins can assign anyone to a lane (any date, for logging attendance too) ----------
drop policy if exists "admins assign" on public.signups;
create policy "admins assign" on public.signups
  for insert to authenticated with check (public.is_admin());
drop policy if exists "admins move" on public.signups;
create policy "admins move" on public.signups
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------- manual fallback: make someone an admin by email ----------
-- update public.profiles set is_admin = true
--   where id = (select id from auth.users where email = 'you@example.com');
