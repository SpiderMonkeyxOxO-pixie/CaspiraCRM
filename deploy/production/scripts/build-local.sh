#!/usr/bin/env bash
# Builds ONE immutable release ON THIS HOST from an exact commit (Backend
# Phase 13) — for hosts without a container registry (IMAGE_SOURCE=local,
# e.g. the aaPanel VPS).
#
#   sudo ./scripts/build-local.sh <commit> <staging|production>
#
# It changes no running container. It:
#   1. refuses a commit that isn't on origin/main or whose CI "checks" job
#      (lint, migrations, server + frontend tests, build, policy, secret and
#      dependency scans) didn't pass on GitHub — that run is the release's
#      test evidence;
#   2. clones that commit into a clean temporary directory (never the working
#      tree) and builds the api, migrator and postgres images once, tagged
#      caspira-<name>:<commit12>, with version and revision labels;
#   3. checks the api image: non-root, no .env, no dev tooling, no tests;
#   4. runs the repository policy check, secret scan and dependency audits in a
#      pinned Node container, and Trivy on each image (plus CycloneDX SBOMs);
#   5. writes releases/<release-id>/manifest.json with the image IDs and the
#      scan reports (register it with scripts/register-release.sh).
# Deploy it only through an approved deployment (scripts/deploy.sh).
set -euo pipefail
COMMIT_REF="${1:?usage: build-local.sh <commit> <staging|production>}"
ENVIRONMENT="${2:?usage: build-local.sh <commit> <staging|production>}"
cd "$(dirname "$0")/.."
source scripts/lib.sh
[[ "$IMAGE_SOURCE" == "local" ]] || { echo "IMAGE_SOURCE is '$IMAGE_SOURCE': build on the build machine with build-release.sh instead." >&2; exit 1; }
for t in docker git jq curl sha256sum; do command -v "$t" >/dev/null || { echo "Missing tool: $t (apt-get install -y $t)" >&2; exit 1; }; done

TRIVY_IMAGE="aquasec/trivy:0.74.0@sha256:62b1e65e8869bc4b4c6aa4fa2b21595256c7c2f6018a9d9ad61caf87187c1969"
NODE_TOOLS_IMAGE="node:22.20.0-bookworm@sha256:915acd9e9b885ead0c620e27e37c81b74c226e0e1c8177f37a60217b6eabb0d7"
GH_REPO="$(env_value GITHUB_REPOSITORY)"; GH_REPO="${GH_REPO:-SpiderMonkeyxOxO-pixie/CaspiraCRM}"
REPO_ROOT="$(git rev-parse --show-toplevel)"

step() { printf '\n== %s\n' "$*"; }

step "Resolve the commit"
git -C "$REPO_ROOT" fetch --quiet origin
COMMIT="$(git -C "$REPO_ROOT" rev-parse --verify "${COMMIT_REF}^{commit}")"
SHORT="${COMMIT:0:12}"
git -C "$REPO_ROOT" merge-base --is-ancestor "$COMMIT" origin/main \
  || { echo "Commit $SHORT is not on origin/main. Only pushed main-branch commits are released." >&2; exit 1; }
echo "commit $COMMIT"

step "CI evidence (GitHub Actions: checks)"
CURL_AUTH=()
[[ -r /etc/caspira/github-token ]] && CURL_AUTH=(-H "Authorization: Bearer $(cat /etc/caspira/github-token)")
RUNS="$(curl -fsS --max-time 30 "${CURL_AUTH[@]}" -H 'Accept: application/vnd.github+json' \
  "https://api.github.com/repos/$GH_REPO/commits/$COMMIT/check-runs?per_page=100")" \
  || { echo "Could not read CI results from GitHub." >&2; exit 1; }
read -r CI_STATUS CI_CONCLUSION CI_URL < <(jq -r '[.check_runs[] | select(.name=="checks")] | sort_by(.completed_at // "") | last // {} | "\(.status // "missing") \(.conclusion // "none") \(.html_url // "-")"' <<<"$RUNS")
[[ "$CI_STATUS" == "completed" && "$CI_CONCLUSION" == "success" ]] \
  || { echo "CI 'checks' for $SHORT is $CI_STATUS/$CI_CONCLUSION ($CI_URL). Only commits whose CI passed are released." >&2; exit 1; }
echo "passed: $CI_URL"

WORK="$(mktemp -d /var/tmp/caspira-build.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "$WORK/reports" "$WORK/scan"

step "Clean checkout of $SHORT"
git clone --quiet --no-checkout "$REPO_ROOT" "$WORK/src"
git -C "$WORK/src" checkout --quiet --detach "$COMMIT"
VERSION="$(jq -r .version "$WORK/src/server/package.json")+$SHORT"
BUILD_DATE="$(date -u +%FT%TZ)"

step "Build images (once; the same images are deployed)"
docker build --quiet --target runtime -t "caspira-api:$SHORT" \
  --build-arg VERSION="$VERSION" --build-arg REVISION="$COMMIT" --build-arg BUILD_DATE="$BUILD_DATE" "$WORK/src/server" >/dev/null
docker build --quiet --target migrator -t "caspira-migrator:$SHORT" "$WORK/src/server" >/dev/null
docker build --quiet -t "caspira-postgres:$SHORT" \
  --build-arg VERSION="$VERSION" --build-arg REVISION="$COMMIT" "$WORK/src/deploy/production/postgres" >/dev/null
image_id() { docker image inspect -f '{{.Id}}' "caspira-$1:$SHORT" | sed 's/^sha256://'; }
for n in api migrator postgres; do echo "caspira-$n:$SHORT  sha256:$(image_id "$n")"; done

step "Image checks"
[[ "$(docker image inspect -f '{{.Config.User}}' "caspira-api:$SHORT")" == "node" ]] || { echo "api image doesn't run as the node user" >&2; exit 1; }
[[ "$(docker image inspect -f '{{index .Config.Labels "org.opencontainers.image.revision"}}' "caspira-api:$SHORT")" == "$COMMIT" ]] || { echo "api image revision label mismatch" >&2; exit 1; }
docker run --rm --network none --entrypoint sh "caspira-api:$SHORT" -c \
  'test ! -e /app/.env && test ! -d /app/node_modules/vitest && test ! -d /app/node_modules/supertest && test ! -e /usr/local/bin/npm && ! find /app/src -name "*.test.js" | grep -q .' \
  || { echo "api image contains .env, dev tooling, a package manager or tests" >&2; exit 1; }
echo "non-root, labelled, no .env / dev tooling / tests"

step "Repository policy, secret scan and dependency audits"
docker run --rm -v "$WORK/src:/repo" -v "$WORK/reports:/reports" -w /repo/server "$NODE_TOOLS_IMAGE" sh -ec '
  git config --global --add safe.directory /repo
  npm ci --ignore-scripts --no-audit --no-fund --loglevel=error >/dev/null
  node scripts/security/policyCheck.js --json > /reports/policy.json || true
  node scripts/security/secretScan.js --json > /reports/secrets.json || true
  node scripts/security/dependencyScan.js audit . > /reports/audit-server.json
  node scripts/security/dependencyScan.js audit .. > /reports/audit-web.json
  node scripts/security/dependencyScan.js sbom . /reports/sbom-server-deps.cdx.json > /dev/null'

step "Container scans (Trivy) and image SBOMs"
for n in api migrator postgres; do
  docker save -o "$WORK/scan/$n.tar" "caspira-$n:$SHORT"
  docker run --rm -v "$WORK/scan:/scan" -v caspira-trivy-cache:/root/.cache "$TRIVY_IMAGE" image --quiet \
    --input "/scan/$n.tar" --scanners vuln --ignore-unfixed --format json --output "/scan/$n.trivy.json"
  docker run --rm -v "$WORK/scan:/scan" -v caspira-trivy-cache:/root/.cache "$TRIVY_IMAGE" image --quiet \
    --input "/scan/$n.tar" --format cyclonedx --output "/scan/$n.cdx.json"
  jq --arg t "container:$n" '{scanner:"trivy", target:$t, category:"container",
      findings:[.Results[]?.Vulnerabilities[]? | {id:.VulnerabilityID, category:"container", title:((.Title // .VulnerabilityID)[0:250]),
        severity:(.Severity|ascii_downcase), component:.PkgName, installedVersion:.InstalledVersion, fixedVersion:(.FixedVersion // null)}]}' \
    "$WORK/scan/$n.trivy.json" > "$WORK/reports/container-$n.json"
  cp "$WORK/scan/$n.cdx.json" "$WORK/reports/sbom-$n.cdx.json"
  rm -f "$WORK/scan/$n.tar"
done

step "Summary (Critical and High findings block deployment unless fixed or excepted)"
for r in "$WORK"/reports/{policy,secrets,audit-server,audit-web,container-api,container-migrator,container-postgres}.json; do
  jq -r --arg f "$(basename "$r" .json)" '"\($f): " + ([.findings[]?.severity | ascii_downcase] | group_by(.) | map("\(.[0]) \(length)") | join(", ") | if . == "" then "no findings" else . end)' "$r"
done

step "Release manifest"
RELEASE_ID="$(date -u +%Y.%m.%d)-$SHORT"
OUT="releases/$RELEASE_ID"
mkdir -p "$OUT"
cp "$WORK"/reports/*.json "$OUT/"
# Every folder with a migration.sql (Prisma's rule), including 0001_baseline.
MIGRATIONS="$(for d in "$WORK"/src/server/prisma/migrations/*/; do [[ -f "$d/migration.sql" ]] && basename "$d"; done | sort | jq -R . | jq -s .)"
SBOMS="$(for n in api migrator postgres; do jq -n --arg c "$n" --arg s "$(sha256sum "$OUT/sbom-$n.cdx.json" | cut -d' ' -f1)" --argjson k "$(jq '.components | length' "$OUT/sbom-$n.cdx.json")" \
  '{component:$c, format:"CycloneDX", specVersion:"1.6", componentCount:$k, sha256:$s}'; done | jq -s .)"
# Scan reports can be large: pass them to jq as a file, not an argument.
jq -s . "$OUT"/{policy,secrets,audit-server,audit-web,container-api,container-migrator,container-postgres}.json > "$WORK/scans.json"
jq -n --arg id "$RELEASE_ID" --arg v "$VERSION" --arg c "$COMMIT" --arg built "$BUILD_DATE" --arg ci "$CI_URL" \
  --arg api "caspira-api@sha256:$(image_id api)" --arg mig "caspira-migrator@sha256:$(image_id migrator)" --arg pg "caspira-postgres@sha256:$(image_id postgres)" \
  --argjson migrations "$MIGRATIONS" --argjson sboms "$SBOMS" --slurpfile scans "$WORK/scans.json" \
  --arg destructive "${RELEASE_DESTRUCTIVE:-false}" --arg compatible "${RELEASE_COMPATIBLE_WITH:-}" --arg notes "${RELEASE_NOTES:-}" \
  '{releaseId:$id, version:$v, gitCommit:$c, buildTimestamp:$built,
    images:{api:$api, migrator:$mig, postgres:$pg},
    migrationVersion:($migrations | last), migrations:$migrations, configSchemaVersion:1,
    tests:{lint:"passed", type_check:"not_applicable", unit_tests:"passed", integration_tests:"passed", authorization_tests:"passed",
           tenant_isolation_tests:"passed", migration_tests:"passed", build:"passed", evidence:$ci},
    testResultRef:$ci, sboms:$sboms, scans:$scans[0],
    destructiveMigration:($destructive == "true"), rollbackCompatibleWith:($compatible | split(",") | map(select(. != ""))),
    releaseNotes:(if $notes == "" then null else $notes end), builtOn:"local", imageSource:"local"}' > "$OUT/manifest.json"
restrict_release_file "$OUT"/*.json
echo "Release $RELEASE_ID written to deploy/production/$OUT/manifest.json"
echo "Next: register it (scripts/register-release.sh $RELEASE_ID $ENVIRONMENT), then plan and approve a deployment."
