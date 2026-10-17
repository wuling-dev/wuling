#!/bin/sh
# Start an already built, single-instance installation behind an HTTPS proxy.
set -eu
cd "$(dirname "$0")/.."
: "${WULING_DATABASE_URL:?Export WULING_DATABASE_URL after migration/import}"
: "${WULING_WEB_ORIGIN:?Export WULING_WEB_ORIGIN (HTTPS origin in production)}"
: "${WULING_JWT_KEYS:?Inject persistent JWT signing configuration from your secret manager}"
test -x target/release/wuling-server
test -f frontend/dist/server/server.js
backend=
frontend=
cleanup() {
  trap - EXIT INT TERM
  [ -z "$backend" ] || kill "$backend" 2>/dev/null || :
  [ -z "$frontend" ] || kill "$frontend" 2>/dev/null || :
  [ -z "$backend" ] || wait "$backend" 2>/dev/null || :
  [ -z "$frontend" ] || wait "$frontend" 2>/dev/null || :
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
./target/release/wuling-server &
backend=$!
(cd frontend && exec node --env-file-if-exists=.env scripts/serve.mjs) &
frontend=$!
while kill -0 "$backend" 2>/dev/null && kill -0 "$frontend" 2>/dev/null; do
  sleep 1
done
echo "A production service exited; stopping both services." >&2
exit 1
