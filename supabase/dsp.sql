-- Magnolia DSP Scheduler (v2) — run AFTER schema.sql. Safe to re-run.
-- Activity-based DSP teams, 20 homes in 4 clusters, 4-hour shift blocks around the clock.
-- Blocks: 0 = 12–4 AM, 1 = 4–8 AM, 2 = 8 AM–12 PM, 3 = 12–4 PM, 4 = 4–8 PM, 5 = 8 PM–12 AM

-- ---------- teams (activity groups) ----------
create table if not exists public.teams (
  id            serial primary key,
  key           text unique not null,
  name          text not null check (char_length(name) <= 60),
  short_name    text not null default '' check (char_length(short_name) <= 24),
  description   text not null default '' check (char_length(description) <= 400),
  activities    text[] not null default '{}',
  needs_license boolean not null default false,
  needs         int[] not null default '{0,0,2,2,2,0}',  -- DSPs needed per block 0..5
  color         smallint not null default 0 check (color between 0 and 7),
  sort          smallint not null default 0,
  active        boolean not null default true
);

-- ---------- homes ----------
create table if not exists public.homes (
  id        serial primary key,
  name      text not null check (char_length(name) <= 60),
  cluster   text not null check (cluster in ('A','B','C','D')),
  location  text not null default 'Community' check (location in ('Campus','Community')),
  residents smallint not null default 6 check (residents between 0 and 20),
  sort      smallint not null default 0
);

-- ---------- employees (DSPs). user_id links a login; HR can add people who never log in ----------
create table if not exists public.employees (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid unique references auth.users on delete set null,
  name          text not null default '' check (char_length(name) <= 60),
  email         text not null default '',
  level         text not null default 'DSP I' check (level in ('DSP I','DSP II','Lead DSP')),
  hire_date     date not null default current_date,
  weekly_target smallint not null default 40 check (weekly_target between 0 and 60),
  has_license   boolean not null default false,
  has_cna       boolean not null default false,
  teams         int[] not null default '{}',
  quiz_team     int,
  active        boolean not null default true,
  demo          boolean not null default false,
  created_at    timestamptz not null default now()
);

create or replace function public.my_employee_id() returns uuid
language sql stable security definer set search_path = public as $$
  select id from public.employees where user_id = auth.uid()
$$;

-- every login gets an employee record (runs when the profile row is created)
create or replace function public.ensure_employee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.employees (user_id, name, email)
  select new.id, new.name, coalesce((select email from auth.users where id = new.id), '')
  where not exists (select 1 from public.employees where user_id = new.id);
  return new;
end $$;
drop trigger if exists profiles_ensure_employee on public.profiles;
create trigger profiles_ensure_employee after insert on public.profiles
  for each row execute function public.ensure_employee();
-- backfill people who signed up before this existed
insert into public.employees (user_id, name, email)
select p.id, p.name, coalesce(u.email, '') from public.profiles p join auth.users u on u.id = p.id
where not exists (select 1 from public.employees e where e.user_id = p.id);

-- ---------- shift sign-ups ----------
create table if not exists public.dsp_signups (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_date  date not null,
  block       smallint not null check (block between 0 and 5),
  team_id     int not null references public.teams(id) on delete cascade,
  created_at  timestamptz not null default now(),
  unique (employee_id, shift_date, block)          -- nobody is double-booked
);
create index if not exists dsp_signups_date_idx on public.dsp_signups (shift_date);

-- settings: months HR has locked (schedule published)
alter table public.settings add column if not exists locked_months text[] not null default '{}';

create or replace function public.month_locked(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select to_char(d, 'YYYY-MM') = any (coalesce((select locked_months from public.settings where id = 1), '{}'))
$$;

-- capacity: never more people than the team needs in that block
create or replace function public.check_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare need int; have int;
begin
  perform pg_advisory_xact_lock(hashtext(new.shift_date::text || ':' || new.block || ':' || new.team_id));
  select coalesce(needs[new.block + 1], 0) into need from public.teams where id = new.team_id and active;
  if coalesce(need, 0) = 0 then raise exception 'That team doesn''t work this block' using errcode = 'P0001'; end if;
  select count(*) into have from public.dsp_signups
    where shift_date = new.shift_date and block = new.block and team_id = new.team_id and id is distinct from new.id;
  if have >= need then raise exception 'That shift is already full' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists dsp_signups_capacity on public.dsp_signups;
create trigger dsp_signups_capacity before insert or update on public.dsp_signups
  for each row execute function public.check_capacity();

-- ---------- access ----------
grant select on public.teams, public.homes, public.employees, public.dsp_signups to authenticated;
grant insert, delete on public.dsp_signups to authenticated;
grant update (name, teams, has_license, has_cna, quiz_team) on public.employees to authenticated;
grant insert, update, delete on public.teams, public.homes to authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on function public.my_employee_id(), public.month_locked(date) to authenticated;

alter table public.teams enable row level security;
alter table public.homes enable row level security;
alter table public.employees enable row level security;
alter table public.dsp_signups enable row level security;

drop policy if exists "read teams" on public.teams;
create policy "read teams" on public.teams for select to authenticated using (true);
drop policy if exists "hr edits teams" on public.teams;
create policy "hr edits teams" on public.teams for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read homes" on public.homes;
create policy "read homes" on public.homes for select to authenticated using (true);
drop policy if exists "hr edits homes" on public.homes;
create policy "hr edits homes" on public.homes for all to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "read employees" on public.employees;
create policy "read employees" on public.employees for select to authenticated using (true);
drop policy if exists "edit own employee" on public.employees;
create policy "edit own employee" on public.employees for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "read shifts" on public.dsp_signups;
create policy "read shifts" on public.dsp_signups for select to authenticated using (true);
drop policy if exists "take own shift" on public.dsp_signups;
create policy "take own shift" on public.dsp_signups for insert to authenticated with check (
  public.is_admin() or (
    employee_id = public.my_employee_id()
    and shift_date >= public.org_today()
    and not public.month_locked(shift_date)
    and team_id = any ((select teams from public.employees where id = public.my_employee_id())::int[])
  ));
drop policy if exists "drop own shift" on public.dsp_signups;
create policy "drop own shift" on public.dsp_signups for delete to authenticated using (
  public.is_admin() or (
    employee_id = public.my_employee_id()
    and shift_date >= public.org_today()
    and not public.month_locked(shift_date)
  ));

-- ---------- HR (admin) actions ----------
create or replace function public.hr_save_employee(
  p_id uuid, p_name text, p_level text, p_target int, p_teams int[],
  p_license boolean, p_cna boolean, p_active boolean, p_hire date)
returns uuid language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
  if p_id is null then
    insert into public.employees (name, level, weekly_target, teams, has_license, has_cna, active, hire_date)
    values (p_name, p_level, p_target, p_teams, p_license, p_cna, p_active, coalesce(p_hire, current_date))
    returning id into rid;
  else
    update public.employees set name = p_name, level = p_level, weekly_target = p_target, teams = p_teams,
      has_license = p_license, has_cna = p_cna, active = p_active, hire_date = coalesce(p_hire, hire_date)
    where id = p_id returning id into rid;
  end if;
  return rid;
end $$;

create or replace function public.hr_set_lock(p_month text, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
  update public.settings set locked_months =
    case when p_locked then array(select distinct unnest(locked_months || p_month))
         else array_remove(locked_months, p_month) end
  where id = 1;
end $$;

create or replace function public.hr_wipe_demo()
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
  delete from public.employees where demo;
  get diagnostics n = row_count;
  return n;
end $$;

revoke execute on function public.hr_save_employee(uuid,text,text,int,int[],boolean,boolean,boolean,date),
  public.hr_set_lock(text,boolean), public.hr_wipe_demo() from public, anon;
grant execute on function public.hr_save_employee(uuid,text,text,int,int[],boolean,boolean,boolean,date),
  public.hr_set_lock(text,boolean), public.hr_wipe_demo() to authenticated;

-- ---------- reminders (v2): everyone with a login and a shift that day ----------
create or replace function public.dsp_reminder_list(day date)
returns table (email text, name text, block smallint, team text)
language sql stable security definer set search_path = public as $$
  select u.email::text, e.name, s.block, t.name
  from public.dsp_signups s
  join public.employees e on e.id = s.employee_id
  join auth.users u on u.id = e.user_id
  left join public.profiles p on p.id = e.user_id
  join public.teams t on t.id = s.team_id
  where s.shift_date = day and coalesce(p.reminders, true) and u.email is not null
  order by u.email, s.block
$$;
revoke execute on function public.dsp_reminder_list(date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.dsp_reminder_list(date) to service_role;
  end if;
end $$;

-- ---------- live updates ----------
do $$ begin alter publication supabase_realtime add table public.dsp_signups; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.employees;   exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.teams;       exception when duplicate_object then null; end $$;

-- ---------- starting teams (from the Magnolia proposal deck) ----------
insert into public.teams (key, name, short_name, description, activities, needs_license, needs, color, sort) values
 ('house', 'House & Daily Living + Job Coaches', 'House & Daily Living',
  'Keeps each home running and residents ready for the day, including job prep for Ochsner. Covers nights. No driver''s license needed.',
  array['Cooking and meal prep','Meal assistance (Meals on Wheels)','Cleaning and housekeeping','Homeroom','Daily living skills','Job prep for Ochsner'],
  false, '{2,2,2,2,2,2}', 0, 1),
 ('campus', 'On-Campus Activities', 'On-Campus',
  'Active days on the 11-acre campus: garden, fitness, sports and crafts. No driver''s license needed.',
  array['Music garden','Campus walks','Arts and crafts','Board games','Fitness center','Sports and wellness classes'],
  false, '{0,0,2,2,2,0}', 1, 2),
 ('outings', 'Community Outings', 'Outings',
  'Shopping, dining and events around New Orleans. Driver''s license required.',
  array['Lakeside Mall','Library','Dollar Tree','Off-campus lunch','Community events','Bowling at Colonial Lanes'],
  true, '{0,0,2,2,2,0}', 2, 3),
 ('learning', 'Learning & Community', 'Learning',
  'Calm, on-campus learning: reading, journaling, music and structured classes.',
  array['Storytelling and reading','Journaling','Music appreciation','Structured learning'],
  false, '{0,0,2,2,2,0}', 3, 4)
on conflict (key) do nothing;

insert into public.homes (name, cluster, location, residents, sort)
select 'Home ' || n, (array['A','B','C','D'])[((n - 1) / 5) + 1], case when n <= 5 then 'Campus' else 'Community' end, 6 + (n % 3), n
from generate_series(1, 20) n
where not exists (select 1 from public.homes);

-- ---------- v2.1: weekly publishing (replaces monthly locks for DSP sign-ups) ----------
-- DSPs pick shifts up to 3 weeks out; HR publishes one week at a time, which locks it and emails the schedule.
alter table public.settings add column if not exists locked_weeks text[] not null default '{}';

create or replace function public.week_start(d date) returns date
language sql immutable as $$ select d - (extract(isodow from d)::int - 1) $$;

create or replace function public.week_locked(d date) returns boolean
language sql stable security definer set search_path = public as $$
  select public.week_start(d)::text = any (coalesce((select locked_weeks from public.settings where id = 1), '{}'))
$$;
grant execute on function public.week_start(date), public.week_locked(date) to authenticated;

drop policy if exists "take own shift" on public.dsp_signups;
create policy "take own shift" on public.dsp_signups for insert to authenticated with check (
  public.is_admin() or (
    employee_id = public.my_employee_id()
    and shift_date >= public.org_today()
    and shift_date < public.week_start(public.org_today()) + 21
    and not public.week_locked(shift_date)
    and team_id = any ((select teams from public.employees where id = public.my_employee_id())::int[])
  ));
drop policy if exists "drop own shift" on public.dsp_signups;
create policy "drop own shift" on public.dsp_signups for delete to authenticated using (
  public.is_admin() or (
    employee_id = public.my_employee_id()
    and shift_date >= public.org_today()
    and not public.week_locked(shift_date)
  ));

create or replace function public.hr_set_week_lock(p_week text, p_locked boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
  update public.settings set locked_weeks =
    case when p_locked then array(select distinct unnest(locked_weeks || p_week))
         else array_remove(locked_weeks, p_week) end
  where id = 1;
end $$;
revoke execute on function public.hr_set_week_lock(text, boolean) from public, anon;
grant execute on function public.hr_set_week_lock(text, boolean) to authenticated;

-- a week's schedule for the "Publish & email" step (server only)
create or replace function public.dsp_week_schedule(ws date)
returns table (email text, name text, shift_date date, block smallint, team text)
language sql stable security definer set search_path = public as $$
  select u.email::text, e.name, s.shift_date, s.block, t.name
  from public.dsp_signups s
  join public.employees e on e.id = s.employee_id
  join auth.users u on u.id = e.user_id
  join public.teams t on t.id = s.team_id
  where s.shift_date between ws and ws + 6 and u.email is not null
  order by u.email, s.shift_date, s.block
$$;
revoke execute on function public.dsp_week_schedule(date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.dsp_week_schedule(date) to service_role;
  end if;
end $$;
