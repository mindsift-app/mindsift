#!/usr/bin/env bash
# Builds MindSift, starts it in demo mode with a fresh database and renews the README screenshots
# in screenshots/ (title picture and colour-family grid: light and dark joined along a diagonal).
# The PNGs from the browser are scaled down (desktop 1280 px, phone 480 px wide) and saved as WebP.
# Requires podman (or docker via ENGINE=docker). Usage: e2e/screenshots.sh, other theme pair: SHOT_LIGHT=fjord SHOT_DARK=fjord-night
set -euo pipefail
ENGINE="${ENGINE:-podman}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
RUN_ID="$$-$RANDOM"
NAME="mindsift-shots-$RUN_ID"
IMAGE="mindsift-shots-image:$RUN_ID"
PORT="${SHOTS_PORT:-}"
if [ -z "$PORT" ]; then
  for p in $(shuf -i 18100-18999 -n 50); do
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then PORT="$p"; break; fi
  done
fi
cleanup() {
  "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true
  "$ENGINE" rmi "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT
mkdir -p "$WORK/png"

echo "Building the image …"
# Version in the header, e.g. APP_VERSION=v0.2 e2e/screenshots.sh
"$ENGINE" build -q --build-arg APP_VERSION="${APP_VERSION:-}" -t "$IMAGE" "$ROOT" >/dev/null
# Straight to the app (not the entrypoint that hands /data to uid 1000): the test data stays the host
# user's, so the script can remove it
"$ENGINE" run -d --entrypoint /app/mindsift --name "$NAME" --network host -e PORT="$PORT" -e MINDSIFT_DEMO=true -e DEMO_RESET_MINUTES=0 \
  -v "$WORK":/data:Z "$IMAGE" >/dev/null
for _ in $(seq 1 60); do curl -s -m 1 "http://localhost:$PORT/api/v1/health" >/dev/null && break; sleep 0.5; done

echo "Taking screenshots …"
"$ENGINE" run --rm --network host -e MINDSIFT_URL="http://localhost:$PORT" -e SHOTS_DIR=/shots \
  -e SHOT_LIGHT="${SHOT_LIGHT:-light}" -e SHOT_DARK="${SHOT_DARK:-dark}" -e LANG=en_US.UTF-8 -e TZ=Europe/Berlin \
  -v "$ROOT/e2e":/e2e:Z -v "$WORK/png":/shots:Z -w /e2e mcr.microsoft.com/playwright:v1.65.0-noble \
  sh -c 'npm install --no-audit --no-fund >/dev/null 2>&1 && node screenshots.mjs'

echo "Converting to WebP …"
"$ENGINE" run --rm -v "$WORK/png":/png:Z -v "$ROOT/screenshots":/shots:Z docker.io/library/alpine:3.24 sh -c '
  apk add -q libwebp-tools >/dev/null
  for f in /png/*.png; do
    name=$(basename "$f" .png)
    case "$name" in Mobile_*) width=480 ;; *) width=1280 ;; esac
    cwebp -quiet -resize "$width" 0 -q 90 -m 6 -metadata none "$f" -o "/shots/$name.webp"
  done'
