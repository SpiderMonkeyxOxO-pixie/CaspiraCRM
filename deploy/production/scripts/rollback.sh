#!/usr/bin/env bash
# Application-image rollback for an APPROVED, schema-compatible rollback
# (Backend Phase 13). The API decides compatibility; an incompatible rollback
# is "Manual Recovery Required" and this script refuses it. No migrations
# run and the schema is never downgraded.
#
#   ./scripts/rollback.sh <rollback-deployment-id> <staging|production>
set -euo pipefail
DEPLOYMENT_ID="${1:?rollback deployment id}"; ENVIRONMENT="${2:?staging|production}"
case "$ENVIRONMENT" in staging|production) ;; *) exit 2 ;; esac
cd "$(dirname "$0")/.."
ENV_FILE="env/$ENVIRONMENT.env"; RELEASE_ENV="env/$ENVIRONMENT.release.env"
API="$(grep -E '^PUBLIC_API_URL=' "$ENV_FILE" | cut -d= -f2-)"
AUTH="Authorization: Bearer $(cat "/etc/caspira/$ENVIRONMENT/deploy-token")"
report() { curl -fsS --max-time 20 -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "$(jq -n --arg s "$1" --arg m "$2" '{status:$s,message:$m}')" "$API/api/v1/admin/automation/deployments/$DEPLOYMENT_ID/events" >/dev/null || true; }

PLAN="$(curl -fsS --max-time 20 -H "$AUTH" "$API/api/v1/admin/automation/deployments/$DEPLOYMENT_ID")"
[[ "$(jq -r .status <<<"$PLAN")" == "Rolling Back" ]] || { echo "Not an approved rollback (status $(jq -r .status <<<"$PLAN"))." >&2; exit 1; }
cp "$RELEASE_ENV" "$RELEASE_ENV.before-rollback"
{
  for pair in api:API_IMAGE migrator:MIGRATOR_IMAGE web:WEB_IMAGE; do
    ref="$(jq -r --arg k "${pair%%:*}" '.images[$k] // empty' <<<"$PLAN")"
    [[ -z "$ref" ]] && continue
    [[ "$ref" =~ @sha256:[a-f0-9]{64}$ ]] || { echo "not digest-pinned" >&2; exit 1; }
    docker pull --quiet "$ref" >/dev/null
    echo "${pair##*:}=$ref"
  done
  grep -E '^(POSTGRES_IMAGE|EXPECTED_SCHEMA_VERSION)=' "$RELEASE_ENV.before-rollback" || true
} > "$RELEASE_ENV"
if docker compose --env-file "$ENV_FILE" --env-file "$RELEASE_ENV" up -d --wait --no-deps api worker web \
  && curl -fsS --max-time 10 "$API/ready" | jq -e '.status=="ready"' >/dev/null; then
  report "Rolled Back" "Previous application images running"
  echo "Rolled back."
else
  report "Manual Recovery Required" "Rollback containers failed health checks"
  echo "Rollback failed health checks — follow runbook 08." >&2; exit 1
fi
