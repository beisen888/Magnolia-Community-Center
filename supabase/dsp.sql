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
drop function if exists public.dsp_week_schedule(date);
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

-- =====================================================================================
-- v2.2: residents, monthly outing clusters, per-house sign-ups, waitlists, 48-hour drop rule, shift alerts
-- Safe to re-run. Run the whole file (or just from here down) in the Supabase SQL editor.
-- =====================================================================================

-- how a team is staffed: 'fixed' = one pool per block, 'home' = per house, 'cluster' = per monthly outing cluster
alter table public.teams add column if not exists staffing text not null default 'fixed';
do $$ begin
  alter table public.teams add constraint teams_staffing_chk check (staffing in ('fixed','home','cluster'));
exception when duplicate_object then null; end $$;
update public.teams set staffing = 'home'    where key = 'house'   and staffing = 'fixed';
update public.teams set staffing = 'cluster' where key = 'outings' and staffing = 'fixed';

-- ---------- residents (HR only enters a first name, a home and whether they need their own DSP) ----------
create table if not exists public.residents (
  id         serial primary key,
  first_name text not null check (char_length(first_name) between 1 and 40),
  home_id    int references public.homes(id) on delete set null,
  own_dsp    boolean not null default false,   -- needs their own DSP on outings (1:1)
  active     boolean not null default true,
  demo       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------- monthly outing clusters (max 8 residents each, reshuffled every month) ----------
create table if not exists public.resident_clusters (
  month       text not null check (month ~ '^\d{4}-\d{2}$'),
  resident_id int not null references public.residents(id) on delete cascade,
  cluster_no  smallint not null check (cluster_no between 1 and 99),
  primary key (month, resident_id)
);

-- Builds a month's clusters. Normal call: creates them if missing, and slots any new residents into the
-- smallest cluster. p_reshuffle (HR only) throws the month away and deals everyone again.
create or replace function public.generate_clusters(p_month text, p_reshuffle boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int; k int; r record; i int; best int; sizes int[]; ones int[];
begin
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Bad month' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('clusters:' || p_month));
  if p_reshuffle then
    if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
    delete from public.resident_clusters where month = p_month;
  end if;
  -- drop people who left
  delete from public.resident_clusters c using public.residents gone
    where c.month = p_month and c.resident_id = gone.id and not gone.active;
  select count(*) into n from public.residents where active;
  if n = 0 then return 0; end if;
  k := greatest(ceil(n / 8.0)::int, coalesce((select max(cluster_no) from public.resident_clusters where month = p_month), 0));
  sizes := array_fill(0, array[k]); ones := array_fill(0, array[k]);
  for r in select c.cluster_no, x.own_dsp from public.resident_clusters c join public.residents x on x.id = c.resident_id where c.month = p_month loop
    sizes[r.cluster_no] := sizes[r.cluster_no] + 1;
    if r.own_dsp then ones[r.cluster_no] := ones[r.cluster_no] + 1; end if;
  end loop;
  -- residents who need their own DSP go first so they spread out; everyone else fills the smallest cluster
  for r in select x.id, x.own_dsp from public.residents x
           where x.active and not exists (select 1 from public.resident_clusters c where c.month = p_month and c.resident_id = x.id)
           order by x.own_dsp desc, random() loop
    best := 0;
    for i in 1..k loop
      if sizes[i] < 8 and (best = 0 or sizes[i] < sizes[best] or (sizes[i] = sizes[best] and r.own_dsp and ones[i] < ones[best])) then best := i; end if;
    end loop;
    if best = 0 then k := k + 1; sizes := sizes || 0; ones := ones || 0; best := k; end if;
    insert into public.resident_clusters (month, resident_id, cluster_no) values (p_month, r.id, best);
    sizes[best] := sizes[best] + 1;
    if r.own_dsp then ones[best] := ones[best] + 1; end if;
  end loop;
  return k;
end $$;

-- ---------- sign-ups now name a house (House & Daily Living) or a cluster (Outings) ----------
alter table public.dsp_signups add column if not exists home_id int references public.homes(id) on delete cascade;
alter table public.dsp_signups add column if not exists cluster_no smallint;

create or replace function public.shift_starts_at(d date, b int) returns timestamptz
language sql stable as $$ select (d::timestamp + make_interval(hours => b * 4)) at time zone 'America/Chicago' $$;

-- Each outing cluster goes out once a day; its time block rotates day to day across the team's outing blocks.
create or replace function public.cluster_block(p_team int, p_date date, p_cluster int) returns int
language sql stable security definer set search_path = public as $$
  with b as (select array_agg(i - 1 order by i) as bl from public.teams t, generate_subscripts(t.needs, 1) i
             where t.id = p_team and t.needs[i] > 0)
  select bl[1 + ((p_date - date '2000-01-03') + p_cluster) % array_length(bl, 1)] from b where array_length(bl, 1) > 0
$$;

-- DSPs needed for one slot. -1 = that slot doesn't exist (wrong house/cluster for the team).
-- Outings: the team's number per block (2) + 1 for every resident in the cluster who needs their own DSP.
create or replace function public.slot_need(p_team int, p_date date, p_block int, p_home int, p_cluster int)
returns int language plpgsql stable security definer set search_path = public as $$
declare t public.teams; base int; m text := to_char(p_date, 'YYYY-MM');
begin
  select * into t from public.teams where id = p_team and active;
  if not found then return 0; end if;
  base := coalesce(t.needs[p_block + 1], 0);
  if base = 0 then return 0; end if;
  if t.staffing = 'home' then
    if p_cluster is not null or p_home is null or not exists (select 1 from public.homes where id = p_home) then return -1; end if;
    return base;
  elsif t.staffing = 'cluster' then
    if p_home is not null then return -1; end if;
    if not exists (select 1 from public.resident_clusters where month = m) then
      return case when p_cluster is null then base else -1 end;
    end if;
    if p_cluster is null or not exists (select 1 from public.resident_clusters where month = m and cluster_no = p_cluster) then return -1; end if;
    if public.cluster_block(p_team, p_date, p_cluster) is distinct from p_block then return -1; end if;
    return base + (select count(*)::int from public.resident_clusters c join public.residents r on r.id = c.resident_id
                   where c.month = m and c.cluster_no = p_cluster and r.own_dsp);
  end if;
  return case when p_home is null and p_cluster is null then base else -1 end;
end $$;

create or replace function public.slot_lock(p_date date, p_block int, p_team int, p_home int, p_cluster int) returns void
language sql as $$ select pg_advisory_xact_lock(hashtext(concat_ws(':', p_date, p_block, p_team, coalesce(p_home, 0), coalesce(p_cluster, 0)))) $$;

create or replace function public.slot_count(p_date date, p_block int, p_team int, p_home int, p_cluster int, p_skip bigint default null)
returns int language sql stable security definer set search_path = public as $$
  select count(*)::int from public.dsp_signups
  where shift_date = p_date and block = p_block and team_id = p_team
    and home_id is not distinct from p_home and cluster_no is not distinct from p_cluster and id is distinct from p_skip
$$;

create or replace function public.check_capacity() returns trigger
language plpgsql security definer set search_path = public as $$
declare need int; st text;
begin
  perform public.slot_lock(new.shift_date, new.block, new.team_id, new.home_id, new.cluster_no);
  need := public.slot_need(new.team_id, new.shift_date, new.block, new.home_id, new.cluster_no);
  if need = 0 then raise exception 'That team doesn''t work this block' using errcode = 'P0001'; end if;
  if need < 0 then
    select staffing into st from public.teams where id = new.team_id;
    raise exception '%', case st when 'home' then 'Pick which house you''re working' when 'cluster' then 'Pick which outing cluster you''re working' else 'That slot doesn''t exist' end using errcode = 'P0001';
  end if;
  if public.slot_count(new.shift_date, new.block, new.team_id, new.home_id, new.cluster_no, new.id) >= need then
    raise exception 'That shift is already full. Join the waitlist instead' using errcode = 'P0001';
  end if;
  return new;
end $$;

-- ---------- waitlists: up to 10 DSPs per full slot ----------
create table if not exists public.dsp_waitlist (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_date  date not null,
  block       smallint not null check (block between 0 and 5),
  team_id     int not null references public.teams(id) on delete cascade,
  home_id     int references public.homes(id) on delete cascade,
  cluster_no  smallint,
  created_at  timestamptz not null default now()
);
create unique index if not exists dsp_waitlist_once on public.dsp_waitlist (employee_id, shift_date, block, team_id, coalesce(home_id, 0), coalesce(cluster_no, 0));
create index if not exists dsp_waitlist_slot on public.dsp_waitlist (shift_date, block, team_id);

create or replace function public.check_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare need int;
begin
  perform public.slot_lock(new.shift_date, new.block, new.team_id, new.home_id, new.cluster_no);
  need := public.slot_need(new.team_id, new.shift_date, new.block, new.home_id, new.cluster_no);
  if need <= 0 then raise exception 'That slot doesn''t exist' using errcode = 'P0001'; end if;
  if public.slot_count(new.shift_date, new.block, new.team_id, new.home_id, new.cluster_no) < need then
    raise exception 'There''s an open spot. Take the shift instead' using errcode = 'P0001'; end if;
  if exists (select 1 from public.dsp_signups where employee_id = new.employee_id and shift_date = new.shift_date and block = new.block) then
    raise exception 'You already work at that time' using errcode = 'P0001'; end if;
  if (select count(*) from public.dsp_waitlist where shift_date = new.shift_date and block = new.block and team_id = new.team_id
        and home_id is not distinct from new.home_id and cluster_no is not distinct from new.cluster_no) >= 10 then
    raise exception 'That waitlist is full (10 people)' using errcode = 'P0001'; end if;
  return new;
end $$;
drop trigger if exists dsp_waitlist_check on public.dsp_waitlist;
create trigger dsp_waitlist_check before insert on public.dsp_waitlist for each row execute function public.check_waitlist();

-- messages waiting to go out by push/email (e.g. "you're off the waitlist")
create table if not exists public.notify_queue (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  title       text not null,
  body        text not null,
  created_at  timestamptz not null default now(),
  sent_at     timestamptz
);

-- when someone drops, the first person on that slot's waitlist gets the spot
create or replace function public.fill_from_waitlist() returns trigger
language plpgsql security definer set search_path = public as $$
declare w record; t text;
begin
  if public.shift_starts_at(old.shift_date, old.block) <= now() then return old; end if;
  for w in select * from public.dsp_waitlist
           where shift_date = old.shift_date and block = old.block and team_id = old.team_id
             and home_id is not distinct from old.home_id and cluster_no is not distinct from old.cluster_no
           order by created_at, id loop
    if exists (select 1 from public.dsp_signups where employee_id = w.employee_id and shift_date = w.shift_date and block = w.block) then
      delete from public.dsp_waitlist where id = w.id; continue;
    end if;
    begin
      insert into public.dsp_signups (employee_id, shift_date, block, team_id, home_id, cluster_no)
      values (w.employee_id, w.shift_date, w.block, w.team_id, w.home_id, w.cluster_no);
    exception when sqlstate 'P0001' then exit;  -- slot is full again
    end;
    delete from public.dsp_waitlist where id = w.id;
    select coalesce(nullif(short_name, ''), name) into t from public.teams where id = w.team_id;
    insert into public.notify_queue (employee_id, title, body) values (w.employee_id, 'You''re off the waitlist',
      'You now have the ' || to_char(w.shift_date, 'Dy Mon FMDD') || ' ' ||
      (array['12–4 AM','4–8 AM','8 AM–12 PM','12–4 PM','4–8 PM','8 PM–12 AM'])[w.block + 1] || ' shift on ' || t ||
      coalesce(' at ' || (select name from public.homes where id = w.home_id), '') ||
      coalesce(' (cluster ' || w.cluster_no || ')', '') || '.');
    exit;
  end loop;
  return old;
end $$;
drop trigger if exists dsp_signups_fill on public.dsp_signups;
create trigger dsp_signups_fill after delete on public.dsp_signups for each row execute function public.fill_from_waitlist();

-- booking a shift takes you off any other waitlist at that same time
create or replace function public.clear_my_waitlists() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  delete from public.dsp_waitlist where employee_id = new.employee_id and shift_date = new.shift_date and block = new.block;
  return new;
end $$;
drop trigger if exists dsp_signups_clearwait on public.dsp_signups;
create trigger dsp_signups_clearwait after insert on public.dsp_signups for each row execute function public.clear_my_waitlists();

-- ---------- phone alerts ----------
alter table public.settings add column if not exists vapid_public text not null default '';

create table if not exists public.push_subscriptions (
  id         bigint generated always as identity primary key,
  user_id    uuid not null references auth.users on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz not null default now()
);
create table if not exists public.alert_log (
  signup_id bigint not null references public.dsp_signups(id) on delete cascade,
  kind      text not null check (kind in ('24h','1h')),
  sent_at   timestamptz not null default now(),
  primary key (signup_id, kind)
);

create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if p_endpoint !~ '^https://' or char_length(p_endpoint) > 1000 then raise exception 'Bad subscription' using errcode = 'P0001'; end if;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values (auth.uid(), p_endpoint, p_p256dh, p_auth)
  on conflict (endpoint) do update set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth;
end $$;
create or replace function public.remove_push_subscription(p_endpoint text)
returns void language sql security definer set search_path = public as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = auth.uid()
$$;
create or replace function public.my_push_count() returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from public.push_subscriptions where user_id = auth.uid()
$$;

-- alerts that are due: '24h' (about a day before) and '1h' (about an hour before). Back-to-back blocks get one alert.
create or replace function public.dsp_due_alerts()
returns table (signup_id bigint, kind text, user_id uuid, email text, name text, reminders boolean,
               shift_date date, block smallint, next_too boolean, team text, place text, extra_min int, starts_at timestamptz)
language sql stable security definer set search_path = public as $$
  with s as (
    select s.*, public.shift_starts_at(s.shift_date, s.block) as at from public.dsp_signups s
    where s.shift_date between (now() at time zone 'America/Chicago')::date - 1 and (now() at time zone 'America/Chicago')::date + 2
  ), due as (
    select s.*, case when s.at <= now() + interval '65 minutes' then '1h' else '24h' end as k from s
    where s.at > now() and s.at <= now() + interval '24 hours 5 minutes'
      and not exists (select 1 from public.dsp_signups p where p.employee_id = s.employee_id and p.team_id = s.team_id
            and ((s.block > 0 and p.shift_date = s.shift_date and p.block = s.block - 1)
              or (s.block = 0 and p.shift_date = s.shift_date - 1 and p.block = 5)))
  )
  select d.id, d.k, e.user_id, u.email::text, e.name, coalesce(p.reminders, true), d.shift_date, d.block,
    exists (select 1 from public.dsp_signups n where n.employee_id = d.employee_id and n.team_id = d.team_id
            and ((d.block < 5 and n.shift_date = d.shift_date and n.block = d.block + 1) or (d.block = 5 and n.shift_date = d.shift_date + 1 and n.block = 0))),
    coalesce(nullif(t.short_name, ''), t.name),
    coalesce(h.name, case when d.cluster_no is not null then 'Outing cluster ' || d.cluster_no end, ''),
    case when d.cluster_no is not null and exists (select 1 from public.resident_clusters c join public.residents r on r.id = c.resident_id
      where c.month = to_char(d.shift_date, 'YYYY-MM') and c.cluster_no = d.cluster_no and r.own_dsp) then 30 else 0 end,
    d.at
  from due d
  join public.employees e on e.id = d.employee_id
  join auth.users u on u.id = e.user_id
  left join public.profiles p on p.id = e.user_id
  join public.teams t on t.id = d.team_id
  left join public.homes h on h.id = d.home_id
  where not exists (select 1 from public.alert_log l where l.signup_id = d.id and l.kind = d.k)
$$;

create or replace function public.dsp_mark_alerts(p_ids bigint[], p_kinds text[])
returns void language sql security definer set search_path = public as $$
  insert into public.alert_log (signup_id, kind)
  select i, k from unnest(p_ids, p_kinds) as x(i, k) where exists (select 1 from public.dsp_signups where id = i)
  on conflict do nothing
$$;

create or replace function public.dsp_pending_messages()
returns table (id bigint, user_id uuid, email text, name text, title text, body text)
language sql stable security definer set search_path = public as $$
  select q.id, e.user_id, u.email::text, e.name, q.title, q.body
  from public.notify_queue q join public.employees e on e.id = q.employee_id
  left join auth.users u on u.id = e.user_id
  where q.sent_at is null and q.created_at > now() - interval '2 days'
  order by q.id
$$;
create or replace function public.dsp_mark_messages(p_ids bigint[])
returns void language sql security definer set search_path = public as $$
  update public.notify_queue set sent_at = now() where id = any (p_ids)
$$;

-- the weekly "Publish & email" list now names the house or cluster
drop function if exists public.dsp_week_schedule(date);
create or replace function public.dsp_week_schedule(ws date)
returns table (email text, name text, shift_date date, block smallint, team text, place text)
language sql stable security definer set search_path = public as $$
  select u.email::text, e.name, s.shift_date, s.block, t.name,
    coalesce(h.name, case when s.cluster_no is not null then 'Outing cluster ' || s.cluster_no end, '')
  from public.dsp_signups s
  join public.employees e on e.id = s.employee_id
  join auth.users u on u.id = e.user_id
  join public.teams t on t.id = s.team_id
  left join public.homes h on h.id = s.home_id
  where s.shift_date between ws and ws + 6 and u.email is not null
  order by u.email, s.shift_date, s.block
$$;

-- ---------- access ----------
grant select on public.residents, public.resident_clusters, public.dsp_waitlist to authenticated;
grant insert, update, delete on public.residents to authenticated;
grant insert, delete on public.dsp_waitlist to authenticated;
grant usage on all sequences in schema public to authenticated;
grant execute on function public.generate_clusters(text, boolean), public.slot_need(int, date, int, int, int), public.cluster_block(int, date, int),
  public.shift_starts_at(date, int), public.save_push_subscription(text, text, text),
  public.remove_push_subscription(text), public.my_push_count() to authenticated;
revoke execute on function public.dsp_due_alerts(), public.dsp_mark_alerts(bigint[], text[]),
  public.dsp_pending_messages(), public.dsp_mark_messages(bigint[]), public.dsp_week_schedule(date) from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.dsp_due_alerts(), public.dsp_mark_alerts(bigint[], text[]),
      public.dsp_pending_messages(), public.dsp_mark_messages(bigint[]), public.dsp_week_schedule(date) to service_role;
  end if;
end $$;

alter table public.residents enable row level security;
alter table public.resident_clusters enable row level security;
alter table public.dsp_waitlist enable row level security;
alter table public.notify_queue enable row level security;      -- server only (no policies)
alter table public.push_subscriptions enable row level security; -- server only; DSPs use save/remove functions
alter table public.alert_log enable row level security;          -- server only

drop policy if exists "read residents" on public.residents;
create policy "read residents" on public.residents for select to authenticated using (true);
drop policy if exists "hr edits residents" on public.residents;
create policy "hr edits residents" on public.residents for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "read clusters" on public.resident_clusters;
create policy "read clusters" on public.resident_clusters for select to authenticated using (true);

drop policy if exists "read waitlist" on public.dsp_waitlist;
create policy "read waitlist" on public.dsp_waitlist for select to authenticated using (true);
drop policy if exists "join waitlist" on public.dsp_waitlist;
create policy "join waitlist" on public.dsp_waitlist for insert to authenticated with check (
  public.is_admin() or (
    employee_id = public.my_employee_id()
    and shift_date >= public.org_today()
    and shift_date < public.week_start(public.org_today()) + 21
    and team_id = any ((select teams from public.employees where id = public.my_employee_id())::int[])
  ));
drop policy if exists "leave waitlist" on public.dsp_waitlist;
create policy "leave waitlist" on public.dsp_waitlist for delete to authenticated using (public.is_admin() or employee_id = public.my_employee_id());

-- DSPs can drop their own shift until 48 hours before it starts (published week or not); HR can always remove
drop policy if exists "drop own shift" on public.dsp_signups;
create policy "drop own shift" on public.dsp_signups for delete to authenticated using (
  public.is_admin() or (
    employee_id = public.my_employee_id()
    and public.shift_starts_at(shift_date, block) > now() + interval '48 hours'
  ));

do $$ begin alter publication supabase_realtime add table public.dsp_waitlist;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.residents;         exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.resident_clusters; exception when duplicate_object then null; end $$;

-- House & Daily Living: 2 DSPs per house per block
update public.teams set needs = '{2,2,2,2,2,2}' where key = 'house';
-- older House sign-ups made before houses existed: spread them over the houses so they still count
alter table public.dsp_signups disable trigger dsp_signups_capacity;
update public.dsp_signups s set home_id = h.id
from (select id, row_number() over (order by sort, id) - 1 as rn, count(*) over () as n from public.homes) h
where s.home_id is null and s.team_id in (select id from public.teams where staffing = 'home') and h.rn = s.id % h.n;
alter table public.dsp_signups enable trigger dsp_signups_capacity;
