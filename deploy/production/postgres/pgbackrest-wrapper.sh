#!/usr/bin/env bash
# Runs pgBackRest with its secrets loaded from Docker secret files into this
# process's environment only (never on the command line, never logged).
# Used by archive_command in the db container and by the backup agent.
set -euo pipefail
if [[ -n "${PGBACKREST_REPO1_CIPHER_PASS_FILE:-}" && -r "${PGBACKREST_REPO1_CIPHER_PASS_FILE}" ]]; then
  PGBACKREST_REPO1_CIPHER_PASS="$(tr -d '\r\n' < "${PGBACKREST_REPO1_CIPHER_PASS_FILE}")"
  export PGBACKREST_REPO1_CIPHER_PASS
else
  echo "pgbackrest-wrapper: repository cipher passphrase is not available" >&2
  exit 1
fi
if [[ "${OFFSITE_ENABLED:-false}" == "true" && -r /run/secrets/backup_offsite_credentials ]]; then
  # File format: two lines "key=<access key>" and "secret=<secret key>", plus "cipher=<repo2 passphrase>".
  while IFS='=' read -r k v; do
    case "$k" in
      key) export PGBACKREST_REPO2_S3_KEY="$v" ;;
      secret) export PGBACKREST_REPO2_S3_KEY_SECRET="$v" ;;
      cipher) export PGBACKREST_REPO2_CIPHER_PASS="$v" ;;
    esac
  done < /run/secrets/backup_offsite_credentials
fi
exec pgbackrest "$@"
