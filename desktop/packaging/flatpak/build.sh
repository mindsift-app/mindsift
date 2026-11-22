#!/bin/sh
# Builds the Flatpak bundle of the desktop app in containers: desktop/out/mindsift-desktop-linux-amd64.flatpak
#   desktop/packaging/flatpak/build.sh                  frontend, vendored Go modules, flatpak-builder
#   SKIP_FRONTEND=1 desktop/packaging/flatpak/build.sh  reuse frontend/dist
#   APP_VERSION=v1.2.0 …                                the app's version, as for desktop/build.sh
# Install it with: flatpak install --user mindsift-desktop-linux-amd64.flatpak (the GNOME runtime comes
# from Flathub).
#
# 1. The frontend and the license file (node and golang, desktop/build.sh licenses); the frontend only
#    unless SKIP_FRONTEND=1.
# 2. A staged source tree in desktop/out/flatpak/src: the repository's files (git ls-files), the
#    built frontend in desktop/dist, THIRD_PARTY_LICENSES.txt, the version in desktop/app-version, a
#    release entry for that version in the metainfo (when CHANGELOG.md has its section), and the Go
#    modules vendored (golang container, the only step that downloads modules), so flatpak-builder builds
#    offline, as Flathub requires.
# 3. flatpak-builder in a Debian container with SYS_ADMIN (bubblewrap needs its own namespaces), with the
#    runtimes cached in the podman/docker volume mindsift-flatpak; the binary is built inside the GNOME
#    SDK with the Go extension, so glibc, GTK and WebKitGTK are the runtime's.
# Like desktop/build.sh it runs with podman and bind mounts locally; the CI workflow sets ENGINE=docker
# COPY_MODE=1 and the sources are copied into the containers instead.
set -eu
cd "$(dirname "$0")/../../.."
ROOT="$PWD"
ENGINE="${ENGINE:-podman}"
COPY_MODE="${COPY_MODE:-0}"
GO_IMAGE=docker.io/library/golang:1.27.4-trixie
FLATPAK_IMAGE=docker.io/library/debian:trixie-20261027-slim
APP_ID=app.mindsift.MindSift
# GNOME 51 (released 2026-09) is a branch: its security rebuilds come along, as they do for every user of
# the runtime. The Go extension is pinned to a commit, so a new Go only comes in deliberately (14-day
# rule): f9e1ac9f… is Go 1.27.3, published on Flathub 2026-10-21.
GNOME_BRANCH=51
GO_EXT_BRANCH=26.08
GO_EXT_COMMIT=f9e1ac9f0c6f95e0df3a4a972a9b7d008715b336c9558098678045a24b81c102
STAGE=desktop/out/flatpak
OUT=desktop/out/mindsift-desktop-linux-amd64.flatpak
APP_VERSION="${APP_VERSION:-v$(sed -n 's/.*"version": "\(.*\)".*/\1/p' frontend/package.json | head -1)-dev}"

# The frontend (unless SKIP_FRONTEND=1, passed on) and desktop/out/THIRD_PARTY_LICENSES.txt
ENGINE="$ENGINE" COPY_MODE="$COPY_MODE" APP_VERSION="$APP_VERSION" desktop/build.sh licenses >/dev/null
[ -f frontend/dist/index.html ] || { echo "frontend/dist is missing (run without SKIP_FRONTEND=1)" >&2; exit 1; }

# Stage the sources
rm -rf "$STAGE" && mkdir -p "$STAGE/src"
# The working tree's files that git knows or would add (ignored ones such as node_modules, local data or
# build output stay out), deleted ones skipped; the screenshots are not needed.
git ls-files -z --cached --others --exclude-standard -- . ':!screenshots' \
  | xargs -0 sh -c 'for f; do [ -e "$f" ] && printf "%s\0" "$f"; done' sh \
  | tar -C "$ROOT" --null -T - -cf - | tar -C "$STAGE/src" -xf -
rm -rf "$STAGE/src/desktop/dist" && cp -r frontend/dist "$STAGE/src/desktop/dist"
cp desktop/out/THIRD_PARTY_LICENSES.txt "$STAGE/src/THIRD_PARTY_LICENSES.txt"
printf '%s\n' "$APP_VERSION" > "$STAGE/src/desktop/app-version"
cp desktop/packaging/flatpak/$APP_ID.yml "$STAGE/"

# A release of the CHANGELOG ("## [1.2.0] - 2026-12-01") gets its entry at the top of the metainfo's
# <releases>, unless it is there already; other builds (…-dev) add none
METAINFO="$STAGE/src/desktop/packaging/flatpak/$APP_ID.metainfo.xml"
release="${APP_VERSION#v}"
date="$(sed -n "s/^## \[$(printf '%s' "$release" | sed 's/[.]/\\./g')\] - \([0-9-]*\).*/\1/p" CHANGELOG.md | head -1)"
if [ -n "$date" ] && ! grep -q "<release version=\"$release\"" "$METAINFO"; then
  type=stable
  case "$release" in *-*) type=development ;; esac
  entry="    <release version=\"$release\" date=\"$date\" type=\"$type\">\\
      <url type=\"details\">https://github.com/mindsift-app/mindsift/releases/tag/v$release</url>\\
    </release>"
  sed -i "s|^\( *\)<releases>\$|&\\
$entry|" "$METAINFO"
  grep -q "<release version=\"$release\"" "$METAINFO" || { echo "could not add release $release to the metainfo" >&2; exit 1; }
fi

$ENGINE volume create mindsift-desktop-gomod >/dev/null 2>&1 || true
$ENGINE volume create mindsift-flatpak >/dev/null 2>&1 || true

# run_in IMAGE VOLUME WORKDIR CMD [privileged]: CMD in IMAGE with $STAGE at /stage (WORKDIR below it) and
# the cache VOLUME mounted; in COPY_MODE the stage is copied in and back out.
run_in() {
  image="$1"; volume="$2"; workdir="$3"; cmd="$4"; priv="${5:-}"
  if [ "$COPY_MODE" != "1" ]; then
    $ENGINE run --rm $priv -v "$ROOT/$STAGE":/stage:Z -v "$volume" -w "/stage/$workdir" "$image" sh -c "$cmd"
    return
  fi
  id="$($ENGINE create $priv -v "$volume" -w "/stage/$workdir" "$image" sh -c "$cmd")"
  status=0
  $ENGINE cp "$ROOT/$STAGE/." "$id:/stage" && $ENGINE start -a "$id" || status=$?
  if [ "$status" = 0 ]; then
    rm -rf "${ROOT:?}/$STAGE" && mkdir -p "$ROOT/$STAGE"
    $ENGINE cp "$id:/stage/." "$ROOT/$STAGE" || status=$?
  fi
  $ENGINE rm -f "$id" >/dev/null
  return "$status"
}

# Vendor the Go modules (desktop/go.mod replaces the main module with ../, which is vendored as well)
run_in "$GO_IMAGE" mindsift-desktop-gomod:/go/pkg/mod src/desktop "go mod download && go mod vendor"

# Build the app and the bundle. flatpak-builder runs every step in bubblewrap, which needs namespaces and
# mounts of its own (proc too): instead of --privileged only what that takes, SYS_ADMIN, NET_ADMIN (the
# loopback of a sandbox without network, e.g. the icon check of the export), no seccomp and AppArmor
# profile, and /proc without the engine's masked paths (bwrap cannot mount proc over them; Docker calls
# this systempaths=unconfined, podman unmask=ALL). No devices, no other capabilities.
SANDBOX_OPTS="--cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined"
case "$ENGINE" in
  *podman*) SANDBOX_OPTS="$SANDBOX_OPTS --security-opt unmask=ALL" ;;
  *) SANDBOX_OPTS="$SANDBOX_OPTS --security-opt systempaths=unconfined" ;;
esac
# (librsvg2-common: flatpak-builder runs appstreamcli compose in this container, which reads the SVG icon)
run_in "$FLATPAK_IMAGE" mindsift-flatpak:/var/lib/flatpak . "set -e
  apt-get update -qq >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends flatpak flatpak-builder librsvg2-common ca-certificates >/dev/null
  flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  for ref in org.gnome.Platform//$GNOME_BRANCH org.gnome.Sdk//$GNOME_BRANCH org.freedesktop.Sdk.Extension.golang//$GO_EXT_BRANCH; do
    flatpak info \$ref >/dev/null 2>&1 || flatpak install -y --noninteractive flathub \$ref
  done
  flatpak update -y --noninteractive org.gnome.Platform//$GNOME_BRANCH org.gnome.Sdk//$GNOME_BRANCH
  flatpak update -y --noninteractive --commit=$GO_EXT_COMMIT org.freedesktop.Sdk.Extension.golang//$GO_EXT_BRANCH
  flatpak-builder --state-dir=/tmp/state --disable-rofiles-fuse --disable-download --force-clean --repo=/tmp/repo /tmp/build $APP_ID.yml
  flatpak build-bundle /tmp/repo mindsift.flatpak $APP_ID --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo
  rm -rf src" "$SANDBOX_OPTS"

mv "$STAGE/mindsift.flatpak" "$OUT"
rm -rf "$STAGE"
ls -la "$OUT"
