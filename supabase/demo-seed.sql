-- Demo DSPs + 3 weeks of shifts, for presentations. Remove any time: HR tab → "Remove demo data".
-- Safe to re-run (it clears old demo data first).
delete from public.employees where demo;

insert into public.employees (name, level, hire_date, weekly_target, has_license, has_cna, teams, demo)
select v.name, v.level, current_date - v.days, v.target, v.lic, v.cna,
       array(select id from public.teams where key = any (v.keys) order by sort), true
from (values
  ('Sally Thompson','DSP I',   40, 40, true,  false, array['outings','house','learning']),
  ('Marcus Johnson','Lead DSP',900, 40, true,  true,  array['outings']),
  ('Keisha Brown',  'DSP II',  300, 40, true,  false, array['outings','campus']),
  ('Andre Williams','DSP I',    60, 40, true,  false, array['outings']),
  ('Tanya Davis',   'Lead DSP',1400,40, false, true,  array['house']),
  ('Robert Lee',    'DSP II',  420, 40, false, false, array['house']),
  ('Gloria Martin', 'DSP II',  250, 32, false, false, array['house','learning']),
  ('Devon Harris',  'DSP I',    20, 40, false, false, array['house']),
  ('Linda Nguyen',  'DSP I',    90, 40, false, false, array['house']),
  ('Chris Jackson', 'Lead DSP',700, 40, true,  false, array['campus']),
  ('Maria Lopez',   'DSP II',  365, 40, false, false, array['campus']),
  ('Jamal Carter',  'DSP I',    45, 40, false, false, array['campus','learning']),
  ('Brianna White', 'Lead DSP',1100,40, false, true,  array['learning']),
  ('Ethan Clark',   'DSP II',  200, 40, true,  false, array['learning','outings']),
  ('Nia Robinson',  'DSP I',    30, 24, false, false, array['learning']),
  ('Paul Walker',   'DSP II',  500, 40, false, false, array['house','campus'])
) as v(name, level, days, target, lic, cna, keys);

-- spread shifts over the next 21 days: most people get 8-hour days (two back-to-back blocks)
do $$
declare e record; d date; b int; t int; i int := 0;
begin
  for e in select * from public.employees where demo order by name loop
    i := i + 1;
    for k in -14..20 loop
      d := current_date + k;
      continue when extract(dow from d) in (0, 6) and (i % 3) <> 0;   -- most work weekdays
      continue when ((k + i) % 7 + 7) % 7 in (5, 6);                              -- two days off a week
      t := e.teams[1 + (((k + i) % array_length(e.teams, 1)) + array_length(e.teams, 1)) % array_length(e.teams, 1)];
      b := case when (select key from public.teams where id = t) = 'house' and i % 4 = 0 then 0 else 2 + (((k + i) % 2) + 2) % 2 end;
      begin
        insert into public.dsp_signups (employee_id, shift_date, block, team_id) values (e.id, d, b, t);
        insert into public.dsp_signups (employee_id, shift_date, block, team_id) values (e.id, d, b + 1, t);
      exception when others then null;  -- full or not staffed that block: skip
      end;
    end loop;
  end loop;
end $$;
