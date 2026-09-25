#!/usr/bin/env bash
# Runs pgBackRest with its secrets loaded from Docker secret files into this
# process's environment only (never on the command line, never logged).
# Used by archive_command in the db container and by the backup agent.
#
# The off-host repository (repo2) is configured by PGBACKREST_REPO2_*
# settings in env/backup-offsite.env (non-secret) and enabled with
# OFFSITE_ENABLED=true. Two types are supported:
#   s3   — object storage; keys come from backup_offsite_credentials
#   sftp — another server over SSH; the private key is the secret file named
#          by PGBACKREST_REPO2_SFTP_PRIVATE_KEY_FILE and the server's host key
#          is pinned in PGBACKREST_REPO2_SFTP_KNOWN_HOST (strict checking)
# For both, the repo2 encryption passphrase is the "cipher=" line of
# backup_offsite_credentials.
set -euo pipefail
if [[ -n "${PGBACKREST_REPO1_CIPHER_PASS_FILE:-}" && -r "${PGBACKREST_REPO1_CIPHER_PASS_FILE}" ]]; then
  PGBACKREST_REPO1_CIPHER_PASS="$(tr -d '\r\n' < "${PGBACKREST_REPO1_CIPHER_PASS_FILE}")"
  export PGBACKREST_REPO1_CIPHER_PASS
  # pgBackRest reads every PGBACKREST_* variable as an option and warns about
  # this unknown one on stdout, which corrupts --output=json for the agent.
  unset PGBACKREST_REPO1_CIPHER_PASS_FILE
else
  echo "pgbackrest-wrapper: repository cipher passphrase is not available" >&2
  exit 1
fi
if [[ "${OFFSITE_ENABLED:-false}" == "true" ]]; then
  [[ -n "${PGBACKREST_REPO2_TYPE:-}" ]] || { echo "pgbackrest-wrapper: OFFSITE_ENABLED=true but no PGBACKREST_REPO2_TYPE (env/backup-offsite.env)" >&2; exit 1; }
  [[ -r /run/secrets/backup_offsite_credentials ]] || { echo "pgbackrest-wrapper: backup_offsite_credentials is not readable" >&2; exit 1; }
  # File format: "cipher=<repo2 passphrase>", plus "key=" and "secret=" for s3.
  while IFS='=' read -r k v; do
    v="${v%$'\r'}"
    [[ -z "$v" ]] && continue
    case "$k" in
      key) [[ "$PGBACKREST_REPO2_TYPE" == "s3" ]] && export PGBACKREST_REPO2_S3_KEY="$v" ;;
      secret) [[ "$PGBACKREST_REPO2_TYPE" == "s3" ]] && export PGBACKREST_REPO2_S3_KEY_SECRET="$v" ;;
      cipher) export PGBACKREST_REPO2_CIPHER_PASS="$v" ;;
    esac
  done < /run/secrets/backup_offsite_credentials
  [[ -n "${PGBACKREST_REPO2_CIPHER_PASS:-}" ]] || { echo "pgbackrest-wrapper: repo2 passphrase (cipher=) is missing" >&2; exit 1; }
  if [[ "$PGBACKREST_REPO2_TYPE" == "sftp" ]]; then
    [[ -r "${PGBACKREST_REPO2_SFTP_PRIVATE_KEY_FILE:-}" ]] || { echo "pgbackrest-wrapper: SFTP private key is not readable" >&2; exit 1; }
    [[ -r "${PGBACKREST_REPO2_SFTP_KNOWN_HOST:-}" ]] || { echo "pgbackrest-wrapper: SFTP known_hosts file is not readable (host key must be pinned)" >&2; exit 1; }
  fi
else
  # No off-host copy configured: make sure a stray repo2 setting can't half-enable it.
  unset PGBACKREST_REPO2_TYPE
fi
exec pgbackrest "$@"
