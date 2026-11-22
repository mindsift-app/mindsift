#!/bin/sh
# Builds the Windows installer of the desktop app from the exe desktop/build.sh made, with NSIS in a Debian
# container (no Windows needed): desktop/out/mindsift-desktop-windows-amd64-setup.exe
#   desktop/packaging/windows/build.sh                  needs desktop/out/mindsift-desktop-windows-amd64.exe
#                                                       and desktop/out/THIRD_PARTY_LICENSES.txt
#   APP_VERSION=v1.2.0 …                                the version, as for desktop/build.sh (it must be the
#                                                       exe's: ci/release-desktop.sh sets both)
# What the installer does is described in mindsift.nsi. makensis runs with -WX, so a warning fails the
# build. Like desktop/build.sh it runs with podman and bind mounts locally; CI sets ENGINE=docker
# COPY_MODE=1 and the files are copied into the container instead.
set -eu
cd "$(dirname "$0")/../../.."
ROOT="$PWD"
ENGINE="${ENGINE:-podman}"
COPY_MODE="${COPY_MODE:-0}"
# The image of the Flatpak build; NSIS is Debian trixie's (3.11)
NSIS_IMAGE=docker.io/library/debian:trixie-20261027-slim
APP_VERSION="${APP_VERSION:-v$(sed -n 's/.*"version": "\(.*\)".*/\1/p' frontend/package.json | head -1)-dev}"
VERSION="${APP_VERSION#v}"
NUMERIC="$(echo "$VERSION" | sed -n 's/^\([0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\).*/\1/p')"
[ -n "$NUMERIC" ] || { echo "APP_VERSION must look like v1.2.3 or v1.2.3-suffix, not '$APP_VERSION'" >&2; exit 1; }
OUT=desktop/out
for f in mindsift-desktop-windows-amd64.exe THIRD_PARTY_LICENSES.txt; do
  [ -s "$OUT/$f" ] || { echo "$OUT/$f is missing (desktop/build.sh windows and licenses)" >&2; exit 1; }
done

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
cp desktop/packaging/windows/mindsift.nsi desktop/packaging/windows/app.ico "$STAGE/"
cp "$OUT/mindsift-desktop-windows-amd64.exe" "$STAGE/MindSift.exe"
cp "$OUT/THIRD_PARTY_LICENSES.txt" "$STAGE/"
cp LICENSE "$STAGE/LICENSE.txt"

CMD="apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends nsis >/dev/null && \
  makensis -VERSION && echo && makensis -WX -V2 -DVERSION=$VERSION -DVERSION_NUMERIC=$NUMERIC mindsift.nsi"
if [ "$COPY_MODE" != "1" ]; then
  $ENGINE run --rm -v "$STAGE":/stage:Z -w /stage "$NSIS_IMAGE" sh -c "$CMD"
else
  id="$($ENGINE create -w /stage "$NSIS_IMAGE" sh -c "$CMD")"
  status=0
  $ENGINE cp "$STAGE/." "$id:/stage" && $ENGINE start -a "$id" || status=$?
  [ "$status" = 0 ] && { $ENGINE cp "$id:/stage/mindsift-desktop-windows-amd64-setup.exe" "$STAGE/" || status=$?; }
  $ENGINE rm -f "$id" >/dev/null
  [ "$status" = 0 ] || exit "$status"
fi
mv "$STAGE/mindsift-desktop-windows-amd64-setup.exe" "$OUT/"
ls -l "$OUT/mindsift-desktop-windows-amd64-setup.exe"
