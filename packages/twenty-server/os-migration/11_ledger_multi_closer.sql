-- Sales attribution per closer. build_sales_ledger() used to credit every matched customer to
-- 'Therapon Savvas'; now the closer is whoever hosted the earliest matching call (Calendly host,
-- Fathom recorder, or a manual trial override), looked up through os.closers. With one closer
-- the output is identical, which the check at the bottom proves.
set search_path to os, public;

create or replace function os.build_sales_ledger()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with pay as (
    select customer_id, sum(amount_cents - coalesce(amount_refunded_cents,0)) net_cents,
      count(*) payments, min(created) first_paid, max(created) last_paid, lower(max(email)) stripe_pay_email
    from stripe_payments where paid and status='succeeded' and customer_id is not null group by 1
  ),
  base as (
    select p.*, cc.user_id, cc.auth_email, cc.stripe_email, cc.stripe_name, cc.status, cc.plan_type, cc.signup_at,
      lower(cc.auth_email) ae, lower(cc.stripe_email) se,
      lower(btrim(regexp_replace(coalesce(cc.stripe_name,''),'\s+',' ','g'))) nm
    from pay p left join conversifi_customers cc on cc.stripe_customer_id = p.customer_id
  ),
  -- Every contact moment that can tie a customer to a closer.
  touch as (
    select lower(i.email) e, lower(btrim(regexp_replace(coalesce(i.name,''),'\s+',' ','g'))) n,
           b.start_time at, null::text fathom_url, c.name closer
    from calendly_invitees i
    join calendly_bookings b on b.uri = i.booking_uri
    left join os.closers c on lower(c.calendly_host_email) = lower(b.host_email)
    where b.name <> 'Conversifi.io - Next Steps'
    union all
    select lower(f.prospect_email), lower(nullif(btrim(regexp_replace(split_part(f.title,':',1),'\s+',' ','g')),'')),
           f.recording_start, f.fathom_url, c.name
    from fathom_calls f
    join os.closers c on lower(c.fathom_email) = lower(f.recorded_by_email)
    union all
    -- an email captured on a manual "trial started" override attributes the sale to that closer
    select lower(o.stripe_email), null, o.updated_at, null, coalesce(c.name, 'Therapon Savvas')
    from therapon_call_overrides o left join os.closers c on c.id = o.closer_id
    where coalesce(o.stripe_email,'') <> ''
  ),
  scored as (
    select b.*, o.source as override_source, o.closer as override_closer, coalesce(o.excluded,false) as excluded,
      m.email_match, m.name_match, m.fathom_url, m.first_call, m.matched_closer
    from base b
    left join sales_overrides o on o.customer_id = b.customer_id
    left join lateral (
      select
        coalesce(bool_or(src = 'email'), false) email_match,
        coalesce(bool_or(src = 'name'), false) name_match,
        (array_agg(fathom_url order by at nulls last) filter (where fathom_url is not null))[1] fathom_url,
        min(at) filter (where fathom_url is not null) first_call,
        (array_agg(closer order by at nulls last) filter (where closer is not null))[1] matched_closer
      from (
        select 'email' src, t.at, t.fathom_url, t.closer from touch t where t.e is not null and t.e in (b.ae, b.se, b.stripe_pay_email)
        union all
        select 'name', t.at, t.fathom_url, t.closer from touch t where b.nm <> '' and t.n = b.nm
      ) x
    ) m on true
  ),
  fin as (
    select s.*, coalesce(s.override_source, case when (s.email_match or s.name_match) then 'linkedin_outreach' end) as source
    from scored s where not s.excluded
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'customer_id', f.customer_id,
    'name', coalesce(nullif(f.stripe_name,''), initcap(replace(split_part(coalesce(f.auth_email,f.stripe_pay_email,'?'),'@',1),'.',' '))),
    'email', coalesce(f.auth_email, f.stripe_pay_email),
    'stripe_email', case when f.stripe_email is not null and lower(f.stripe_email)<>lower(coalesce(f.auth_email,'')) then f.stripe_email end,
    'status', f.status, 'plan', f.plan_type,
    'total_paid', round(f.net_cents/100.0,2), 'payments', f.payments,
    'first_paid', f.first_paid, 'last_paid', f.last_paid, 'signup_at', f.signup_at,
    'in_subscriptions', f.user_id is not null,
    'fathom_url', f.fathom_url, 'first_call', f.first_call,
    'source', f.source,
    'closer', case when f.source='linkedin_outreach'
                   then coalesce(f.override_closer, case when (f.email_match or f.name_match) then f.matched_closer end) end,
    'is_manual', (f.override_source is not null or f.override_closer is not null),
    'bucket', case when f.source is not null then 'attributed' else 'unattributed' end
  ) order by f.net_cents desc), '[]'::jsonb)
  from fin f;
$$;

-- Same customers, same closers as the cached ledger built by the old function.
do $$
declare diff int; old_n int; new_n int;
begin
  select jsonb_array_length(data) into old_n from os.sales_ledger_cache where id = 1;
  select jsonb_array_length(os.build_sales_ledger()) into new_n;
  if old_n <> new_n then raise exception 'ledger row count changed: % -> %', old_n, new_n; end if;
  select count(*) into diff from (
    select e->>'customer_id' cid, e->>'closer' closer, e->>'source' source from jsonb_array_elements((select data from os.sales_ledger_cache where id=1)) e
    except
    select e->>'customer_id', e->>'closer', e->>'source' from jsonb_array_elements(os.build_sales_ledger()) e
  ) d;
  if diff <> 0 then raise exception 'ledger attribution changed for % customers', diff; end if;
end $$;

select os.refresh_sales_ledger();
