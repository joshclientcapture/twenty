-- Trial-to-sale by path, one cohort. Every trial email is classified once: it booked a sales call
-- with any closer, or it did not. Converted means that person ever paid. Replaces the Sales page
-- footnote that divided Therapon's lifetime sales by sat-appointment trials (Jamal, 21 Sep 2026:
-- "its sales so it should be all, not scoped").
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 40_trial_paths.sql
set search_path to os, public;

create or replace function os.get_trial_paths()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with booked as (
    select lower(trim(i.email)) em from os.sales_appointments b join calendly_invitees i on i.booking_uri = b.uri
    where coalesce(i.email, '') <> ''
    union
    select lower(trim(prospect_email)) from fathom_calls
    where lower(recorded_by_email) in (select os.sales_recorder_emails()) and coalesce(prospect_email, '') <> ''
    union
    select lower(trim(stripe_email)) from therapon_call_overrides where coalesce(stripe_email, '') <> ''
  ),
  trials as (
    select lower(trim(customer_email)) em, min(customer_id) customer_id
    from stripe_subscriptions
    where trial_start is not null and coalesce(customer_email, '') <> '' and not os.is_suppressed(customer_email, customer_name)
    group by 1
  ),
  paid as (select ident em, cid from v_customer_first_pay),
  per as (
    select t.em, (t.em in (select em from booked)) had_call,
      exists (select 1 from paid p where p.em = t.em or p.cid = t.customer_id) converted
    from trials t
  ),
  -- The appointment funnel: sat sales calls, the ones that started a trial, the ones that paid.
  sat as (
    select r.call_key, coalesce(r.stripe_email, r.email) em, r.trialed
    from os.closers c cross join lateral os.closer_call_rows(c.id) r
    where c.active and r.status = 'showed'
      and (r.kind <> 'appt' or exists (select 1 from os.sales_appointments s where s.uri = r.call_key))
  ),
  -- Same matching as the trial flag: exact email, else a shared company domain (never a free mailbox).
  generic(d) as (values ('gmail.com'),('yahoo.com'),('hotmail.com'),('outlook.com'),('icloud.com'),
    ('aol.com'),('gmx.com'),('proton.me'),('protonmail.com'),('live.com'),('msn.com'),('me.com')),
  sat_conv as (
    select s.call_key, s.trialed,
      s.trialed and s.em is not null and (
        exists (select 1 from paid p where p.em = lower(trim(s.em)))
        or (split_part(lower(trim(s.em)), '@', 2) not in (select d from generic)
            and exists (select 1 from paid p where split_part(p.em, '@', 2) = split_part(lower(trim(s.em)), '@', 2)))
      ) converted
    from sat s
  )
  select jsonb_build_object(
    'appointment', jsonb_build_object(
      'trials', (select count(*) from per where had_call),
      'sales', (select count(*) from per where had_call and converted),
      'rate', (select round(100.0 * count(*) filter (where converted) / nullif(count(*), 0), 1) from per where had_call)),
    'organic', jsonb_build_object(
      'trials', (select count(*) from per where not had_call),
      'sales', (select count(*) from per where not had_call and converted),
      'rate', (select round(100.0 * count(*) filter (where converted) / nullif(count(*), 0), 1) from per where not had_call)),
    'funnel', jsonb_build_object(
      'sat', (select count(*) from sat_conv),
      'sat_trials', (select count(*) from sat_conv where trialed),
      'sat_sales', (select count(*) from sat_conv where converted))
  );
$function$;
