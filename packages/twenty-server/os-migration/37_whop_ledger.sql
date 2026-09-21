-- Whop DFY payments on the ledger. Every paid Whop payment is mirrored into os.stripe_payments
-- (source = 'whop', customer 'whop:<user>') so the ledger, Records, closer commission and the
-- revenue tiles see one payments table. Commission runs on every payment while the client stays.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 37_whop_ledger.sql
set search_path to os, public;

alter table os.stripe_payments add column if not exists source text not null default 'stripe';
create index if not exists stripe_payments_source_idx on os.stripe_payments (source);

create or replace function os.mirror_whop_payments()
returns integer language plpgsql security definer set search_path to 'os', 'public' as $function$
declare n int;
begin
  insert into os.stripe_payments (id, customer_id, amount_cents, amount_refunded_cents, currency, created, status, paid, refunded, email, payer_name, description, synced_at, source)
  select y.id, 'whop:' || coalesce(y.user_id, y.member_id, lower(y.email)), y.total_cents, coalesce(y.refunded_cents, 0),
         lower(coalesce(y.currency, 'usd')), coalesce(y.paid_at, y.created_at), 'succeeded', true,
         coalesce(y.refunded_cents, 0) >= y.total_cents, lower(y.email), y.name,
         'DFY: ' || coalesce(p.title, y.product_title, 'Whop'), now(), 'whop'
  from os.whop_payments y left join os.whop_products p on p.id = y.product_id
  where y.status = 'paid' and coalesce(y.total_cents, 0) > 0 and coalesce(p.offer, 'DFY') = 'DFY'
    and coalesce(y.user_id, y.member_id, y.email) is not null
    and not os.is_suppressed(y.email, y.name)
  on conflict (id) do update set
    customer_id = excluded.customer_id, amount_cents = excluded.amount_cents, amount_refunded_cents = excluded.amount_refunded_cents,
    currency = excluded.currency, created = excluded.created, refunded = excluded.refunded, email = excluded.email,
    payer_name = excluded.payer_name, description = excluded.description, synced_at = now(), source = 'whop';
  get diagnostics n = row_count;
  delete from os.stripe_payments sp where sp.source = 'whop' and not exists (
    select 1 from os.whop_payments y left join os.whop_products p on p.id = y.product_id
    where y.id = sp.id and y.status = 'paid' and coalesce(y.total_cents, 0) > 0 and coalesce(p.offer, 'DFY') = 'DFY' and not os.is_suppressed(y.email, y.name));
  return n;
end $function$;

create or replace function os.build_sales_ledger()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $$
  with pay as (
    select customer_id, sum(amount_cents - coalesce(amount_refunded_cents,0)) net_cents,
      count(*) payments, min(created) first_paid, max(created) last_paid, lower(max(email)) stripe_pay_email,
      max(nullif(btrim(payer_name), '')) payer_name
    from stripe_payments where paid and status='succeeded' and customer_id is not null group by 1
  ),
  subname as (
    select distinct on (customer_id) customer_id, nullif(btrim(customer_name),'') customer_name, lower(nullif(btrim(customer_email),'')) customer_email
    from stripe_subscriptions where customer_id is not null
    order by customer_id, (status='active') desc, created desc
  ),
  base as (
    select p.*, cc.user_id, cc.auth_email, cc.stripe_email, cc.stripe_name, cc.status, cc.plan_type, cc.signup_at,
      sn.customer_name sub_name, sn.customer_email sub_email, dfy.dfy_status,
      lower(cc.auth_email) ae, lower(cc.stripe_email) se,
      lower(btrim(regexp_replace(coalesce(nullif(cc.stripe_name,''), sn.customer_name, p.payer_name, ''),'\s+',' ','g'))) nm
    from pay p
    left join conversifi_customers cc on cc.stripe_customer_id = p.customer_id
    left join subname sn on sn.customer_id = p.customer_id
    -- DFY customers come from Whop and have no Stripe customer: their status is the Whop membership.
    left join lateral (
      select case when bool_or(wm.valid) then 'active' else 'canceled' end dfy_status
      from os.whop_memberships wm
      where p.customer_id like 'whop:%' and ('whop:' || coalesce(wm.user_id, wm.member_id, lower(wm.email)) = p.customer_id or lower(wm.email) = p.stripe_pay_email)
    ) dfy on true
  ),
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
        select 'email' src, t.at, t.fathom_url, t.closer from touch t where t.e is not null and t.e in (b.ae, b.se, b.stripe_pay_email, b.sub_email)
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
    'name', coalesce(nullif(f.stripe_name,''), f.sub_name, f.payer_name,
                     initcap(replace(split_part(coalesce(f.auth_email, f.sub_email, f.stripe_pay_email, '?'),'@',1),'.',' '))),
    'email', coalesce(f.auth_email, f.sub_email, f.stripe_pay_email),
    'stripe_email', case when f.stripe_email is not null and lower(f.stripe_email)<>lower(coalesce(f.auth_email,'')) then f.stripe_email end,
    'status', coalesce(f.status, f.dfy_status), 'plan', coalesce(f.plan_type, case when f.customer_id like 'whop:%' then 'DFY' end),
    'channel', case when f.customer_id like 'whop:%' then 'dfy' else 'software' end,
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

-- Commission summary per closer at each closer's own rate (was a flat 10% with Jamal hard-coded out).
create or replace function os.get_commission_summary()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with led as (select e->>'customer_id' cid, e->>'closer' clr from jsonb_array_elements(get_sales_ledger()) e),
  pay as (
    select sp.id, sp.customer_id, (sp.amount_cents-coalesce(sp.amount_refunded_cents,0)) net, (cp.payment_id is not null) as comm_paid
    from stripe_payments sp left join commission_paid cp on cp.payment_id = sp.id
    where sp.paid and sp.status='succeeded'
  ),
  j as (
    select p.net, p.comm_paid, led.clr, coalesce(c.commission_rate, 0.10) rate, coalesce(c.commissioned, led.clr <> 'Jamal Robinson') commissioned
    from pay p join led on led.cid=p.customer_id left join os.closers c on c.name = led.clr where led.clr is not null
  ),
  reps as (
    select clr rep, rate, commissioned,
      round(sum(net)/100.0,2) revenue,
      round(sum(net)*rate/100.0,2) earned,
      round(coalesce(sum(net) filter (where comm_paid),0)*rate/100.0,2) paid,
      round(coalesce(sum(net) filter (where not comm_paid),0)*rate/100.0,2) outstanding,
      count(*) payments, count(*) filter (where comm_paid) payments_paid, count(*) filter (where not comm_paid) payments_due
    from j group by clr, rate, commissioned
  )
  select jsonb_build_object(
    'commission_rate', 0.10,
    'next_payout', (date_trunc('month',current_date)+interval '1 month - 1 day')::date,
    'reps', coalesce((select jsonb_agg(jsonb_build_object(
      'rep',rep,'revenue',revenue,'earned',earned,'paid',paid,'outstanding',outstanding,'commission_rate',rate,
      'payments',payments,'payments_paid',payments_paid,'payments_due',payments_due,'commissioned',commissioned)
      order by earned desc) from reps),'[]'::jsonb)
  );
$function$;

-- DFY on the revenue page: live Whop memberships priced from the product list, cash from the mirrored payments.
create or replace function os.get_dfy_revenue()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with live as (
    select distinct on (m.id) m.id, coalesce(m.user_id, m.member_id, lower(m.email)) who,
      coalesce(p.monthly_cents, (select y.total_cents from os.whop_payments y where y.membership_id = m.id and y.status = 'paid' order by coalesce(y.paid_at, y.created_at) desc limit 1), 0) mrr_cents
    from os.whop_memberships m left join os.whop_products p on p.id = m.product_id
    where m.valid and coalesce(p.offer, 'DFY') = 'DFY' and not os.is_suppressed(m.email, m.name)
  ),
  cash as (
    select to_char(created, 'YYYY-MM') mk, sum(amount_cents - coalesce(amount_refunded_cents, 0)) net
    from os.stripe_payments where source = 'whop' and paid and status = 'succeeded' group by 1
  )
  select jsonb_build_object(
    'mrr', (select round(coalesce(sum(mrr_cents), 0)/100.0) from live),
    'clients', (select count(distinct who) from live),
    'collected', (select round(coalesce(sum(net), 0)/100.0, 2) from cash),
    'collected_this_month', (select round(coalesce(sum(net), 0)/100.0, 2) from cash where mk = to_char(current_date, 'YYYY-MM')),
    'monthly', coalesce((select jsonb_object_agg(mk, round(net/100.0, 2)) from cash), '{}'::jsonb)
  );
$function$;

select os.mirror_whop_payments();
select os.refresh_sales_ledger();
