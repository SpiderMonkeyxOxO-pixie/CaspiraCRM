#!/usr/bin/env bash
# Controlled deployment of an APPROVED release (Backend Phase 13).
#
#   ./scripts/deploy.sh <deployment-id> <staging|production>
#
# Refuses to act unless the API reports the deployment as "Deploying" (i.e.
# planned, approved by a second person and every preflight gate passed).
# Pulls images ONLY by digest and checks the digests, takes a pre-deployment
# backup, runs migrations with the migration identity, replaces the
# application containers, runs smoke tests and reports every step back.
# It never deletes volumes and never downgrades the schema.
#
# Needs: docker compose v2, curl, jq; the automation token (scopes
# deployment:read, deployment:report) in /etc/caspira/<env>/deploy-token (0400).
set -euo pipefail
DEPLOYMENT_ID="${1:?deployment id}"; ENVIRONMENT="${2:?staging|production}"
case "$ENVIRONMENT" in staging|production) ;; *) echo "environment must be staging or production" >&2; exit 2 ;; esac
cd "$(dirname "$0")/.."
ENV_FILE="env/$ENVIRONMENT.env"
RELEASE_ENV="env/$ENVIRONMENT.release.env"
TOKEN_FILE="/etc/caspira/$ENVIRONMENT/deploy-token"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE" >&2; exit 1; }
[[ -r "$TOKEN_FILE" ]] || { echo "Missing automation token $TOKEN_FILE" >&2; exit 1; }
API="$(grep -E '^PUBLIC_API_URL=' "$ENV_FILE" | cut -d= -f2-)"
AUTH="Authorization: Bearer $(cat "$TOKEN_FILE")"
DC=(docker compose --env-file "$ENV_FILE" --env-file "$RELEASE_ENV")

api_get() { curl -fsS --max-time 20 -H "$AUTH" "$API/api/v1/admin/automation/deployments/$DEPLOYMENT_ID"; }
report() { # report <status> <message>
  curl -fsS --max-time 20 -X POST -H "$AUTH" -H 'Content-Type: application/json' \
    -d "$(jq -n --arg s "$1" --arg m "$2" '{status:$s,message:$m}')" \
    "$API/api/v1/admin/automation/deployments/$DEPLOYMENT_ID/events" >/dev/null || echo "WARNING: could not report '$1' to the API" >&2
}
fail() { report "${2:-Failed}" "$1"; echo "DEPLOYMENT STOPPED: $1" >&2; exit 1; }

PLAN="$(api_get)" || { echo "Cannot read the deployment from the API." >&2; exit 1; }
STATUS="$(jq -r .status <<<"$PLAN")"
[[ "$STATUS" == "Deploying" ]] || { echo "Deployment is '$STATUS', not 'Deploying'. Approve it and run preflight in Platform → Deployments first." >&2; exit 1; }

# ── 1. Images: digest-pinned only, pulled and verified ───────────────────────
: > "$RELEASE_ENV.tmp"
for pair in api:API_IMAGE migrator:MIGRATOR_IMAGE web:WEB_IMAGE postgres:POSTGRES_IMAGE; do
  key="${pair%%:*}"; var="${pair##*:}"
  ref="$(jq -r --arg k "$key" '.images[$k] // empty' <<<"$PLAN")"
  [[ -z "$ref" ]] && continue
  [[ "$ref" =~ @sha256:[a-f0-9]{64}$ ]] || fail "Image $key is not pinned by digest."
  docker pull --quiet "$ref" >/dev/null || fail "Could not pull $key."
  docker image inspect --format '{{join .RepoDigests "\n"}}' "$ref" | grep -q "${ref##*@}" || fail "Pulled image $key does not match its digest."
  echo "$var=$ref" >> "$RELEASE_ENV.tmp"
done
mv "$RELEASE_ENV.tmp" "$RELEASE_ENV"
chmod 0640 "$RELEASE_ENV"
# Record the schema version found now; the migrator refuses to run if it changes before migration.
CURRENT_SCHEMA="$("${DC[@]}" --profile migrate run --rm -T migrate node scripts/migrate.js --check 2>/dev/null | jq -r '.current // "none"')" \
  || fail "Migration preflight failed (unknown or unfinished migrations). Nothing was changed."
echo "EXPECTED_SCHEMA_VERSION=$CURRENT_SCHEMA" >> "$RELEASE_ENV"

# ── 2. Pre-deployment backup (incremental, verified by pgBackRest) ───────────
if "${DC[@]}" --profile backup ps --status running backup-agent | grep -q backup-agent; then
  "${DC[@]}" --profile backup exec -T backup-agent /opt/caspira/pgbackrest-wrapper.sh --stanza=caspira --type=incr backup >/dev/null \
    || fail "Pre-deployment backup failed; nothing was changed."
else
  fail "The backup agent is not running; refusing to deploy without a pre-deployment backup."
fi

# ── 3. Maintenance (only when the plan requires it) ──────────────────────────
MAINT="$(jq -r .maintenanceRequired <<<"$PLAN")"
[[ "$MAINT" == "true" ]] && touch proxy/maintenance/ENABLED

# ── 4. Migrations with the migration identity ────────────────────────────────
report "Migrating" "Applying migrations"
if ! MIG="$("${DC[@]}" --profile migrate run --rm -T migrate 2>/dev/null)"; then
  fail "Migration failed: $(jq -r '.message // "see migrator output"' <<<"$MIG" 2>/dev/null). Maintenance mode left on." "Manual Recovery Required"
fi
echo "Migrations: $(jq -c '{before,after,applied}' <<<"$MIG")"

# ── 5. Replace application containers (graceful stop; volumes untouched) ─────
"${DC[@]}" up -d --wait --no-deps api worker web || fail "New containers did not become healthy."
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
