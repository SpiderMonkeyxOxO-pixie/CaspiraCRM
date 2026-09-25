#!/usr/bin/env bash
# Application-image rollback for an APPROVED, schema-compatible rollback
# (Backend Phase 13). The API decides compatibility; an incompatible rollback
# is "Manual Recovery Required" and this script refuses it. No migrations
# run and the schema is never downgraded.
#
#   ./scripts/rollback.sh <rollback-deployment-id> <staging|production>
#
# Images are the target release's registry digests, or (IMAGE_SOURCE=local)
# its image IDs, which must still be on this host — keep the previous
# release's images until the next release has been stable for a while.
set -euo pipefail
DEPLOYMENT_ID="${1:?rollback deployment id}"; ENVIRONMENT="${2:?staging|production}"
cd "$(dirname "$0")/.."
source scripts/lib.sh
API="$(env_value PUBLIC_API_URL)"
AUTH="Authorization: Bearer $(cat "/etc/caspira/$ENVIRONMENT/deploy-token")"
report() { curl -fsS --max-time 20 -X POST -H "$AUTH" -H 'Content-Type: application/json' -d "$(jq -n --arg s "$1" --arg m "$2" '{status:$s,message:$m}')" "$API/api/v1/admin/automation/deployments/$DEPLOYMENT_ID/events" >/dev/null || true; }

PLAN="$(curl -fsS --max-time 20 -H "$AUTH" "$API/api/v1/admin/automation/deployments/$DEPLOYMENT_ID")"
[[ "$(jq -r .status <<<"$PLAN")" == "Rolling Back" ]] || { echo "Not an approved rollback (status $(jq -r .status <<<"$PLAN"))." >&2; exit 1; }
RELEASE_ID="$(jq -r .releaseId <<<"$PLAN")"
cp "$RELEASE_ENV" "$RELEASE_ENV.before-rollback"
{
  for pair in api:API_IMAGE migrator:MIGRATOR_IMAGE web:WEB_IMAGE; do
    ref="$(jq -r --arg k "${pair%%:*}" '.images[$k] // empty' <<<"$PLAN")"
    [[ -z "$ref" ]] && continue
    resolved="$(resolve_image "${pair%%:*}" "$ref" "$RELEASE_ID")" || { cp "$RELEASE_ENV.before-rollback" "$RELEASE_ENV"; exit 1; }
    echo "${pair##*:}=$resolved"
  done
  echo "RELEASE_ID=$RELEASE_ID"
  # The database image and the schema stay as they are.
  grep -E '^(POSTGRES_IMAGE|EXPECTED_SCHEMA_VERSION)=' "$RELEASE_ENV.before-rollback" || true
} > "$RELEASE_ENV.tmp"
mv "$RELEASE_ENV.tmp" "$RELEASE_ENV"
dc_refresh
APP_SERVICES=(api worker); uses_layer compose.edge.yaml && APP_SERVICES+=(web)
if "${DC[@]}" up -d --wait --no-deps "${APP_SERVICES[@]}" \
  && curl -fsS --max-time 10 "$API/ready" | jq -e '.status=="ready"' >/dev/null; then
  report "Rolled Back" "Previous application images running"
  echo "Rolled back to $RELEASE_ID."
else
  report "Manual Recovery Required" "Rollback containers failed health checks"
  echo "Rollback failed health checks — follow runbook 08." >&2; exit 1
fi
