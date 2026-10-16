#!/bin/sh
# Start an already built, single-instance installation behind an HTTPS proxy.
set -eu
cd "$(dirname "$0")/.."
: "${WULING_ADMIN_TOKEN:?Export WULING_ADMIN_TOKEN}"
if [ "${#WULING_ADMIN_TOKEN}" -lt 32 ]; then
  echo "WULING_ADMIN_TOKEN must be at least 32 characters" >&2
  exit 1
fi
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
