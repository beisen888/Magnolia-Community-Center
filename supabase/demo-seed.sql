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

-- 120 day residents = 6 per home across 20 homes, which makes 15 outing clusters of 8
update public.homes set residents = 6;

-- demo residents: first names only, as many per home as the Homes tab says; about 1 in 9 needs their own DSP
insert into public.residents (first_name, home_id, own_dsp, demo)
select (array['James','Mary','Darnell','Linda','Kevin','Angela','Tyrone','Denise','Brandon','Monique','Eric','Shanice',
              'Joseph','Patricia','Marcus','Yolanda','Henry','Carla','Isaiah','Renee','Louis','Bernadette','Calvin','Tasha',
              'Victor','Jasmine','Wendell','Lorraine','Oscar','Keyana','Raymond','Felicia','Terrence','Gwen','Alvin','Dana'])
       [1 + (h.sort * 5 + g * 11) % 36], h.id, (h.sort * 7 + g) % 9 = 4, true
from public.homes h, generate_series(1, h.residents) g;

select public.generate_clusters(to_char(current_date, 'YYYY-MM'), false);
select public.generate_clusters(to_char(current_date + 31, 'YYYY-MM'), false);

-- outing sign-ups pointing at a cluster that no longer exists (e.g. after going from 18 clusters to 15)
delete from public.dsp_signups s where s.cluster_no is not null and s.shift_date >= current_date
  and exists (select 1 from public.resident_clusters c where c.month = to_char(s.shift_date, 'YYYY-MM'))
  and not exists (select 1 from public.resident_clusters c where c.month = to_char(s.shift_date, 'YYYY-MM') and c.cluster_no = s.cluster_no);

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

-- A realistic staff: 180 House & Daily Living DSPs (3 per house per 8-hour shift, so 2 are on each day) and 24 Outings DSPs,
-- each with 2 days off a week and the odd call-out. What's left open is what HR sees under "Temps needed".
do $$
declare g int; eid uuid; h int; p int; j int; hm int; d date; di int; blk int; cl int; ht int; ot int;
  fn text[] := array['Alicia','Bernard','Camille','Darius','Elena','Frank','Grace','Hakeem','Imani','Jerome','Kayla','Lamar','Monica','Nathan','Olivia','Preston','Quiana','Rashad','Simone','Trevor'];
  ln text[] := array['Alexander','Batiste','Coleman','Dupre','Edwards','Fontenot','Guidry','Hebert','Landry'];
  ln2 text[] := array['Mitchell','Narcisse','Okafor','Picou','Reed','Toussaint'];
begin
  select id into ht from public.teams where key = 'house';
  select id into ot from public.teams where key = 'outings';
  for g in 0..179 loop
    h := g / 9; p := (g / 3) % 3; j := g % 3;
    hm := (select id from public.homes order by sort, id offset h limit 1);
    continue when hm is null or ht is null;
    insert into public.employees (name, level, hire_date, weekly_target, has_license, has_cna, teams, demo)
    values (fn[1 + g % 20] || ' ' || ln[1 + g / 20], case when g % 9 = 3 then 'Lead DSP' when g % 3 = 1 then 'DSP II' else 'DSP I' end,
            current_date - (30 + (g * 37) % 1500), 40, g % 4 = 0, g % 7 = 0, array[ht], true) returning id into eid;
    for k in -14..20 loop
      d := current_date + k; di := d - date '2000-01-03';
      continue when di % 7 in (j * 2, j * 2 + 1);
      continue when (g * 31 + di * 17) % 23 = 0;
      for blk in p * 2 .. p * 2 + 1 loop
        begin insert into public.dsp_signups (employee_id, shift_date, block, team_id, home_id) values (eid, d, blk, ht, hm);
        exception when others then null; end;
      end loop;
    end loop;
  end loop;
  for g in 0..23 loop
    continue when ot is null;
    insert into public.employees (name, level, hire_date, weekly_target, has_license, has_cna, teams, demo)
    values (fn[1 + (g * 3 + 5) % 20] || ' ' || ln2[1 + g % 6], case when g % 8 = 0 then 'Lead DSP' when g % 2 = 1 then 'DSP II' else 'DSP I' end,
            current_date - (60 + (g * 53) % 1200), 40, true, g % 5 = 0, array[ot], true) returning id into eid;
    for k in -14..20 loop
      d := current_date + k; di := d - date '2000-01-03';
      continue when (di + g) % 7 >= 5 or (g * 29 + di * 13) % 19 = 0;
      for blk in 2 + g % 2 .. 3 + g % 2 loop
        select c.cluster_no into cl from (select distinct cluster_no from public.resident_clusters where month = to_char(d, 'YYYY-MM')) c
          where public.cluster_block(ot, d, c.cluster_no) = blk
          order by public.slot_need(ot, d, blk, null, c.cluster_no) - public.slot_count(d, blk, ot, null, c.cluster_no) desc, c.cluster_no limit 1;
        continue when cl is null;
        begin insert into public.dsp_signups (employee_id, shift_date, block, team_id, cluster_no) values (eid, d, blk, ot, cl);
        exception when others then null; end;
      end loop;
    end loop;
  end loop;
end $$;
