-- Demo DSPs, residents and 5 weeks of shifts, for presentations. Run AFTER dsp.sql.
-- Remove any time: HR tab → Settings → "Remove demo data". Safe to re-run (it clears old demo data first).
delete from public.employees where demo;
delete from public.residents where demo;

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

-- demo residents: first names only, as many per home as the Homes tab says; about 1 in 9 needs their own DSP
insert into public.residents (first_name, home_id, own_dsp, demo)
select (array['James','Mary','Darnell','Linda','Kevin','Angela','Tyrone','Denise','Brandon','Monique','Eric','Shanice',
              'Joseph','Patricia','Marcus','Yolanda','Henry','Carla','Isaiah','Renee','Louis','Bernadette','Calvin','Tasha',
              'Victor','Jasmine','Wendell','Lorraine','Oscar','Keyana','Raymond','Felicia','Terrence','Gwen','Alvin','Dana'])
       [1 + (h.sort * 5 + g * 11) % 36], h.id, (h.sort * 7 + g) % 9 = 4, true
from public.homes h, generate_series(1, h.residents) g;

select public.generate_clusters(to_char(current_date, 'YYYY-MM'), false);
select public.generate_clusters(to_char(current_date + 31, 'YYYY-MM'), false);

-- shifts from 2 weeks ago to 3 weeks out: mostly 8-hour days (two back-to-back blocks)
do $$
declare e record; d date; b int; t int; tk text; i int := 0; hm int; cl int; nh int;
begin
  select count(*) into nh from public.homes;
  for e in select * from public.employees where demo order by name loop
    i := i + 1;
    for k in -14..20 loop
      d := current_date + k;
      continue when extract(dow from d) in (0, 6) and (i % 3) <> 0;
      continue when ((k + i) % 7 + 7) % 7 in (5, 6);
      t := e.teams[1 + (((k + i) % array_length(e.teams, 1)) + array_length(e.teams, 1)) % array_length(e.teams, 1)];
      select key into tk from public.teams where id = t;
      b := case when tk = 'house' and i % 4 = 0 then 0 else 2 + (((k + i) % 2) + 2) % 2 end;
      hm := null; cl := null;
      if tk = 'house' then
        hm := (select id from public.homes order by sort, id offset (i * 3) % nh limit 1);   -- same house every time
      elsif tk = 'outings' then
        select c.cluster_no into cl from (select distinct cluster_no from public.resident_clusters where month = to_char(d, 'YYYY-MM')) c
          where public.cluster_block(t, d, c.cluster_no) = b order by (c.cluster_no + i) % 7 limit 1;
        continue when cl is null and exists (select 1 from public.resident_clusters where month = to_char(d, 'YYYY-MM'));
      end if;
      begin
        insert into public.dsp_signups (employee_id, shift_date, block, team_id, home_id, cluster_no) values (e.id, d, b, t, hm, cl);
        if tk = 'outings' and cl is not null then   -- second half of the day: whichever cluster goes out next
          select c.cluster_no into cl from (select distinct cluster_no from public.resident_clusters where month = to_char(d, 'YYYY-MM')) c
            where public.cluster_block(t, d, c.cluster_no) = b + 1 order by (c.cluster_no + i) % 7 limit 1;
        end if;
        insert into public.dsp_signups (employee_id, shift_date, block, team_id, home_id, cluster_no) values (e.id, d, b + 1, t, hm, cl);
      exception when others then null;  -- full or not staffed that block: skip
      end;
    end loop;
  end loop;
end $$;
