#!/usr/bin/env bash
# Builds MindSift, starts it in demo mode with a fresh database and renews the README screenshots
# in screenshots/ (title picture and colour-family grid: light and dark joined along a diagonal).
# The PNGs from the browser are scaled down (desktop 1280 px, phone 480 px wide) and saved as WebP.
# The Flatpak's software-center screenshots (store-*.png of screenshots.mjs) go to screenshots/store/ as PNG,
# 1600x900: appstreamcli compose (flatpak-builder) and the software centers read no WebP. The metainfo
# (desktop/packaging/flatpak/) refers to them; a release build points it at the tag's copies.
# Requires podman (or docker via ENGINE=docker). Usage: e2e/screenshots.sh, other theme pair: SHOT_LIGHT=fjord SHOT_DARK=fjord-night
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# ENGINE, the images, free_port, wait_healthy and start_demo
. "$ROOT/e2e/lib.sh"
WORK="$(mktemp -d)"
RUN_ID="$$-$RANDOM"
NAME="mindsift-shots-$RUN_ID"
IMAGE="mindsift-shots-image:$RUN_ID"
PORT="${SHOTS_PORT:-$(free_port)}"
cleanup() {
  "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true
  "$ENGINE" rmi "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/png"

echo "Building the image …"
# Version in the header, e.g. APP_VERSION=v0.2 e2e/screenshots.sh; the image's tests are skipped (pictures
# need none, ci/local-checks.sh runs them), SKIP_TESTS=0 runs them
"$ENGINE" build -q --build-arg APP_VERSION="${APP_VERSION:-}" --build-arg SKIP_TESTS="${SKIP_TESTS:-1}" -t "$IMAGE" "$ROOT" >/dev/null
# The English demo (the README shows it)
start_demo "$NAME" "$IMAGE" "$PORT" -e DEMO_RESET_MINUTES=0 -v "$WORK":/data:Z
wait_healthy "$PORT" "$NAME"

echo "Taking screenshots …"
"$ENGINE" run --rm --network host -e MINDSIFT_URL="http://localhost:$PORT" -e SHOTS_DIR=/shots \
  -e SHOT_LIGHT="${SHOT_LIGHT:-light}" -e SHOT_DARK="${SHOT_DARK:-dark}" -e LANG=en_US.UTF-8 -e TZ=Europe/Berlin \
  -v "$ROOT/e2e":/e2e:Z -v "$WORK/png":/shots:Z -w /e2e "$PLAYWRIGHT_IMAGE" \
  sh -c 'npm install --no-audit --no-fund >/dev/null 2>&1 && node screenshots.mjs'

echo "Converting to WebP …"
"$ENGINE" run --rm -v "$WORK/png":/png:Z -v "$ROOT/screenshots":/shots:Z "$ALPINE_IMAGE" sh -c '
  apk add -q libwebp-tools >/dev/null
  for f in /png/*.png; do
    name=$(basename "$f" .png)
    case "$name" in store-*) continue ;; esac
    case "$name" in Mobile_*) width=480 ;; *) width=1280 ;; esac
    cwebp -quiet -resize "$width" 0 -q 90 -m 6 -metadata none "$f" -o "/shots/$name.webp"
  done'

echo "Store screenshots (PNG) …"
mkdir -p "$ROOT/screenshots/store"
"$ENGINE" run --rm -v "$WORK/png":/png:Z -v "$ROOT/screenshots/store":/store:Z "$ALPINE_IMAGE" sh -c '
  apk add -q imagemagick pngquant >/dev/null
  rm -f /store/*.png
  for f in /png/store-*.png; do
    name=$(basename "$f" .png); name=${name#store-}
    magick "$f" -resize 1600x -strip "/tmp/$name.png"
    pngquant --quality 80-95 --speed 1 --strip --force --output "/store/$name.png" "/tmp/$name.png" \
      || cp "/tmp/$name.png" "/store/$name.png"  # pngquant leaves it when the quality would suffer
  done'
