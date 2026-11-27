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

-- =====================================================================================
-- v2.3: tell HR about unfilled shifts (so they know how many temp DSPs to request). Safe to re-run.
-- =====================================================================================

-- every slot starting in the next p_hours hours that still has open spots
create or replace function public.dsp_open_slots(p_hours int default 48)
returns table (shift_date date, block int, team text, place text, need int, have int)
language sql stable security definer set search_path = public as $$
  with days as (
    select g::date as d from generate_series(public.org_today(), public.org_today() + (p_hours / 24 + 1), interval '1 day') g
  ), u as (
    select d.d, b.b, t.id as team_id, t.sort as ts, coalesce(nullif(t.short_name, ''), t.name) as team,
           h.id as home_id, null::int as cluster_no, h.name as place, h.sort as o
    from days d cross join generate_series(0, 5) b(b)
    join public.teams t on t.active and t.staffing = 'home' and t.needs[b.b + 1] > 0
    cross join public.homes h
    union all
    select d.d, b.b, t.id, t.sort, coalesce(nullif(t.short_name, ''), t.name), null, c.cluster_no, 'Cluster ' || c.cluster_no, c.cluster_no
    from days d cross join generate_series(0, 5) b(b)
    join public.teams t on t.active and t.staffing = 'cluster' and t.needs[b.b + 1] > 0
    join (select distinct month, cluster_no from public.resident_clusters) c
      on c.month = to_char(d.d, 'YYYY-MM') and public.cluster_block(t.id, d.d, c.cluster_no) = b.b
    union all
    select d.d, b.b, t.id, t.sort, coalesce(nullif(t.short_name, ''), t.name), null, null, '', 0
    from days d cross join generate_series(0, 5) b(b)
    join public.teams t on t.active and t.needs[b.b + 1] > 0
      and (t.staffing = 'fixed' or (t.staffing = 'cluster'
           and not exists (select 1 from public.resident_clusters where month = to_char(d.d, 'YYYY-MM'))))
  ), x as (
    select u.*, public.slot_need(u.team_id, u.d, u.b, u.home_id, u.cluster_no) as need,
           public.slot_count(u.d, u.b, u.team_id, u.home_id, u.cluster_no) as have
    from u
    where public.shift_starts_at(u.d, u.b) > now()
      and public.shift_starts_at(u.d, u.b) <= now() + make_interval(hours => p_hours)
  )
  select x.d, x.b, x.team, x.place, x.need, x.have from x where x.need > x.have order by x.d, x.b, x.ts, x.o
$$;

-- one HR summary per day: the first caller for a day gets true
create table if not exists public.hr_digest_log (day date primary key, sent_at timestamptz not null default now());
alter table public.hr_digest_log enable row level security;  -- server only

create or replace function public.hr_digest_claim(p_day date) returns boolean
language plpgsql security definer set search_path = public as $$
begin
  insert into public.hr_digest_log (day) values (p_day) on conflict do nothing;
  return found;
end $$;

create or replace function public.hr_contacts()
returns table (user_id uuid, email text, name text)
language sql stable security definer set search_path = public as $$
  select p.id, u.email::text, p.name from public.profiles p join auth.users u on u.id = p.id where p.is_admin
$$;

revoke execute on function public.dsp_open_slots(int), public.hr_digest_claim(date), public.hr_contacts() from public, anon, authenticated;
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.dsp_open_slots(int), public.hr_digest_claim(date), public.hr_contacts() to service_role;
  end if;
end $$;

-- =====================================================================================
-- v2.4: HR can mark open spots as covered by a temp (agency) DSP. Safe to re-run.
-- A booked temp fills a spot: it stops counting as open, and gives a record of temp hours used.
-- =====================================================================================
create table if not exists public.temp_cover (
  id         bigint generated always as identity primary key,
  shift_date date not null,
  block      smallint not null check (block between 0 and 5),
  team_id    int not null references public.teams(id) on delete cascade,
  home_id    int references public.homes(id) on delete cascade,
  cluster_no smallint,
  count      smallint not null check (count between 1 and 30),
  created_at timestamptz not null default now()
);
create unique index if not exists temp_cover_slot on public.temp_cover (shift_date, block, team_id, coalesce(home_id, 0), coalesce(cluster_no, 0));
alter table public.temp_cover enable row level security;
grant select on public.temp_cover to authenticated;
drop policy if exists "read temps" on public.temp_cover;
create policy "read temps" on public.temp_cover for select to authenticated using (true);
do $$ begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then grant all on public.temp_cover to service_role; end if;
end $$;

-- spots taken in a slot = DSP sign-ups + temps HR has booked
create or replace function public.slot_count(p_date date, p_block int, p_team int, p_home int, p_cluster int, p_skip bigint default null)
returns int language sql stable security definer set search_path = public as $$
  select (select count(*)::int from public.dsp_signups
          where shift_date = p_date and block = p_block and team_id = p_team
            and home_id is not distinct from p_home and cluster_no is not distinct from p_cluster and id is distinct from p_skip)
       + coalesce((select sum(count)::int from public.temp_cover
          where shift_date = p_date and block = p_block and team_id = p_team
            and home_id is not distinct from p_home and cluster_no is not distinct from p_cluster), 0)
$$;

-- HR sets how many temps are booked for one slot (0 removes them)
create or replace function public.hr_set_temps(p_date date, p_block int, p_team int, p_home int, p_cluster int, p_count int)
returns void language plpgsql security definer set search_path = public as $$
declare need int; dsps int;
begin
  if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
  perform public.slot_lock(p_date, p_block, p_team, p_home, p_cluster);
  delete from public.temp_cover where shift_date = p_date and block = p_block and team_id = p_team
    and home_id is not distinct from p_home and cluster_no is not distinct from p_cluster;
  if coalesce(p_count, 0) <= 0 then return; end if;
  need := public.slot_need(p_team, p_date, p_block, p_home, p_cluster);
  if need <= 0 then raise exception 'That slot doesn''t exist' using errcode = 'P0001'; end if;
  dsps := public.slot_count(p_date, p_block, p_team, p_home, p_cluster);
  if dsps + p_count > need then raise exception 'Only % spot(s) open there', greatest(need - dsps, 0) using errcode = 'P0001'; end if;
  insert into public.temp_cover (shift_date, block, team_id, home_id, cluster_no, count) values (p_date, p_block, p_team, p_home, p_cluster, p_count);
end $$;
revoke execute on function public.hr_set_temps(date, int, int, int, int, int) from public, anon;
grant execute on function public.hr_set_temps(date, int, int, int, int, int) to authenticated;

do $$ begin alter publication supabase_realtime add table public.temp_cover; exception when duplicate_object then null; end $$;

-- =====================================================================================
-- v2.5: time off, call-outs, shift swaps (offer → claim → approve), temp-hours history. Safe to re-run.
-- =====================================================================================

-- message every HR admin (goes out by push/email on the next /api/notify run)
create or replace function public.notify_hr(p_title text, p_body text) returns void
language sql security definer set search_path = public as $$
  insert into public.notify_queue (employee_id, title, body)
  select e.id, p_title, p_body from public.employees e join public.profiles p on p.id = e.user_id where p.is_admin
$$;
revoke execute on function public.notify_hr(text, text) from public, anon, authenticated;

create or replace function public.slot_label(p_date date, p_block int, p_team int, p_home int, p_cluster int) returns text
language sql stable security definer set search_path = public as $$
  select to_char(p_date, 'Dy Mon FMDD') || ' ' || (array['12–4 AM','4–8 AM','8 AM–12 PM','12–4 PM','4–8 PM','8 PM–12 AM'])[p_block + 1]
    || ' · ' || coalesce((select coalesce(nullif(short_name, ''), name) from public.teams where id = p_team), '')
    || coalesce(' · ' || (select name from public.homes where id = p_home), '')
    || coalesce(' · Cluster ' || p_cluster, '')
$$;

-- ---------- time off: days a DSP can't work ----------
create table if not exists public.time_off (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  day         date not null,
  note        text not null default '' check (char_length(note) <= 120),
  created_at  timestamptz not null default now(),
  unique (employee_id, day)
);
alter table public.time_off enable row level security;
grant select, insert, delete on public.time_off to authenticated;
drop policy if exists "read time off" on public.time_off;
create policy "read time off" on public.time_off for select to authenticated using (true);
drop policy if exists "add time off" on public.time_off;
create policy "add time off" on public.time_off for insert to authenticated
  with check (public.is_admin() or (employee_id = public.my_employee_id() and day >= public.org_today()));
drop policy if exists "remove time off" on public.time_off;
create policy "remove time off" on public.time_off for delete to authenticated
  using (public.is_admin() or employee_id = public.my_employee_id());

-- ---------- call-outs: "I can't make it" inside 48 hours ----------
create table if not exists public.callouts (
  id          bigint generated always as identity primary key,
  employee_id uuid not null references public.employees(id) on delete cascade,
  shift_date  date not null,
  block       smallint not null,
  team_id     int references public.teams(id) on delete set null,
  home_id     int references public.homes(id) on delete set null,
  cluster_no  smallint,
  reason      text not null default '',
  filled_by   uuid references public.employees(id) on delete set null,
  created_at  timestamptz not null default now()
);
alter table public.callouts enable row level security;
grant select on public.callouts to authenticated;
drop policy if exists "read callouts" on public.callouts;
create policy "read callouts" on public.callouts for select to authenticated
  using (public.is_admin() or employee_id = public.my_employee_id());

-- removes the shift (even inside 48 hours), lets the waitlist fill it, and tells HR either way
create or replace function public.call_out(p_signup bigint, p_reason text default '')
returns boolean language plpgsql security definer set search_path = public as $$
declare s public.dsp_signups; before int; filler uuid; who text;
begin
  select * into s from public.dsp_signups where id = p_signup;
  if not found then raise exception 'That shift is already gone' using errcode = 'P0001'; end if;
  if not (public.is_admin() or s.employee_id = public.my_employee_id()) then raise exception 'Not your shift' using errcode = '42501'; end if;
  if public.shift_starts_at(s.shift_date, s.block) <= now() then raise exception 'That shift already started' using errcode = 'P0001'; end if;
  select count(*) into before from public.dsp_signups where shift_date = s.shift_date and block = s.block and team_id = s.team_id
    and home_id is not distinct from s.home_id and cluster_no is not distinct from s.cluster_no;
  delete from public.dsp_signups where id = p_signup;   -- the waitlist trigger fills the spot if someone is waiting
  if (select count(*) from public.dsp_signups where shift_date = s.shift_date and block = s.block and team_id = s.team_id
        and home_id is not distinct from s.home_id and cluster_no is not distinct from s.cluster_no) = before then
    select employee_id into filler from public.dsp_signups where shift_date = s.shift_date and block = s.block and team_id = s.team_id
      and home_id is not distinct from s.home_id and cluster_no is not distinct from s.cluster_no order by id desc limit 1;
  end if;
  insert into public.callouts (employee_id, shift_date, block, team_id, home_id, cluster_no, reason, filled_by)
  values (s.employee_id, s.shift_date, s.block, s.team_id, s.home_id, s.cluster_no, left(coalesce(p_reason, ''), 200), filler);
  select name into who from public.employees where id = s.employee_id;
  perform public.notify_hr('Call-out: ' || coalesce(nullif(who, ''), 'A DSP'),
    public.slot_label(s.shift_date, s.block, s.team_id, s.home_id, s.cluster_no) ||
    case when filler is not null then '. Covered from the waitlist by ' || coalesce((select name from public.employees where id = filler), 'a DSP') || '.'
         else '. Nobody was waiting: this spot needs a temp or an assignment.' end);
  return filler is not null;
end $$;
revoke execute on function public.call_out(bigint, text) from public, anon;
grant execute on function public.call_out(bigint, text) to authenticated;

-- ---------- shift swaps: offer a shift, a teammate claims it, HR or a Lead DSP approves ----------
create table if not exists public.shift_offers (
  id            bigint generated always as identity primary key,
  signup_id     bigint not null unique references public.dsp_signups(id) on delete cascade,
  from_employee uuid not null references public.employees(id) on delete cascade,
  to_employee   uuid references public.employees(id) on delete set null,
  status        text not null default 'open' check (status in ('open', 'claimed')),
  created_at    timestamptz not null default now()
);
alter table public.shift_offers enable row level security;
grant select on public.shift_offers to authenticated;
drop policy if exists "read offers" on public.shift_offers;
create policy "read offers" on public.shift_offers for select to authenticated using (true);

create or replace function public.is_lead_for(p_team int) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.employees where id = public.my_employee_id() and level = 'Lead DSP' and p_team = any (teams))
$$;

create or replace function public.offer_shift(p_signup bigint) returns void
language plpgsql security definer set search_path = public as $$
declare s public.dsp_signups;
begin
  select * into s from public.dsp_signups where id = p_signup;
  if not found or s.employee_id is distinct from public.my_employee_id() then raise exception 'Not your shift' using errcode = '42501'; end if;
  if public.shift_starts_at(s.shift_date, s.block) <= now() then raise exception 'That shift already started' using errcode = 'P0001'; end if;
  insert into public.shift_offers (signup_id, from_employee) values (p_signup, s.employee_id) on conflict (signup_id) do nothing;
end $$;

create or replace function public.cancel_offer(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
begin
  delete from public.shift_offers where id = p_id and (public.is_admin() or from_employee = public.my_employee_id());
end $$;

create or replace function public.claim_offer(p_id bigint) returns void
language plpgsql security definer set search_path = public as $$
declare o public.shift_offers; s public.dsp_signups; me uuid := public.my_employee_id();
begin
  select * into o from public.shift_offers where id = p_id for update;
  if not found or o.status <> 'open' then raise exception 'Someone already claimed that shift' using errcode = 'P0001'; end if;
  select * into s from public.dsp_signups where id = o.signup_id;
  if me is null or me = o.from_employee then raise exception 'You can''t claim your own shift' using errcode = 'P0001'; end if;
  if not exists (select 1 from public.employees where id = me and active and s.team_id = any (teams)) then raise exception 'That shift is on a team you''re not on' using errcode = 'P0001'; end if;
  if exists (select 1 from public.dsp_signups where employee_id = me and shift_date = s.shift_date and block = s.block) then raise exception 'You already work at that time' using errcode = 'P0001'; end if;
  update public.shift_offers set status = 'claimed', to_employee = me where id = p_id;
  perform public.notify_hr('Shift swap needs approval',
    coalesce((select nullif(name, '') from public.employees where id = me), 'A DSP') || ' wants to take ' ||
    coalesce((select nullif(name, '') from public.employees where id = o.from_employee), 'a DSP') || '''s shift: ' ||
    public.slot_label(s.shift_date, s.block, s.team_id, s.home_id, s.cluster_no) || '.');
end $$;

create or replace function public.decide_offer(p_id bigint, p_ok boolean) returns void
language plpgsql security definer set search_path = public as $$
declare o public.shift_offers; s public.dsp_signups; lbl text;
begin
  select * into o from public.shift_offers where id = p_id for update;
  if not found or o.status <> 'claimed' or o.to_employee is null then raise exception 'Nothing to approve there' using errcode = 'P0001'; end if;
  select * into s from public.dsp_signups where id = o.signup_id;
  if not (public.is_admin() or public.is_lead_for(s.team_id)) then raise exception 'HR or the team''s Lead DSP approves swaps' using errcode = '42501'; end if;
  lbl := public.slot_label(s.shift_date, s.block, s.team_id, s.home_id, s.cluster_no);
  if p_ok then
    if exists (select 1 from public.dsp_signups where employee_id = o.to_employee and shift_date = s.shift_date and block = s.block) then
      raise exception 'They already work at that time now' using errcode = 'P0001'; end if;
    update public.dsp_signups set employee_id = o.to_employee where id = s.id;
    delete from public.alert_log where signup_id = s.id;       -- the new person gets fresh reminders
    delete from public.shift_offers where id = p_id;
    insert into public.notify_queue (employee_id, title, body) values
      (o.to_employee, 'Swap approved', 'You now have ' || lbl || '.'),
      (o.from_employee, 'Swap approved', 'You''re off ' || lbl || '.');
  else
    update public.shift_offers set status = 'open', to_employee = null where id = p_id;
    insert into public.notify_queue (employee_id, title, body) values (o.to_employee, 'Swap not approved', lbl || ' stays with the original DSP for now.');
  end if;
end $$;
revoke execute on function public.offer_shift(bigint), public.cancel_offer(bigint), public.claim_offer(bigint), public.decide_offer(bigint, boolean) from public, anon;
grant execute on function public.offer_shift(bigint), public.cancel_offer(bigint), public.claim_offer(bigint), public.decide_offer(bigint, boolean), public.is_lead_for(int) to authenticated;

-- ---------- temp hours history (for the monthly trend) ----------
alter table public.temp_cover add column if not exists demo boolean not null default false;
create or replace function public.temp_hours_history(p_months int default 6)
returns table (month text, team_id int, home_id int, hours int)
language sql stable security definer set search_path = public as $$
  select to_char(shift_date, 'YYYY-MM'), team_id, home_id, (sum(count) * 4)::int
  from public.temp_cover
  where public.is_admin() and shift_date >= date_trunc('month', public.org_today()) - make_interval(months => p_months - 1)
    and shift_date <= public.org_today() + 7
  group by 1, 2, 3
$$;
create or replace function public.hr_wipe_demo_extras() returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
  delete from public.temp_cover where demo;
end $$;
revoke execute on function public.temp_hours_history(int), public.hr_wipe_demo_extras() from public, anon;
grant execute on function public.temp_hours_history(int), public.hr_wipe_demo_extras() to authenticated;

do $$ begin alter publication supabase_realtime add table public.shift_offers; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.time_off;     exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.callouts;     exception when duplicate_object then null; end $$;


-- =====================================================================================
-- v2.6: clusters stay the same from month to month (HR can still reshuffle). Safe to re-run.
-- =====================================================================================
create or replace function public.generate_clusters(p_month text, p_reshuffle boolean default false)
returns int language plpgsql security definer set search_path = public as $$
declare n int; k int; r record; i int; best int; sizes int[]; ones int[];
begin
  if p_month !~ '^\d{4}-\d{2}$' then raise exception 'Bad month' using errcode = 'P0001'; end if;
  perform pg_advisory_xact_lock(hashtext('clusters:' || p_month));
  if p_reshuffle then
    if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
    delete from public.resident_clusters where month >= p_month;   -- later months copy this one again
  elsif not exists (select 1 from public.resident_clusters where month = p_month) then
    -- clusters stay the same each month: start from the latest earlier month
    insert into public.resident_clusters (month, resident_id, cluster_no)
    select p_month, c.resident_id, c.cluster_no from public.resident_clusters c join public.residents keep on keep.id = c.resident_id and keep.active
    where c.month = (select max(month) from public.resident_clusters where month < p_month);
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

-- make months after this one match it
delete from public.resident_clusters where month > to_char(public.org_today(), 'YYYY-MM');
select public.generate_clusters(to_char(public.org_today() + 31, 'YYYY-MM'), false);

-- =====================================================================================
-- v2.7: monthly sign-up windows by rank, 3-day cancel rule with a waitlist, licenses for outings. Safe to re-run.
-- A month's schedule opens in the month before: Lead DSPs the 2nd week (weeks start Monday; week 1 holds the 1st),
-- DSP IIs a week later, DSP Is a week after that. It closes the Sunday before that month's last week
-- (the week holding its last day), but DSP Is always get at least a week. Same rule as signupWindow() in data.js.
-- =====================================================================================
create or replace function public.signup_window(p_date date)
returns table (lead date, ii date, i date, closes date)
language sql immutable as $$
  with b as (
    select (date_trunc('month', p_date) - interval '1 month')::date as first_prev,
           (date_trunc('month', p_date) - interval '1 day')::date as last_prev
  ), w as (
    select date_trunc('week', first_prev)::date as wk1, date_trunc('week', last_prev)::date - 1 as close0 from b
  )
  select wk1 + 7, wk1 + 14, wk1 + 21, greatest(close0, wk1 + 27) from w
$$;

-- Priority sign-up: a DSP's first month (hired within 45 days of the month starting) and merit award winners
-- (HR sets priority_month) pick a week before Lead DSPs.
alter table public.employees add column if not exists priority_month text;
create or replace function public.sign_rank(p_level text, p_hire date, p_priority text, p_date date) returns text
language sql stable as $$
  select case when p_priority = to_char(p_date, 'YYYY-MM')
                or (p_hire is not null and p_hire >= date_trunc('month', p_date)::date - 45) then 'Priority' else p_level end
$$;
create or replace function public.pick_open(p_level text, p_date date) returns boolean
language sql stable as $$
  select public.org_today() between (case p_level when 'Priority' then w.lead - 7 when 'Lead DSP' then w.lead when 'DSP II' then w.ii else w.i end) and w.closes
  from public.signup_window(p_date) w
$$;
create or replace function public.pick_opened(p_level text, p_date date) returns boolean
language sql stable as $$
  select public.org_today() >= (case p_level when 'Priority' then w.lead - 7 when 'Lead DSP' then w.lead when 'DSP II' then w.ii else w.i end)
  from public.signup_window(p_date) w
$$;
create or replace function public.hr_set_priority(p_id uuid, p_month text) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'HR only' using errcode = '42501'; end if;
  update public.employees set priority_month = nullif(p_month, '') where id = p_id;
end $$;
grant execute on function public.sign_rank(text, date, text, date), public.hr_set_priority(uuid, text) to authenticated;
grant execute on function public.signup_window(date), public.pick_open(text, date), public.pick_opened(text, date) to authenticated;

-- DSPs take shifts only on their own teams, inside their rank's window, and outings only with a license
drop policy if exists "take own shift" on public.dsp_signups;
create policy "take own shift" on public.dsp_signups for insert to authenticated with check (
  public.is_admin() or exists (
    select 1 from public.employees e join public.teams t on t.id = team_id
    where e.id = public.my_employee_id() and e.id = employee_id and e.active
      and shift_date >= public.org_today()
      and public.pick_open(public.sign_rank(e.level, e.hire_date, e.priority_month, shift_date), shift_date)
      and not public.week_locked(shift_date)
      and team_id = any (e.teams)
      and (not t.needs_license or e.has_license)
  ));

-- waitlists open with your window and stay open after sign-up closes
drop policy if exists "join waitlist" on public.dsp_waitlist;
create policy "join waitlist" on public.dsp_waitlist for insert to authenticated with check (
  public.is_admin() or exists (
    select 1 from public.employees e join public.teams t on t.id = team_id
    where e.id = public.my_employee_id() and e.id = employee_id and e.active
      and shift_date >= public.org_today()
      and public.pick_opened(public.sign_rank(e.level, e.hire_date, e.priority_month, shift_date), shift_date)
      and team_id = any (e.teams)
      and (not t.needs_license or e.has_license)
  ));

-- cancel only 3+ days ahead AND when someone is waiting to take it (the waitlist trigger hands it over); HR can always remove
drop policy if exists "drop own shift" on public.dsp_signups;
create policy "drop own shift" on public.dsp_signups for delete to authenticated using (
  public.is_admin() or (
    employee_id = public.my_employee_id()
    and public.shift_starts_at(shift_date, block) > now() + interval '72 hours'
    and exists (select 1 from public.dsp_waitlist w where w.shift_date = dsp_signups.shift_date and w.block = dsp_signups.block
                and w.team_id = dsp_signups.team_id and w.home_id is not distinct from dsp_signups.home_id
                and w.cluster_no is not distinct from dsp_signups.cluster_no)
  ));

-- emergency call-outs are for the last 3 days; earlier than that, cancel (with a waitlist) or swap
create or replace function public.call_out_guard() returns trigger language plpgsql as $$ begin return new; end $$;
do $$ declare src text; begin
  select prosrc into src from pg_proc where proname = 'call_out';
  if src is not null and position('72 hours' in src) = 0 then
    execute replace(pg_get_functiondef('public.call_out(bigint, text)'::regprocedure),
      'if public.shift_starts_at(s.shift_date, s.block) <= now() then raise exception ''That shift already started'' using errcode = ''P0001''; end if;',
      'if public.shift_starts_at(s.shift_date, s.block) <= now() then raise exception ''That shift already started'' using errcode = ''P0001''; end if;
  if not public.is_admin() and public.shift_starts_at(s.shift_date, s.block) > now() + interval ''72 hours'' then
    raise exception ''More than 3 days out: cancel it (when someone is waiting) or offer it to a teammate'' using errcode = ''P0001''; end if;');
  end if;
end $$;
drop function if exists public.call_out_guard();


-- ---------- shift preferences (days / times a DSP likes to work; used by "Fill my week") ----------
alter table public.employees add column if not exists prefs jsonb;
grant update (prefs) on public.employees to authenticated;
