#!/usr/bin/env bash
# Registers a release manifest (from build-local.sh or build-release.sh) with
# the API, which stores it immutably with its SBOMs and scan reports; the scan
# findings feed the deployment gates. Another person approves the release in
# Platform → Releases & deployments.
#
#   ./scripts/register-release.sh <release-id> <staging|production>
#
# Uses the automation token in /etc/caspira/<env>/deploy-token (scope
# release:register). Prints the API's answer; never prints the token.
set -euo pipefail
RELEASE_ID="${1:?usage: register-release.sh <release-id> <staging|production>}"
ENVIRONMENT="${2:?usage: register-release.sh <release-id> <staging|production>}"
cd "$(dirname "$0")/.."
source scripts/lib.sh
[[ "$RELEASE_ID" =~ ^[A-Za-z0-9._-]{3,80}$ ]] || { echo "Invalid release id." >&2; exit 2; }
MANIFEST="releases/$RELEASE_ID/manifest.json"
[[ -r "$MANIFEST" ]] || { echo "No manifest at deploy/production/$MANIFEST" >&2; exit 1; }
TOKEN_FILE="/etc/caspira/$ENVIRONMENT/deploy-token"
[[ -r "$TOKEN_FILE" ]] || { echo "Missing automation token $TOKEN_FILE (create one in Platform → Security with scope release:register)." >&2; exit 1; }
API="$(env_value PUBLIC_API_URL)"
curl -fsS --max-time 120 -X POST -H "Authorization: Bearer $(cat "$TOKEN_FILE")" -H 'Content-Type: application/json' \
  --data @"$MANIFEST" "$API/api/v1/admin/automation/releases" | jq '{releaseId, version, status, existing}'
