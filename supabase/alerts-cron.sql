-- Phone alerts timer: asks the website to send any due shift alerts every 10 minutes.
-- Run once in the Supabase SQL editor AFTER dsp.sql. Safe to re-run.
-- (Vercel's free plan can only run its own timer once a day, so Supabase does the frequent part.)
-- If your site lives at a different address, change the URL below.
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$ begin perform cron.unschedule('dsp-shift-alerts'); exception when others then null; end $$;
select cron.schedule('dsp-shift-alerts', '*/10 * * * *',
  $$ select net.http_get(url := 'https://magnolia-community-center.vercel.app/api/notify', timeout_milliseconds := 25000) $$);

-- check it:   select * from cron.job;
-- recent runs: select status, return_message, start_time from cron.job_run_details order by start_time desc limit 5;
