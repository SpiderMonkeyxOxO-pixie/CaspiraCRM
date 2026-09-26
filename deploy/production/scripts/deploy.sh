#!/usr/bin/env bash
# Controlled deployment of an APPROVED release (Backend Phase 13).
#
#   ./scripts/deploy.sh <deployment-id> <staging|production>
#
# Refuses to act unless the API reports the deployment as "Deploying" (i.e.
# planned, approved by a second person and every preflight gate passed).
# Uses images ONLY by digest (registry) or verified image ID (IMAGE_SOURCE=local:
# built on this host by build-local.sh), takes a pre-deployment
# backup, runs migrations with the migration identity, replaces the
# application containers, runs smoke tests and reports every step back.
# It never deletes volumes and never downgrades the schema.
#
# Needs: docker compose v2, curl, jq; the automation token (scopes
# deployment:read, deployment:report) in /etc/caspira/<env>/deploy-token (0400).
set -euo pipefail
DEPLOYMENT_ID="${1:?deployment id}"; ENVIRONMENT="${2:?staging|production}"
cd "$(dirname "$0")/.."
source scripts/lib.sh
TOKEN_FILE="/etc/caspira/$ENVIRONMENT/deploy-token"
[[ -r "$TOKEN_FILE" ]] || { echo "Missing automation token $TOKEN_FILE" >&2; exit 1; }
API="$(env_value PUBLIC_API_URL)"
AUTH="Authorization: Bearer $(cat "$TOKEN_FILE")"

api_get() { curl -fsS --max-time 20 -H "$AUTH" "$API/api/v1/admin/automation/deployments/$DEPLOYMENT_ID"; }
report() { # report <status> <message>
  curl -fsS --max-time 20 -X POST -H "$AUTH" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg s "$1" --arg m "$2" '{status:$s,message:$m}')" \
    "$API/api/v1/admin/automation/deployments/$DEPLOYMENT_ID/events" >/dev/null || echo "WARNING: could not report '$1' to the API" >&2
}
REPLACED=false
fail() {
  # Before the containers are replaced, put back the running release's image
  # file so a later `up` can't start images that weren't deployed.
  if [[ "$REPLACED" == "false" && -f "$RELEASE_ENV.previous" ]]; then cp "$RELEASE_ENV.previous" "$RELEASE_ENV"; fi
  report "${2:-Failed}" "$1"; echo "DEPLOYMENT STOPPED: $1" >&2; exit 1
}

PLAN="$(api_get)" || { echo "Cannot read the deployment from the API." >&2; exit 1; }
STATUS="$(jq -r .status <<<"$PLAN")"
[[ "$STATUS" == "Deploying" ]] || { echo "Deployment is '$STATUS', not 'Deploying'. Approve it and run preflight in Platform → Deployments first." >&2; exit 1; }

# ── 1. Images: the approved digests / image IDs only, verified ───────────────
RELEASE_ID="$(jq -r .releaseId <<<"$PLAN")"
[[ -f "$RELEASE_ENV" ]] && cp "$RELEASE_ENV" "$RELEASE_ENV.previous"
: > "$RELEASE_ENV.tmp"
for pair in api:API_IMAGE migrator:MIGRATOR_IMAGE web:WEB_IMAGE postgres:POSTGRES_IMAGE; do
  key="${pair%%:*}"; var="${pair##*:}"
  ref="$(jq -r --arg k "$key" '.images[$k] // empty' <<<"$PLAN")"
  [[ -z "$ref" ]] && continue
  resolved="$(resolve_image "$key" "$ref" "$RELEASE_ID")" || fail "Image $key could not be verified. Nothing was changed."
  echo "$var=$resolved" >> "$RELEASE_ENV.tmp"
done
echo "RELEASE_ID=$RELEASE_ID" >> "$RELEASE_ENV.tmp"
mv "$RELEASE_ENV.tmp" "$RELEASE_ENV"
restrict_release_file "$RELEASE_ENV"
dc_refresh
# Record the schema version found now; the migrator refuses to run if it changes before migration.
CURRENT_SCHEMA="$("${DC[@]}" --profile migrate run --rm -T migrate node scripts/migrate.js --check 2>/dev/null | jq -r '.current // "none"')" \
  || fail "Migration preflight failed (unknown or unfinished migrations). Nothing was changed."
echo "EXPECTED_SCHEMA_VERSION=$CURRENT_SCHEMA" >> "$RELEASE_ENV"

# ── 2. Pre-deployment backup (incremental, verified by pgBackRest) ───────────
if "${DC[@]}" --profile backup ps --status running backup-agent | grep -q backup-agent; then
  # repo1 (local, fast); with an off-host repo2 configured pgBackRest needs the repository named.
  "${DC[@]}" --profile backup exec -T backup-agent /opt/caspira/pgbackrest-wrapper.sh --stanza=caspira --repo=1 --type=incr backup >/dev/null \
    || fail "Pre-deployment backup failed; nothing was changed."
else
  fail "The backup agent is not running; refusing to deploy without a pre-deployment backup."
fi

# ── 3. Maintenance (only when the plan requires it) ──────────────────────────
MAINT="$(jq -r .maintenanceRequired <<<"$PLAN")"
# (The maintenance page is served by our own proxy; on the aaPanel VPS use
# aaPanel's maintenance setting instead — runbook 04.)
[[ "$MAINT" == "true" ]] && uses_layer compose.edge.yaml && touch proxy/maintenance/ENABLED

# ── 4. Migrations with the migration identity ────────────────────────────────
report "Migrating" "Applying migrations"
if ! MIG="$("${DC[@]}" --profile migrate run --rm -T migrate 2>/dev/null)"; then
  fail "Migration failed: $(jq -r '.message // "see migrator output"' <<<"$MIG" 2>/dev/null). Maintenance mode left on." "Manual Recovery Required"
fi
echo "Migrations: $(jq -c '{before,after,applied}' <<<"$MIG")"

# ── 5. Replace application containers (graceful stop; volumes untouched) ─────
REPLACED=true
APP_SERVICES=(api worker); uses_layer compose.edge.yaml && APP_SERVICES+=(web)
"${DC[@]}" up -d --wait --no-deps "${APP_SERVICES[@]}" || fail "New containers did not become healthy."
# The backup agent runs the release's postgres image (agent script, pgBackRest
# wrapper). The database itself is recreated only when its image changed:
# that is a short outage, reported as its own step.
"${DC[@]}" --profile backup up -d --wait --no-deps backup-agent || fail "The backup agent did not become healthy."
db_running="$(docker inspect --format '{{.Image}}' "$("${DC[@]}" ps -q db)" 2>/dev/null || true)"
db_wanted="$(docker image inspect --format '{{.Id}}' "$(grep -E '^POSTGRES_IMAGE=' "$RELEASE_ENV" | cut -d= -f2-)" 2>/dev/null || true)"
if [[ -n "$db_wanted" && "$db_running" != "$db_wanted" ]]; then
  report "Deploying" "Restarting the database on the release's postgres image"
  "${DC[@]}" up -d --wait --no-deps db || fail "The database did not become healthy on the new image." "Manual Recovery Required"
  "${DC[@]}" up -d --wait --no-deps "${APP_SERVICES[@]}" || fail "Application containers did not recover after the database restart."
fi
report "Verifying" "Containers healthy; running smoke tests"

# ── 6. Smoke tests through the public proxy ──────────────────────────────────
curl -fsS --max-time 10 "$API/health" | jq -e '.status=="ok"' >/dev/null || fail "Smoke: /health failed."
curl -fsS --max-time 10 "$API/ready" | jq -e '.status=="ready"' >/dev/null || fail "Smoke: /ready failed."
code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$API/api/v1/auth/me")"
[[ "$code" == "401" ]] || fail "Smoke: unauthenticated /auth/me returned $code (expected 401)."
hdr="$(curl -sI --max-time 10 "$API/api/v1/health")"
grep -qi '^x-content-type-options: nosniff' <<<"$hdr" || fail "Smoke: security headers missing."

rm -f proxy/maintenance/ENABLED
report "Completed" "Deployed $(jq -r .releaseId <<<"$PLAN")"
echo "Deployment $DEPLOYMENT_ID completed."
