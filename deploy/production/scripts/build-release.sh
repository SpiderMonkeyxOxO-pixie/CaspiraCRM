#!/usr/bin/env bash
# Builds ONE immutable release and its evidence (Backend Phase 13).
#
#   REGISTRY=registry.example.com/caspira ./deploy/production/scripts/build-release.sh <version>
#
# Run from a clean checkout on the build machine (not on the production
# host). It: runs lint and all tests; builds the api, migrator, web and
# postgres images once with the version and git revision as OCI labels;
# pushes them and records their DIGESTS; runs the repository policy check,
# secret scan, dependency and license scans, and Trivy/Syft on the images if
# installed; writes SBOMs; and writes releases/<id>/manifest.json. The same
# digests are then promoted to staging and production — never rebuilt.
# Optionally registers the manifest with the API (token scope release:register).
set -euo pipefail
VERSION="${1:?version, e.g. 2026.09.25}"
: "${REGISTRY:?set REGISTRY, e.g. registry.example.com/caspira}"
ROOT="$(git rev-parse --show-toplevel)"; cd "$ROOT"
[[ -z "$(git status --porcelain)" ]] || { echo "Working tree is not clean; commit first." >&2; exit 1; }
COMMIT="$(git rev-parse HEAD)"; SHORT="${COMMIT:0:7}"
RELEASE_ID="${VERSION}-${SHORT}"
OUT="deploy/production/releases/$RELEASE_ID"
[[ -e "$OUT/manifest.json" ]] && { echo "Release $RELEASE_ID already exists; releases are immutable." >&2; exit 1; }
mkdir -p "$OUT"
BUILD_DATE="$(date -u +%FT%TZ)"
result() { if "$@" >"$OUT/$(echo "$1-$2" | tr -c 'a-zA-Z0-9-' '_').log" 2>&1; then echo passed; else echo failed; fi; }

echo "== Tests"
npm ci --no-audit --no-fund >/dev/null; npm ci --prefix server --no-audit --no-fund >/dev/null
LINT="$(result npx eslint .)"
UNIT="$(cd server && result npm test)"
WEB="$(result npx vitest run)"
INTEGRATION="$(cd server && result npm run test:integration)"
AUTHZ="$(cd server && result npx vitest run src/middleware src/platform src/analytics)"
TENANT="$(cd server && result npx vitest run src/analytics src/platform/tenantIsolation.test.js)"
MIGRATIONS="$(cd server && result node scripts/migrate.js --check)"
BUILD="$(result npm run build)"
[[ "$UNIT" == passed && "$WEB" == passed ]] && UNIT_ALL=passed || UNIT_ALL=failed

echo "== Images (built once, pushed, digests recorded)"
build_push() { # name dockerfile-args...
  local name="$1"; shift
  docker build --pull "$@" --build-arg VERSION="$VERSION" --build-arg REVISION="$COMMIT" --build-arg BUILD_DATE="$BUILD_DATE" -t "$REGISTRY/$name:$RELEASE_ID" >/dev/null
  docker push --quiet "$REGISTRY/$name:$RELEASE_ID" >/dev/null
  docker image inspect --format '{{index .RepoDigests 0}}' "$REGISTRY/$name:$RELEASE_ID"
}
API_REF="$(build_push api --target runtime server)"
MIG_REF="$(build_push migrator --target migrator server)"
WEB_REF="$(build_push web -f Dockerfile.web .)"
PG_REF="$(build_push postgres deploy/production/postgres)"

echo "== Scans and SBOMs"
( cd server
  node scripts/security/policyCheck.js --json > "../$OUT/policy-report.json" || true
  node scripts/security/secretScan.js --json > "../$OUT/secret-report.json" || true
  node scripts/security/dependencyScan.js audit . > "../$OUT/audit-server.json"
  node scripts/security/dependencyScan.js audit .. > "../$OUT/audit-web.json"
  node scripts/security/dependencyScan.js licenses . > "../$OUT/licenses-server.json"
  node scripts/security/dependencyScan.js sbom . "../$OUT/sbom-api.cdx.json" > "../$OUT/sbom-api.meta.json"
  node scripts/security/dependencyScan.js sbom .. "../$OUT/sbom-web.cdx.json" > "../$OUT/sbom-web.meta.json" )
CONTAINER_SCANS='[]'
if command -v trivy >/dev/null; then
  for ref in "$API_REF" "$WEB_REF" "$PG_REF"; do
    n="$(basename "${ref%@*}")"
    trivy image --quiet --format json --severity CRITICAL,HIGH --ignore-unfixed "$ref" > "$OUT/trivy-$n.json" || true
    CONTAINER_SCANS="$(jq --arg n "$n" --slurpfile t "$OUT/trivy-$n.json" '. + [{scanner:"trivy",target:("container:"+$n),category:"container",findings:[($t[0].Results // [])[] | (.Vulnerabilities // [])[] | {id:.VulnerabilityID,title:(.Title // .VulnerabilityID),severity:.Severity,component:.PkgName,installedVersion:.InstalledVersion,fixedVersion:.FixedVersion,category:"container"}]}]' <<<"$CONTAINER_SCANS")"
  done
else
  echo "trivy not installed: the container scan gate will fail until CI evidence is attached." >&2
fi
if command -v syft >/dev/null; then syft "$API_REF" -o cyclonedx-json > "$OUT/sbom-api-image.cdx.json"; fi

echo "== Manifest"
MIGRATIONS_LIST="$(for d in server/prisma/migrations/*/; do [[ -f "$d/migration.sql" ]] && basename "$d"; done | sort | jq -R . | jq -s .)"
jq -n --arg id "$RELEASE_ID" --arg v "$VERSION" --arg c "$COMMIT" --arg t "$BUILD_DATE" \
  --arg api "$API_REF" --arg mig "$MIG_REF" --arg web "$WEB_REF" --arg pg "$PG_REF" \
  --argjson migrations "$MIGRATIONS_LIST" \
  --arg lint "$LINT" --arg unit "$UNIT_ALL" --arg integ "$INTEGRATION" --arg authz "$AUTHZ" --arg tenant "$TENANT" --arg mt "$MIGRATIONS" --arg build "$BUILD" \
  --slurpfile sbomApi "$OUT/sbom-api.meta.json" --slurpfile sbomWeb "$OUT/sbom-web.meta.json" \
  --slurpfile p "$OUT/policy-report.json" --slurpfile s "$OUT/secret-report.json" --slurpfile a1 "$OUT/audit-server.json" --slurpfile a2 "$OUT/audit-web.json" --argjson cs "$CONTAINER_SCANS" \
  '{releaseId:$id,version:$v,gitCommit:$c,buildTimestamp:$t,images:{api:$api,migrator:$mig,web:$web,postgres:$pg},
    migrationVersion:($migrations|last),migrations:$migrations,configSchemaVersion:1,
    tests:{lint:$lint,type_check:"not_applicable",unit_tests:$unit,integration_tests:$integ,authorization_tests:$authz,tenant_isolation_tests:$tenant,migration_tests:$mt,build:$build},
    sboms:[$sbomApi[0],$sbomWeb[0]],scans:([$p[0],$s[0],$a1[0],$a2[0]] + $cs),
    rollbackCompatibleWith:[],destructiveMigration:false,releaseNotes:""}' > "$OUT/manifest.json"
echo "Release $RELEASE_ID written to $OUT/manifest.json"
echo "Edit rollbackCompatibleWith/destructiveMigration/releaseNotes if needed, then register it:"
echo "  curl -H \"Authorization: Bearer \$(cat <token-file>)\" -H 'Content-Type: application/json' --data @$OUT/manifest.json <PUBLIC_API_URL>/api/v1/admin/automation/releases"
