#!/usr/bin/env bash
# Builds MindSift, starts it in demo mode with a fresh database and runs the browser tests.
# Requires podman (or docker via ENGINE=docker). Usage: e2e/run.sh
# Every run uses its own container, image tag and port, so runs from several working copies at the
# same time cannot remove or test each other's server.
# A second server without the demo (fresh database, first admin from ADMIN_USER) serves the tests that
# need a real account of their own (tour-offer.e2e.mjs; mfa.e2e.mjs and passkey.e2e.mjs, as two-factor
# sign-in is off in the demo); its port is E2E_PLAIN_PORT, else E2E_PORT + 1, else a free one. Its
# BASE_URL is http://localhost:<port>, the address the browsers open, so passkeys work there.
set -euo pipefail
ENGINE="${ENGINE:-podman}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PLAIN_WORK="$(mktemp -d)"
RUN_ID="$$-$RANDOM"
NAME="mindsift-e2e-$RUN_ID"
PLAIN_NAME="mindsift-e2e-plain-$RUN_ID"
IMAGE="mindsift-e2e-image:$RUN_ID"
PLAIN_ADMIN_PASSWORD="Tour-Angebot-$RUN_ID"
free_port() {
  for p in $(shuf -i 18100-18999 -n 50); do
    if [ "$p" != "${1:-}" ] && ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return; fi
  done
}
# A free port above 18000 (E2E_PORT overrides)
PORT="${E2E_PORT:-}"
if [ -z "$PORT" ]; then
  PORT="$(free_port)"
fi
PLAIN_PORT="${E2E_PLAIN_PORT:-}"
if [ -z "$PLAIN_PORT" ]; then
  if [ -n "${E2E_PORT:-}" ]; then PLAIN_PORT=$((E2E_PORT + 1)); else PLAIN_PORT="$(free_port "$PORT")"; fi
fi
cleanup() {
  "$ENGINE" rm -f "$NAME" "$PLAIN_NAME" >/dev/null 2>&1 || true
  "$ENGINE" rmi "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK" "$PLAIN_WORK"
}
trap cleanup EXIT

echo "Building the image …"
"$ENGINE" build -q -t "$IMAGE" "$ROOT" >/dev/null
# Straight to the app (not the entrypoint that hands /data to uid 1000): the test data stays the host
# user's, so the script can remove it
"$ENGINE" run -d --entrypoint /app/mindsift --name "$NAME" --network host -e PORT="$PORT" -e MINDSIFT_DEMO=true -e DEFAULT_LANGUAGE=de \
  -v "$WORK":/data:Z "$IMAGE" >/dev/null
"$ENGINE" run -d --entrypoint /app/mindsift --name "$PLAIN_NAME" --network host -e PORT="$PLAIN_PORT" -e DEFAULT_LANGUAGE=de \
  -e BASE_URL="http://localhost:$PLAIN_PORT" \
  -e ADMIN_USER=admin -e ADMIN_PASSWORD="$PLAIN_ADMIN_PASSWORD" -v "$PLAIN_WORK":/data:Z "$IMAGE" >/dev/null
for port in "$PORT" "$PLAIN_PORT"; do
  for _ in $(seq 1 60); do curl -s -m 1 "http://localhost:$port/api/v1/health" >/dev/null && break; sleep 0.5; done
done

echo "Starting the browser tests (port $PORT, without demo $PLAIN_PORT) …"
"$ENGINE" run --rm --network host -e MINDSIFT_URL="http://localhost:$PORT" \
  -e MINDSIFT_PLAIN_URL="http://localhost:$PLAIN_PORT" -e MINDSIFT_PLAIN_ADMIN=admin -e MINDSIFT_PLAIN_PASSWORD="$PLAIN_ADMIN_PASSWORD" \
  -v "$ROOT/e2e":/e2e:Z -w /e2e \
  mcr.microsoft.com/playwright:v1.65.0-noble \
  sh -c 'npm install --no-audit --no-fund >/dev/null 2>&1 && node collab.e2e.mjs && node share.e2e.mjs && node lock.e2e.mjs && node copy.e2e.mjs && node table.e2e.mjs && node live.e2e.mjs && node channels.e2e.mjs && node offline.e2e.mjs && node tour.e2e.mjs && node tour-offer.e2e.mjs && node mfa.e2e.mjs && node passkey.e2e.mjs'
