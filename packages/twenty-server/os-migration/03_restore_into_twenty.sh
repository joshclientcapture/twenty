#!/bin/bash
# Loads schema_os.sql then data_os.sql into Twenty's core database (schema `os`).
# Drops and recreates the `os` schema first, so this is safe to re-run until cut-over.
set -euo pipefail
IN=/root/os-migration
set -a; . /root/twenty/packages/twenty-server/.env; set +a
PSQL="docker exec -i twenty-dev-db-1 psql $PG_DATABASE_URL -v ON_ERROR_STOP=1 -q"

echo "-- backup of core db before touching it"
docker exec twenty-dev-db-1 pg_dump "$PG_DATABASE_URL" -Fc > "$IN/twenty_core_before_os_$(date +%Y%m%d_%H%M%S).dump"

echo "-- reset os schema"
$PSQL -c "drop schema if exists os cascade;"

echo "-- schema"
$PSQL < "$IN/schema_os.sql"

echo "-- data"
$PSQL < "$IN/data_os.sql"

echo "-- sanity"
docker exec twenty-dev-db-1 psql "$PG_DATABASE_URL" -Atc "
select 'tables', count(*) from pg_tables where schemaname='os'
union all select 'views', count(*) from pg_views where schemaname='os'
union all select 'functions', count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='os'
union all select 'fathom_calls', count(*) from os.fathom_calls
union all select 'calendly_bookings', count(*) from os.calendly_bookings
union all select 'stripe_payments', count(*) from os.stripe_payments
union all select 'ledger_rows', jsonb_array_length(data) from os.sales_ledger_cache where id=1;"

echo "-- smoke: the RPCs the CRM pages call"
docker exec twenty-dev-db-1 psql "$PG_DATABASE_URL" -Atc "
select 'get_show_up', (os.get_show_up()->>'held');
select 'get_conversion', (os.get_conversion()->'total'->>'sat');
select 'get_therapon_cash', (os.get_therapon_cash()->>'total');
select 'get_commission_summary', jsonb_array_length(os.get_commission_summary()->'reps');
select 'get_monthly_metrics', jsonb_array_length(os.get_monthly_metrics());
select 'get_therapon_daily', (os.get_therapon_daily(current_date - 7, current_date)->'summary'->>'booked');
select 'get_dashboard_metrics', (os.get_dashboard_metrics()->'kpis'->>'appts_booked');"
echo RESTORE_DONE
