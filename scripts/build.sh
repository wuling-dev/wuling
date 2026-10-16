#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
cargo build --locked --release -p wuling-server
(cd frontend && pnpm install --frozen-lockfile && pnpm build)
