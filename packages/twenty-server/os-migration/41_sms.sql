-- Melanie's SMS chase for form leads who did not book within 15 minutes (DFY, demo, agency).
-- One thread per person and form, every message in and out, and the unmatched inbound texts.
--   docker exec -i -e PGPASSWORD=$PW twenty-dev-db-1 psql -U postgres -d default < 41_sms.sql
set search_path to os, public;

create table if not exists os.sms_threads (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null,
  phone text not null,                       -- E.164
  route text not null,                       -- dfy | demo | agency
  first_name text,
  full_name text,
  email text,
  status text not null default 'queued',     -- queued | opener_sent | replied | handed_off | booked | stopped | opted_out
  stop_reason text,
  form_at timestamptz,
  due_at timestamptz,                        -- opener due: form + 15 min
  opener_at timestamptz,
  ladder_step int not null default 0,
  ladder_due_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  ai_due_at timestamptz,
  ai_busy_until timestamptz,
  interest text,
  handoff_reason text,
  from_number text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists sms_threads_phone_idx on os.sms_threads (phone, created_at desc);
create index if not exists sms_threads_person_idx on os.sms_threads (person_id, created_at desc);
create index if not exists sms_threads_status_idx on os.sms_threads (status);

create table if not exists os.sms_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references os.sms_threads (id) on delete cascade,
  direction text not null,                   -- in | out
  kind text,                                 -- opener | typo | ladder | ai | inbound
  body text not null,
  by_ai boolean not null default false,
  provider_sid text,
  provider_status text,
  at timestamptz not null default now()
);
create index if not exists sms_messages_thread_idx on os.sms_messages (thread_id, at);
create unique index if not exists sms_messages_sid_idx on os.sms_messages (provider_sid) where provider_sid is not null;

create table if not exists os.sms_inbound_unmatched (
  id uuid primary key default gen_random_uuid(),
  from_number text,
  to_number text,
  body text,
  provider_sid text,
  at timestamptz not null default now(),
  payload jsonb
);
