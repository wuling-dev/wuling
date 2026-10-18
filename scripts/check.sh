#!/bin/sh
# Run from any directory; fail at the first broken gate.
set -eu
cd "$(dirname "$0")/.."
cargo fmt --all -- --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
(
  cd frontend
  pnpm api:check
  pnpm format:check
  pnpm lint
  pnpm typecheck
  pnpm test
)
