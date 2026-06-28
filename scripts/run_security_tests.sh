#!/usr/bin/env bash
# =====================================================================
#  scripts/run_security_tests.sh
#  DChill Outpost — RLS / Owner-protection security gate.
#
#  Spins up a DISPOSABLE database, applies the schema + RLS migration, then
#  runs both proof suites. ANY failed PASS/FAIL assertion, missing RLS,
#  readable secret, or Owner/Technology-Specialist breach raises a SQL
#  exception -> psql exits non-zero (ON_ERROR_STOP) -> this script exits
#  non-zero -> the build fails.
#
#  Connection: standard libpq env vars (PGHOST, PGPORT, PGUSER, PGPASSWORD).
#  The connecting user needs CREATEDB + superuser (to create roles / BYPASSRLS).
#  Local quick start (Postgres running on localhost):
#      PGUSER=postgres PGPASSWORD=postgres ./scripts/run_security_tests.sh
# =====================================================================
set -Eeuo pipefail

ADMIN_DB="${ADMIN_DB:-postgres}"          # maintenance DB used to create/drop the test DB
TEST_DB="${TEST_DB:-dchill_security_test}"

# Resolve repo root so the script works from anywhere.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

PSQL_BASE=(psql -v ON_ERROR_STOP=1 -X -q)

admin() { "${PSQL_BASE[@]}" -d "$ADMIN_DB" "$@"; }
run()   { "${PSQL_BASE[@]}" -d "$TEST_DB"  "$@"; }

cleanup() {
  admin -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE);" >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "==> (re)creating disposable test database: $TEST_DB"
admin -c "DROP DATABASE IF EXISTS \"$TEST_DB\" WITH (FORCE);"
admin -c "CREATE DATABASE \"$TEST_DB\";"

echo "==> [1/5] Supabase test shim (roles + auth.uid)"
run -f ci/supabase_test_shim.sql

echo "==> [2/5] DATABASE_SCHEMA.sql"
run -f DATABASE_SCHEMA.sql

echo "==> [3/5] 0002_complete_rls_policies.sql"
run -f 0002_complete_rls_policies.sql

echo "==> [4/5] 0002_rls_verification.sql  (RLS coverage / secrets / append-only)"
run -f 0002_rls_verification.sql

echo "==> [5/5] test_technology_specialist_rbac.sql  (Owner / Technology Specialist boundary)"
run -f test_technology_specialist_rbac.sql

echo ""
echo "============================================================"
echo " ALL SECURITY TESTS PASSED — RLS coverage + Owner protection"
echo "============================================================"
