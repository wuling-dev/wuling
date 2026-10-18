#!/bin/sh
# Disposable DB and two test-only accounts; no deployment secrets are written to disk.
set -eu
cd "$(dirname "$0")/.."
mkdir -p data
base=$(mktemp -d "$PWD/data/web-check.XXXXXX")
pgport=${WULING_WEB_TEST_POSTGRES_PORT:-55433}
apiport=${WULING_WEB_TEST_API_PORT:-4400}
webport=${WULING_WEB_TEST_PORT:-3300}
export PGHOST=127.0.0.1 PGPORT="$pgport" PGUSER=wuling_web_test
backend= frontend= started=
cleanup() {
  [ -z "$frontend" ] || kill "$frontend" 2>/dev/null || :
  [ -z "$backend" ] || kill "$backend" 2>/dev/null || :
  [ -z "$frontend" ] || wait "$frontend" 2>/dev/null || :
  [ -z "$backend" ] || wait "$backend" 2>/dev/null || :
  [ -z "$started" ] || pg_ctl -D "$base/cluster" -m fast -w stop
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
node --input-type=module - "$pgport" "$apiport" "$webport" <<'JS'
import { createServer } from 'node:net'
for (const port of process.argv.slice(2).map(Number)) {
  await new Promise((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => server.close(resolve))
  })
}
JS
initdb -D "$base/cluster" -U "$PGUSER" --auth=trust --no-locale --encoding=UTF8 > "$base/initdb.log"
pg_ctl -D "$base/cluster" -l "$base/postgres.log" -o "-p $pgport -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -w start
started=1
createdb web_test
export WULING_DATABASE_URL="host=127.0.0.1 port=$pgport user=$PGUSER dbname=web_test"
export WULING_DATA_DIR="$base/data"
export WULING_WEB_ORIGIN="http://localhost:$webport"
export WULING_LISTEN="127.0.0.1:$apiport"
export WULING_API_ORIGIN="http://127.0.0.1:$apiport"
export WULING_E2E_ORIGIN="$WULING_WEB_ORIGIN"
export WULING_PUBLIC_ORIGIN="$WULING_WEB_ORIGIN"
export WULING_INDEXABLE=${WULING_WEB_TEST_INDEXABLE:-false}
export PLAYWRIGHT_BROWSERS_PATH="${PLAYWRIGHT_BROWSERS_PATH:-$PWD/frontend/.cache/playwright}"
# Ephemeral fixture only, never a production signing-key procedure.
WULING_JWT_KEYS=$(python3 -c 'import json,secrets; print(json.dumps({"active_kid":"e2e","keys":[{"kid":"e2e","secret_hex":secrets.token_hex(32)}]}))')
export WULING_JWT_KEYS
(cd frontend && pnpm build) > "$base/build.log" 2>&1 || { cat "$base/build.log"; exit 1; }
cargo build -p wuling-server -p wuling-admin
target/debug/wuling-db migrate
printf 'test-only-long-password\n' | target/debug/wuling-admin bootstrap alice
printf 'test-only-long-password\ntest-only-long-password\n' | target/debug/wuling-admin create-user alice bob
target/debug/wuling-server > "$base/api.log" 2>&1 &
backend=$!
(cd frontend/apps/web && PORT="$webport" exec node scripts/serve.mjs) > "$base/web.log" 2>&1 &
frontend=$!
kill -0 "$backend"
kill -0 "$frontend"
# Bounded readiness checks, not background-agent polling.
node --input-type=module -e '
for (const url of [process.env.WULING_API_ORIGIN+"/api/health", process.env.WULING_E2E_ORIGIN+"/robots.txt"]) {
  let ready=false;
  for (let i=0;i<100;i++) {
    try { if ((await fetch(url, {signal:AbortSignal.timeout(1000)})).ok) { ready=true;break; } } catch {}
    await new Promise(r=>setTimeout(r,100));
  }
  if (!ready) throw Error("Service not ready: "+url);
}'
(cd frontend && pnpm exec lightning run --config lightning.e2e.config.ts)
printf 'Web 验收通过。数据库/服务日志目录：%s；截图：frontend/test-results/auth/\n' "$base"
