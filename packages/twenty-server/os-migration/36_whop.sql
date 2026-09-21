-- Whop: DFY subscriptions are billed through Whop, not Stripe. Every webhook is kept raw, and
-- payments and memberships are mirrored into their own tables for the lifecycle and the ledger.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 36_whop.sql
create table if not exists os.whop_events (
  id text primary key,                 -- webhook-id header, so a redelivery is a no-op
  event text not null,
  received_at timestamptz not null default now(),
  payload jsonb not null
);

create table if not exists os.whop_payments (
  id text primary key,
  status text,
  total_cents bigint,
  currency text,
  refunded_cents bigint,
  paid_at timestamptz,
  created_at timestamptz,
  user_id text,
  email text,
  name text,
  member_id text,
  membership_id text,
  product_id text,
  product_title text,
  plan_id text,
  synced_at timestamptz not null default now()
);
create index if not exists whop_payments_email_idx on os.whop_payments (lower(email));

create table if not exists os.whop_memberships (
  id text primary key,
  status text,
  valid boolean,
  user_id text,
  email text,
  name text,
  member_id text,
  product_id text,
  product_title text,
  plan_id text,
  created_at timestamptz,
  renewal_period_start timestamptz,
  renewal_period_end timestamptz,
  canceled_at timestamptz,
  cancel_at_period_end boolean,
  synced_at timestamptz not null default now()
);
create index if not exists whop_memberships_email_idx on os.whop_memberships (lower(email));

-- Which Whop products are DFY (everything created for the DFY offer is; anything else sold there later is not).
create table if not exists os.whop_products (
  id text primary key,
  title text,
  offer text not null default 'DFY',    -- DFY | OTHER
  monthly_cents bigint
);
insert into os.whop_products (id, title, offer, monthly_cents) values
  ('prod_BM4tD7NbpnfBd', 'Conversifi LinkedIn Growth Package', 'DFY', 100000),
  ('prod_i9zXCQJLYkTkG', 'Conversifi LinkedIn Growth Package + 1 Additional Account', 'DFY', 125000),
  ('prod_Cdr04jR1yFTkt', 'Conversifi LinkedIn Growth Package + 2 Additional Accounts', 'DFY', 150000),
  ('prod_Z132He0bZ9I4H', 'Conversifi LinkedIn Outreach (Own Account)', 'DFY', 75000)
on conflict (id) do update set title = excluded.title, offer = excluded.offer, monthly_cents = excluded.monthly_cents;
