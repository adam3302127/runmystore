#!/usr/bin/env bash
# Local Postgres harness for the RMS Ops Console (no Docker, no Supabase CLI needed).
#   scripts/local/db.sh reset [dbname]   fresh database: stubs + migrations + seed (prints simulator keys)
#   scripts/local/db.sh test             fresh rms_test database, then the SQL test suite
#   scripts/local/db.sh psql [dbname]    open psql
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PSQL=(sudo -u postgres psql -v ON_ERROR_STOP=1 -q -X)
cmd="${1:-reset}"; db="${2:-rms_local}"

apply() {
  local db="$1"
  sudo -u postgres dropdb --if-exists "$db"
  sudo -u postgres createdb "$db"
  "${PSQL[@]}" -d "$db" -f "$HERE/supabase-stubs.sql"
  for m in "$ROOT"/supabase/migrations/*.sql; do
    echo "applying $(basename "$m")"; "${PSQL[@]}" -d "$db" -f "$m"
  done
  echo "seeding"; "${PSQL[@]}" -d "$db" -f "$ROOT/supabase/seed.sql"
}

case "$cmd" in
  reset) apply "$db" ;;
  test)  apply rms_test; echo "running sql tests"; "${PSQL[@]}" -d rms_test -f "$HERE/sql-tests.sql"; echo "SQL TESTS PASSED" ;;
  psql)  sudo -u postgres psql -d "$db" ;;
  *) echo "unknown command $cmd"; exit 1 ;;
esac
