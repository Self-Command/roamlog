#!/usr/bin/env bash
# G1 真实 PostgreSQL 环境准备（embedded PG，无 Docker）
# 用法: bash .audit/g1-pg.sh
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PG_BIN=".data/bootstrap-e2e/node_modules/@embedded-postgres/windows-x64/native/bin"
PGDATA=".data/g1-20261118/pgdata"
PGPORT="${PGPORT:-55442}"
PGSOCK=".data/g1-20261118"
DB="roamlog_g1"

mkdir -p "$PGSOCK"

if [ ! -f "$PGDATA/PG_VERSION" ]; then
  echo "== initdb =="
  "$PG_BIN/initdb.exe" -D "$PGDATA" -U postgres -A trust -E UTF8 --locale=C >"$PGSOCK/initdb.log" 2>&1 || {
    echo "initdb failed"; tail -20 "$PGSOCK/initdb.log"; exit 1; }
fi

if ! "$PG_BIN/pg_ctl.exe" -D "$PGDATA" status >/dev/null 2>&1; then
  echo "== starting postgres on $PGPORT =="
  "$PG_BIN/pg_ctl.exe" -D "$PGDATA" -l "$PGSOCK/pg.log" \
    -o "-p $PGPORT -c listen_addresses=127.0.0.1" -w start >"$PGSOCK/start.log" 2>&1 || {
      echo "start failed"; tail -20 "$PGSOCK/pg.log"; exit 1; }
fi

export PGHOST=127.0.0.1 PGPORT=$PGPORT PGUSER=postgres

# The embedded distribution ships no createdb/psql; use node + pg driver.
node --input-type=module -e "
import { Client } from 'pg';
const client = new Client({ host: '127.0.0.1', port: $PGPORT, user: 'postgres', database: 'postgres' });
await client.connect();
const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = \$1', ['$DB']);
if (existing.rowCount === 0) { await client.query('CREATE DATABASE \"$DB\"'); console.log('created $DB'); }
else console.log('$DB already exists');
await client.end();
" || exit 1

echo "DATABASE_URL=postgresql://postgres@127.0.0.1:$PGPORT/$DB?schema=public"