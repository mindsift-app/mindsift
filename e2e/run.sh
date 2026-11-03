#!/usr/bin/env bash
# Builds MindSift, starts it in demo mode with a fresh database and runs the browser tests.
# Requires podman (or docker via ENGINE=docker). Usage: e2e/run.sh
# Every run uses its own container, image tag and port, so runs from several working copies at the
# same time cannot remove or test each other's server.
set -euo pipefail
ENGINE="${ENGINE:-podman}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
RUN_ID="$$-$RANDOM"
NAME="mindsift-e2e-$RUN_ID"
IMAGE="mindsift-e2e-image:$RUN_ID"
# A free port above 18000 (E2E_PORT overrides)
PORT="${E2E_PORT:-}"
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

echo "Baue Image …"
"$ENGINE" build -q -t "$IMAGE" "$ROOT" >/dev/null
"$ENGINE" run -d --name "$NAME" --network host -e PORT="$PORT" -e MINDA_DEMO=true \
  -e JWT_SECRET=e2e-only-secret -v "$WORK":/data:Z "$IMAGE" >/dev/null
for _ in $(seq 1 60); do curl -s -m 1 "http://localhost:$PORT/api/v1/health" >/dev/null && break; sleep 0.5; done

echo "Starte Browser-Tests (Port $PORT) …"
"$ENGINE" run --rm --network host -e MINDSIFT_URL="http://localhost:$PORT" -v "$ROOT/e2e":/e2e:Z -w /e2e \
  mcr.microsoft.com/playwright:v1.48.2-jammy \
  sh -c 'npm install --no-audit --no-fund >/dev/null 2>&1 && node collab.e2e.mjs && node share.e2e.mjs && node lock.e2e.mjs && node channels.e2e.mjs'
