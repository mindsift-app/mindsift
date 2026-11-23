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
ENGINE="${ENGINE:-podman}"
COPY_MODE="${COPY_MODE:-0}"
# The image of the Flatpak build (DEBIAN_IMAGE); NSIS is Debian trixie's (3.11)
. ci/images.env
NSIS_IMAGE="$DEBIAN_IMAGE"
APP_VERSION="$(sh ci/version.sh app "${APP_VERSION:-}")"
VERSION="${APP_VERSION#v}"
NUMERIC="${VERSION%%-*}"
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

# run_in (desktop/packaging/lib.sh): the stage at /stage, in COPY_MODE copied in and back out
. desktop/packaging/lib.sh
run_in "$NSIS_IMAGE" "$STAGE" /stage . . "apt-get update -qq >/dev/null && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends nsis >/dev/null && \
  makensis -VERSION && echo && makensis -WX -V2 -DVERSION=$VERSION -DVERSION_NUMERIC=$NUMERIC mindsift.nsi"
mv "$STAGE/mindsift-desktop-windows-amd64-setup.exe" "$OUT/"
ls -l "$OUT/mindsift-desktop-windows-amd64-setup.exe"
