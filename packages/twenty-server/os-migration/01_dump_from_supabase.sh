#!/bin/bash
# Dumps the OS Supabase project's public schema (structure + data) into /root/os-migration/.
# Run on the VPS. Needs OS_SUPABASE_DB_URL in the environment, e.g.
#   OS_SUPABASE_DB_URL='postgresql://postgres.shhgojbfvatscupsaqcv:<password>@aws-0-eu-west-2.pooler.supabase.com:5432/postgres'
set -euo pipefail
: "${OS_SUPABASE_DB_URL:?set OS_SUPABASE_DB_URL}"
OUT=/root/os-migration
mkdir -p "$OUT"

# Supabase's direct host is IPv6-only and the pooler does not know this tenant, so pg_dump runs
# in a throwaway container on the host network (containers have no IPv6 by default).
PGDUMP="docker run --rm --network host postgres:17 pg_dump"

# Structure: tables, sequences, views, functions, indexes. No owners, grants, RLS policies or
# Supabase-only bits; those are stripped again in 02 before restore.
$PGDUMP "$OS_SUPABASE_DB_URL" --schema=public --schema-only --no-owner --no-privileges --no-security-labels \
  --no-publications --no-subscriptions --no-comments > "$OUT/schema_public.sql"

# Data for every table except the sync log (7k rows of history nobody reads).
$PGDUMP "$OS_SUPABASE_DB_URL" --schema=public --data-only --no-owner --no-privileges \
  --exclude-table=public.calendly_sync_log > "$OUT/data_public.sql"

ls -la "$OUT"
grep -c "^CREATE TABLE" "$OUT/schema_public.sql" | sed 's/^/tables: /'
grep -c "^CREATE .*FUNCTION" "$OUT/schema_public.sql" | sed 's/^/functions: /'
grep -c "^CREATE VIEW\|^CREATE OR REPLACE VIEW" "$OUT/schema_public.sql" | sed 's/^/views: /'
echo DUMP_DONE
