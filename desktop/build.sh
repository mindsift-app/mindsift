#!/bin/sh
# Builds the desktop app in containers: the frontend once, then the shell for Linux (GTK4 + WebKitGTK 6.0,
# needs cgo) and Windows (WebView2, no cgo, with icon and version resources from desktop/packaging, see
# tools/mksyso), and the licenses of the third-party software in both. Output: desktop/out/.
#   desktop/build.sh            frontend, Linux, Windows and licenses
#   desktop/build.sh linux      only Linux (plus the frontend)
#   desktop/build.sh windows    only Windows (plus the frontend)
#   desktop/build.sh frontend   only the frontend (frontend/dist)
#   desktop/build.sh licenses   only desktop/out/THIRD_PARTY_LICENSES.txt (plus the frontend, whose npm
#                               packages are part of it)
#   SKIP_FRONTEND=1 desktop/build.sh      reuse frontend/dist and desktop/out/third-party-npm.txt
#   APP_VERSION=v1.2.0 desktop/build.sh   the version the app knows itself as (a release's tag, set by
#                               ci/release-desktop.sh); default v<frontend/package.json version>-dev, like
#                               the server images of branches
# Locally this runs with podman and bind mounts. CI (ci/release-desktop.sh, run by
# .github/workflows/release.yaml and .gitea/workflows/desktop.yaml) sets ENGINE=docker COPY_MODE=1: the job
# may run in a container itself, where the paths of the Docker host differ from ours, so the sources are
# copied into the build container and the result copied back.
set -eu
cd "$(dirname "$0")/.."
ROOT="$PWD"
TARGET="${1:-all}"
ENGINE="${ENGINE:-podman}"
COPY_MODE="${COPY_MODE:-0}"
# NODE_IMAGE and GO_DESKTOP_IMAGE (Debian, for GTK 4 / WebKitGTK 6.0 and cgo)
. ci/images.env
GO_IMAGE="$GO_DESKTOP_IMAGE"
APP_VERSION="$(sh ci/version.sh app "${APP_VERSION:-}")"
case "$TARGET" in
  all|linux|windows|frontend|licenses) ;;
  *) echo "unknown target '$TARGET' (all, linux, windows, frontend, licenses)" >&2; exit 1 ;;
esac

$ENGINE volume create mindsift-desktop-gomod >/dev/null 2>&1 || true

# The Go modules exactly as go.mod and go.sum name them: downloaded and checked against go.sum, and every
# go command after it fails instead of changing go.mod (no go mod tidy, which could pull other versions)
GO_MODULES="go mod download && export GOFLAGS=-mod=readonly"

# run_in (desktop/packaging/lib.sh)
. desktop/packaging/lib.sh
# build IMAGE WORKDIR OUTDIRS COMMAND: runs COMMAND in IMAGE with the repository at /src and WORKDIR
# (relative to the repository) as working directory; what COMMAND leaves in OUTDIRS (relative to the
# repository, separated by spaces) ends up in the same folders of $ROOT.
build() { run_in "$1" "$ROOT" /src "$2" "$3" "$4" -v mindsift-desktop-gomod:/go/pkg/mod; }

mkdir -p desktop/out
if [ "${SKIP_FRONTEND:-0}" != "1" ]; then
  # The npm part of the license file comes from the node_modules the frontend is built from.
  # --ignore-scripts: no package's install script runs; the only one in package-lock.json is fsevents
  # (macOS only), esbuild finds its binary in its platform package without one.
  build "$NODE_IMAGE" frontend "frontend/dist desktop/out" \
    "npm ci --ignore-scripts --no-audit --no-fund >/dev/null && APP_VERSION=$APP_VERSION npm run build >/dev/null && \
    mkdir -p ../desktop/out && node ../ci/third-party-licenses-npm.mjs . > ../desktop/out/third-party-npm.txt"
fi
[ "$TARGET" = frontend ] && exit 0
rm -rf desktop/dist && cp -r frontend/dist desktop/dist

if [ "$TARGET" = all ] || [ "$TARGET" = linux ]; then
  build "$GO_IMAGE" desktop desktop/out "apt-get update -qq >/dev/null && apt-get install -y -qq --no-install-recommends libgtk-4-dev libwebkitgtk-6.0-dev pkg-config >/dev/null && \
    $GO_MODULES && CGO_ENABLED=1 go build -trimpath -ldflags '-s -w -X main.version=$APP_VERSION' -o out/mindsift-desktop-linux-amd64 ."
fi
if [ "$TARGET" = all ] || [ "$TARGET" = windows ]; then
  # The .syso (icon, version information, manifest) is linked in by go build and removed again afterwards
  build "$GO_IMAGE" desktop desktop/out "$GO_MODULES && go run ./tools/mksyso -ico packaging/windows/app.ico -version ${APP_VERSION#v} -out resource_windows_amd64.syso && \
    CGO_ENABLED=0 GOOS=windows GOARCH=amd64 go build -trimpath -ldflags '-s -w -H windowsgui -X main.version=$APP_VERSION' -o out/mindsift-desktop-windows-amd64.exe . ; status=\$?; rm -f resource_windows_amd64.syso; exit \$status"
fi
if [ "$TARGET" = all ] || [ "$TARGET" = licenses ]; then
  # One file for both platforms: the frontend's npm packages, the Go modules either binary imports (Wails
  # and its dependencies, those of MindSift's server packages) and Go's standard library
  [ -s desktop/out/third-party-npm.txt ] || { echo "desktop/out/third-party-npm.txt is missing (run without SKIP_FRONTEND=1)" >&2; exit 1; }
  build "$GO_IMAGE" desktop desktop/out "$GO_MODULES && \
    SUBJECT='The desktop app' GO_PLATFORMS='linux/amd64 windows/amd64' \
    bash ../ci/third-party-licenses.sh out/third-party-npm.txt . > out/THIRD_PARTY_LICENSES.txt.tmp && \
    mv out/THIRD_PARTY_LICENSES.txt.tmp out/THIRD_PARTY_LICENSES.txt"
fi
# The placeholder page goes back, so the checkout stays clean
rm -rf desktop/dist && mkdir desktop/dist && cp cmd/server/dist/index.html desktop/dist/
ls -la desktop/out
