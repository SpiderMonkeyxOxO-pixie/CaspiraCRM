#!/usr/bin/env bash
# Caspira backup agent (Backend Phase 13).
#
# Runs in its own container (same image as db, user postgres, read-only root
# filesystem, no Docker socket). It is the ONLY component that runs backup and
# restore tools. It:
#   * processes request files the worker writes to $CONTROL_DIR/requests —
#     an allowlist of operations with validated parameters (never commands);
#   * writes one result file per request to $CONTROL_DIR/results;
#   * writes status every minute: heartbeat, `pgbackrest info` JSON,
#     pg_stat_archiver (WAL archiving) and repository disk usage;
#   * restores ONLY into new directories under $RESTORE_DIR (isolated targets,
#     a temporary PostgreSQL on a private socket, archiving disabled) and
#     never touches the live data directory.
set -uo pipefail

CONTROL_DIR="${CONTROL_DIR:-/control}"
RESTORE_DIR="${RESTORE_DIR:-/restore}"
STANZA="${PGBACKREST_STANZA:-caspira}"
TTL_HOURS="${RESTORE_TARGET_TTL_HOURS:-24}"
PGBR=/opt/caspira/pgbackrest-wrapper.sh
# gpg needs a writable home for its keyring and lock files; the agent's root
# filesystem is read-only, so use the tmpfs. (Nothing secret is stored there:
# symmetric encryption with a passphrase file.)
export GNUPGHOME=/tmp/gnupg
mkdir -p -m 0700 "$GNUPGHOME"
# The worker (another uid) shares the control volume through BACKUP_CONTROL_GID.
umask 0007
mkdir -p "$CONTROL_DIR/requests" "$CONTROL_DIR/results/processed" "$CONTROL_DIR/status" "$RESTORE_DIR"
chgrp -R "${BACKUP_CONTROL_GID:-1600}" "$CONTROL_DIR" 2>/dev/null || true
chmod -R g+rwX "$CONTROL_DIR" 2>/dev/null || true
find "$CONTROL_DIR" -type d -exec chmod g+s {} + 2>/dev/null || true
chmod 0700 "$RESTORE_DIR"

log() { printf '%s backup-agent: %s\n' "$(date -u +%FT%TZ)" "$*" >&2; }
now() { date -u +%FT%TZ; }

write_json() { # write_json <file> <json> — atomic
  local tmp="$1.tmp"
  printf '%s' "$2" > "$tmp" && mv -f "$tmp" "$1"
}

result() { # result <id> <type> <params-json> <status> <exit> <started> <output-json> [error]
  local out
  out=$(jq -n --arg id "$1" --arg type "$2" --argjson params "$3" --arg status "$4" --argjson exitCode "$5" \
    --arg startedAt "$6" --arg completedAt "$(now)" --argjson output "$7" --arg error "${8:-}" \
    '{id:$id,type:$type,params:$params,status:$status,exitCode:$exitCode,startedAt:$startedAt,completedAt:$completedAt,output:$output,error:($error|select(length>0))}')
  write_json "$CONTROL_DIR/results/$1.json" "$out"
}

ensure_stanza() {
  $PGBR --stanza="$STANZA" stanza-create >/dev/null 2>&1 || true
}

status_loop_once() {
  write_json "$CONTROL_DIR/status/heartbeat.json" "$(jq -n --arg at "$(now)" --arg env "${DEPLOY_ENVIRONMENT:-unknown}" '{at:$at,environment:$env}')"
  local info
  if info=$($PGBR --stanza="$STANZA" info --output=json 2>/dev/null); then
    write_json "$CONTROL_DIR/status/info.json" "$info"
  fi
  local arch
  if arch=$(psql -XAtq -c "select row_to_json(a) from (select archived_count, last_archived_wal, last_archived_time, failed_count, last_failed_wal, last_failed_time from pg_stat_archiver) a" 2>/dev/null); then
    [[ -n "$arch" ]] && write_json "$CONTROL_DIR/status/archiver.json" "$arch"
  fi
  local df_line
  df_line=$(df -P -B1 /var/lib/pgbackrest | tail -1)
  write_json "$CONTROL_DIR/status/repository.json" "$(echo "$df_line" | awk '{printf "{\"totalBytes\":%s,\"usedBytes\":%s,\"freeBytes\":%s,\"usedPercent\":%s}", $2, $3, $4, substr($5,1,length($5)-1)}')"
}

# ── operations ──────────────────────────────────────────────────────────────
op_backup() { # type: full|diff|incr (validated)
  local type="$1"
  case "$type" in full|diff|incr) ;; *) return 2 ;; esac
  ensure_stanza
  # pgBackRest backs up to one repository per run: the local repo1 first, then
  # the off-host repo2 when it's enabled (WAL already reaches both). A repo2
  # failure fails the job, so it's alerted; the repo1 backup still stands.
  $PGBR --stanza="$STANZA" --repo=1 --type="$type" backup >&2 || return $?
  if [[ "${OFFSITE_ENABLED:-false}" == "true" && -n "${PGBACKREST_REPO2_TYPE:-}" ]]; then
    $PGBR --stanza="$STANZA" --repo=2 --type="$type" backup >&2 || return $?
  fi
  $PGBR --stanza="$STANZA" info --output=json
}

op_check() { ensure_stanza; $PGBR --stanza="$STANZA" check >&2 && echo '{"summary":"archive and backup configuration check passed"}'; }

op_verify() {
  local out rc
  out=$($PGBR --stanza="$STANZA" verify --output=text 2>&1); rc=$?
  # Count WAL gaps reported as missing archive ranges.
  local gaps; gaps=$(printf '%s' "$out" | grep -ci "missing" || true)
  jq -n --arg summary "$(printf '%s' "$out" | tail -20)" --argjson walGaps "${gaps:-0}" '{summary:$summary,walGaps:$walGaps}'
  return $rc
}

op_expire() {
  local rf="$1" rd="$2"
  $PGBR --stanza="$STANZA" --repo1-retention-full="$rf" --repo1-retention-diff="$rd" expire >&2 && echo '{"summary":"retention applied"}'
}

op_logical() { # pg_dump custom format, GPG AES-256 encrypted; key file is a separate secret
  local label; label="logical-$(date -u +%Y%m%d-%H%M%S)"
  local dir=/var/lib/pgbackrest/logical; mkdir -p "$dir"
  local file="$dir/$label.dump.gpg"
  pg_dump -Fc -d "${PGDATABASE:-caspira_crm}" | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase-file /run/secrets/backup_logical_passphrase -o "$file" || { rm -f "$file"; return 1; }
  local sum size ver; sum=$(sha256sum "$file" | cut -d' ' -f1); size=$(stat -c %s "$file"); ver=$(pg_dump --version | awk '{print $3}')
  echo "$sum  $label.dump.gpg" > "$file.sha256"
  jq -n --arg label "$label" --arg sha "$sum" --argjson size "$size" --arg ver "$ver" \
    '{artifact:{"label":$label,tool:"pg_dump + gpg",toolVersion:$ver,locationId:("repo1:logical/"+$label+".dump.gpg"),encrypted:true,encryptionKeyVersion:"backup_logical_passphrase",sizeBytes:$size,sha256:$sha}}'
}

op_configuration() { # non-secret configuration and release manifests (never ./secrets)
  local label; label="config-$(date -u +%Y%m%d-%H%M%S)"
  local dir=/var/lib/pgbackrest/configuration; mkdir -p "$dir"
  local file="$dir/$label.tar.gpg"
  tar -C /config-src --exclude='./secrets' --exclude='*.pem' --exclude='*.key' -cf - . | gpg --batch --yes --quiet --symmetric --cipher-algo AES256 --passphrase-file /run/secrets/backup_logical_passphrase -o "$file" || { rm -f "$file"; return 1; }
  local sum size; sum=$(sha256sum "$file" | cut -d' ' -f1); size=$(stat -c %s "$file")
  jq -n --arg label "$label" --arg sha "$sum" --argjson size "$size" \
    '{artifact:{"label":$label,tool:"tar + gpg",locationId:("repo1:configuration/"+$label+".tar.gpg"),encrypted:true,encryptionKeyVersion:"backup_logical_passphrase",sizeBytes:$size,sha256:$sha}}'
}

op_object_backup() {
  # No object store holds application data yet (the Documents service is
  # not built). Configure OBJECT_STORAGE_RCLONE_REMOTE and OFFSITE_RCLONE_REMOTE
  # to mirror a bucket into a versioned off-host bucket.
  if [[ -z "${OBJECT_STORAGE_RCLONE_REMOTE:-}" || -z "${OFFSITE_RCLONE_REMOTE:-}" ]]; then
    echo "object storage backup is not configured" >&2; return 3
  fi
  rclone sync --checksum "$OBJECT_STORAGE_RCLONE_REMOTE" "$OFFSITE_RCLONE_REMOTE" --config /run/secrets/backup_offsite_credentials >&2 || return $?
  local label; label="objects-$(date -u +%Y%m%d-%H%M%S)"
  jq -n --arg label "$label" '{artifact:{"label":$label,tool:"rclone sync",locationId:"offsite:objects",encrypted:true,encryptionKeyVersion:"provider-side",sha256:null}}'
}

validate_restored() { # <socket dir> → JSON with aggregate counts only
  local sock="$1" q
  q() { psql -XAtq -h "$sock" -p 55432 -d "${PGDATABASE:-caspira_crm}" -c "$1" 2>/dev/null; }
  local migration users owners orgs roles audit replay
  migration=$(q "select migration_name from _prisma_migrations where finished_at is not null and rolled_back_at is null order by migration_name desc limit 1")
  users=$(q "select count(*) from users"); owners=$(q "select count(*) from users where role = 'Super-Admin'")
  orgs=$(q "select count(*) from organizations"); roles=$(q "select count(*) from roles")
  audit=$(q "select count(*) from audit_events")
  replay=$(q "select coalesce(to_char(pg_last_xact_replay_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),'')")
  jq -n --arg m "$migration" --arg u "${users:-}" --arg o "${owners:-}" --arg g "${orgs:-}" --arg r "${roles:-}" --arg a "${audit:-}" --arg t "$replay" \
    '{validation:{connectivity:(if $m=="" then "failed" else "ok" end),lastMigration:$m,users:($u|tonumber? // null),systemOwners:($o|tonumber? // null),organizations:($g|tonumber? // null),roles:($r|tonumber? // null),auditEvents:($a|tonumber? // null)},recoveredTo:($t|select(length>0))}'
}

op_restore() { # restoreId set targetType target repo — into $RESTORE_DIR/<id> only
  local id="$1" set="$2" ttype="$3" target="$4" repo="$5"
  [[ "$id" =~ ^[A-Za-z0-9_-]{6,64}$ ]] || return 2
  [[ -z "$repo" || "$repo" =~ ^[12]$ ]] || return 2
  local dest="$RESTORE_DIR/$id" sock="/tmp/restore-$id"
  [[ -e "$dest" ]] && { echo "restore target already exists" >&2; return 2; }
  mkdir -p "$dest" "$sock" && chmod 700 "$dest"
  local args=(--stanza="$STANZA" --pg1-path="$dest" --archive-mode=off restore)
  [[ -n "$set" && "$set" != "null" ]] && args=(--set="$set" "${args[@]}")
  # The repository that holds the set (otherwise pgBackRest picks the newest across repositories).
  [[ -n "$repo" ]] && args=(--repo="$repo" "${args[@]}")
  if [[ "$ttype" == "time" ]]; then args=(--type=time --target="$target" --target-action=promote "${args[@]}"); fi
  $PGBR "${args[@]}" >&2 || { rm -rf "$dest"; return 1; }
  # Temporary instance: private socket, no TCP, archiving off (never pushes
  # restored WAL into the production repository).
  pg_ctl -D "$dest" -w -t 7200 -l "$dest/restore.log" -o "-p 55432 -c listen_addresses='' -c unix_socket_directories=$sock -c archive_mode=off -c config_file=$dest/postgresql.conf -c hba_file=/etc/caspira/pg_hba.conf" start >&2 || { rm -rf "$dest"; return 1; }
  # Wait for recovery to finish (promotion).
  for _ in $(seq 1 720); do
    [[ "$(psql -XAtq -h "$sock" -p 55432 -d postgres -c 'select pg_is_in_recovery()' 2>/dev/null)" == "f" ]] && break
    sleep 5
  done
  local out; out=$(validate_restored "$sock")
  pg_ctl -D "$dest" -m fast stop >&2 || true
  touch "$dest/.restored-at"
  printf '%s' "$out"
}

op_restore_cleanup() {
  local id="$1"
  [[ "$id" =~ ^[A-Za-z0-9_-]{6,64}$ ]] || return 2
  pg_ctl -D "$RESTORE_DIR/$id" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "${RESTORE_DIR:?}/$id" "/tmp/restore-$id"
  echo '{"summary":"isolated restore target removed"}'
}

cleanup_expired_targets() {
  find "$RESTORE_DIR" -mindepth 1 -maxdepth 1 -type d -mmin +$((TTL_HOURS * 60)) -print0 2>/dev/null | while IFS= read -r -d '' d; do
    local id; id=$(basename "$d"); op_restore_cleanup "$id" >/dev/null
  done
}

process_request() {
  local file="$1" req id type params started out rc
  req=$(cat "$file") || return
  rm -f "$file"
  id=$(jq -r '.id // empty' <<<"$req"); type=$(jq -r '.type // empty' <<<"$req"); params=$(jq -c '.params // {}' <<<"$req")
  [[ "$id" =~ ^[A-Za-z0-9_-]{6,64}$ ]] || { log "rejected request with invalid id"; return; }
  [[ "$(jq -r '.environment' <<<"$req")" == "${DEPLOY_ENVIRONMENT:-}" ]] || { result "$id" "$type" "$params" failed 2 "$(now)" '{}' "environment mismatch"; return; }
  started=$(now); log "start $type $id"
  case "$type" in
    backup) out=$(op_backup "$(jq -r '.type' <<<"$params")"); rc=$? ; [[ $rc -eq 0 ]] && out=$(jq -n --argjson info "$out" '{info:$info}') ;;
    check) out=$(op_check); rc=$? ;;
    verify) out=$(op_verify); rc=$? ;;
    expire) out=$(op_expire "$(jq -r '.retentionFull' <<<"$params")" "$(jq -r '.retentionDiff' <<<"$params")"); rc=$? ;;
    logical) out=$(op_logical); rc=$? ;;
    configuration) out=$(op_configuration); rc=$? ;;
    object_backup) out=$(op_object_backup); rc=$? ;;
    restore) out=$(op_restore "$(jq -r '.restoreId' <<<"$params")" "$(jq -r '.set // ""' <<<"$params")" "$(jq -r '.targetType' <<<"$params")" "$(jq -r '.target // ""' <<<"$params")" "$(jq -r '.repo // ""' <<<"$params")"); rc=$? ;;
    restore_cleanup) out=$(op_restore_cleanup "$(jq -r '.restoreId' <<<"$params")"); rc=$? ;;
    *) out='{}'; rc=2 ;;
  esac
  [[ -z "${out:-}" ]] && out='{}'
  jq -e . >/dev/null 2>&1 <<<"$out" || out='{}'
  if [[ $rc -eq 0 ]]; then result "$id" "$type" "$params" succeeded 0 "$started" "$out"
  else result "$id" "$type" "$params" failed "$rc" "$started" "$out" "$type failed (exit $rc); see backup-agent logs"; fi
  log "done $type $id rc=$rc"
}

log "starting (environment ${DEPLOY_ENVIRONMENT:-unknown})"
ensure_stanza
tick=0
while true; do
  for f in "$CONTROL_DIR"/requests/*.json; do [[ -e "$f" ]] && process_request "$f"; done
  if (( tick % 6 == 0 )); then status_loop_once; cleanup_expired_targets; fi
  tick=$((tick + 1))
  sleep 10
done
