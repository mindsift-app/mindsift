#!/bin/sh
# Builds the desktop spike in containers: the frontend once, then the shell for Linux
# (GTK4 + WebKitGTK 6.0, needs cgo) and Windows (WebView2, no cgo, with icon and version resources from
# desktop/packaging, see tools/mksyso). Output: desktop/out/.
#   desktop/build.sh            both
#   desktop/build.sh linux      only Linux
#   desktop/build.sh windows    only Windows
#   SKIP_FRONTEND=1 desktop/build.sh   reuse frontend/dist
# Locally this runs with podman and bind mounts. The CI workflow (.gitea/workflows/desktop-spike.yaml)
# sets ENGINE=docker COPY_MODE=1: the job may run in a container itself, where the paths of the Docker
# host differ from ours, so the sources are copied into the build container and the result copied back.
set -eu
cd "$(dirname "$0")/.."
ROOT="$PWD"
TARGET="${1:-all}"
ENGINE="${ENGINE:-podman}"
COPY_MODE="${COPY_MODE:-0}"
NODE_IMAGE=docker.io/library/node:26.13.1-alpine
GO_IMAGE=docker.io/library/golang:1.27.4-trixie
VERSION="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' frontend/package.json | head -1)-desktop-spike"

$ENGINE volume create mindsift-desktop-gomod >/dev/null 2>&1 || true

# run_in IMAGE WORKDIR OUTDIR COMMAND: runs COMMAND in IMAGE with the repository at /src and WORKDIR
# (relative to the repository) as working directory; what COMMAND leaves in OUTDIR ends up in $ROOT/OUTDIR.
run_in() {
  image="$1"; workdir="$2"; outdir="$3"; cmd="$4"
  if [ "$COPY_MODE" != "1" ]; then
    $ENGINE run --rm -v "$ROOT":/src:Z -v mindsift-desktop-gomod:/go/pkg/mod -w "/src/$workdir" "$image" sh -c "$cmd"
    return
  fi
  id="$($ENGINE create -v mindsift-desktop-gomod:/go/pkg/mod -w "/src/$workdir" "$image" sh -c "$cmd")"
  status=0
  $ENGINE cp "$ROOT/." "$id:/src" && $ENGINE start -a "$id" || status=$?
  if [ "$status" = 0 ]; then
    mkdir -p "$ROOT/$outdir"
    $ENGINE cp "$id:/src/$outdir/." "$ROOT/$outdir" || status=$?
  fi
  $ENGINE rm -f "$id" >/dev/null
  return "$status"
}

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  run_in "$NODE_IMAGE" frontend frontend/dist \
    "npm ci --no-audit --no-fund >/dev/null && APP_VERSION=v$VERSION npm run build >/dev/null"
fi
rm -rf desktop/dist && cp -r frontend/dist desktop/dist
mkdir -p desktop/out

if [ "$TARGET" = all ] || [ "$TARGET" = linux ]; then
  run_in "$GO_IMAGE" desktop desktop/out "apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends libgtk-4-dev libwebkitgtk-6.0-dev pkg-config >/dev/null && \
    go mod tidy && CGO_ENABLED=1 go build -trimpath -ldflags '-s -w -X main.version=v$VERSION' -o out/mindsift-desktop-linux-amd64 ."
fi
if [ "$TARGET" = all ] || [ "$TARGET" = windows ]; then
  # The .syso (icon, version information, manifest) is linked in by go build and removed again afterwards
  run_in "$GO_IMAGE" desktop desktop/out "go mod tidy && go run ./tools/mksyso -ico packaging/windows/app.ico -version $VERSION -out resource_windows_amd64.syso && \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags '-s -w -H windowsgui -X main.version=v$VERSION' -o out/mindsift-desktop-windows-amd64.exe . ; status=\$?; rm -f resource_windows_amd64.syso; exit \$status"
fi
# The placeholder page goes back, so the checkout stays clean
rm -rf desktop/dist && mkdir desktop/dist && cp cmd/server/dist/index.html desktop/dist/
ls -la desktop/out
