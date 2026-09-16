-- get_records() drill-downs per closer. `p_arg` may be a closer id ('jamal') or name
-- ('Jamal Robinson'); with no arg the OS app's Therapon defaults still apply. Commission
-- amounts use the closer's rate instead of a flat 10%.
set search_path to os, public;

create or replace function os.get_records(p_type text, p_month text default null, p_arg text default null, p_from date default null, p_to date default null)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with closer as (
    select * from os.closers where id = p_arg or name = p_arg
    union all
    select * from os.closers where id = 'therapon' and not exists (select 1 from os.closers where id = p_arg or name = p_arg)
    limit 1
  )
  select case p_type
    when 'calls' then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'name', coalesce(nullif(f.prospect_name,''),
          nullif(btrim(regexp_replace(case when f.title like '%:%' then split_part(f.title,':',1)
            when f.title like '% and %' then split_part(f.title,' and ',1) else f.title end,'\s+',' ','g')),''), f.prospect_email),
        'email', f.prospect_email, 'date', f.recording_start, 'recording', f.fathom_url
      ) order by f.recording_start desc), '[]'::jsonb)
      from fathom_calls f, closer c where f.recorded_by_email = c.fathom_email
        and exists(select 1 from calendly_appointments b where b.is_new_appointment and b.host_email = c.calendly_host_email
                   and b.start_time=f.scheduled_start and b.time_status<>'canceled'
                   and not exists(select 1 from calendly_invitees i where i.booking_uri=b.uri and coalesce(i.rescheduled,false)))
        and (p_month is null or to_char(f.recording_start,'YYYY-MM')=p_month)
        and (p_from is null or coalesce(f.scheduled_start,f.recording_start) >= p_from)
        and (p_to is null or coalesce(f.scheduled_start,f.recording_start) < (p_to + 1)))
    when 'bookings' then (
      select coalesce(jsonb_agg(jsonb_build_object('name',i.name,'email',i.email,'date',b.start_time,'status',b.time_status,'event',b.name) order by b.start_time desc),'[]'::jsonb)
      from calendly_appointments b left join calendly_invitees i on i.booking_uri=b.uri, closer c
      where b.is_new_appointment and b.host_email = c.calendly_host_email and (p_month is null or to_char(b.start_time,'YYYY-MM')=p_month)
        and (p_from is null or b.start_time >= p_from) and (p_to is null or b.start_time < (p_to + 1)))
    when 'cancellations' then (
      select coalesce(jsonb_agg(jsonb_build_object('name',i.name,'email',i.email,'date',b.start_time,'reason',nullif(i.cancel_reason,'')) order by b.start_time desc),'[]'::jsonb)
      from calendly_appointments b join calendly_invitees i on i.booking_uri=b.uri, closer c
      where b.is_new_appointment and b.host_email = c.calendly_host_email and b.time_status='canceled' and b.start_time < now() and coalesce(i.rescheduled,false)=false
        and (p_month is null or to_char(b.start_time,'YYYY-MM')=p_month)
        and (p_from is null or b.start_time >= p_from) and (p_to is null or b.start_time < (p_to + 1)))
    when 'noshows' then (
      select coalesce(jsonb_agg(jsonb_build_object('name',i.name,'email',i.email,'date',b.start_time) order by b.start_time desc),'[]'::jsonb)
      from calendly_appointments b join calendly_invitees i on i.booking_uri=b.uri, closer c
      where b.is_new_appointment and b.host_email = c.calendly_host_email and b.time_status<>'canceled' and b.start_time < now() and coalesce(i.rescheduled,false)=false
        and not exists(select 1 from fathom_calls f where f.recorded_by_email = c.fathom_email and f.scheduled_start=b.start_time)
        and (p_month is null or to_char(b.start_time,'YYYY-MM')=p_month)
        and (p_from is null or b.start_time >= p_from) and (p_to is null or b.start_time < (p_to + 1)))
    when 'trials' then (
      select coalesce(jsonb_agg(jsonb_build_object('name',coalesce(nullif(customer_name,''),initcap(replace(split_part(coalesce(customer_email,'?'),'@',1),'.',' '))),'email',customer_email,'status',status,'plan',plan,'date',created,'trial_ends',trial_end,'paid',(status='active')) order by created desc),'[]'::jsonb)
      from stripe_subscriptions where trial_start is not null and (p_month is null or to_char(created,'YYYY-MM')=p_month)
        and (p_from is null or created >= p_from) and (p_to is null or created < (p_to + 1)))
    when 'sales' then (
      with led as (select e->>'customer_id' cid, e->>'closer' clr, e->>'name' nm, e->>'email' em, e->>'fathom_url' rec from jsonb_array_elements(get_sales_ledger()) e),
      pay as (select sp.id, sp.customer_id, sp.created, (sp.amount_cents-coalesce(sp.amount_refunded_cents,0)) net,
        row_number() over (partition by sp.customer_id order by sp.created) pn,
        sum(sp.amount_cents-coalesce(sp.amount_refunded_cents,0)) over (partition by sp.customer_id) tot,
        (cp.payment_id is not null) comm_paid
        from stripe_payments sp left join commission_paid cp on cp.payment_id=sp.id where sp.paid and sp.status='succeeded')
      select coalesce(jsonb_agg(jsonb_build_object('name',led.nm,'email',led.em,'date',pay.created,'amount',round(pay.net/100.0,2),
        'payment_no',pay.pn,'total_paid',round(pay.tot/100.0,2),'recording',led.rec,'customer_id',pay.customer_id,
        'payment_id',pay.id,'commission',round(pay.net*c.commission_rate/100.0,2),'commission_paid',pay.comm_paid) order by pay.created desc),'[]'::jsonb)
      from pay join led on led.cid=pay.customer_id, closer c
      where led.clr = c.name and (p_month is null or to_char(pay.created,'YYYY-MM')=p_month)
        and (p_from is null or pay.created >= p_from) and (p_to is null or pay.created < (p_to + 1)))
    when 'sales_comm_due' then (
      with led as (select e->>'customer_id' cid, e->>'closer' clr, e->>'name' nm, e->>'email' em from jsonb_array_elements(get_sales_ledger()) e),
      pay as (select sp.id, sp.customer_id, sp.created, (sp.amount_cents-coalesce(sp.amount_refunded_cents,0)) net,
        row_number() over (partition by sp.customer_id order by sp.created) pn, (cp.payment_id is not null) comm_paid
        from stripe_payments sp left join commission_paid cp on cp.payment_id=sp.id where sp.paid and sp.status='succeeded')
      select coalesce(jsonb_agg(jsonb_build_object('name',led.nm,'email',led.em,'date',pay.created,'amount',round(pay.net/100.0,2),
        'payment_no',pay.pn,'commission',round(pay.net*c.commission_rate/100.0,2),'payment_id',pay.id,'commission_paid',pay.comm_paid,'customer_id',pay.customer_id) order by pay.created desc),'[]'::jsonb)
      from pay join led on led.cid=pay.customer_id, closer c where led.clr = c.name and not pay.comm_paid)
    when 'sales_comm_paid' then (
      with led as (select e->>'customer_id' cid, e->>'closer' clr, e->>'name' nm, e->>'email' em from jsonb_array_elements(get_sales_ledger()) e),
      pay as (select sp.id, sp.customer_id, sp.created, (sp.amount_cents-coalesce(sp.amount_refunded_cents,0)) net,
        row_number() over (partition by sp.customer_id order by sp.created) pn, (cp.payment_id is not null) comm_paid
        from stripe_payments sp left join commission_paid cp on cp.payment_id=sp.id where sp.paid and sp.status='succeeded')
      select coalesce(jsonb_agg(jsonb_build_object('name',led.nm,'email',led.em,'date',pay.created,'amount',round(pay.net/100.0,2),
        'payment_no',pay.pn,'commission',round(pay.net*c.commission_rate/100.0,2),'payment_id',pay.id,'commission_paid',pay.comm_paid,'customer_id',pay.customer_id) order by pay.created desc),'[]'::jsonb)
      from pay join led on led.cid=pay.customer_id, closer c where led.clr = c.name and pay.comm_paid)
    when 'customer_payments' then (
      select coalesce(jsonb_agg(jsonb_build_object('date',created,'payment_no',pn,'amount',amt,'status',status) order by created desc),'[]'::jsonb)
      from (select created, status, round((amount_cents-coalesce(amount_refunded_cents,0))/100.0,2) amt, row_number() over (order by created) pn
            from stripe_payments where customer_id=p_arg and paid and status='succeeded') q)
    else '[]'::jsonb end;
$function$;

-- Therapon defaults unchanged, and a named closer now gets their own rows.
do $$
begin
  if jsonb_array_length(os.get_records('sales', null, null)) <> jsonb_array_length(os.get_records('sales', null, 'Therapon Savvas')) then
    raise exception 'therapon default sales mismatch';
  end if;
  if jsonb_array_length(os.get_records('sales', null, 'Jamal Robinson')) = jsonb_array_length(os.get_records('sales', null, 'Therapon Savvas')) then
    raise exception 'closer arg ignored for sales';
  end if;
  if jsonb_array_length(os.get_records('sales', null, 'jamal')) <> jsonb_array_length(os.get_records('sales', null, 'Jamal Robinson')) then
    raise exception 'closer id and name disagree';
  end if;
end $$;
