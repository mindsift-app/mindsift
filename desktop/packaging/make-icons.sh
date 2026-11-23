#!/bin/sh
# Regenerates the app icons of the desktop app from the web app's artwork (frontend/public/icon.svg):
# hicolor PNGs for Linux (and the Flatpak) and app.ico for the Windows exe. The results are committed,
# so a normal build needs no image tools; run this only when the artwork changes (podman).
set -eu
cd "$(dirname "$0")/../.."
. ci/images.env
podman run --rm -v "$PWD":/src:Z -w /src "$ALPINE_IMAGE" sh -c '
  apk add --no-cache -q rsvg-convert imagemagick >/dev/null
  id=app.mindsift.MindSift
  out=desktop/packaging/linux/icons/hicolor
  rm -rf "$out" && mkdir -p "$out/scalable/apps"
  cp frontend/public/icon.svg "$out/scalable/apps/$id.svg"
  for s in 16 24 32 48 64 128 256 512; do
    mkdir -p "$out/${s}x${s}/apps"
    rsvg-convert -w $s -h $s frontend/public/icon.svg -o "$out/${s}x${s}/apps/$id.png"
  done
  cd "$out"
  mkdir -p /src/desktop/packaging/windows
  magick 16x16/apps/$id.png 24x24/apps/$id.png 32x32/apps/$id.png 48x48/apps/$id.png 64x64/apps/$id.png 128x128/apps/$id.png 256x256/apps/$id.png /src/desktop/packaging/windows/app.ico
'
