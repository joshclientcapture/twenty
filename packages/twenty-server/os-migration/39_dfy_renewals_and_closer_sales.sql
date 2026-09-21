-- DFY (Whop) in the forecast and on the closer pages. Upcoming renewals lists Whop memberships
-- next to Stripe subscriptions; a closer's active customers and MRR come from v_paying_subs,
-- which carries DFY memberships since 38, instead of Stripe subscriptions only.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 39_dfy_renewals_and_closer_sales.sql
set search_path to os, public;

create or replace function os.get_upcoming_renewals(p_days integer default 7)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with lastpay as (
    select distinct on (customer_id) customer_id, (amount_cents-coalesce(amount_refunded_cents,0)) amt
    from stripe_payments where paid and status='succeeded' order by customer_id, created desc
  ),
  net as (select customer_id, sum(amount_cents-coalesce(amount_refunded_cents,0)) net from stripe_payments where paid and status='succeeded' group by customer_id),
  rows as (
    select s.customer_id,
      coalesce(nullif(s.customer_name,''), initcap(replace(split_part(coalesce(s.customer_email,''),'@',1),'.',' ')), 'Unknown') name,
      s.status, s.current_period_end, s.created, s.plan, coalesce(s.interval,'month') interval, s.cancel_at_period_end,
      coalesce(s.amount_cents, lp.amt, 0) mrr_cents, coalesce(n.net,0) net_cents, g.country
    from stripe_subscriptions s
    left join lastpay lp on lp.customer_id=s.customer_id
    left join net n on n.customer_id=s.customer_id
    left join stripe_customer_geo g on g.customer_id=s.customer_id
    where s.status in ('active','past_due') and s.current_period_end is not null
      and s.current_period_end <= now() + (p_days || ' days')::interval
      -- exclude subscriptions that are cancelling: no renewal payment expected
      and coalesce(s.cancel_at_period_end, false) = false
      and (s.cancel_at is null or s.cancel_at > s.current_period_end)
      and not os.is_suppressed(s.customer_email, s.customer_name)
    union all
    -- DFY memberships on Whop renew monthly on renewal_period_end.
    select 'whop:' || coalesce(m.user_id, m.member_id, lower(m.email)),
      coalesce(nullif(m.name,''), initcap(replace(split_part(coalesce(m.email,''),'@',1),'.',' ')), 'Unknown'),
      case when m.status = 'past_due' then 'past_due' else 'active' end, m.renewal_period_end, m.created_at,
      'DFY: ' || coalesce(p.title, m.product_title, 'Whop'), 'month', m.cancel_at_period_end,
      coalesce(p.monthly_cents, lp.amt, 0), coalesce(n.net,0), null::text
    from whop_memberships m
    left join whop_products p on p.id = m.product_id
    left join lastpay lp on lp.customer_id = 'whop:' || coalesce(m.user_id, m.member_id, lower(m.email))
    left join net n on n.customer_id = 'whop:' || coalesce(m.user_id, m.member_id, lower(m.email))
    where m.valid and m.renewal_period_end is not null
      and m.renewal_period_end <= now() + (p_days || ' days')::interval
      and coalesce(m.cancel_at_period_end, false) = false and m.status <> 'canceling'
      and coalesce(p.offer, 'DFY') = 'DFY'
      and not os.is_suppressed(m.email, m.name)
  )
  select jsonb_build_object(
    'days', p_days,
    'count', (select count(*) from rows),
    'past_due_count', (select count(*) from rows where current_period_end < now()),
    'total_expected', (select round(coalesce(sum(mrr_cents),0)/100.0,2) from rows),
    'rows', coalesce((select jsonb_agg(jsonb_build_object(
        'customer_id', customer_id, 'name', name, 'country', country,
        'renewal', current_period_end, 'past_due', current_period_end < now(),
        'status', case when status='past_due' then 'past_due' else 'active' end,
        'mrr', round(mrr_cents/100.0,2),
        'arr', round(mrr_cents * (case when interval='year' then 1 else 12 end)/100.0,2),
        'net_payments', round(net_cents/100.0,2),
        'plan', plan, 'interval', initcap(interval), 'since', created
      ) order by current_period_end asc) from rows), '[]'::jsonb)
  );
$function$;

-- Active customers and MRR per closer from the paying view, so DFY clients count.
create or replace function os.get_closer_sales(p_closer_id text)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with c as (select name from os.closers where id = p_closer_id),
  sales as (
    select e->>'customer_id' cid, to_char((e->>'first_paid')::timestamptz,'YYYY-MM') mk
    from jsonb_array_elements(get_sales_ledger()) e, c
    where e->>'closer' = c.name and coalesce((e->>'total_paid')::numeric,0) > 0 and e->>'first_paid' is not null
  ),
  active_cust as (
    select customer_id, sum(mrr_cents) mrr_cents from v_paying_subs
    where paying_end is null and plan <> 'Clientcapture.io Services' and coalesce(email,'') <> 'applications@nouveaumillionnaire.com'
    group by customer_id
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
$function$;

create or replace function os.get_attribution_split()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with therapon_contacts as (
    select lower(prospect_email) em from fathom_calls
      where recorded_by_email='sales@conversifi.io' and coalesce(prospect_email,'')<>''
    union
    select lower(i.email) from calendly_appointments b join calendly_invitees i on i.booking_uri=b.uri
      where b.is_new_appointment and coalesce(i.email,'')<>''
    union
    select lower(stripe_email) from therapon_call_overrides where coalesce(stripe_email,'')<>''
  ),
  trials as (
    select to_char(created,'YYYY-MM') mk,
      (lower(customer_email) in (select em from therapon_contacts)) is_th
    from stripe_subscriptions where trial_start is not null
  ),
  sales as (
    select e->>'customer_id' cid,
      to_char((e->>'first_paid')::timestamptz,'YYYY-MM') mk,
      (e->>'closer'='Therapon Savvas') is_th
    from jsonb_array_elements(get_sales_ledger()) e
    where coalesce((e->>'total_paid')::numeric,0) > 0 and e->>'first_paid' is not null
  ),
  active_cust as (
    select customer_id, sum(mrr_cents) mrr_cents from v_paying_subs
    where paying_end is null and plan <> 'Clientcapture.io Services' and coalesce(email,'') <> 'applications@nouveaumillionnaire.com'
    group by customer_id
  )
  select jsonb_build_object(
    'trials', jsonb_build_object(
      'total', (select count(*) from trials),
      'therapon', (select count(*) filter (where is_th) from trials),
      'monthly', coalesce((select jsonb_object_agg(mk, jsonb_build_object('total',t,'therapon',th))
        from (select mk, count(*) t, count(*) filter (where is_th) th from trials group by mk) q), '{}'::jsonb)
    ),
    'sales', jsonb_build_object(
      'total', (select count(*) from sales),
      'therapon', (select count(*) filter (where is_th) from sales),
      'active', (select count(*) from sales s join active_cust a on a.customer_id=s.cid where s.is_th),
      'mrr', (select round(coalesce(sum(a.mrr_cents),0)/100.0,2) from sales s join active_cust a on a.customer_id=s.cid where s.is_th),
      'monthly', coalesce((select jsonb_object_agg(mk, jsonb_build_object('total',t,'therapon',th,'active',act,'mrr',mrr))
        from (select s.mk, count(*) t, count(*) filter (where s.is_th) th,
                count(*) filter (where s.is_th and a.customer_id is not null) act,
                round(coalesce(sum(a.mrr_cents) filter (where s.is_th),0)/100.0,2) mrr
              from sales s left join active_cust a on a.customer_id=s.cid group by s.mk) q), '{}'::jsonb)
    )
  );
$function$;
