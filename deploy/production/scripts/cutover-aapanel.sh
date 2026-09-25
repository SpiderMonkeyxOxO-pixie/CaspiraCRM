#!/usr/bin/env bash
# ONE-TIME cut-over of production on the aaPanel VPS from the legacy stack
# (deploy/vps-prod, project caspira-prod) to the Backend Phase 13 stack
# (deploy/production, project caspira-production). Follow the checklist:
# docs/deploy/AAPANEL_CUTOVER.md. Run each phase when the checklist says so:
#
#   sudo ./scripts/cutover-aapanel.sh <phase>
#
#   select-release <id>  first cut-over only: use the release built by build-local.sh (verified image IDs)
#   preflight       read-only checks (tools, env, secrets, host key, images, old stack)
#   import-secrets  copy the credential-vault keyring from the legacy .env (never printed)
#   dump-old        a pg_dump (mode 0600, root-only folder) of the legacy DB + checksum + counts
#   rehearse <dump> restore that dump into a THROWAWAY container (no network) and compare counts
#   stop-old        stop the legacy api, worker and mailpit (legacy DB keeps running, untouched)
#   restore <dump>  restore the FINAL dump into the new, empty database + least-privilege roles
#   migrate         migration preflight, then Phases 8–13 migrations (migration role)
#   seed            built-in roles, integrations, AI registry, analytics metrics + backfill, Copilot index
#   start           start api, worker, redis, mailpit and the backup agent on 127.0.0.1:4010
#   backup-init     pgBackRest check (repo1 + off-host repo2) and the first full backup
#   verify          local + public health, headers, counts, containers, keyring
#   rollback        stop the new api/worker and restart the legacy ones (asks to confirm)
#   status          both stacks at a glance
#
# Nothing here deletes a volume, touches other containers on this VPS (mjw-*,
# mysql) or changes aaPanel, DNS or the firewall. The legacy database and its
# volume stay intact until you decommission them separately.
set -euo pipefail
PHASE="${1:?usage: cutover-aapanel.sh <phase> [dump-file] (see the header)}"
ENVIRONMENT=production
cd "$(dirname "$0")/.."
source scripts/lib.sh
[[ $EUID -eq 0 ]] || { echo "Run as root (sudo): Docker and the secret files need it." >&2; exit 1; }
uses_layer compose.aapanel.yaml || { echo "env/production.env must set COMPOSE_LAYERS=\"compose.yaml compose.aapanel.yaml\"." >&2; exit 1; }

OLD_DB=caspira-prod-db; OLD_API=caspira-prod-api; OLD_WORKER=caspira-prod-worker; OLD_MAIL=caspira-prod-mailpit
OLD_ENV=../vps-prod/.env
EVIDENCE=/root/caspira-cutover
SECRETS="secrets/$ENVIRONMENT"
TABLES=(users organizations organization_memberships roles leads deals activities tickets invoices audit_events)
ok() { printf '  \033[32mOK\033[0m   %s\n' "$*"; }
bad() { printf '  \033[31mFAIL\033[0m %s\n' "$*"; FAILED=1; }
die() { echo "STOPPED: $*" >&2; exit 1; }
confirm() { local answer; read -r -p "$1 Type YES to continue: " answer; [[ "$answer" == "YES" ]] || die "not confirmed."; }
container_running() { [[ "$(docker inspect -f '{{.State.Running}}' "$1" 2>/dev/null)" == "true" ]]; }
new_running() { "${DC[@]}" ps --status running --services 2>/dev/null | grep -qx "$1"; }
mkdir -p "$EVIDENCE"; chmod 0700 "$EVIDENCE"
log() { echo "$(date -u +%FT%TZ) $PHASE $*" >> "$EVIDENCE/cutover.log"; }

# counts <psql command…> — aggregate row counts only (no record contents)
counts() {
  local t
  for t in "${TABLES[@]}"; do printf '%s=%s\n' "$t" "$("$@" -XAtqc "select count(*) from \"$t\"" 2>/dev/null || echo missing)"; done
  printf 'migration=%s\n' "$("$@" -XAtqc "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name desc limit 1" 2>/dev/null || echo missing)"
}
old_psql() { docker exec -i "$OLD_DB" psql -U caspira -d caspira_crm "$@"; }
new_psql() { "${DC[@]}" exec -T db psql -h /var/run/postgresql -U postgres -d caspira_crm "$@"; }

# restore_into <exec prefix…> -- <dump>: placeholder legacy owner, restore as the
# migration role, then the production privilege model (roles-upgrade.sql).
restore_into() {
  local dump="${*: -1}"; local -a ex=("${@:1:$#-2}")
  "${ex[@]}" psql -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d caspira_crm -XAtqc \
    "DO \$\$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='caspira') THEN CREATE ROLE caspira NOLOGIN; END IF; END \$\$;"
  local err; err="$(mktemp)"
  "${ex[@]}" pg_restore -h /var/run/postgresql -U postgres -d caspira_crm --no-owner --role=caspira_owner < "$dump" 2> "$err" || true
  if grep -i 'error:' "$err" | grep -viq 'already exists'; then
    grep -i 'error:' "$err" | grep -vi 'already exists' | head -5 >&2; rm -f "$err"; return 1
  fi
  rm -f "$err"
  "${ex[@]}" sh -c 'psql -X -q -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d caspira_crm \
    -v app_pw="$(cat /run/secrets/db_password)" -v owner_pw="$(cat /run/secrets/db_migrator_password)" \
    -v ro_pw="$(cat /run/secrets/db_readonly_password)" -v mon_pw="$(cat /run/secrets/db_monitor_password)" \
    -v old_owner=caspira -f -' < postgres/roles-upgrade.sql >/dev/null
}

case "$PHASE" in

select-release)
  # First cut-over only: the API that approves deployments isn't running yet,
  # so the release built by build-local.sh is selected here, by image ID. Every
  # later release goes through Platform → Deployments and scripts/deploy.sh.
  id="${2:?usage: cutover-aapanel.sh select-release <release-id>}"
  [[ "$id" =~ ^[A-Za-z0-9._-]{3,80}$ ]] || die "invalid release id."
  manifest="releases/$id/manifest.json"; [[ -r "$manifest" ]] || die "no $manifest (run scripts/build-local.sh first)."
  : > "$RELEASE_ENV.tmp"
  for pair in api:API_IMAGE migrator:MIGRATOR_IMAGE postgres:POSTGRES_IMAGE; do
    ref="$(jq -r --arg k "${pair%%:*}" '.images[$k] // empty' "$manifest")"
    resolved="$(resolve_image "${pair%%:*}" "$ref" "$id")" || die "image ${pair%%:*} could not be verified."
    echo "${pair##*:}=$resolved" >> "$RELEASE_ENV.tmp"
  done
  echo "RELEASE_ID=$id" >> "$RELEASE_ENV.tmp"
  mv "$RELEASE_ENV.tmp" "$RELEASE_ENV"; restrict_release_file "$RELEASE_ENV"
  cat "$RELEASE_ENV"; log "selected $id"
  ;;

preflight)
  FAILED=0
  echo "== Tools"
  for t in docker git jq curl sha256sum; do command -v "$t" >/dev/null && ok "$t" || bad "$t missing (apt-get install -y $t)"; done
  v="$(docker compose version --short 2>/dev/null || echo 0)"
  [[ "$(printf '%s\n2.24.0\n' "${v#v}" | sort -V | head -1)" == "2.24.0" ]] && ok "docker compose $v" || bad "docker compose $v (need 2.24 or newer)"
  echo "== Configuration"
  "${DC[@]}" --profile backup --profile migrate config --quiet 2>/dev/null && ok "compose layers and env resolve" || bad "compose config fails: ./dc production config"
  [[ "$(env_value TRUST_PROXY_HOPS)" == "2" ]] && ok "TRUST_PROXY_HOPS=2 (Cloudflare + aaPanel)" || bad "TRUST_PROXY_HOPS should be 2"
  [[ -r "$RELEASE_ENV" ]] && ok "release images chosen ($RELEASE_ENV)" || bad "no $RELEASE_ENV yet (checklist: build and select the release)"
  if [[ -r "$RELEASE_ENV" ]]; then
    for var in API_IMAGE MIGRATOR_IMAGE POSTGRES_IMAGE; do
      img="$( { grep -E "^$var=" "$RELEASE_ENV" || true; } | cut -d= -f2-)"
      docker image inspect "$img" >/dev/null 2>&1 && ok "$var=$img present" || bad "$var image '$img' not on this host"
    done
  fi
  echo "== Secrets (names and permissions only)"
  getent group 1500 >/dev/null && ok "group 1500 exists" || bad "group 1500 missing (groupadd -g 1500 caspira-secrets)"
  getent group 1600 >/dev/null && ok "group 1600 exists" || bad "group 1600 missing (groupadd -g 1600 caspira-backup-control)"
  [[ "$(stat -c '%a %g' "$SECRETS" 2>/dev/null)" == "750 1500" ]] && ok "$SECRETS is 0750, group 1500" || bad "$SECRETS must be 0750 root:1500"
  for s in jwt_secret db_password db_migrator_password db_readonly_password db_monitor_password postgres_superuser_password redis_password \
           integrations_keys ai_safety_id_secret metrics_token platform_automation_token_pepper backup_repo_cipher_pass backup_logical_passphrase \
           backup_offsite_credentials backup_offsite_sftp_key; do
    f="$SECRETS/$s"
    if [[ -s "$f" && "$(stat -c '%a' "$f")" == "440" ]]; then ok "$s"; else bad "$s missing, empty or not 0440"; fi
  done
  for s in smtp_password jwt_secret_previous; do [[ -f "$SECRETS/$s" ]] && ok "$s (may be empty)" || bad "$s file missing (create-secrets.sh creates it)"; done
  grep -q '^cipher=.\{40,\}' "$SECRETS/backup_offsite_credentials" 2>/dev/null && ok "repo2 passphrase present" || bad "backup_offsite_credentials needs a cipher= line"
  echo "== Off-host copy (website VPS over SFTP)"
  [[ -r env/backup-offsite.env ]] && grep -q '^PGBACKREST_REPO2_TYPE=sftp' env/backup-offsite.env && ok "env/backup-offsite.env (sftp)" || bad "env/backup-offsite.env missing or not sftp"
  grep -qE '^PGBACKREST_REPO2_SFTP_HOST=.+' env/backup-offsite.env 2>/dev/null && ok "repo2 host set" || bad "PGBACKREST_REPO2_SFTP_HOST is empty"
  [[ -f env/offsite_known_hosts && -s env/offsite_known_hosts ]] && ok "website VPS host key pinned (env/offsite_known_hosts)" || bad "env/offsite_known_hosts missing (checklist step: pin the host key)"
  echo "== Legacy stack (read-only)"
  container_running "$OLD_DB" && ok "$OLD_DB running" || bad "$OLD_DB not running"
  old_psql -XAtqc 'select 1' >/dev/null 2>&1 && ok "legacy database answers" || bad "legacy database does not answer"
  [[ -r "$OLD_ENV" ]] && ok "legacy .env readable (for the keyring)" || bad "$OLD_ENV not found"
  echo "== Host"
  free_gb="$(df -BG --output=avail /var/lib/docker | tail -1 | tr -dc 0-9)"
  (( free_gb >= 8 )) && ok "${free_gb} GB free for Docker" || bad "only ${free_gb} GB free under /var/lib/docker (need 8)"
  [[ "$FAILED" == 0 ]] && { echo; echo "Preflight passed."; log "passed"; } || { echo; echo "Preflight found problems (above). Nothing was changed."; log "failed"; exit 1; }
  ;;

import-secrets)
  # The legacy stack's credential-vault keyring must be kept: stored provider
  # credentials are encrypted with it. JWT and database secrets are NOT reused.
  keys="$(grep -E '^INTEGRATIONS_KEYS=' "$OLD_ENV" | tail -1 | cut -d= -f2- | tr -d '"'"'"' \r')"
  if [[ -z "$keys" ]]; then
    echo "The legacy .env has no INTEGRATIONS_KEYS: keeping the newly generated keyring (no credentials were stored)."
  else
    [[ "$keys" =~ ^[0-9]+:[A-Za-z0-9+/=]{40,}(,[0-9]+:[A-Za-z0-9+/=]{40,})*$ ]] || die "the legacy INTEGRATIONS_KEYS doesn't look like a keyring; not copied."
    printf '%s' "$keys" > "$SECRETS/integrations_keys.new"
    chown root:1500 "$SECRETS/integrations_keys.new"; chmod 0440 "$SECRETS/integrations_keys.new"
    mv "$SECRETS/integrations_keys.new" "$SECRETS/integrations_keys"
    echo "Copied the legacy credential-vault keyring into $SECRETS/integrations_keys (value not shown)."
  fi
  unset keys; log "done"
  ;;

dump-old)
  container_running "$OLD_DB" || die "$OLD_DB is not running."
  stamp="$(date -u +%Y%m%dT%H%M%SZ)"; out="$EVIDENCE/legacy-$stamp.dump"
  ( umask 077; docker exec "$OLD_DB" pg_dump -U caspira -d caspira_crm -Fc > "$out" )
  docker exec -i "$OLD_DB" pg_restore --list < "$out" > /dev/null || die "the dump doesn't read back; not usable."
  sha256sum "$out" > "$out.sha256"
  counts old_psql > "$EVIDENCE/legacy-$stamp.counts"
  api_state="$(docker inspect -f '{{.State.Running}}' "$OLD_API" 2>/dev/null || echo absent)"
  echo "Dump: $out ($(du -h "$out" | cut -f1)); legacy api running: $api_state"
  echo "Checksum and aggregate counts saved beside it."
  [[ "$api_state" == "true" ]] && echo "(The legacy api is still running: use this dump for the rehearsal, and take a FINAL dump after stop-old.)"
  log "$out api_running=$api_state"
  ;;

rehearse)
  dump="${2:?usage: cutover-aapanel.sh rehearse <dump-file>}"; [[ -r "$dump" ]] || die "no such dump."
  sha256sum -c "$dump.sha256" >/dev/null || die "dump checksum mismatch."
  img="$( { grep -E '^POSTGRES_IMAGE=' "$RELEASE_ENV" || true; } | cut -d= -f2-)"; [[ -n "$img" ]] || die "no POSTGRES_IMAGE in $RELEASE_ENV (run select-release first)."
  tmp="$(mktemp -d /var/tmp/caspira-rehearse.XXXXXX)"; name="caspira-rehearsal-$$"
  trap 'docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$tmp"' EXIT
  # Throwaway credentials for a throwaway, network-less instance.
  for s in postgres_superuser_password db_password db_migrator_password db_readonly_password db_monitor_password; do head -c 32 /dev/urandom | base64 | tr -dc A-Za-z0-9 > "$tmp/$s"; done
  chmod 0755 "$tmp"; chmod 0444 "$tmp"/*
  docker run -d --name "$name" --network none --user 999:999 --tmpfs /var/lib/postgresql/data:uid=999,gid=999,size=4g \
    -v "$tmp:/run/secrets:ro" -e POSTGRES_DB=caspira_crm -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD_FILE=/run/secrets/postgres_superuser_password \
    -e POSTGRES_INITDB_ARGS="--data-checksums" -e PGDATA=/var/lib/postgresql/data/pgdata "$img" postgres -c listen_addresses='' >/dev/null
  for _ in $(seq 1 60); do docker exec "$name" pg_isready -h /var/run/postgresql -U postgres >/dev/null 2>&1 && break; sleep 2; done
  sleep 3; docker exec "$name" pg_isready -h /var/run/postgresql -U postgres >/dev/null || die "rehearsal instance didn't start."
  start="$(date +%s)"
  restore_into docker exec -i "$name" -- "$dump" || die "restore reported errors (above)."
  counts docker exec -i "$name" psql -h /var/run/postgresql -U postgres -d caspira_crm > "$tmp/new.counts"
  seconds=$(( $(date +%s) - start ))
  base="${dump%.dump}"
  if diff -u "$base.counts" "$tmp/new.counts"; then
    ddl="$(docker exec "$name" sh -c 'PGPASSWORD="$(cat /run/secrets/db_password)" psql -h /var/run/postgresql -U caspira_app -d caspira_crm -XAtqc "create table drill_probe(x int)" 2>&1 || true')"
    [[ "$ddl" == *"permission denied"* ]] && echo "Runtime role can't create tables: OK" || die "runtime role could create tables: $ddl"
    echo "Rehearsal PASSED: counts and migration version match; restore took ${seconds}s (measured RTO for the data step)."
    cp "$tmp/new.counts" "$base.rehearsal-counts"; log "passed $dump ${seconds}s"
  else
    log "counts differ $dump"; die "counts differ (above). Nothing was changed."
  fi
  ;;

stop-old)
  confirm "This stops the legacy api, worker and mailpit: the live site stops working until 'start' succeeds (or 'rollback')."
  for c in "$OLD_API" "$OLD_WORKER" "$OLD_MAIL"; do docker stop --time 30 "$c" >/dev/null 2>&1 && echo "stopped $c" || echo "$c was not running"; done
  echo "The legacy database ($OLD_DB) keeps running, read-only in practice, for the final dump and for rollback."
  log "stopped"
  ;;

restore)
  dump="${2:?usage: cutover-aapanel.sh restore <FINAL dump-file>}"; [[ -r "$dump" ]] || die "no such dump."
  sha256sum -c "$dump.sha256" >/dev/null || die "dump checksum mismatch."
  ! container_running "$OLD_API" || die "the legacy api is still running: run stop-old, then take the FINAL dump (dump-old)."
  "${DC[@]}" up -d --wait db || die "the new database did not become healthy."
  # Prove WAL archiving (repo1 and the off-host repo2) before any data goes in.
  "${DC[@]}" exec -T db /opt/caspira/pgbackrest-wrapper.sh --stanza=caspira stanza-create \
    || die "pgBackRest stanza-create failed (repo1 or the SFTP copy on the website VPS). Fix it before restoring; see runbook 19."
  existing="$(new_psql -XAtqc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'")"
  [[ "$existing" == "0" ]] || die "the new database already has $existing application tables. Refusing to restore over it."
  start="$(date +%s)"
  restore_into "${DC[@]}" exec -T db -- "$dump" || die "restore reported errors (above). The legacy stack is intact: run rollback."
  counts new_psql > "${dump%.dump}.restored-counts"
  diff -u "${dump%.dump}.counts" "${dump%.dump}.restored-counts" || die "counts differ after restore. Run rollback and investigate."
  echo "Restored in $(( $(date +%s) - start ))s; counts and migration version match the legacy database."
  log "restored $dump"
  ;;

migrate)
  "${DC[@]}" --profile migrate run --rm -T migrate node scripts/migrate.js --check || die "migration preflight failed. Nothing was changed; see the output."
  "${DC[@]}" --profile migrate run --rm -T migrate || die "migration failed (runbook 10). The legacy stack is intact: rollback is safe."
  log "migrated"
  ;;

seed)
  "${DC[@]}" up -d --wait redis
  run_api() { "${DC[@]}" run --rm --no-deps -T api node --import ./src/config/applyEnv.js "$@"; }
  run_api scripts/seedRoles.js
  run_api scripts/seedIntegrations.js
  run_api scripts/seedAi.js
  run_api scripts/analytics.js seed
  run_api scripts/analytics.js backfill
  run_api scripts/copilotIndex.js --rebuild
  run_api scripts/verifyIntegrationEncryption.js || die "stored integration credentials don't decrypt with this keyring (import-secrets)."
  log "seeded"
  ;;

start)
  ! container_running "$OLD_API" || die "the legacy api still holds 127.0.0.1:4010: run stop-old first."
  "${DC[@]}" --profile backup up -d --wait || die "the new stack did not become healthy: ./dc production ps; ./dc production logs --since 10m api"
  "${DC[@]}" --profile backup ps
  log "started"
  ;;

backup-init)
  agent=("${DC[@]}" --profile backup exec -T backup-agent /opt/caspira/pgbackrest-wrapper.sh --stanza=caspira)
  "${agent[@]}" stanza-create >/dev/null 2>&1 || true
  "${agent[@]}" check || die "pgBackRest check failed (WAL archiving to repo1/repo2). See runbook 19."
  "${agent[@]}" --type=full backup || die "the first full backup failed. See runbook 19."
  "${agent[@]}" info
  log "first full backup"
  ;;

verify)
  FAILED=0
  api="$(env_value PUBLIC_API_URL)"
  curl -fsS --max-time 10 http://127.0.0.1:4010/health | jq -e '.status=="ok"' >/dev/null && ok "api on 127.0.0.1:4010" || bad "api on 127.0.0.1:4010"
  curl -fsS --max-time 10 "$api/health" | jq -e '.status=="ok"' >/dev/null && ok "public $api/health (Cloudflare → aaPanel → api)" || bad "public health"
  curl -fsS --max-time 10 "$api/ready" | jq -e '.status=="ready"' >/dev/null && ok "ready (database + Redis)" || bad "ready"
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$api/api/v1/auth/me")" == "401" ]] && ok "auth required (401)" || bad "/auth/me should be 401"
  curl -sI --max-time 10 "$api/api/v1/health" | grep -qi '^x-content-type-options: nosniff' && ok "security headers" || bad "security headers missing"
  for s in api worker db redis backup-agent mailpit; do
    h="$("${DC[@]}" --profile backup ps --format '{{.Service}} {{.Health}}' 2>/dev/null | awk -v s="$s" '$1==s{print $2}')"
    [[ "$h" == "healthy" || ( "$s" == "mailpit" && -n "$h" ) ]] && ok "$s ${h:-running}" || bad "$s ${h:-not running}"
  done
  echo "  -- current aggregate counts:"; counts new_psql | sed 's/^/     /'
  [[ "$FAILED" == 0 ]] && { echo "Verification passed."; log "passed"; } || { echo "Verification found problems."; log "failed"; exit 1; }
  ;;

rollback)
  confirm "This stops the NEW api and worker and restarts the legacy ones on the legacy database. Anything written on the new stack since the switch is NOT in the legacy database."
  "${DC[@]}" --profile backup stop api worker mailpit backup-agent || true
  for c in "$OLD_MAIL" "$OLD_API" "$OLD_WORKER"; do docker start "$c" >/dev/null && echo "started $c"; done
  for _ in $(seq 1 30); do curl -fsS --max-time 5 http://127.0.0.1:4010/health >/dev/null 2>&1 && break; sleep 3; done
  curl -fsS --max-time 5 http://127.0.0.1:4010/health && echo && echo "Legacy stack is serving again. The new database volume is kept for investigation."
  log "rolled back"
  ;;

status)
  echo "== Legacy stack (caspira-prod)"
  docker ps -a --filter "name=^caspira-prod-" --format '  {{.Names}}  {{.Status}}'
  echo "== New stack (caspira-$ENVIRONMENT)"
  "${DC[@]}" --profile backup ps --format '  {{.Service}}  {{.Status}}' 2>/dev/null || echo "  (not started)"
  echo "== Evidence: $EVIDENCE"; ls -1 "$EVIDENCE" 2>/dev/null | sed 's/^/  /'
  ;;

*) echo "Unknown phase '$PHASE' (see the header of this script)." >&2; exit 2 ;;
esac
