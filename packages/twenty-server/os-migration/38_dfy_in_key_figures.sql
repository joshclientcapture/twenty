-- DFY memberships (Whop) count as paying subscriptions everywhere the key figures are built:
-- ARR, paid subscribers, new and churned customers, customer records. Jamal, 21 Sep 2026:
-- "dfy should be in ARR btw it should mix well in key figures".
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 38_dfy_in_key_figures.sql
set search_path to os, public;

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
  WHERE ((COALESCE(s.amount_cents, lp.amt, (0)::bigint) > 0) AND (s.status <> 'trialing'::text)) AND NOT os.is_suppressed(s.customer_email, s.customer_name)
 UNION ALL
 -- DFY: one row per Whop membership, priced from the product list, else the last payment on it.
 SELECT m.id,
    ('whop:' || COALESCE(m.user_id, m.member_id, lower(m.email))) AS customer_id,
    COALESCE(NULLIF(m.name, ''::text), initcap(replace(split_part(COALESCE(m.email, ''::text), '@'::text, 1), '.'::text, ' '::text)), 'Unknown'::text) AS name,
    lower(m.email) AS email,
    m.status,
    ('DFY: ' || COALESCE(p.title, m.product_title, 'Whop'::text)) AS plan,
    'month'::text AS "interval",
    round(COALESCE(p.monthly_cents, lpw.amt)::numeric) AS mrr_cents,
    date(m.created_at) AS paying_start,
        CASE
            WHEN m.valid THEN NULL::date
            ELSE date(COALESCE(m.canceled_at, m.renewal_period_end, m.synced_at))
        END AS paying_end,
    NULL::text AS country
   FROM os.whop_memberships m
     LEFT JOIN os.whop_products p ON p.id = m.product_id
     LEFT JOIN LATERAL (
        SELECT y.total_cents AS amt FROM os.whop_payments y
        WHERE y.membership_id = m.id AND y.status = 'paid' AND COALESCE(y.total_cents, 0) > 0
        ORDER BY COALESCE(y.paid_at, y.created_at) DESC LIMIT 1
     ) lpw ON true
  WHERE COALESCE(p.offer, 'DFY') = 'DFY' AND COALESCE(p.monthly_cents, lpw.amt, 0) > 0
    AND m.status <> 'trialing' AND m.created_at IS NOT NULL
    AND NOT os.is_suppressed(m.email, m.name);
