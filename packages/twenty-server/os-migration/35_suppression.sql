-- Suppression: a person deleted in the CRM (or any test identity) disappears from the OS numbers,
-- from the booking mirror and from the importer, and never comes back on its own.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 35_suppression.sql
create table if not exists os.suppressed_emails (
  email text primary key,
  reason text,
  created_at timestamptz not null default now()
);

-- Test identities: throwaway domains, internal test addresses, and names that are literally a test.
create or replace function os.is_test_identity(p_email text, p_name text default null)
returns boolean language sql immutable as $$
  select coalesce(p_email, '') ~* '(@example\.(invalid|com|org)$|@crmwiring\.dev$|@test\.com$|@joshuatest\.com$|@clientcapture\.io$|@yopmail\.|@mailinator\.|^preview@|^test@|^jamal@gmail\.com$|^jamaldjs1507@gmail\.com$|^jamalrobinson1507@gmail\.com$|^jamalconversi@gmail\.com$|^(demo(-[a-z0-9]+)?|lookup[0-9]*|[a-z0-9-]*test[a-z0-9-]*|native\.test.*|intake\.check.*)@conversifi\.io$)'
      or coalesce(p_name, '') ~* '(^|\s)(test|tester|testerr+|testing|testttt|preview)(\s|$)';
$$;

create or replace function os.is_suppressed(p_email text, p_name text default null)
returns boolean language sql stable as $$
  select os.is_test_identity(p_email, p_name)
      or exists (select 1 from os.suppressed_emails s where s.email = lower(coalesce(p_email, '')));
$$;

-- Every OS page reads appointments through this view; a booking whose invitee is suppressed is not an appointment.
create or replace view os.calendly_appointments as
  select uri, calendar_external_id, name, status, start_time, end_time, booked_at, updated_at, event_type_uri,
         host_user_uri, host_email, host_name, location_type, join_url, invitees_active, invitees_total, synced_at,
         case when name = 'Conversifi.io - Next Steps' then 'follow_up' else 'new_appointment' end as appt_category,
         (name <> 'Conversifi.io - Next Steps') as is_new_appointment,
         (start_time < now()) as is_past,
         case when status = 'canceled' then 'canceled' when start_time >= now() then 'upcoming' else 'elapsed' end as time_status
  from os.calendly_bookings b
  where not exists (select 1 from os.calendly_invitees i where i.booking_uri = b.uri and os.is_suppressed(i.email, i.name));

-- Webinar events for a suppressed identity are dropped on arrival.
create or replace function os.drop_suppressed_webinar_event() returns trigger language plpgsql as $$
begin
  if os.is_suppressed(new.email, new.name) then return null; end if;
  return new;
end;
$$;
drop trigger if exists webinar_events_drop_suppressed on os.webinar_events;
create trigger webinar_events_drop_suppressed before insert on os.webinar_events
  for each row execute function os.drop_suppressed_webinar_event();

-- Purge what is already there.
delete from os.webinar_events where os.is_suppressed(email, name);
create or replace view os.v_paying_subs as
 WITH lastpay AS (
         SELECT DISTINCT ON (stripe_payments.customer_id) stripe_payments.customer_id,
            (stripe_payments.amount_cents - COALESCE(stripe_payments.amount_refunded_cents, (0)::bigint)) AS amt
           FROM os.stripe_payments
          WHERE (stripe_payments.paid AND (stripe_payments.status = 'succeeded'::text))
          ORDER BY stripe_payments.customer_id, stripe_payments.created DESC
        )
 SELECT s.id,
    s.customer_id,
    COALESCE(NULLIF(s.customer_name, ''::text), initcap(replace(split_part(COALESCE(s.customer_email, ''::text), '@'::text, 1), '.'::text, ' '::text)), 'Unknown'::text) AS name,
    s.customer_email AS email,
    s.status,
    s.plan,
    COALESCE(s."interval", 'month'::text) AS "interval",
    round(
        CASE
            WHEN (COALESCE(s."interval", 'month'::text) = 'year'::text) THEN ((COALESCE(s.amount_cents, lp.amt))::numeric / 12.0)
            ELSE (COALESCE(s.amount_cents, lp.amt))::numeric
        END) AS mrr_cents,
    date(COALESCE(s.trial_end, s.created)) AS paying_start,
        CASE
            WHEN (s.status = ANY (ARRAY['active'::text, 'past_due'::text])) THEN NULL::date
            ELSE date(COALESCE(s.ended_at, s.canceled_at, s.current_period_end))
        END AS paying_end,
    g.country
   FROM ((os.stripe_subscriptions s
     LEFT JOIN lastpay lp ON ((lp.customer_id = s.customer_id)))
     LEFT JOIN os.stripe_customer_geo g ON ((g.customer_id = s.customer_id)))
  WHERE ((COALESCE(s.amount_cents, lp.amt, (0)::bigint) > 0) AND (s.status <> 'trialing'::text)) AND NOT os.is_suppressed(s.customer_email, s.customer_name);
