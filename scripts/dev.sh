#!/bin/sh
# No secrets are generated or persisted by this launcher.
set -eu
cd "$(dirname "$0")/.."
: "${WULING_ADMIN_TOKEN:?Export WULING_ADMIN_TOKEN (at least 32 characters)}"
if [ "${#WULING_ADMIN_TOKEN}" -lt 32 ]; then
  echo "WULING_ADMIN_TOKEN must be at least 32 characters" >&2
  exit 1
fi
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
cargo run -p wuling-server &
backend=$!
(cd frontend && exec pnpm dev) &
frontend=$!
# POSIX sh has no wait -n. Stop the pair if either service exits.
while kill -0 "$backend" 2>/dev/null && kill -0 "$frontend" 2>/dev/null; do
  sleep 1
done
echo "A development service exited; stopping both services." >&2
exit 1
