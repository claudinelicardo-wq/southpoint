#!/usr/bin/env bash
# Local database harness for South Point.
#
# Docker is unavailable on this machine, so instead of `supabase start` we run the
# version-controlled migrations against a local PostgreSQL 17 instance with a minimal
# stub of the Supabase `auth` schema. The same migrations apply unchanged to the real
# Supabase project.
#
# Usage:
#   scripts/db.sh start    # start local postgres (port 54322)
#   scripts/db.sh stop
#   scripts/db.sh reset    # drop + recreate southpoint db, apply migrations + seed
#   scripts/db.sh psql     # open a psql shell
#   scripts/db.sh test     # run tests/db/*.sql against a freshly reset db
set -euo pipefail

export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PGDATA="${SOUTHPOINT_PGDATA:-$HOME/.southpoint-pgdata}"
PORT=54322
DB=southpoint
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PSQL=("$PGBIN/psql" -v ON_ERROR_STOP=1 -p "$PORT" -U postgres -q)

start() {
  if ! "$PGBIN/pg_isready" -p "$PORT" -q 2>/dev/null; then
    [ -d "$PGDATA" ] || "$PGBIN/initdb" -D "$PGDATA" -U postgres --auth=trust -E UTF8 >/dev/null
    "$PGBIN/pg_ctl" -D "$PGDATA" -l "$PGDATA/log" -o "-p $PORT" start >/dev/null
  fi
  echo "postgres ready on :$PORT"
}

reset() {
  start
  "${PSQL[@]}" -d postgres -c "drop database if exists $DB with (force)" -c "create database $DB"
  # Stub of the Supabase-managed auth schema (real Supabase provides this).
  "${PSQL[@]}" -d "$DB" -f "$ROOT/scripts/stub-auth.sql"
  for f in "$ROOT"/supabase/migrations/*.sql; do
    echo "applying $(basename "$f")"
    "${PSQL[@]}" -d "$DB" -f "$f"
  done
  if [ -f "$ROOT/supabase/seed.sql" ]; then
    echo "applying seed.sql"
    "${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql"
  fi
  echo "reset complete"
}

run_tests() {
  reset
  local fail=0
  for f in "$ROOT"/tests/db/*.sql; do
    if out=$("${PSQL[@]}" -d "$DB" -f "$f" 2>&1); then
      echo "PASS $(basename "$f")"
    else
      echo "FAIL $(basename "$f")"; echo "$out" | tail -20; fail=1
    fi
  done
  # Multi-connection tests (concurrency / locking) can't run as single-session
  # .sql files, so they ship as executable shell scripts.
  for s in "$ROOT"/tests/db/*.sh; do
    [ -e "$s" ] || continue
    if out=$(PORT="$PORT" DB="$DB" PGBIN="$PGBIN" bash "$s" 2>&1); then
      echo "$out"
    else
      echo "$out"; fail=1
    fi
  done
  exit $fail
}

case "${1:-}" in
  start) start ;;
  stop)  "$PGBIN/pg_ctl" -D "$PGDATA" stop >/dev/null && echo stopped ;;
  reset) reset ;;
  psql)  exec "$PGBIN/psql" -p "$PORT" -U postgres -d "$DB" ;;
  test)  run_tests ;;
  *) echo "usage: $0 {start|stop|reset|psql|test}"; exit 1 ;;
esac
