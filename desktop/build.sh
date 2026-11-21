#!/bin/sh
# Builds the desktop spike in containers (podman): the frontend once, then the shell for Linux
# (GTK4 + WebKitGTK 6.0, needs cgo) and Windows (WebView2, no cgo). Output: desktop/out/.
#   desktop/build.sh            both
#   desktop/build.sh linux      only Linux
#   desktop/build.sh windows    only Windows
#   SKIP_FRONTEND=1 desktop/build.sh   reuse frontend/dist
set -eu
cd "$(dirname "$0")/.."
ROOT="$PWD"
TARGET="${1:-all}"
NODE_IMAGE=docker.io/library/node:26.13.1-alpine
GO_IMAGE=docker.io/library/golang:1.27.4-trixie
VERSION="$(sed -n 's/.*"version": "\(.*\)".*/\1/p' frontend/package.json | head -1)-desktop-spike"

if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  podman run --rm -v "$ROOT/frontend":/app:Z -w /app "$NODE_IMAGE" \
    sh -c "npm ci --no-audit --no-fund >/dev/null && APP_VERSION=v$VERSION npm run build >/dev/null"
fi
rm -rf desktop/dist && cp -r frontend/dist desktop/dist
mkdir -p desktop/out

podman volume create mindsift-desktop-gomod >/dev/null 2>&1 || true
run_go() {
  podman run --rm -v "$ROOT":/src:Z -v mindsift-desktop-gomod:/go/pkg/mod -w /src/desktop "$GO_IMAGE" sh -c "$1"
}

if [ "$TARGET" = all ] || [ "$TARGET" = linux ]; then
  run_go "apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends libgtk-4-dev libwebkitgtk-6.0-dev pkg-config >/dev/null && \
    go mod tidy && CGO_ENABLED=1 go build -trimpath -ldflags '-s -w -X main.version=v$VERSION' -o out/mindsift-desktop-linux-amd64 ."
fi
if [ "$TARGET" = all ] || [ "$TARGET" = windows ]; then
  run_go "go mod tidy && CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags '-s -w -H windowsgui -X main.version=v$VERSION' -o out/mindsift-desktop-windows-amd64.exe ."
fi
# The placeholder page goes back, so the checkout stays clean
rm -rf desktop/dist && mkdir desktop/dist && cp cmd/server/dist/index.html desktop/dist/
ls -la desktop/out
