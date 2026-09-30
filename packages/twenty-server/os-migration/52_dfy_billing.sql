-- DFY billing on Airwallex / bank transfer instead of Whop: paid instalments are mirrored into
-- os.stripe_payments with source 'transfer' | 'airwallex' | 'manual' (customer 'dfy:<personId>'),
-- so the ledger, commission and Revenue keep working. The two custom objects are created by
-- OsDfyBillingService.ensureMetadata (POST /os/dfy/setup) BEFORE this file runs.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 52_dfy_billing.sql
set search_path to os, public;

-- Every DFY source counts as DFY cash.
create or replace function os.is_dfy_source(p_source text)
returns boolean language sql immutable as $$ select coalesce(p_source, '') in ('whop', 'transfer', 'airwallex', 'manual'); $$;

create or replace function os.get_dfy_revenue()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with live as (
    select distinct on (m.id) m.id, coalesce(m.user_id, m.member_id, lower(m.email)) who,
      coalesce(p.monthly_cents, (select y.total_cents from os.whop_payments y where y.membership_id = m.id and y.status = 'paid' order by coalesce(y.paid_at, y.created_at) desc limit 1), 0) mrr_cents
    from os.whop_memberships m left join os.whop_products p on p.id = m.product_id
    where m.valid and coalesce(p.offer, 'DFY') = 'DFY' and not os.is_suppressed(m.email, m.name)
  ),
  -- A live engagement is worth its package price spread over the 90-day term, per month.
  engaged as (
    select e.id, e."personId" who, round(coalesce(e."priceAmountMicros", 0) / 1000000.0 * 100 / 3.0) mrr_cents
    from workspace_a1aip8pgko71t0v2lrw9rnizs."_dfyEngagement" e
    where e."deletedAt" is null and e.status::text in ('LIVE', 'PAUSED')
  ),
  cash as (
    select to_char(created, 'YYYY-MM') mk, sum(amount_cents - coalesce(amount_refunded_cents, 0)) net
    from os.stripe_payments where os.is_dfy_source(source) and paid and status = 'succeeded' group by 1
  )
  select jsonb_build_object(
    'mrr', (select round(coalesce(sum(mrr_cents), 0)/100.0) from (select mrr_cents from live union all select mrr_cents from engaged) x),
    'clients', (select count(*) from (select who from live union select who::text from engaged) x),
    'collected', (select round(coalesce(sum(net), 0)/100.0, 2) from cash),
    'collected_this_month', (select round(coalesce(sum(net), 0)/100.0, 2) from cash where mk = to_char(current_date, 'YYYY-MM')),
    'monthly', coalesce((select jsonb_object_agg(mk, round(net/100.0, 2)) from cash), '{}'::jsonb)
  );
$function$;

-- The DFY Billing page: everything due, overdue and renewing, plus the forecast by month.
create or replace function os.get_dfy_billing()
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  with i as (
    select i.id, i.name, i.number, i.kind::text kind, i.status::text status, i.method::text method, i."dueDate" due_date, i."paidAt" paid_at,
      round(coalesce(i."amountAmountMicros", 0) / 1000000.0, 2) amount, round(coalesce(i."paidAmountAmountMicros", 0) / 1000000.0, 2) paid_amount,
      i."invoiceReference" reference, i."engagementId" engagement_id, i."personId" person_id
    from workspace_a1aip8pgko71t0v2lrw9rnizs."_dfyInstalment" i where i."deletedAt" is null
  ),
  e as (
    select e.id, e.name, e.package, e.plan::text plan, e.status::text status, e."contractDate" contract_date, e."goLiveDate" go_live_date, e."endDate" end_date,
      e."pausedAt" paused_at, e."volumeTarget" volume_target, e."volumeDelivered" volume_delivered, e."daysPaused" days_paused, e."closerEmail" closer_email,
      round(coalesce(e."priceAmountMicros", 0) / 1000000.0, 2) price, e."personId" person_id,
      p."nameFirstName" || ' ' || p."nameLastName" client, p."emailsPrimaryEmail" client_email,
      (select coalesce(sum(paid_amount), 0) from i where i.engagement_id = e.id and i.status = 'PAID') paid_total,
      (select count(*) from i where i.engagement_id = e.id and i.status = 'OVERDUE') overdue_count,
      (select min(due_date) from i where i.engagement_id = e.id and i.status in ('SCHEDULED', 'INVOICED', 'PENDING', 'OVERDUE')) next_due
    from workspace_a1aip8pgko71t0v2lrw9rnizs."_dfyEngagement" e
    left join workspace_a1aip8pgko71t0v2lrw9rnizs.person p on p.id = e."personId"
    where e."deletedAt" is null
  )
  select jsonb_build_object(
    'engagements', coalesce((select jsonb_agg(to_jsonb(e) order by (e.status in ('LIVE','PAUSED','PENDING')) desc, e.next_due nulls last) from e), '[]'::jsonb),
    'instalments', coalesce((select jsonb_agg(to_jsonb(i) order by i.due_date) from i), '[]'::jsonb),
    'due_this_week', coalesce((select round(sum(amount), 2) from i where i.status in ('SCHEDULED','INVOICED','PENDING') and i.due_date between current_date and current_date + 7), 0),
    'overdue', coalesce((select round(sum(amount), 2) from i where i.status = 'OVERDUE'), 0),
    'overdue_count', (select count(*) from i where i.status = 'OVERDUE'),
    'renewals_30d', (select count(*) from i where i.kind = 'RENEWAL' and i.status <> 'PAID' and i.status <> 'CANCELLED' and i.due_date between current_date and current_date + 30),
    'collected_this_month', coalesce((select round(sum(paid_amount), 2) from i where i.status = 'PAID' and date_trunc('month', i.paid_at) = date_trunc('month', now())), 0),
    'forecast', coalesce((select jsonb_object_agg(mk, total) from (select to_char(due_date, 'YYYY-MM') mk, round(sum(amount), 2) total from i where i.status in ('SCHEDULED','INVOICED','PENDING','OVERDUE') group by 1) f), '{}'::jsonb),
    'live', (select count(*) from e where e.status in ('LIVE','PAUSED')),
    'paused', (select count(*) from e where e.status = 'PAUSED')
  );
$function$;

-- The Invoicing tab on one client.
create or replace function os.get_dfy_client_billing(p_person_id uuid)
returns jsonb language sql stable security definer set search_path to 'os', 'public' as $function$
  select jsonb_build_object(
    'engagements', coalesce((select jsonb_agg(jsonb_build_object(
        'id', e.id, 'name', e.name, 'package', e.package, 'plan', e.plan::text, 'status', e.status::text, 'price', round(coalesce(e."priceAmountMicros", 0) / 1000000.0, 2),
        'contract_date', e."contractDate", 'go_live_date', e."goLiveDate", 'end_date', e."endDate", 'paused_at', e."pausedAt", 'days_paused', e."daysPaused",
        'volume_target', e."volumeTarget", 'volume_delivered', e."volumeDelivered", 'closer_email', e."closerEmail",
        'instalments', coalesce((select jsonb_agg(jsonb_build_object(
            'id', i.id, 'name', i.name, 'number', i.number, 'kind', i.kind::text, 'status', i.status::text, 'method', i.method::text, 'due_date', i."dueDate",
            'amount', round(coalesce(i."amountAmountMicros", 0) / 1000000.0, 2), 'paid_amount', round(coalesce(i."paidAmountAmountMicros", 0) / 1000000.0, 2),
            'paid_at', i."paidAt", 'reference', i."invoiceReference", 'provider_reference', i."providerReference"
          ) order by i.number) from workspace_a1aip8pgko71t0v2lrw9rnizs."_dfyInstalment" i where i."engagementId" = e.id and i."deletedAt" is null), '[]'::jsonb)
      ) order by e."createdAt" desc) from workspace_a1aip8pgko71t0v2lrw9rnizs."_dfyEngagement" e where e."personId" = p_person_id and e."deletedAt" is null), '[]'::jsonb)
  );
$function$;
