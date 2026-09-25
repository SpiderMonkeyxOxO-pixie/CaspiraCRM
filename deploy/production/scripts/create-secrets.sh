#!/usr/bin/env bash
# Creates any MISSING secret files for one environment (Backend Phase 13).
# Never prints a value, never overwrites an existing file (rotation is a
# separate, recorded procedure: runbooks 15 and 16).
#
#   sudo ./scripts/create-secrets.sh production
#
# Provider-issued secrets (smtp_password, backup_offsite_credentials) are
# created as empty placeholders; paste the provider's value with an editor.
set -euo pipefail
ENVIRONMENT="${1:-}"
case "$ENVIRONMENT" in staging|production) ;; *) echo "usage: $0 staging|production" >&2; exit 2 ;; esac
cd "$(dirname "$0")/.."
DIR="secrets/$ENVIRONMENT"
GID="${SECRETS_GID:-1500}"
getent group "$GID" >/dev/null || { echo "Group $GID does not exist. Create it first: groupadd -g $GID caspira-secrets" >&2; exit 1; }
install -d -o root -g "$GID" -m 0750 "$DIR"
umask 077
rand() { head -c "$1" /dev/urandom | base64 | tr -d '\n=+/' | head -c "$2"; }
make() { # make <name> <generator…>
  local f="$DIR/$1"; shift
  if [[ -e "$f" ]]; then echo "exists   $f"; return; fi
  "$@" > "$f"; chown root:"$GID" "$f"; chmod 0440 "$f"; echo "created  $f"
}
make jwt_secret rand 64 64
make db_password rand 48 40
make db_migrator_password rand 48 40
make db_readonly_password rand 48 40
make db_monitor_password rand 48 40
make postgres_superuser_password rand 48 40
make redis_password rand 48 40
make integrations_keys sh -c 'printf "1:%s" "$(head -c 32 /dev/urandom | base64 | tr -d "\n")"'
make ai_safety_id_secret rand 64 64
make metrics_token rand 48 40
make platform_automation_token_pepper rand 64 64
make backup_repo_cipher_pass rand 96 80
make backup_logical_passphrase rand 96 80
make smtp_password printf ''
# Holds the previous JWT key only during a rotation (runbook 15); empty otherwise.
make jwt_secret_previous printf ''
make backup_offsite_credentials printf 'key=\nsecret=\ncipher=%s\n' "$(rand 96 80)"
# Off-host copy over SFTP (the aaPanel layout): a dedicated key pair. Only the
# PUBLIC half is printed, to be installed for the backup user on the other server.
if grep -qs '^PGBACKREST_REPO2_TYPE=sftp' env/backup-offsite.env; then
  f="$DIR/backup_offsite_sftp_key"
  if [[ -e "$f" ]]; then echo "exists   $f"
  else
    ssh-keygen -q -t rsa -b 4096 -m PEM -N "" -C "caspira-$ENVIRONMENT-backup" -f "$f"
    chown root:"$GID" "$f" "$f.pub"; chmod 0440 "$f"; chmod 0444 "$f.pub"; echo "created  $f"
  fi
  echo
  echo "Public key for the backup user on the off-host server (safe to copy):"
  cat "$f.pub"
fi
echo
echo "Next: paste provider values (if any) into $DIR/smtp_password and the key/secret lines of $DIR/backup_offsite_credentials (S3 only),"
echo "escrow the backup keys in the password manager, and record the metadata in Platform → Secrets."
