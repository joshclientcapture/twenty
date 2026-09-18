-- Reschedules were classed as cancellations because Calendly marks the old event canceled and
-- the rescheduled flag was tested second. The flag wins now; the booking mirror does the same.
-- Generated from the live os.closer_call_rows with the two verdict lines swapped.
CREATE OR REPLACE FUNCTION os.closer_call_rows(p_closer_id text, p_from date DEFAULT NULL::date, p_to date DEFAULT NULL::date)
 RETURNS TABLE(kind text, call_key text, start_time timestamp with time zone, end_time timestamp with time zone, time_status text, rescheduled boolean, name text, email text, has_rec boolean, recording text, status text, trialed boolean, stripe_email text, overridden boolean, note text, maybe_email text, maybe_name text, maybe_mins integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'os', 'public'
AS $function$
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
      when r.kind='appt' and r.rescheduled then 'rescheduled'
      when r.kind='appt' and r.time_status='canceled' then 'cancelled'
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
$function$;
