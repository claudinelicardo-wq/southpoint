#!/usr/bin/env bash
# Concurrency test: two terminals selling the same last units at once must not
# oversell. consume_stock locks the item row FOR UPDATE, so the second sale
# blocks until the first commits, then re-reads the depleted stock and fails.
#
# This cannot be expressed in a single-session .sql file (no parallelism), so it
# runs two real psql connections with deliberate timing. Invoked by
# scripts/db.sh (needs the local Postgres from `scripts/db.sh start`).
set -euo pipefail

PGBIN="${PGBIN:-/opt/homebrew/opt/postgresql@17/bin}"
PORT="${PORT:-54322}"
DB="${DB:-southpoint}"
PSQL=("$PGBIN/psql" -v ON_ERROR_STOP=1 -p "$PORT" -U postgres -d "$DB" -qtA)

ITEM="c0ffee00-0000-0000-0000-00000000ace1"
TMP="${TMPDIR:-/tmp}"

cleanup() {
  "${PSQL[@]}" -c "delete from public.inventory_movements where item_id='$ITEM';
                   delete from public.inventory_batches where item_id='$ITEM';
                   delete from public.inventory_items where id='$ITEM';
                   delete from public.units where code='racetest';" >/dev/null 2>&1 || true
}
trap cleanup EXIT

fail() { echo "FAIL concurrency.sh: $1" >&2; exit 1; }

# --- setup: one item with exactly 10 units in stock (committed) --------------
"${PSQL[@]}" >/dev/null <<SQL
insert into public.units (code, name, kind, factor) values ('racetest','Race Unit','count',1)
  on conflict (code) do nothing;
delete from public.inventory_movements where item_id='$ITEM';
delete from public.inventory_batches where item_id='$ITEM';
delete from public.inventory_items where id='$ITEM';
insert into public.inventory_items (id, name, inventory_type, base_unit)
  values ('$ITEM','Race Item','retail','racetest');
select public.add_stock('$ITEM', 10, 5, 'opening_balance');
SQL

# --- session A: consume 8, hold the transaction open ~2s, then commit -------
"${PSQL[@]}" >"$TMP/race_a.log" 2>&1 <<SQL &
begin;
select public.consume_stock('$ITEM', 8, 'sale'::movement_type, null, null, 'A', null, true, false);
select pg_sleep(2);
commit;
SQL
APID=$!

sleep 0.6  # let A acquire the FOR UPDATE lock first

# --- session B: also try to consume 8 — should block, then fail insufficient -
start=$(date +%s.%N)
set +e
"${PSQL[@]}" >"$TMP/race_b.log" 2>&1 <<SQL
begin;
select public.consume_stock('$ITEM', 8, 'sale'::movement_type, null, null, 'B', null, true, false);
commit;
SQL
BRC=$?
set -e
end=$(date +%s.%N)
waited=$(awk -v s="$start" -v e="$end" 'BEGIN{ printf "%.2f", e - s }')

wait "$APID" || fail "session A (the winning sale) errored unexpectedly: $(cat "$TMP/race_a.log")"

# --- assertions -------------------------------------------------------------
[ "$BRC" -ne 0 ] || fail "session B oversold: it should have failed on insufficient stock"
grep -qi "insufficient stock" "$TMP/race_b.log" || fail "B failed for the wrong reason: $(cat "$TMP/race_b.log")"

final=$("${PSQL[@]}" -c "select current_stock from public.inventory_items where id='$ITEM'")
[ "$final" = "2.0000" ] || fail "final stock should be 2 (only one sale of 8 succeeded), got $final"

# B must have BLOCKED on A's lock (proves serialization, not a lucky ordering).
blocked_ok=$(awk -v w="$waited" 'BEGIN{ print (w+0 >= 1.0) ? "yes" : "no" }')
[ "$blocked_ok" = "yes" ] || fail "B did not block on A's lock (waited ${waited}s, expected >=1s)"

echo "PASS concurrency.sh (B blocked ${waited}s on A's lock, no oversell, final stock 2)"
