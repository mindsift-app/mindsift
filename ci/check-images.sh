#!/bin/sh
# Checks that the container images are pinned in one place, ci/images.env (run by ci/local-checks.sh; no
# containers, no network):
#   - the Dockerfile's FROM lines, which cannot read the file, name its NODE_IMAGE, GO_IMAGE and
#     ALPINE_IMAGE, and no other image
#   - no script or workflow names a pinned image of its own instead of reading ci/images.env
# Usage: ci/check-images.sh [<repository root>]
set -eu
ROOT="${1:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
. ci/images.env
status=0
fail() { echo "check-images: $*" >&2; status=1; }

# The images of the FROM lines, with Docker Hub's default registry spelled out like in images.env
from="$(sed -n 's/^FROM \(--platform=[^ ]* \)\{0,1\}\([^ ]*\).*/\2/p' Dockerfile | while read -r image; do
  case "$image" in
    */*/*) echo "$image" ;;
    */*) echo "docker.io/$image" ;;
    *) echo "docker.io/library/$image" ;;
  esac
done)"
want=""
for name in NODE_IMAGE GO_IMAGE ALPINE_IMAGE; do
  eval "want=\$$name"
  printf '%s\n' "$from" | grep -qxF "$want" || fail "the Dockerfile has no FROM $want ($name in ci/images.env)"
done
for image in $from; do
  case "$image" in
    "$NODE_IMAGE"|"$GO_IMAGE"|"$ALPINE_IMAGE") ;;
    *) fail "the Dockerfile's FROM $image is not NODE_IMAGE, GO_IMAGE or ALPINE_IMAGE of ci/images.env" ;;
  esac
done

# A registry, a path and a tag: an image named in a script instead of ci/images.env
own="$(find ci desktop e2e .github .gitea -path '*/node_modules' -prune -o -type f \
    \( -name '*.sh' -o -name '*.yaml' -o -name '*.yml' \) \
    -exec grep -nE '(docker\.io|mcr\.microsoft\.com|ghcr\.io|quay\.io)/[a-z0-9._-]+(/[a-z0-9._-]+)*:[A-Za-z0-9]' /dev/null {} + \
    2>/dev/null || true)"
[ -z "$own" ] || fail "images pinned outside ci/images.env (read them from there):
$own"
[ "$status" = 0 ] && echo "check-images: ok"
exit "$status"
