-- Multi-closer support on top of the migrated OS schema. Additive only: every function the
-- OS app calls (get_show_up, get_therapon_daily, ...) keeps its name, arguments and output.
-- Apply after 03_restore_into_twenty.sh:
--   docker exec -i twenty-dev-db-1 psql "$PG_DATABASE_URL" -v ON_ERROR_STOP=1 < 10_closers.sql

set search_path to os, public;

create table if not exists os.closers (
  id text primary key,
  -- Must equal the `closer` text on the sales ledger and sales_overrides, so commission keeps matching.
  name text not null unique,
  login_email text,
  fathom_email text,
  calendly_host_email text,
  calendly_user_uri text,
  commission_rate numeric not null default 0.10,
  commissioned boolean not null default true,
  tracked boolean not null default true,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into os.closers (id, name, login_email, fathom_email, calendly_host_email, calendly_user_uri, commissioned, tracked, sort_order)
values
  ('therapon', 'Therapon Savvas', 'sales@conversifi.io', 'sales@conversifi.io', 'sales@conversifi.io',
   'https://api.calendly.com/users/aa7a3f42-1964-48e6-aa9b-89f2cf18cb70', true, true, 10),
  ('jamal', 'Jamal Robinson', 'jamal@conversifi.io', 'jamal@conversifi.io', null, null, false, true, 20)
on conflict (id) do nothing;

alter table os.therapon_call_overrides add column if not exists closer_id text;
update os.therapon_call_overrides set closer_id = 'therapon' where closer_id is null;

create or replace function os.get_closers()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'name', name, 'email', login_email, 'fathom_email', fathom_email,
    'calendly_host_email', calendly_host_email, 'commission_rate', commission_rate,
    'commissioned', commissioned, 'tracked', tracked, 'active', active
  ) order by sort_order, name), '[]'::jsonb) from os.closers;
$$;

create or replace function os.upsert_closer(
  p_id text, p_name text, p_login_email text default null, p_fathom_email text default null,
  p_calendly_host_email text default null, p_calendly_user_uri text default null,
  p_commission_rate numeric default null, p_commissioned boolean default null,
  p_tracked boolean default null, p_active boolean default null
) returns jsonb language plpgsql security definer set search_path to 'os', 'public' as $$
begin
  if p_id is null or btrim(p_id) = '' or p_id !~ '^[a-z0-9_-]+$' then raise exception 'closer id must be a slug'; end if;
  if p_name is null or btrim(p_name) = '' then raise exception 'closer name required'; end if;
  insert into os.closers (id, name, login_email, fathom_email, calendly_host_email, calendly_user_uri, commission_rate, commissioned, tracked, active)
  values (p_id, btrim(p_name), lower(nullif(btrim(p_login_email),'')), lower(nullif(btrim(p_fathom_email),'')),
          lower(nullif(btrim(p_calendly_host_email),'')), nullif(btrim(p_calendly_user_uri),''),
          coalesce(p_commission_rate, 0.10), coalesce(p_commissioned, true), coalesce(p_tracked, true), coalesce(p_active, true))
  on conflict (id) do update set
    name = excluded.name,
    login_email = coalesce(excluded.login_email, os.closers.login_email),
    fathom_email = coalesce(excluded.fathom_email, os.closers.fathom_email),
    calendly_host_email = coalesce(excluded.calendly_host_email, os.closers.calendly_host_email),
    calendly_user_uri = coalesce(excluded.calendly_user_uri, os.closers.calendly_user_uri),
    commission_rate = coalesce(p_commission_rate, os.closers.commission_rate),
    commissioned = coalesce(p_commissioned, os.closers.commissioned),
    tracked = coalesce(p_tracked, os.closers.tracked),
    active = coalesce(p_active, os.closers.active),
    updated_at = now();
  return (select jsonb_build_object('id', id, 'name', name) from os.closers where id = p_id);
end $$;

-- Same buckets as get_show_up(), restricted to one closer's Calendly host and Fathom recorder.
create or replace function os.get_closer_show_up(p_closer_id text)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with c as (select * from os.closers where id = p_closer_id),
  base as (
    select b.uri, b.start_time, b.time_status,
      bool_or(coalesce(i.rescheduled,false)) rescheduled,
      exists(select 1 from fathom_calls f, c where f.recorded_by_email = c.fathom_email and f.scheduled_start = b.start_time) matched
    from calendly_appointments b left join calendly_invitees i on i.booking_uri = b.uri, c
    where b.is_new_appointment and b.host_email = c.calendly_host_email
    group by b.uri, b.start_time, b.time_status
  ),
  cls as (
    select to_char(start_time,'YYYY-MM') mk, matched,
      case when rescheduled then 'rescheduled' when time_status='canceled' then 'canceled'
           when start_time >= now() then 'upcoming' else 'held' end bucket
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

-- Shared classification used by conversion and the daily log: appointments + ad-hoc recordings
-- for one closer, with trial attribution and overrides applied. Mirrors get_therapon_daily().
create or replace function os.closer_call_rows(p_closer_id text, p_from date default null, p_to date default null)
returns table (
  kind text, call_key text, start_time timestamptz, end_time timestamptz, time_status text, rescheduled boolean,
  name text, email text, has_rec boolean, recording text, status text, trialed boolean, stripe_email text,
  overridden boolean, note text, maybe_email text, maybe_name text, maybe_mins int
) language sql stable security definer set search_path to 'os', 'public' as $$
with c as (select * from os.closers where id = p_closer_id),
fcalls as (
  select f.recording_id, coalesce(f.scheduled_start, f.recording_start) sstart,
         f.fathom_url, f.prospect_name, lower(nullif(trim(f.prospect_email),'')) pemail
  from fathom_calls f, c
  where f.recorded_by_email = c.fathom_email
    and (p_from is null or coalesce(f.scheduled_start, f.recording_start) >= p_from)
    and (p_to is null or coalesce(f.scheduled_start, f.recording_start) < (p_to + 1))
),
appts as (
  select b.uri, b.start_time, b.end_time, b.time_status,
    (select i.name from calendly_invitees i where i.booking_uri=b.uri limit 1) name,
    (select lower(trim(i.email)) from calendly_invitees i where i.booking_uri=b.uri and coalesce(i.email,'')<>'' limit 1) email,
    (select bool_or(coalesce(i.rescheduled,false)) from calendly_invitees i where i.booking_uri=b.uri) rescheduled
  from calendly_appointments b, c
  where b.is_new_appointment and b.host_email = c.calendly_host_email
    and (p_from is null or b.start_time >= p_from) and (p_to is null or b.start_time < (p_to + 1))
),
appt_match as (
  select a.*, (select f.recording_id from fcalls f
      where f.sstart between a.start_time - interval '15 min' and a.start_time + interval '15 min'
      order by abs(extract(epoch from (f.sstart - a.start_time))) limit 1) rid
  from appts a
),
adhoc as (select f.* from fcalls f where not exists (select 1 from appt_match am where am.rid=f.recording_id)),
rows0 as (
  select 'appt' kind, am.uri call_key, am.start_time, am.end_time, am.time_status, am.rescheduled,
         am.name, am.email, (am.rid is not null) has_rec,
         (select fathom_url from fcalls f where f.recording_id=am.rid) recording
  from appt_match am
  union all
  select 'adhoc', ad.recording_id::text, ad.sstart, ad.sstart + interval '30 min', 'elapsed', false,
         coalesce(nullif(ad.prospect_name,''), ad.pemail), ad.pemail, true, ad.fathom_url
  from adhoc ad
),
trials as (
  select lower(trim(customer_email)) em, customer_name, trial_start,
         split_part(lower(trim(customer_email)),'@',2) dom
  from stripe_subscriptions
  where trial_start is not null and coalesce(customer_email,'')<>''
    and (p_from is null or trial_start >= (p_from - 1)) and (p_to is null or trial_start < (p_to + 2))
),
generic(d) as (values ('gmail.com'),('yahoo.com'),('hotmail.com'),('outlook.com'),('icloud.com'),
  ('aol.com'),('gmx.com'),('proton.me'),('protonmail.com'),('live.com'),('msn.com'),('me.com')),
cand as (
  select t.em, t.trial_start, r.call_key, r.start_time,
    case when r.email = t.em then 3
      when t.dom not in (select d from generic) and split_part(r.email,'@',2)=t.dom then 2
      when length(regexp_replace(split_part(t.em,'@',1),'[^a-z]','','g'))>=5
       and length(regexp_replace(lower(coalesce(r.name,'')),'[^a-z]','','g'))>=5
       and ( regexp_replace(lower(coalesce(r.name,'')),'[^a-z]','','g') like '%'||regexp_replace(split_part(t.em,'@',1),'[^a-z]','','g')||'%'
          or regexp_replace(split_part(t.em,'@',1),'[^a-z]','','g') like '%'||regexp_replace(lower(coalesce(r.name,'')),'[^a-z]','','g')||'%') then 1
      else 0 end score
  from trials t join rows0 r on t.trial_start between r.start_time - interval '30 min' and r.start_time + interval '4 hours'
),
attrib as (
  select distinct on (em) em, call_key, trial_start from cand where score>0
  order by em, score desc, abs(extract(epoch from (trial_start - start_time))) asc
),
maybe0 as (
  select r.call_key, t.em, t.customer_name, t.trial_start,
         round(extract(epoch from (t.trial_start - r.start_time))/60)::int mins,
         (regexp_replace(lower(coalesce(t.customer_name,'')),'[^a-z]','','g')) sn,
         (regexp_replace(lower(coalesce(r.name,'')),'[^a-z]','','g')) bn
  from trials t join rows0 r on t.trial_start between r.start_time - interval '30 min' and r.start_time + interval '4 hours'
  where t.em not in (select em from attrib)
),
maybe as (
  select distinct on (call_key) call_key, em, customer_name, mins
  from maybe0
  where length(sn)>=4 and length(bn)>=4 and (sn like '%'||bn||'%' or bn like '%'||sn||'%')
  order by call_key, abs(mins)
),
ov as (select call_key, status ov_status, trialed ov_trialed, stripe_email, note from therapon_call_overrides),
classed as (
  select r.*, (r.call_key in (select call_key from attrib)) auto_trialed,
    case
      when r.kind='appt' and r.time_status='canceled' then 'cancelled'
      when r.kind='appt' and r.rescheduled then 'rescheduled'
      when r.has_rec then 'showed'
      when r.call_key in (select call_key from attrib) then 'showed'
      when coalesce(r.end_time, r.start_time + interval '30 min') + interval '30 min' > now()
        then (case when r.start_time > now() then 'upcoming' else 'in_progress' end)
      else 'no_show' end auto_status
  from rows0 r
)
select c2.kind, c2.call_key, c2.start_time, c2.end_time, c2.time_status, c2.rescheduled, c2.name, c2.email, c2.has_rec, c2.recording,
  coalesce(o.ov_status, c2.auto_status) as status,
  (coalesce(o.ov_trialed, c2.auto_trialed) or o.stripe_email is not null) as trialed,
  o.stripe_email,
  (o.ov_status is not null or o.ov_trialed is not null or o.stripe_email is not null) as overridden,
  o.note, mb.em, mb.customer_name, mb.mins
from classed c2 left join ov o on o.call_key = c2.call_key left join maybe mb on mb.call_key = c2.call_key;
$$;

create or replace function os.get_closer_conversion(p_closer_id text)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with keep as (select to_char(start_time,'YYYY-MM') mk, status, trialed from os.closer_call_rows(p_closer_id) where status <> 'rescheduled'),
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

create or replace function os.get_closer_daily(p_closer_id text, p_from date, p_to date)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with keep as (select * from os.closer_call_rows(p_closer_id, p_from, p_to) where status <> 'rescheduled')
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
             'overridden', overridden, 'stripe_email', stripe_email, 'note', note,
             'maybe', case when not trialed and maybe_email is not null
                           then jsonb_build_object('email', maybe_email, 'name', maybe_name, 'mins', maybe_mins) end
           ) order by start_time desc) from keep), '[]'::jsonb)
  );
$$;

create or replace function os.get_closer_cash(p_closer_id text)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with c as (select name from os.closers where id = p_closer_id),
  led as (select e->>'customer_id' cid from jsonb_array_elements(get_sales_ledger()) e, c where e->>'closer' = c.name),
  pay as (select to_char(created,'YYYY-MM') mk, (amount_cents-coalesce(amount_refunded_cents,0)) net
          from stripe_payments where paid and status='succeeded' and customer_id in (select cid from led))
  select jsonb_build_object(
    'total', round(coalesce(sum(net),0)/100.0,2),
    'monthly', coalesce((select jsonb_object_agg(mk, round(s/100.0,2)) from (select mk, sum(net) s from pay group by mk) q), '{}'::jsonb)
  ) from pay;
$$;

-- Sales closed by this closer with the active-customer / MRR view the closer page shows.
create or replace function os.get_closer_sales(p_closer_id text)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with c as (select name from os.closers where id = p_closer_id),
  sales as (
    select e->>'customer_id' cid, to_char((e->>'first_paid')::timestamptz,'YYYY-MM') mk
    from jsonb_array_elements(get_sales_ledger()) e, c
    where e->>'closer' = c.name and coalesce((e->>'total_paid')::numeric,0) > 0 and e->>'first_paid' is not null
  ),
  lastpay as (select distinct on (customer_id) customer_id, (amount_cents-coalesce(amount_refunded_cents,0)) amt
    from stripe_payments where paid and status='succeeded' order by customer_id, created desc),
  active_cust as (
    select s.customer_id, sum(coalesce(nullif(case when s.interval='year' then s.amount_cents/12.0 else s.amount_cents end,0), lp.amt)) mrr_cents
    from stripe_subscriptions s left join lastpay lp on lp.customer_id=s.customer_id
    where s.status in ('active','past_due','unpaid') and s.plan <> 'Clientcapture.io Services' and coalesce(s.customer_email,'') <> 'applications@nouveaumillionnaire.com'
    group by s.customer_id
  )
  select jsonb_build_object(
    'total', (select count(*) from sales),
    'active', (select count(*) from sales s join active_cust a on a.customer_id=s.cid),
    'mrr', (select round(coalesce(sum(a.mrr_cents),0)/100.0,2) from sales s join active_cust a on a.customer_id=s.cid),
    'monthly', coalesce((select jsonb_object_agg(mk, jsonb_build_object('total',t,'active',act,'mrr',mrr))
      from (select s.mk, count(*) t,
              count(*) filter (where a.customer_id is not null) act,
              round(coalesce(sum(a.mrr_cents),0)/100.0,2) mrr
            from sales s left join active_cust a on a.customer_id=s.cid group by s.mk) q), '{}'::jsonb)
  );
$$;

create or replace function os.get_closer_customers(p_closer_id text, p_month text default null, p_from date default null, p_to date default null)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with c as (select name from os.closers where id = p_closer_id),
  led as (
    select e->>'customer_id' cid, e->>'name' nm, coalesce(e->>'email', e->>'stripe_email') em,
           (e->>'total_paid')::numeric total_paid, e->>'fathom_url' rec, (e->>'first_paid')::timestamptz first_paid
    from jsonb_array_elements(get_sales_ledger()) e, c where e->>'closer' = c.name
  ),
  lastpay as (select distinct on (customer_id) customer_id, (amount_cents-coalesce(amount_refunded_cents,0)) amt
    from stripe_payments where paid and status='succeeded' order by customer_id, created desc),
  sub as (
    select distinct on (s.customer_id) s.customer_id, s.status, s.plan,
      coalesce(nullif(case when s.interval='year' then s.amount_cents/12.0 else s.amount_cents end,0), lp.amt) mrr_cents
    from stripe_subscriptions s left join lastpay lp on lp.customer_id=s.customer_id
    order by s.customer_id, (s.status='active') desc, s.current_period_end desc nulls last
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'name', led.nm, 'email', led.em,
    'status', coalesce(sub.status, 'no sub'), 'plan', sub.plan, 'paid', (sub.status='active'),
    'mrr', case when sub.status='active' then round(coalesce(sub.mrr_cents,0)/100.0,2) else 0 end,
    'total_paid', led.total_paid, 'date', led.first_paid, 'recording', led.rec
  ) order by (sub.status='active') desc, led.total_paid desc), '[]'::jsonb)
  from led left join sub on sub.customer_id=led.cid
  where (p_month is null or to_char(led.first_paid,'YYYY-MM')=p_month)
    and (p_from is null or led.first_paid >= p_from) and (p_to is null or led.first_paid < (p_to + 1));
$$;

create or replace function os.set_closer_call(
  p_closer_id text, p_key text, p_status text default null, p_trialed boolean default null, p_stripe_email text default null,
  p_name text default null, p_email text default null, p_note text default null, p_by text default null
) returns void language plpgsql security definer set search_path to 'os', 'public' as $$
begin
  if p_key is null or btrim(p_key)='' then raise exception 'call key required'; end if;
  if not exists (select 1 from os.closers where id = p_closer_id) then raise exception 'unknown closer %', p_closer_id; end if;
  insert into os.therapon_call_overrides (call_key, status, trialed, stripe_email, prospect_name, prospect_email, note, set_by, updated_at, closer_id)
  values (p_key, nullif(btrim(p_status),''), p_trialed, lower(nullif(btrim(p_stripe_email),'')), p_name, p_email, nullif(btrim(p_note),''), p_by, now(), p_closer_id)
  on conflict (call_key) do update set
    status = excluded.status, trialed = excluded.trialed, stripe_email = excluded.stripe_email,
    prospect_name = coalesce(excluded.prospect_name, os.therapon_call_overrides.prospect_name),
    prospect_email = coalesce(excluded.prospect_email, os.therapon_call_overrides.prospect_email),
    note = excluded.note, set_by = excluded.set_by, updated_at = now(), closer_id = excluded.closer_id;
  if lower(nullif(btrim(p_stripe_email),'')) is not null then perform os.refresh_sales_ledger(); end if;
end $$;

create or replace function os.clear_closer_call(p_closer_id text, p_key text)
returns void language plpgsql security definer set search_path to 'os', 'public' as $$
begin
  delete from os.therapon_call_overrides where call_key = p_key;
  perform os.refresh_sales_ledger();
end $$;

-- Commission per closer straight from the closers table, so a new closer needs no SQL change.
create or replace function os.get_closer_commission(p_closer_id text)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with c as (select * from os.closers where id = p_closer_id),
  led as (select e->>'customer_id' cid from jsonb_array_elements(get_sales_ledger()) e, c where e->>'closer' = c.name),
  pay as (
    select sp.id, (sp.amount_cents-coalesce(sp.amount_refunded_cents,0)) net, (cp.payment_id is not null) comm_paid
    from stripe_payments sp join led on led.cid = sp.customer_id
    left join commission_paid cp on cp.payment_id = sp.id
    where sp.paid and sp.status='succeeded'
  )
  select jsonb_build_object(
    'rep', (select name from c),
    'commission_rate', (select commission_rate from c),
    'commissioned', (select commissioned from c),
    'next_payout', (date_trunc('month',current_date)+interval '1 month - 1 day')::date,
    'revenue', round(coalesce(sum(net),0)/100.0,2),
    'earned', round(coalesce(sum(net),0)*(select commission_rate from c)/100.0,2),
    'paid', round(coalesce(sum(net) filter (where comm_paid),0)*(select commission_rate from c)/100.0,2),
    'outstanding', round(coalesce(sum(net) filter (where not comm_paid),0)*(select commission_rate from c)/100.0,2),
    'payments', count(*), 'payments_paid', count(*) filter (where comm_paid), 'payments_due', count(*) filter (where not comm_paid)
  ) from pay;
$$;

-- Sanity: Therapon through the generic path must equal the original single-closer functions.
do $$
declare a jsonb; b jsonb;
begin
  a := os.get_show_up(); b := os.get_closer_show_up('therapon');
  if a->>'held' <> b->>'held' or a->>'recorded' <> b->>'recorded' then
    raise exception 'closer show-up mismatch: % vs %', a->>'held', b->>'held';
  end if;
  a := os.get_conversion(); b := os.get_closer_conversion('therapon');
  if a->'total'->>'sat' <> b->'total'->>'sat' then
    raise exception 'closer conversion mismatch: % vs %', a->'total'->>'sat', b->'total'->>'sat';
  end if;
  a := os.get_therapon_cash(); b := os.get_closer_cash('therapon');
  if a->>'total' <> b->>'total' then raise exception 'closer cash mismatch'; end if;
end $$;
