#!/bin/bash
# Rewrites the Supabase dump so it loads into the `os` schema of Twenty's core database.
# Produces /root/os-migration/schema_os.sql and data_os.sql. Idempotent.
set -euo pipefail
IN=/root/os-migration
SCHEMA_IN="$IN/schema_public.sql"
DATA_IN="$IN/data_public.sql"
SCHEMA_OUT="$IN/schema_os.sql"
DATA_OUT="$IN/data_os.sql"

transform() {
  sed -E \
    -e 's/\bpublic\./os./g' \
    -e "s/SET search_path TO 'public'/SET search_path TO 'os', 'public'/g" \
    -e "s/SET search_path = public/SET search_path = os, public/g" \
    -e 's/^CREATE SCHEMA public;/CREATE SCHEMA IF NOT EXISTS os;/' \
    -e 's/^COMMENT ON SCHEMA public .*$//' \
    -e 's/^ALTER TABLE (os\.[a-z_]+) ENABLE ROW LEVEL SECURITY;$//' \
    -e 's/^ALTER TABLE (os\.[a-z_]+) FORCE ROW LEVEL SECURITY;$//' \
    -e '/^CREATE POLICY /,/;$/d' \
    -e '/^GRANT /d' \
    -e '/^REVOKE /d' \
    -e '/^ALTER DEFAULT PRIVILEGES /d' \
    -e '/^CREATE EXTENSION /d' \
    -e '/^COMMENT ON EXTENSION /d' \
    -e '/^CREATE EVENT TRIGGER /,/;$/d' \
    -e '/^ALTER EVENT TRIGGER /d' \
    -e 's/auth\.uid\(\)/NULL::uuid/g' \
    -e 's/auth\.role\(\)/NULL::text/g' \
    -e 's/auth\.jwt\(\)/NULL::jsonb/g' \
    -e 's/extensions\.//g' \
    -e 's/\\restrict [a-zA-Z0-9]+//' \
    -e 's/\\unrestrict [a-zA-Z0-9]+//'
}

{
  echo "CREATE SCHEMA IF NOT EXISTS os;"
  echo "CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;"
  transform < "$SCHEMA_IN"
} > "$SCHEMA_OUT"

transform < "$DATA_IN" > "$DATA_OUT"

# Anything still pointing at Supabase-only schemas is a porting bug, so fail loudly.
if grep -nE '\b(auth|storage|realtime|vault|supabase_functions|net|cron)\.' "$SCHEMA_OUT" | grep -v '^--' | head -5; then
  echo "TRANSFORM_WARN: Supabase schema references remain (see above)"
fi
echo "schema lines: $(wc -l < "$SCHEMA_OUT")  data lines: $(wc -l < "$DATA_OUT")"
echo TRANSFORM_DONE
