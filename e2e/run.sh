#!/usr/bin/env bash
# Builds MindSift, starts it in demo mode with a fresh database and runs the browser tests.
# Requires podman (or docker via ENGINE=docker). Usage: e2e/run.sh
# Every run uses its own container, image tag and port, so runs from several working copies at the
# same time cannot remove or test each other's server.
# A second server without the demo (fresh database, first admin from ADMIN_USER) serves the tests that
# need a real account of their own (tour-offer.e2e.mjs; mfa.e2e.mjs and passkey.e2e.mjs, as two-factor
# sign-in is off in the demo); its port is E2E_PLAIN_PORT, else E2E_PORT + 1, else a free one. Its
# BASE_URL is http://localhost:<port>, the address the browsers open, so passkeys work there.
# A third server signs in through an OpenID Connect provider, a Dex started here as well (e2e/dex.yaml), with
# the password login off (oidc.e2e.mjs). Their ports: E2E_OIDC_PORT and E2E_DEX_PORT, else E2E_PORT + 2 and
# + 3, else free ones.
# A fourth server starts without the demo and without ADMIN_USER, so its setup wizard asks for the setup code
# the server writes to its log; read from there and passed on (setup.e2e.mjs). Its port: E2E_SETUP_PORT, else
# E2E_PORT + 4, else a free one.
set -euo pipefail
ENGINE="${ENGINE:-podman}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
PLAIN_WORK="$(mktemp -d)"
RUN_ID="$$-$RANDOM"
NAME="mindsift-e2e-$RUN_ID"
PLAIN_NAME="mindsift-e2e-plain-$RUN_ID"
OIDC_NAME="mindsift-e2e-oidc-$RUN_ID"
DEX_NAME="mindsift-e2e-dex-$RUN_ID"
OIDC_WORK="$(mktemp -d)"
DEX_WORK="$(mktemp -d)"
SETUP_NAME="mindsift-e2e-setup-$RUN_ID"
SETUP_WORK="$(mktemp -d)"
IMAGE="mindsift-e2e-image:$RUN_ID"
PLAIN_ADMIN_PASSWORD="Tour-Angebot-$RUN_ID"
OIDC_ADMIN_PASSWORD="Notzugang-$RUN_ID"
OIDC_CLIENT_SECRET="dex-client-$RUN_ID"
# A free port, none of the ones given
free_port() {
  for p in $(shuf -i 18100-18999 -n 50); do
    case " $* " in *" $p "*) continue ;; esac
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return; fi
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
OIDC_PORT="${E2E_OIDC_PORT:-}"
if [ -z "$OIDC_PORT" ]; then
  if [ -n "${E2E_PORT:-}" ]; then OIDC_PORT=$((E2E_PORT + 2)); else OIDC_PORT="$(free_port "$PORT" "$PLAIN_PORT")"; fi
fi
DEX_PORT="${E2E_DEX_PORT:-}"
if [ -z "$DEX_PORT" ]; then
  if [ -n "${E2E_PORT:-}" ]; then DEX_PORT=$((E2E_PORT + 3)); else DEX_PORT="$(free_port "$PORT" "$PLAIN_PORT" "$OIDC_PORT")"; fi
fi
SETUP_PORT="${E2E_SETUP_PORT:-}"
if [ -z "$SETUP_PORT" ]; then
  if [ -n "${E2E_PORT:-}" ]; then SETUP_PORT=$((E2E_PORT + 4)); else SETUP_PORT="$(free_port "$PORT" "$PLAIN_PORT" "$OIDC_PORT" "$DEX_PORT")"; fi
fi
cleanup() {
  "$ENGINE" rm -f "$NAME" "$PLAIN_NAME" "$OIDC_NAME" "$DEX_NAME" "$SETUP_NAME" >/dev/null 2>&1 || true
  "$ENGINE" rmi "$IMAGE" >/dev/null 2>&1 || true
  rm -rf "$WORK" "$PLAIN_WORK" "$OIDC_WORK" "$DEX_WORK" "$SETUP_WORK"
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
# Dex (version fixed) and the server signing in through it, password login off but for the admin
sed -e "s/__DEX_PORT__/$DEX_PORT/g" -e "s/__OIDC_PORT__/$OIDC_PORT/g" -e "s/__CLIENT_SECRET__/$OIDC_CLIENT_SECRET/g" \
  "$ROOT/e2e/dex.yaml" >"$DEX_WORK/config.yaml"
chmod 755 "$DEX_WORK" && chmod 644 "$DEX_WORK/config.yaml"
"$ENGINE" run -d --name "$DEX_NAME" --network host -v "$DEX_WORK/config.yaml":/etc/dex/mindsift.yaml:ro,Z \
  ghcr.io/dexidp/dex:v2.44.0 dex serve /etc/dex/mindsift.yaml >/dev/null
"$ENGINE" run -d --entrypoint /app/mindsift --name "$OIDC_NAME" --network host -e PORT="$OIDC_PORT" -e DEFAULT_LANGUAGE=de \
  -e BASE_URL="http://localhost:$OIDC_PORT" -e ADMIN_USER=admin -e ADMIN_PASSWORD="$OIDC_ADMIN_PASSWORD" \
  -e OIDC_ISSUER="http://localhost:$DEX_PORT/dex" -e OIDC_CLIENT_ID=mindsift -e OIDC_CLIENT_SECRET="$OIDC_CLIENT_SECRET" \
  -e OIDC_NAME=Dex -e OIDC_PASSWORD_LOGIN=false -v "$OIDC_WORK":/data:Z "$IMAGE" >/dev/null
# Without ADMIN_USER: the setup wizard needs the code from the log
"$ENGINE" run -d --entrypoint /app/mindsift --name "$SETUP_NAME" --network host -e PORT="$SETUP_PORT" -e DEFAULT_LANGUAGE=de \
  -v "$SETUP_WORK":/data:Z "$IMAGE" >/dev/null
for port in "$PORT" "$PLAIN_PORT" "$OIDC_PORT" "$SETUP_PORT"; do
  for _ in $(seq 1 60); do curl -s -m 1 "http://localhost:$port/api/v1/health" >/dev/null && break; sleep 0.5; done
done
for _ in $(seq 1 60); do curl -s -m 1 "http://localhost:$DEX_PORT/dex/.well-known/openid-configuration" >/dev/null && break; sleep 0.5; done

# The code as an administrator finds it: in the container's log
SETUP_CODE="$("$ENGINE" logs "$SETUP_NAME" 2>&1 | sed -n 's/.*Setup code: \([A-Z0-9]\{4\}-[A-Z0-9]\{4\}-[A-Z0-9]\{4\}\).*/\1/p' | tail -n1)"
if [ -z "$SETUP_CODE" ]; then
  echo "No setup code in the log of the server without ADMIN_USER:" >&2
  "$ENGINE" logs "$SETUP_NAME" >&2 || true
  exit 1
fi

echo "Starting the browser tests (port $PORT, without demo $PLAIN_PORT, OIDC $OIDC_PORT with Dex on $DEX_PORT, setup $SETUP_PORT) …"
"$ENGINE" run --rm --network host -e MINDSIFT_URL="http://localhost:$PORT" \
  -e MINDSIFT_PLAIN_URL="http://localhost:$PLAIN_PORT" -e MINDSIFT_PLAIN_ADMIN=admin -e MINDSIFT_PLAIN_PASSWORD="$PLAIN_ADMIN_PASSWORD" \
  -e MINDSIFT_OIDC_URL="http://localhost:$OIDC_PORT" -e MINDSIFT_OIDC_ADMIN=admin -e MINDSIFT_OIDC_PASSWORD="$OIDC_ADMIN_PASSWORD" \
  -e MINDSIFT_SETUP_URL="http://localhost:$SETUP_PORT" -e MINDSIFT_SETUP_CODE="$SETUP_CODE" \
  -v "$ROOT/e2e":/e2e:Z -w /e2e \
  mcr.microsoft.com/playwright:v1.65.0-noble \
  sh -c 'npm install --no-audit --no-fund >/dev/null 2>&1 && node collab.e2e.mjs && node share.e2e.mjs && node lock.e2e.mjs && node copy.e2e.mjs && node drawing-live.e2e.mjs && node table.e2e.mjs && node live.e2e.mjs && node channels.e2e.mjs && node offline.e2e.mjs && node tour.e2e.mjs && node tour-offer.e2e.mjs && node mfa.e2e.mjs && node passkey.e2e.mjs && node oidc.e2e.mjs && node setup.e2e.mjs'
