#!/usr/bin/env bash
# Plays the demo walk-through (e2e/video-tour.mjs) in a visible Chrome window for a screen recording.
# Chrome starts as an app window (no tabs, no address bar) with its own profile, so the normal profile is
# not touched; Playwright drives it from a container over the debugging port.
#   e2e/video-tour.sh                 against the public demo https://demo.mindsift.app (others may be in it)
#   LOCAL=1 e2e/video-tour.sh         against a fresh local demo, built from this checkout
#   BASE=https://… e2e/video-tour.sh  against another instance in demo mode (account admin/admin)
#   LOCAL=1 TOUR_LANG=de e2e/video-tour.sh   the local demo in German (the tour follows the page's language)
#   PACE=1.5 e2e/video-tour.sh        slower (0.5 = twice as fast)
#   SIZE=1920,1080 e2e/video-tour.sh  window size (default 1600,900)
#   START_DELAY=8 e2e/video-tour.sh   seconds to start the screen recorder before the first click
# Needs podman (or docker via ENGINE=docker) and Google Chrome (flatpak com.google.Chrome or google-chrome).
set -euo pipefail
ENGINE="${ENGINE:-podman}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT="${PORT:-18555}"
CDP_PORT="${CDP_PORT:-9222}"
SIZE="${SIZE:-1600,900}"
PROFILE="${PROFILE:-$HOME/.var/app/com.google.Chrome/mindsift-tour}"
NAME=mindsift-tour
PW=mcr.microsoft.com/playwright:v1.65.0-noble

if [ "${LOCAL:-}" = 1 ]; then
  echo "Starting a fresh local demo on port $PORT …"
  "$ENGINE" build -q -t mindsift-tour "$ROOT" >/dev/null
  "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true
  # Straight to the app (not the entrypoint): the demo keeps its data in the container only
  "$ENGINE" run -d --rm --entrypoint /app/mindsift --name "$NAME" --network host -e PORT="$PORT" -e MINDSIFT_DEMO=true \
    -e DEFAULT_LANGUAGE="${TOUR_LANG:-en}" -e DEMO_RESET_MINUTES=0 -e JWT_SECRET=tour-only mindsift-tour >/dev/null
  trap '"$ENGINE" stop "$NAME" >/dev/null 2>&1 || true' EXIT
  BASE="http://localhost:$PORT"
  for _ in $(seq 1 60); do curl -s -m 1 "$BASE/api/v1/health" >/dev/null && break; sleep 0.5; done
else
  BASE="${BASE:-https://demo.mindsift.app}"
fi

if command -v google-chrome >/dev/null 2>&1; then
  CHROME=(google-chrome)
else
  CHROME=(flatpak run com.google.Chrome)
fi
mkdir -p "$PROFILE"
echo "Opening Chrome as an app window ($SIZE) …"
"${CHROME[@]}" --user-data-dir="$PROFILE" --remote-debugging-port="$CDP_PORT" --no-first-run --no-default-browser-check \
  --disable-features=Translate --lang="${TOUR_LANG:-en}" --window-size="$SIZE" --window-position=0,0 --app="$BASE" >/dev/null 2>&1 &
for _ in $(seq 1 60); do curl -s -m 1 "http://localhost:$CDP_PORT/json/version" >/dev/null && break; sleep 0.5; done

if [ "${START_DELAY:-5}" != 0 ]; then
  echo "Start the screen recording now – the tour begins in ${START_DELAY:-5} s."
  sleep "${START_DELAY:-5}"
fi
"$ENGINE" run --rm --network host -e BASE="$BASE" -e CDP="http://localhost:$CDP_PORT" -e PACE="${PACE:-1}" -e TOUR_LANG="${TOUR_LANG:-}" \
  -v "$ROOT/e2e":/e2e:Z -w /e2e "$PW" sh -c 'npm install --no-audit --no-fund >/dev/null 2>&1 && node video-tour.mjs'
echo "Done. Close the Chrome window when the recording has stopped."
