-- Sales-page metrics count sales calls only.
-- Why: get_show_up / get_range_metrics / get_dashboard_metrics / get_show_up_series / get_monthly_metrics
-- aggregated every Calendly host (recruiting interviews, setup and onboarding calls, webinars), so
-- "booked" was 3.9k across 13 calendars and the show-up rate blended interviews with sales calls.
-- get_conversion took every appointment but only sales@ recordings, so "sat" disagreed with the closer
-- pages. get_dashboard_metrics hard-coded 2026 windows, so the monthly charts stopped at July.
-- One helper (os.is_sales_appointment) now decides what a sales call is, one view (os.sales_appointments)
-- exposes it, one function (os.sales_call_rows) gives the per-closer verdict, and the windows roll with now().
-- Idempotent. Apply on the server:
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 31_sales_metrics_sales_calls_only.sql

set search_path to os, public;

-- A sales appointment: hosted by a closer's Calendly account, or booked on an event type mapped to
-- DEMO / AGENCY_DEMO / DISCOVERY, and named like a sales call. Recruitment calendars, setup /
-- onboarding / diagnostic / feedback support calls and webinars ("Live Demo") are never sales.
create or replace function os.is_sales_appointment(p_host_email text, p_event_name text, p_event_type_uri text)
returns boolean language sql stable set search_path to 'os', 'public' as $$
  select (
      lower(coalesce(p_host_email, '')) in (select lower(calendly_host_email) from os.closers where calendly_host_email is not null)
      or exists (select 1 from os.calendly_event_type_map m
                 where m.event_type_uri = p_event_type_uri and m.booking_type in ('DEMO', 'AGENCY_DEMO', 'DISCOVERY'))
    )
    and coalesce(p_event_name, '') ~* '(discovery|demo|next steps)'
    and coalesce(p_event_name, '') !~* '(live demo|webinar|set ?up|onboarding|diagnostic|feedback|appointment setting|introducci|apresenta)';
$$;

create or replace view os.sales_appointments as
  select b.* from os.calendly_appointments b
  where os.is_sales_appointment(b.host_email, b.name, b.event_type_uri);

-- Fathom accounts whose recordings prove a sales appointment was sat.
create or replace function os.sales_recorder_emails()
returns setof text language sql stable set search_path to 'os', 'public' as $$
  select lower(fathom_email) from os.closers where fathom_email is not null;
$$;

-- The closer pages' verdict per call, summed over active closers. Appointment rows must pass the sales
-- rule; ad-hoc recordings (no Calendly event to classify) count as the closer pages count them.
create or replace function os.sales_call_rows()
returns table (closer_id text, kind text, call_key text, start_time timestamptz, status text, trialed boolean)
language sql stable security definer set search_path to 'os', 'public' as $$
  select c.id, r.kind, r.call_key, r.start_time, r.status, r.trialed
  from os.closers c cross join lateral os.closer_call_rows(c.id) r
  where c.active
    and (r.kind <> 'appt' or exists (select 1 from os.sales_appointments s where s.uri = r.call_key));
$$;

create or replace function os.get_show_up()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with base as (
    select b.uri, b.start_time, b.time_status,
      bool_or(coalesce(i.rescheduled,false)) rescheduled,
      exists(select 1 from fathom_calls f where lower(f.recorded_by_email) in (select os.sales_recorder_emails()) and f.scheduled_start=b.start_time) matched
    from os.sales_appointments b left join calendly_invitees i on i.booking_uri=b.uri
    where b.is_new_appointment
    group by b.uri, b.start_time, b.time_status
  ),
  cls as (
    select to_char(start_time,'YYYY-MM') mk, matched,
      case
        when rescheduled then 'rescheduled'
        when time_status='canceled' then 'canceled'
        when start_time >= now() then 'upcoming'
        else 'held'
      end bucket
    from base
  )
  select jsonb_build_object(
    'booked', count(*),
    'held', count(*) filter (where bucket='held'),
    'canceled', count(*) filter (where bucket='canceled'),
    'rescheduled', count(*) filter (where bucket='rescheduled'),
    'upcoming', count(*) filter (where bucket='upcoming'),
    'occurred', count(*) filter (where bucket in ('held','canceled')),
    'no_show', count(*) filter (where bucket='held' and not matched),
    'recorded', count(*) filter (where bucket='held' and matched),
    'rate', round(100.0*count(*) filter (where bucket='held' and matched)/nullif(count(*) filter (where bucket='held'),0),1),
    'cancel_rate', round(100.0*count(*) filter (where bucket='canceled')/nullif(count(*) filter (where bucket in ('held','canceled')),0),1),
    'monthly', coalesce((
      select jsonb_object_agg(mk, jsonb_build_object(
        'booked',bk,'held',held,'recorded',rec,'canceled',can,'rescheduled',res,'upcoming',upc,'no_show',ns,'occurred',occ,
        'rate',round(100.0*rec/nullif(held,0),1),'cancel_rate',round(100.0*can/nullif(occ,0),1)))
      from (select mk, count(*) bk,
        count(*) filter (where bucket='held') held,
        count(*) filter (where bucket='held' and matched) rec,
        count(*) filter (where bucket='canceled') can,
        count(*) filter (where bucket='rescheduled') res,
        count(*) filter (where bucket='upcoming') upc,
        count(*) filter (where bucket='held' and not matched) ns,
        count(*) filter (where bucket in ('held','canceled')) occ
        from cls group by mk) q), '{}'::jsonb)
  ) from cls;
$$;

create or replace function os.get_show_up_series(p_grain text default 'week', p_from date default null, p_to date default null)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with params as (select case lower(coalesce(p_grain,'week')) when 'day' then 'day' when 'month' then 'month' else 'week' end g),
  base as (
    select b.uri, b.start_time, b.time_status,
      bool_or(coalesce(i.rescheduled,false)) rescheduled,
      exists(select 1 from fathom_calls f where lower(f.recorded_by_email) in (select os.sales_recorder_emails()) and f.scheduled_start=b.start_time) matched
    from os.sales_appointments b left join calendly_invitees i on i.booking_uri=b.uri
    where b.is_new_appointment and b.start_time < now()
      and (p_from is null or b.start_time >= p_from) and (p_to is null or b.start_time < (p_to + 1))
    group by b.uri, b.start_time, b.time_status
  ),
  pb as (select date_trunc((select g from params), start_time)::date bkt, (time_status='canceled') canceled, matched from base where not rescheduled),
  buckets as (
    select bkt, count(*) occurred, count(*) filter (where canceled) canceled, count(*) filter (where not canceled) held,
      count(*) filter (where not canceled and matched) recorded, count(*) filter (where not canceled and not matched) no_show
    from pb group by bkt
  )
  select jsonb_build_object(
    'grain', (select g from params),
    'buckets', coalesce((select jsonb_agg(jsonb_build_object(
        'start', bkt, 'occurred', occurred, 'canceled', canceled, 'held', held, 'recorded', recorded, 'no_show', no_show,
        'rate', round(100.0*recorded/nullif(held,0),1), 'cancel_rate', round(100.0*canceled/nullif(occurred,0),1)
      ) order by bkt desc) from buckets), '[]'::jsonb),
    'total', coalesce((select jsonb_build_object(
        'occurred', sum(occurred), 'canceled', sum(canceled), 'held', sum(held), 'recorded', sum(recorded), 'no_show', sum(no_show),
        'rate', round(100.0*sum(recorded)/nullif(sum(held),0),1), 'cancel_rate', round(100.0*sum(canceled)/nullif(sum(occurred),0),1)
      ) from buckets), jsonb_build_object('occurred',0,'canceled',0,'held',0,'recorded',0,'no_show',0,'rate',null,'cancel_rate',null))
  );
$$;

create or replace function os.get_range_metrics(p_from date, p_to date)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with appts as (
    select b.uri, b.start_time, b.time_status,
      bool_or(coalesce(i.rescheduled,false)) rescheduled,
      exists(select 1 from fathom_calls f where lower(f.recorded_by_email) in (select os.sales_recorder_emails()) and f.scheduled_start=b.start_time) matched
    from os.sales_appointments b left join calendly_invitees i on i.booking_uri=b.uri
    where b.is_new_appointment and b.start_time >= p_from and b.start_time < (p_to + 1)
    group by b.uri, b.start_time, b.time_status
  ),
  occ as (select * from appts where not rescheduled and start_time < now()),
  contacts as (
    select lower(prospect_email) em from fathom_calls where lower(recorded_by_email) in (select os.sales_recorder_emails()) and coalesce(prospect_email,'')<>''
    union
    select lower(i.email) from os.sales_appointments b join calendly_invitees i on i.booking_uri=b.uri where b.is_new_appointment and coalesce(i.email,'')<>''
  ),
  trial_emails as (select distinct lower(customer_email) em from stripe_subscriptions where trial_start is not null and coalesce(customer_email,'')<>''),
  sat_appts as (
    select b.uri, b.start_time,
      coalesce(
        (select lower(f.prospect_email) from fathom_calls f where lower(f.recorded_by_email) in (select os.sales_recorder_emails()) and f.scheduled_start=b.start_time and coalesce(f.prospect_email,'')<>'' limit 1),
        (select lower(i.email) from calendly_invitees i where i.booking_uri=b.uri and coalesce(i.email,'')<>'' limit 1)
      ) em
    from os.sales_appointments b
    where b.is_new_appointment and b.start_time >= p_from and b.start_time < (p_to + 1) and b.start_time < now() and b.time_status<>'canceled'
      and not exists(select 1 from calendly_invitees i where i.booking_uri=b.uri and coalesce(i.rescheduled,false))
      and exists(select 1 from fathom_calls f where lower(f.recorded_by_email) in (select os.sales_recorder_emails()) and f.scheduled_start=b.start_time)
  ),
  tr as (select (lower(customer_email) in (select em from contacts)) is_th
         from stripe_subscriptions where trial_start is not null and created >= p_from and created < (p_to + 1)),
  sl as (select (e->>'closer'='Therapon Savvas') is_th
         from jsonb_array_elements(get_sales_ledger()) e
         where coalesce((e->>'total_paid')::numeric,0) > 0 and e->>'first_paid' is not null
           and (e->>'first_paid')::timestamptz >= p_from and (e->>'first_paid')::timestamptz < (p_to + 1))
  select jsonb_build_object(
    'from', p_from, 'to', p_to,
    'booked', (select count(*) from appts),
    'recorded', (select count(*) from occ where time_status<>'canceled' and matched),
    'held', (select count(*) from occ where time_status<>'canceled'),
    'no_show', (select count(*) from occ where time_status<>'canceled' and not matched),
    'canceled', (select count(*) from occ where time_status='canceled'),
    'show_up_rate', (select round(100.0*count(*) filter (where time_status<>'canceled' and matched)/nullif(count(*) filter (where time_status<>'canceled'),0),1) from occ),
    'cancel_rate', (select round(100.0*count(*) filter (where time_status='canceled')/nullif(count(*),0),1) from occ),
    'sat_trials', (select count(*) from sat_appts where em is not null and em in (select em from trial_emails)),
    'conversion', (select round(100.0*count(*) filter (where em is not null and em in (select em from trial_emails))/nullif(count(*),0),1) from sat_appts),
    'trials_total', (select count(*) from tr),
    'trials_therapon', (select count(*) filter (where is_th) from tr),
    'sales_total', (select count(*) from sl),
    'sales_therapon', (select count(*) filter (where is_th) from sl),
    'cash_collected', (select coalesce(round(sum(amount_cents-coalesce(amount_refunded_cents,0))/100.0,2),0)
                       from stripe_payments where paid and status='succeeded' and created >= p_from and created < (p_to + 1))
  );
$$;

create or replace function os.get_conversion()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with keep as (select to_char(start_time,'YYYY-MM') mk, status, trialed from os.sales_call_rows() where status <> 'rescheduled'),
  tot as (select to_char(created,'YYYY-MM') mk, count(*) n from stripe_subscriptions where trial_start is not null group by 1)
  select jsonb_build_object(
    'total', jsonb_build_object(
      'sat', (select count(*) from keep where status='showed'),
      'sat_trials', (select count(*) from keep where trialed),
      'trials_total', (select count(*) from stripe_subscriptions where trial_start is not null),
      'rate', (select round(100.0*count(*) filter (where trialed)/nullif(count(*) filter (where status='showed'),0),1) from keep)),
    'monthly', coalesce((
      select jsonb_object_agg(q.mk, jsonb_build_object('sat',s,'sat_trials',c,
        'trials_total', coalesce((select n from tot where tot.mk=q.mk),0),
        'rate', round(100.0*c/nullif(s,0),1)))
      from (select mk, count(*) filter (where status='showed') s, count(*) filter (where trialed) c from keep group by mk) q), '{}'::jsonb)
  );
$$;

create or replace function os.get_dashboard_metrics()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with months as (
    select generate_series(date_trunc('month', now()) - interval '5 months', date_trunc('month', now()), interval '1 month') m
  )
  select jsonb_build_object(
    'generated_at', now(),
    'kpis', (select jsonb_build_object(
        'appts_booked', count(*) filter (where is_new_appointment),
        'appts_held', count(*) filter (where is_new_appointment and time_status='elapsed'),
        'appts_upcoming', count(*) filter (where is_new_appointment and time_status='upcoming'),
        'appts_canceled', count(*) filter (where is_new_appointment and time_status='canceled')
      ) from os.sales_appointments),
    'appointments_sat', (select count(*) from os.sales_call_rows() where status='showed'),
    'trials_started', (select count(*) from stripe_subscriptions where trial_start is not null),
    'revenue', (
      with led as (select (e->>'total_paid')::numeric v, e->>'source' src, e->>'closer' clr
                   from jsonb_array_elements(get_sales_ledger()) e)
      select jsonb_build_object(
        'currency','USD',
        'total_collected', (select round(sum(amount_cents-coalesce(amount_refunded_cents,0))/100.0,2) from stripe_payments where paid and status='succeeded'),
        'from_sales_calls', round(coalesce(sum(v) filter (where src='linkedin_outreach'),0),2),
        'sales_commission', round(coalesce(sum(v) filter (where clr='Therapon Savvas'),0)*0.10,2),
        'therapon_customers', count(*) filter (where clr='Therapon Savvas'),
        'jamal_customers', count(*) filter (where clr='Jamal Robinson'),
        'jamal_revenue', round(coalesce(sum(v) filter (where clr='Jamal Robinson'),0),2),
        'unattributed_customers', count(*) filter (where src is null),
        'unattributed_revenue', round(coalesce(sum(v) filter (where src is null),0),2),
        'by_source', jsonb_build_object(
          'linkedin_outreach', jsonb_build_object('n',count(*) filter (where src='linkedin_outreach'),'v',round(coalesce(sum(v) filter (where src='linkedin_outreach'),0),2)),
          'email_marketing', jsonb_build_object('n',count(*) filter (where src='email_marketing'),'v',round(coalesce(sum(v) filter (where src='email_marketing'),0),2)),
          'organic', jsonb_build_object('n',count(*) filter (where src='organic'),'v',round(coalesce(sum(v) filter (where src='organic'),0),2)),
          'paid_ads', jsonb_build_object('n',count(*) filter (where src='paid_ads'),'v',round(coalesce(sum(v) filter (where src='paid_ads'),0),2)),
          'unattributed', jsonb_build_object('n',count(*) filter (where src is null),'v',round(coalesce(sum(v) filter (where src is null),0),2))
        )
      ) from led),
    'subs', (select jsonb_build_object('total',count(*),'active',count(*) filter (where status='active'),
        'trialing',count(*) filter (where status='trialing'),'ever_paid',count(*) filter (where has_paid_anything)) from conversifi_customers),
    'attribution', (select jsonb_build_object('email',count(*) filter (where match_method='email'),
        'name',count(*) filter (where match_method='name'),'unmatched',count(*) filter (where match_method='unmatched'),
        'paid_from_appt',count(*) filter (where has_paid_anything and match_method<>'unmatched'),
        'paid_total',count(*) filter (where has_paid_anything)) from customer_attribution),
    'attribution_recent', (select jsonb_build_object('paid',count(*) filter (where has_paid_anything),
        'paid_from_appt',count(*) filter (where has_paid_anything and match_method<>'unmatched'),
        'pct',round(100.0*count(*) filter (where has_paid_anything and match_method<>'unmatched')
             / nullif(count(*) filter (where has_paid_anything),0)))
      from customer_attribution where signup_at >= (select min(m) from months)),
    'linkedin', (select jsonb_build_object(
        'active',(select coalesce(sum(cnt) filter (where last_status='active'),0) from linkedin_status_now),
        'idle',  (select coalesce(sum(cnt) filter (where last_status='idle'),0) from linkedin_status_now),
        'total', (select coalesce(sum(cnt) filter (where last_status='total'),0) from linkedin_status_now))),
    'linkedin_monthly', (select coalesce(jsonb_agg(jsonb_build_object(
        'month',to_char(month,'Mon'),'added',added,'cumulative',cumulative) order by month),'[]'::jsonb) from linkedin_monthly),
    'appts_monthly', (select coalesce(jsonb_agg(jsonb_build_object(
        'month',to_char(mo.m,'Mon'),'booked',coalesce(q.booked,0),'held',coalesce(q.held,0),'upcoming',coalesce(q.upcoming,0),'canceled',coalesce(q.canceled,0)) order by mo.m),'[]'::jsonb)
      from months mo left join (
        select date_trunc('month',start_time) ord,
          count(*) filter (where is_new_appointment) booked,
          count(*) filter (where is_new_appointment and time_status='elapsed') held,
          count(*) filter (where is_new_appointment and time_status='upcoming') upcoming,
          count(*) filter (where is_new_appointment and time_status='canceled') canceled
        from os.sales_appointments where start_time >= (select min(m) from months) group by 1) q on q.ord = mo.m),
    'signups_monthly', (select coalesce(jsonb_agg(jsonb_build_object(
        'month',to_char(mo.m,'Mon'),'signups',coalesce(q.signups,0),'paid',coalesce(q.paid,0),'sales',coalesce(q.sales,0)) order by mo.m),'[]'::jsonb)
      from months mo left join (
        select date_trunc('month',signup_at) ord, count(*) signups,
          count(*) filter (where has_paid_anything) paid,
          count(*) filter (where has_paid_anything and match_method<>'unmatched') sales
        from customer_attribution where signup_at >= (select min(m) from months) group by 1) q on q.ord = mo.m)
  );
$$;

-- Same monthly table the Sales page renders; only "booked" (sales appointments) and "sat"
-- (the closers' verdict, matching get_conversion) change.
create or replace function os.get_monthly_metrics()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with led as (
    select e->>'customer_id' cid, e->>'closer' closer, e->>'source' src
    from jsonb_array_elements(get_sales_ledger()) e
  ),
  months as (select generate_series(date_trunc('month','2026-01-01'::date), date_trunc('month',current_date), interval '1 month')::date m),
  booked as (select date_trunc('month',start_time)::date m, count(*) c from os.sales_appointments where is_new_appointment group by 1),
  sat as (select date_trunc('month',start_time)::date m, count(*) c from os.sales_call_rows() where status='showed' group by 1),
  trials as (select date_trunc('month',created)::date m, count(*) c from stripe_subscriptions where trial_start is not null group by 1),
  pay as (
    select date_trunc('month',sp.created)::date m,
      sum(sp.amount_cents-coalesce(sp.amount_refunded_cents,0)) net,
      sum(case when l.closer='Therapon Savvas' then sp.amount_cents-coalesce(sp.amount_refunded_cents,0) else 0 end) therapon_net,
      sum(case when l.src='linkedin_outreach' then sp.amount_cents-coalesce(sp.amount_refunded_cents,0) else 0 end) linkedin_net
    from stripe_payments sp left join led l on l.cid=sp.customer_id
    where sp.paid and sp.status='succeeded' group by 1
  ),
  -- total successful transactions (incl. recurring) per month
  txn as (
    select date_trunc('month',created)::date m, count(*) c
    from stripe_payments where paid and status='succeeded' and (amount_cents-coalesce(amount_refunded_cents,0))>0
    group by 1
  ),
  -- new paying customers per month (canonical: same source as homepage tile & Goals)
  newc as (select date_trunc('month',first_pay)::date m, count(*) c from v_customer_first_pay group by 1),
  th as (
    select date_trunc('month',fp.first_pay)::date m, count(*) c
    from v_customer_first_pay fp left join led l on l.cid=fp.cid
    where l.closer='Therapon Savvas' group by 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'month', to_char(mo.m,'Mon YYYY'), 'month_key', to_char(mo.m,'YYYY-MM'),
    'booked', coalesce(b.c,0), 'sat', coalesce(s.c,0), 'trials', coalesce(tr.c,0),
    'transactions', coalesce(tx.c,0),
    'new_sales', coalesce(nc.c,0), 'new_customers', coalesce(nc.c,0),
    'therapon_sales', coalesce(th.c,0),
    'cash_collected', round(coalesce(p.net,0)/100.0,2),
    'sales_revenue', round(coalesce(p.linkedin_net,0)/100.0,2),
    'commission', round(coalesce(p.therapon_net,0)/100.0*0.10,2)
  ) order by mo.m desc), '[]'::jsonb)
  from months mo
  left join booked b on b.m=mo.m left join sat s on s.m=mo.m left join trials tr on tr.m=mo.m
  left join pay p on p.m=mo.m left join txn tx on tx.m=mo.m left join newc nc on nc.m=mo.m left join th on th.m=mo.m;
$$;

-- Sanity: the rule must keep sales calendars and drop recruiting, support and webinar ones.
do $$
begin
  if not os.is_sales_appointment('sales@conversifi.io', 'Conversifi.io Discovery', null) then raise exception 'sales discovery rejected'; end if;
  if not os.is_sales_appointment('sales@conversifi.io', 'Conversifi.io Agency Demo', null) then raise exception 'agency demo rejected'; end if;
  if not os.is_sales_appointment('jamal@conversifi.io', 'Conversifi Discovery Call', null) then raise exception 'jamal discovery rejected'; end if;
  if os.is_sales_appointment('jamal@conversifi.io', '30 minute meeting', null) then raise exception 'generic meeting accepted'; end if;
  if os.is_sales_appointment('jamal@conversifi.io', 'Conversifi Live Demo', null) then raise exception 'webinar accepted'; end if;
  if os.is_sales_appointment('jamal@conversifi.io', 'Conversifi.io user set up call', null) then raise exception 'setup call accepted'; end if;
  if os.is_sales_appointment('recruiting@conversifi.io', 'Introducción al agendamiento de citas de Conversifi', null) then raise exception 'recruiting accepted'; end if;
  if os.is_sales_appointment('melanie@conversifi.io', 'Conversifi Campaign Setup Call', null) then raise exception 'setup accepted'; end if;
  if os.is_sales_appointment('demo@conversifi.io', 'Conversifi - Live Demo (45 Min)', null) then raise exception 'live demo accepted'; end if;
end $$;
