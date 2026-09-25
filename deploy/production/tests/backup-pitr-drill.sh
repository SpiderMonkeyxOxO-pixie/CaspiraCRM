#!/usr/bin/env bash
# Deterministic integration test for the production backup path (Backend
# Phase 13). Requires Docker Engine or Docker Desktop and ~2 GB free disk.
# Uses ONLY throwaway containers, volumes and generated secrets named
# caspira-drilltest-* — never production data or volumes.
#
#   ./deploy/production/tests/backup-pitr-drill.sh
#
# Proves, end to end with the real images and the real agent protocol:
#   1. the caspira-postgres image initializes with least-privilege roles;
#   2. WAL archiving to an ENCRYPTED pgBackRest repository works (check);
#   3. a full backup succeeds through a control-volume request;
#   4. point-in-time recovery to a timestamp BETWEEN two writes restores
#      exactly the first write, into an isolated target;
#   5. the agent's validation reports connectivity, migration and counts;
#   6. the repository verifies (pgbackrest verify);
#   7. cleanup removes the isolated target.
set -euo pipefail
cd "$(dirname "$0")/.."
P=caspira-drilltest
TMP="$(mktemp -d)"; trap 'cleanup' EXIT
cleanup() {
  docker rm -f "$P-db" "$P-agent" >/dev/null 2>&1 || true
  docker volume rm "$P-pgdata" "$P-socket" "$P-repo" "$P-spool" "$P-control" "$P-restore" >/dev/null 2>&1 || true
  docker network rm "$P-net" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}
pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; exit 1; }

echo "== build image"
docker build -q -t "$P-postgres" postgres >/dev/null

echo "== throwaway secrets"
mkdir -p "$TMP/secrets"
for s in postgres_superuser_password db_password db_migrator_password db_readonly_password db_monitor_password backup_repo_cipher_pass backup_logical_passphrase; do
  head -c 48 /dev/urandom | base64 | tr -d '\n=+/' > "$TMP/secrets/$s"
done
printf 'key=\nsecret=\ncipher=\n' > "$TMP/secrets/backup_offsite_credentials"
chmod 0444 "$TMP/secrets/"*   # test only: containers run as uid 999

docker network create --internal "$P-net" >/dev/null
for v in pgdata socket repo spool control restore; do docker volume create "$P-$v" >/dev/null; done
SECRET_MOUNTS=(); for s in "$TMP"/secrets/*; do SECRET_MOUNTS+=(-v "$s:/run/secrets/$(basename "$s"):ro"); done

echo "== start db"
docker run -d --name "$P-db" --network "$P-net" --user 999:999 --cap-drop ALL --security-opt no-new-privileges \
  -e POSTGRES_DB=caspira_crm -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_superuser_password \
  -e POSTGRES_INITDB_ARGS="--auth-host=scram-sha-256 --data-checksums" -e PGDATA=/var/lib/postgresql/data/pgdata \
  -e PGBACKREST_REPO1_CIPHER_PASS_FILE=/run/secrets/backup_repo_cipher_pass "${SECRET_MOUNTS[@]}" \
  -v "$P-pgdata:/var/lib/postgresql/data" -v "$P-socket:/var/run/postgresql" -v "$P-repo:/var/lib/pgbackrest" -v "$P-spool:/var/spool/pgbackrest" \
  "$P-postgres" postgres -c config_file=/etc/caspira/postgresql.conf -c hba_file=/etc/caspira/pg_hba.conf >/dev/null
for _ in $(seq 1 60); do docker exec "$P-db" pg_isready -h /var/run/postgresql -U postgres >/dev/null 2>&1 && break; sleep 2; done
sql() { docker exec -i "$P-db" psql -XAtq -h /var/run/postgresql -U postgres -d caspira_crm -c "$1"; }
[[ "$(sql "select count(*) from pg_roles where rolname in ('caspira_app','caspira_owner','caspira_readonly','caspira_monitor')")" == 4 ]] && pass "least-privilege roles created" || fail "roles"
[[ "$(sql "select rolsuper from pg_roles where rolname='caspira_app'")" == f ]] && pass "runtime role is not a superuser" || fail "runtime role privileges"
[[ "$(sql "select pg_get_userbyid(nspowner) from pg_namespace where nspname='public'")" == caspira_owner ]] && pass "schema owned by the migration role" || fail "schema owner"

# Minimal application tables so the agent's validation has something to count.
sql "create table _prisma_migrations(migration_name text, finished_at timestamptz, rolled_back_at timestamptz); insert into _prisma_migrations values ('20260101000000_drill', now(), null);
     create table users(id serial, role text); insert into users(role) values ('Super-Admin'),('User');
     create table organizations(id serial); insert into organizations default values;
     create table roles(id serial); insert into roles default values;
     create table audit_events(id serial); create table drill_marker(phase text, at timestamptz default clock_timestamp());" >/dev/null

echo "== start backup agent"
docker run -d --name "$P-agent" --network "$P-net" --user 999:999 --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges \
  -e DEPLOY_ENVIRONMENT=staging -e PGHOST=/var/run/postgresql -e PGDATABASE=caspira_crm -e PGUSER=postgres \
  -e PGBACKREST_REPO1_CIPHER_PASS_FILE=/run/secrets/backup_repo_cipher_pass "${SECRET_MOUNTS[@]}" \
  -v "$P-pgdata:/var/lib/postgresql/data:ro" -v "$P-socket:/var/run/postgresql" -v "$P-repo:/var/lib/pgbackrest" -v "$P-spool:/var/spool/pgbackrest" \
  -v "$P-control:/control" -v "$P-restore:/restore" --entrypoint /opt/caspira/backup-agent.sh "$P-postgres" >/dev/null

request() { # request <id> <type> <params-json> → waits for the result, prints it
  docker exec -i "$P-agent" sh -c "cat > /control/requests/$1.json" <<<"$(printf '{"id":"%s","type":"%s","params":%s,"environment":"staging","protocol":1}' "$1" "$2" "$3")"
  for _ in $(seq 1 360); do
    if docker exec "$P-agent" test -f "/control/results/$1.json"; then docker exec "$P-agent" cat "/control/results/$1.json"; return; fi
    sleep 5
  done
  fail "no result for $2 ($1)"
}

R="$(request drill-check-01 check '{}')"; [[ "$(jq -r .status <<<"$R")" == succeeded ]] && pass "WAL archiving check (encrypted repository)" || fail "check: $(jq -r .error <<<"$R")"
R="$(request drill-full-01 backup '{"type":"full"}')"; [[ "$(jq -r .status <<<"$R")" == succeeded ]] && pass "full backup" || fail "backup"
[[ "$(jq -r '.output.info[0].cipher' <<<"$R")" == "aes-256-cbc" ]] && pass "backup repository encrypted (aes-256-cbc)" || fail "encryption"
LABEL="$(jq -r '.output.info[0].backup[-1].label' <<<"$R")"

sql "insert into drill_marker(phase) values ('A')" >/dev/null
sleep 2; TARGET="$(sql "select to_char(clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.US\"Z\"')")"; sleep 2
sql "insert into drill_marker(phase) values ('B')" >/dev/null
sql "select pg_switch_wal()" >/dev/null; sleep 15   # archive the segment holding both writes

R="$(request drillrestore01 restore "$(jq -nc --arg set "$LABEL" --arg t "$TARGET" '{restoreId:"drillrestore01",set:$set,targetType:"time",target:$t}')")"
[[ "$(jq -r .status <<<"$R")" == succeeded ]] && pass "point-in-time restore into an isolated target" || fail "restore: $(jq -r .error <<<"$R")"
[[ "$(jq -r .output.validation.connectivity <<<"$R")" == ok ]] && pass "restored instance reachable; migration $(jq -r .output.validation.lastMigration <<<"$R")" || fail "validation"
[[ "$(jq -r .output.validation.systemOwners <<<"$R")" == 1 ]] && pass "restored auth tables (1 System Owner)" || fail "auth tables"

# Recovered state: start the isolated copy again and look for the markers.
docker exec "$P-agent" sh -c 'mkdir -p /tmp/chk && pg_ctl -D /restore/drillrestore01 -w -o "-p 55433 -c listen_addresses= -c unix_socket_directories=/tmp/chk -c archive_mode=off -c config_file=/restore/drillrestore01/postgresql.conf -c hba_file=/etc/caspira/pg_hba.conf" -l /tmp/chk/log start' >/dev/null
PHASES="$(docker exec "$P-agent" psql -XAtq -h /tmp/chk -p 55433 -d caspira_crm -c "select string_agg(phase, ',' order by phase) from drill_marker")"
docker exec "$P-agent" pg_ctl -D /restore/drillrestore01 -m fast stop >/dev/null
[[ "$PHASES" == "A" ]] && pass "PITR recovered exactly the writes before $TARGET (found: $PHASES)" || fail "PITR contents: expected A, found '$PHASES'"
[[ "$(sql "select count(*) from drill_marker")" == 2 ]] && pass "live database untouched (both writes present)" || fail "live database changed"

R="$(request drill-verify-01 verify '{}')"; [[ "$(jq -r .status <<<"$R")" == succeeded ]] && pass "repository verify (checksums, WAL continuity)" || fail "verify"
R="$(request drill-cleanup-01 restore_cleanup '{"restoreId":"drillrestore01"}')"
docker exec "$P-agent" test ! -e /restore/drillrestore01 && pass "isolated target removed" || fail "cleanup"
echo "All backup/PITR drill checks passed."
