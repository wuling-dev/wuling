#!/bin/sh
# Disposable local cluster; never connects to an existing database.
set -eu
cd "$(dirname "$0")/.."
mkdir -p data
base=$(mktemp -d "$PWD/data/postgres-check.XXXXXX")
port=${WULING_TEST_POSTGRES_PORT:-55432}
export PGHOST=127.0.0.1 PGPORT="$port" PGUSER=wuling_test_admin
initdb -D "$base/cluster" -U "$PGUSER" --auth=trust --no-locale --encoding=UTF8 > "$base/initdb.log"
# No Unix socket: long Delta worktree paths exceed macOS socket path limits.
# Trust auth is confined to this disposable loopback-only cluster; never use for deployment.
pg_ctl -D "$base/cluster" -l "$base/postgres.log" \
  -o "-p $port -c listen_addresses=127.0.0.1 -c unix_socket_directories=''" -w start
trap 'pg_ctl -D "$base/cluster" -m fast -w stop' EXIT
createdb storage_test
createdb import_test
createdb cli_test
WULING_TEST_DATABASE_URL="host=127.0.0.1 port=$port user=$PGUSER dbname=storage_test" \
  cargo test -p wuling-storage --test postgres -- --ignored
WULING_TEST_DATABASE_URL="host=127.0.0.1 port=$port user=$PGUSER dbname=import_test" \
  cargo test -p wuling-import --test postgres -- --ignored

mkdir -p "$base/original/repos"
git init --bare --initial-branch=main "$base/original/repos/10.git"
repo="$base/original/repos/10.git"
tree=$(git --git-dir="$repo" hash-object -w -t tree --stdin < /dev/null)
commit=$(git --git-dir="$repo" -c user.name=fixture -c user.email=fixture@example.invalid \
  commit-tree "$tree" -m 'import fixture')
git --git-dir="$repo" update-ref refs/heads/main "$commit"
cat > "$base/original/state.json" <<'JSON'
{"repos":[{"id":10,"name":"fixture","description":"导入验收","public":false}],"items":[{"id":20,"repo_id":10,"kind":"issues","title":"历史记录","body":"正文","state":"open","source":null,"target":null}],"next_id":20}
JSON
cp -R "$base/original" "$base/backup"
printf '{"10":1}\n' > "$base/owners.json"
git --git-dir="$repo" for-each-ref --format='%(refname) %(objectname)' > "$base/refs.before"
git --git-dir="$repo" symbolic-ref HEAD > "$base/head.before"
export WULING_DATABASE_URL="host=127.0.0.1 port=$port user=$PGUSER dbname=cli_test"
cargo run -p wuling-server --bin wuling-db -- migrate
cargo run -p wuling-server --bin wuling-db -- migrate
# Test-only owner, deliberately not a valid password hash; not an account bootstrap procedure.
psql -X -v ON_ERROR_STOP=1 -d cli_test \
  -c "INSERT INTO users (username, password_hash) VALUES ('fixture_owner', '!');"
cargo run -p wuling-server --bin wuling-db -- import \
  "$base/original/state.json" "$base/backup/state.json" "$base/owners.json"
cargo run -p wuling-server --bin wuling-db -- import \
  "$base/original/state.json" "$base/backup/state.json" "$base/owners.json"
counts=$(psql -X -At -v ON_ERROR_STOP=1 -d cli_test -c \
  "SELECT (SELECT count(*) FROM repositories WHERE id=10 AND owner_id=1 AND NOT public),
          (SELECT count(*) FROM historical_items WHERE id=20 AND author_id IS NULL AND author_origin='historical_import'),
          (SELECT count(*) FROM prototype_import);")
test "$counts" = '1|1|1'
git --git-dir="$repo" for-each-ref --format='%(refname) %(objectname)' > "$base/refs.after"
git --git-dir="$repo" symbolic-ref HEAD > "$base/head.after"
cmp "$base/refs.before" "$base/refs.after"
cmp "$base/head.before" "$base/head.after"
diff -r "$base/backup" "$base/original"
git --git-dir="$repo" fsck --full
printf 'PostgreSQL 验收通过：数量=%s，JSON/备份/Git 引用与 HEAD 不变。证据目录：%s\n' "$counts" "$base"
