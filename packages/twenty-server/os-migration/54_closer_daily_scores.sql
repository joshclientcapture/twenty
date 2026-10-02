-- The closer page daily log shows the call review score next to the recording. Same function as
-- 10_closers.sql get_closer_daily, plus the callReview join. Run AFTER /os/calls/setup (table must exist).
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 54_closer_daily_scores.sql
set search_path to os, public;

create or replace function os.get_closer_daily(p_closer_id text, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with keep as (select * from os.closer_call_rows(p_closer_id, p_from, p_to) where status <> 'rescheduled'),
  scored as (
    select k.*, cr.id review_id, cr."overallScore" score, cr.status review_status
    from keep k
    left join lateral (
      select r.id, r."overallScore", r.status
      from workspace_a1aip8pgko71t0v2lrw9rnizs."callReview" r
      join os.fathom_calls f on f.recording_id::text = r."fathomRecordingId"
      where k.recording is not null and f.fathom_url = k.recording and r."deletedAt" is null
      order by r."createdAt" desc limit 1
    ) cr on true
  )
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'summary', jsonb_build_object(
      'booked', (select count(*) from keep),
      'showed', (select count(*) from keep where status='showed'),
      'no_show', (select count(*) from keep where status='no_show'),
      'in_progress', (select count(*) from keep where status='in_progress'),
      'cancelled', (select count(*) from keep where status='cancelled'),
      'upcoming', (select count(*) from keep where status='upcoming'),
      'trials', (select count(*) from keep where trialed),
      'maybe_trials', (select count(*) from keep where not trialed and maybe_email is not null),
      'show_up_rate', (select round(100.0*count(*) filter (where status='showed')/nullif(count(*) filter (where status in ('showed','no_show')),0),1) from keep)
    ),
    'daily', coalesce((select jsonb_agg(jsonb_build_object('date', d, 'booked', bk, 'showed', sh, 'no_show', ns, 'trials', tr) order by d desc)
       from (select start_time::date d, count(*) bk, count(*) filter (where status='showed') sh,
                    count(*) filter (where status='no_show') ns, count(*) filter (where trialed) tr
             from keep group by 1) q), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('key', call_key, 'time', start_time, 'name', name, 'email', email,
             'status', status, 'trialed', trialed, 'recording', recording,
             'score', score, 'review_id', review_id, 'review_status', review_status,
             'overridden', overridden, 'stripe_email', stripe_email, 'note', note,
             'maybe', case when not trialed and maybe_email is not null
                           then jsonb_build_object('email', maybe_email, 'name', maybe_name, 'mins', maybe_mins) end
           ) order by start_time desc) from scored), '[]'::jsonb)
  );
$$;
