#!/usr/bin/env bash
# Shared helpers for the deployment scripts (Backend Phase 13). Sourced, not run.
# Sets: ENVIRONMENT, ENV_FILE, RELEASE_ENV, LAYERS, IMAGE_SOURCE, DC (array).
# Requires the caller to be in deploy/production and ENVIRONMENT to be set.

case "${ENVIRONMENT:-}" in staging|production) ;; *) echo "environment must be staging or production" >&2; exit 2 ;; esac
ENV_FILE="env/$ENVIRONMENT.env"
RELEASE_ENV="env/$ENVIRONMENT.release.env"
[[ -r "$ENV_FILE" ]] || { echo "Missing $ENV_FILE (copy the matching env/*.env.example and fill it in)." >&2; exit 1; }

# env_value <KEY> — a value from the environment file (quotes stripped).
env_value() { grep -E "^$1=" "$ENV_FILE" | tail -1 | cut -d= -f2- | sed -e 's/^"//' -e 's/"$//'; }

LAYERS="$(env_value COMPOSE_LAYERS)"; LAYERS="${LAYERS:-compose.yaml compose.edge.yaml}"
IMAGE_SOURCE="$(env_value IMAGE_SOURCE)"; IMAGE_SOURCE="${IMAGE_SOURCE:-registry}"
# dc_refresh — (re)builds DC; call again after writing the release env file.
dc_refresh() {
  DC=(docker compose --project-directory . --env-file "$ENV_FILE")
  [[ -r "$RELEASE_ENV" ]] && DC+=(--env-file "$RELEASE_ENV")
  local f
  for f in $LAYERS; do
    [[ "$f" =~ ^compose(\.[a-z0-9-]+)?\.yaml$ && -r "$f" ]] || { echo "COMPOSE_LAYERS lists an unknown file: $f" >&2; exit 1; }
    DC+=(-f "$f")
  done
}
dc_refresh
uses_layer() { [[ " $LAYERS " == *" $1 "* ]]; }

# resolve_image <name> <ref> <release-id> — prints the image reference Compose
# should use for an approved release image, after verifying it:
#   registry: <repo>@sha256:<digest> is pulled and its digest checked;
#   local:    caspira-<name>@sha256:<image id> must already exist on this host
#             (scripts/build-local.sh); it's tagged caspira-<name>:<release-id>
#             and that tag's image ID is checked. Nothing is pulled.
resolve_image() {
  local name="$1" ref="$2" release="$3"
  [[ "$ref" =~ @sha256:([a-f0-9]{64})$ ]] || { echo "Image $name is not pinned by digest or image ID." >&2; return 1; }
  local hash="${BASH_REMATCH[1]}"
  if [[ "$IMAGE_SOURCE" == "local" ]]; then
    docker image inspect "sha256:$hash" >/dev/null 2>&1 || { echo "Image $name (sha256:${hash:0:12}) is not on this host. Build it with scripts/build-local.sh." >&2; return 1; }
    local tag="caspira-$name:$release"
    docker tag "sha256:$hash" "$tag"
    [[ "$(docker image inspect -f '{{.Id}}' "$tag")" == "sha256:$hash" ]] || { echo "Tag $tag does not match the approved image ID." >&2; return 1; }
    echo "$tag"
  else
    docker pull --quiet "$ref" >/dev/null || { echo "Could not pull $name." >&2; return 1; }
    docker image inspect --format '{{join .RepoDigests "\n"}}' "$ref" | grep -q "sha256:$hash" || { echo "Pulled image $name does not match its digest." >&2; return 1; }
    echo "$ref"
  fi
}
