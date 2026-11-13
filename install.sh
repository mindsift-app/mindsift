#!/usr/bin/env bash
set -euo pipefail

echo "============================================="
echo "🧠 MindSift — quick install"
echo "============================================="

# 1. Check that Docker / Compose is available
COMPOSE_CMD=""
CONTAINER_CMD="docker"
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
elif command -v podman &>/dev/null && podman compose version &>/dev/null; then
  COMPOSE_CMD="podman compose"
  CONTAINER_CMD="podman"
else
  echo "❌ Error: Docker Compose (or Podman Compose) was not found."
  echo "Please install Docker (https://docs.docker.com/get-docker/) and try again."
  exit 1
fi

INSTALL_DIR="${MINDSIFT_DIR:-mindsift}"
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

# Questions are read from the terminal, since the script itself usually comes in through a pipe
# (curl … | bash). Without a terminal every question takes its default: the plain install.
INTERACTIVE=0
if (exec </dev/tty) 2>/dev/null; then INTERACTIVE=1; fi

# ask <prompt> <default>: the answer ends up in REPLY
ask() {
  local answer=""
  if [ "${INTERACTIVE}" = "1" ]; then
    read -r -p "$1" answer </dev/tty || true
  fi
  REPLY="${answer:-$2}"
}

# yes_no <question>: default no
yes_no() {
  ask "$1 [y/N] " "n"
  case "${REPLY}" in [yYjJ]*) return 0 ;; *) return 1 ;; esac
}

# set_env <key> <value>: sets the key in .env, also when it is only there as a comment. umask 077: the
# new file that replaces .env stays readable only for you (it holds secrets)
set_env() {
  (umask 077 && KEY="$1" VALUE="$2" awk '
    !done && ($0 ~ "^" ENVIRON["KEY"] "=" || $0 ~ "^# ?" ENVIRON["KEY"] "=") {
      print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; done = 1; next
    }
    { print }
    END { if (!done) print ENVIRON["KEY"] "=" ENVIRON["VALUE"] }
  ' .env >.env.tmp) && mv .env.tmp .env
}

echo "📥 Downloading the configuration files..."
REPO_RAW_URL="https://raw.githubusercontent.com/mindsift-app/mindsift/main"

curl -fsSL "${REPO_RAW_URL}/docker-compose.yml" -o docker-compose.yml

BASE_URL=""
# 1 when the script runs again over an installation (.env exists): an update, data and settings stay
UPDATING=0
# 1 when the data folder already holds a database (accounts exist, no setup wizard)
HAD_DATA=0
if [ -f data/mindsift.db ]; then HAD_DATA=1; fi
if [ -f .env ]; then
  UPDATING=1
  # Running the script again updates docker-compose.yml and keeps your settings
  echo "ℹ️  Existing installation found: .env and docker-compose.override.yml stay as they are."
  BASE_URL=$(sed -n 's/^BASE_URL=//p' .env | head -n1)
else
  curl -fsSL "${REPO_RAW_URL}/.env.example" -o .env
  chmod 600 .env

  # Random JWT secret; not when data/ already holds one (keeps everyone signed in). Without a good
  # random source it stays empty and MindSift makes its own in data/jwt.secret.
  if grep -q "^JWT_SECRET=$" .env && [ ! -f data/jwt.secret ]; then
    RANDOM_SECRET=$(head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48 || openssl rand -hex 24 2>/dev/null)
    if [ "${#RANDOM_SECRET}" -ge 32 ]; then set_env JWT_SECRET "${RANDOM_SECRET}"; fi
  fi

  # Key for hidden values in notes; not when data/ already holds one (the stored values need that key)
  if grep -q "^SECRETS_KEY=$" .env && [ ! -f data/secrets.key ]; then
    SECRETS_KEY_VALUE=$(head -c 48 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 48 || openssl rand -hex 24 2>/dev/null)
    if [ -n "${SECRETS_KEY_VALUE}" ]; then sed -i "s/^SECRETS_KEY=$/SECRETS_KEY=${SECRETS_KEY_VALUE}/" .env; fi
  fi

  WHISPER=0
  STT_MODEL=""
  PROXY_NETWORK=""
  ADMIN_NAME=""
  ADMIN_PW=""
  ADMIN_PW_GENERATED=0
  # Without an admin from here the setup wizard asks for the setup code from MindSift's log (shown at the end)
  SETUP_CODE_NEEDED=0

  # The first admin (ADMIN_USER / ADMIN_PASSWORD), created on the first start, so nobody else can claim the
  # new instance in the setup wizard. Only for a new installation: with a database in data/ the accounts
  # exist and the variables would be ignored.
  if [ ! -f data/mindsift.db ]; then
    if [ "${INTERACTIVE}" = "1" ]; then
      echo ""
      echo "🔐 Admin account: created on the first start, so nobody else can claim your new instance."
      while true; do
        ask "Admin username [admin]: " "admin"
        ADMIN_NAME=$(printf '%s' "${REPLY}" | tr '[:upper:]' '[:lower:]')
        # The server's rule (storage.ValidUsername)
        if [[ "${ADMIN_NAME}" =~ ^[a-z0-9]([a-z0-9._-]{0,30}[a-z0-9])?$ ]]; then break; fi
        echo "    Up to 32 characters: letters, digits, dot, dash and underscore, starting and ending with a letter or digit."
      done
      while true; do
        ADMIN_PW=""
        IFS= read -r -s -p "Admin password (at least 8 characters, empty = generate one): " ADMIN_PW </dev/tty || true
        echo ""
        if [ -z "${ADMIN_PW}" ]; then
          ADMIN_PW=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 20 || openssl rand -hex 10 2>/dev/null)
          ADMIN_PW_GENERATED=1
          if [ "${#ADMIN_PW}" -ge 16 ]; then break; fi
          # Without a random source: no admin from here, the wizard as before
          echo "    Could not generate a password: create the admin in the setup wizard right after the start."
          ADMIN_PW=""
          ADMIN_PW_GENERATED=0
          break
        fi
        # The server's rule (auth.ValidatePassword): 8 to 1024 characters, not only spaces. Characters as
        # the server counts them, whatever the locale: the bytes of the UTF-8 text without its continuation bytes
        PW_CHARS=$(printf '%s' "${ADMIN_PW}" | LC_ALL=C tr -d '\200-\277' | LC_ALL=C wc -c)
        if [ "${PW_CHARS}" -lt 8 ] || [ -z "${ADMIN_PW//[[:space:]]/}" ]; then
          echo "    At least 8 characters, please."
          continue
        fi
        if [ "${PW_CHARS}" -gt 1024 ]; then
          echo "    At most 1024 characters, please."
          continue
        fi
        # .env holds it in single quotes (no $ expansion), so these two would not come through as typed
        case "${ADMIN_PW}" in
          *\'* | *\\*) echo "    Please without ' and \\."; continue ;;
        esac
        IFS= read -r -s -p "Repeat the password: " ADMIN_PW2 </dev/tty || true
        echo ""
        if [ "${ADMIN_PW}" = "${ADMIN_PW2}" ]; then break; fi
        echo "    The passwords differ, please try again."
      done
      ADMIN_PW2=""
      if [ -n "${ADMIN_PW}" ]; then
        # Single quotes: a $ in the password stays a $ (.env is 0600)
        set_env ADMIN_USER "${ADMIN_NAME}"
        set_env ADMIN_PASSWORD "'${ADMIN_PW}'"
      else
        ADMIN_NAME=""
        SETUP_CODE_NEEDED=1
      fi
    else
      echo "ℹ️  No terminal for questions, so no admin account is set: open MindSift right after the start"
      echo "   and create it in the setup wizard. It asks for the setup code MindSift writes to its log"
      echo "   (shown at the end, or: ${COMPOSE_CMD} logs mindsift | grep 'Setup code')."
      SETUP_CODE_NEEDED=1
    fi
  fi

  if [ "${INTERACTIVE}" = "1" ]; then
    echo ""
    echo "Two optional questions; just press Enter for a plain install."
    echo ""
    echo "🎙️  Voice input: MindSift can run its own speech recognition (Whisper) next to it, so recordings"
    echo "    stay on this server. Without it, the browser's speech recognition is used."
    if yes_no "Set up your own speech recognition?"; then
      WHISPER=1
      echo "    1) large-v3-turbo   best recognition, about 2 GB RAM, 1.6 GB download"
      echo "    2) small            about 1 GB RAM, much faster, makes small mistakes"
      ask "Model [1]: " "1"
      case "${REPLY}" in
        2*) STT_MODEL="Systran/faster-whisper-small" ;;
        *) STT_MODEL="deepdml/faster-whisper-large-v3-turbo-ct2" ;;
      esac
    fi

    echo ""
    echo "🌐 Reverse proxy: for an address like https://mindsift.example.com (nginx, Traefik, Caddy …)."
    if yes_no "Will MindSift run behind a reverse proxy?"; then
      while true; do
        ask "Public address (e.g. https://mindsift.example.com): " ""
        case "${REPLY}" in
          http://* | https://*) BASE_URL="${REPLY%/}"; break ;;
          "") break ;;
          *) echo "    Please start with https:// (or http://), or leave it empty." ;;
        esac
      done
      NETWORKS=$(${CONTAINER_CMD} network ls --format '{{.Name}}' 2>/dev/null |
        grep -vxE 'bridge|host|none|podman|mindsift_default' | tr '\n' ' ' || true)
      if [ -n "${NETWORKS}" ]; then echo "    Networks on this host: ${NETWORKS}"; fi
      while true; do
        ask "Docker network of your proxy (empty = none, e.g. proxy outside Docker): " ""
        if [ -z "${REPLY}" ] || ${CONTAINER_CMD} network inspect "${REPLY}" &>/dev/null; then
          PROXY_NETWORK="${REPLY}"
          break
        fi
        echo "    There is no network \"${REPLY}\"."
      done
    fi
  fi

  if [ -n "${BASE_URL}" ]; then set_env BASE_URL "${BASE_URL}"; fi

  if [ "${WHISPER}" = "1" ]; then
    set_env STT_URL "http://whisper:8000"
    set_env STT_MODEL "${STT_MODEL}"
  fi

  # Additions to docker-compose.yml; that file is replaced on updates, this one stays
  if [ "${WHISPER}" = "1" ] || [ -n "${PROXY_NETWORK}" ]; then
    {
      echo "# Written by install.sh: your additions to docker-compose.yml (which updates may replace)."
      echo "services:"
      if [ -n "${PROXY_NETWORK}" ]; then
        echo "  mindsift:"
        echo "    networks:"
        echo "      - default"
        echo "      - proxy"
      fi
      if [ "${WHISPER}" = "1" ]; then
        cat <<'EOF'
  # Speech recognition; MindSift loads the model into the volume on the first start
  whisper:
    image: ghcr.io/speaches-ai/speaches:0.8.3-cpu
    container_name: mindsift-whisper
    restart: unless-stopped
    volumes:
      - whisper-models:/home/ubuntu/.cache/huggingface/hub
    environment:
      - WHISPER__COMPUTE_TYPE=int8   # faster on the CPU, hardly any loss in quality
      - WHISPER__TTL=-1              # keep the model in memory instead of unloading it after 5 min
      - ENABLE_UI=false              # without the speaches web interface
      - LOG_LEVEL=info
volumes:
  whisper-models:
EOF
      fi
      if [ -n "${PROXY_NETWORK}" ]; then
        echo "networks:"
        echo "  proxy:"
        echo "    external: true"
        echo "    name: ${PROXY_NETWORK}"
      fi
    } >docker-compose.override.yml
  fi
fi

# compose up alone keeps an image it already has; on an update it should start the latest one
PULLED=0
if [ "${UPDATING}" = "1" ]; then
  echo "📥 Pulling the latest image..."
  if ${COMPOSE_CMD} pull; then
    PULLED=1
  else
    echo "⚠️  Could not pull the latest image; starting the one already on this host."
  fi
fi

echo "🚀 Starting MindSift..."
${COMPOSE_CMD} up -d

PORT_VALUE=$(sed -n 's/^PORT=//p' .env | head -n1)
OPEN_URL="http://localhost:${PORT_VALUE:-8080}"
if [ -n "${BASE_URL}" ] && [ "${BASE_URL}" != "http://localhost:8080" ]; then OPEN_URL="${BASE_URL}"; fi

# A new installation with an admin from here: once MindSift answers and has created that account, the
# password leaves .env again (only the first start uses it). Never on an update.
ADMIN_PW_REMOVED=0
ADMIN_FAILED=0
if [ "${UPDATING}" = "0" ] && [ -n "${ADMIN_NAME:-}" ]; then
  echo "⏳ Waiting for the first start..."
  for _ in $(seq 1 90); do
    LOGS=$(${COMPOSE_CMD} logs mindsift 2>/dev/null || true)
    # Variables set but unusable: MindSift stops and says why; the password stays for a fix
    if grep -q 'Creating the first administrator from ADMIN_USER / ADMIN_PASSWORD failed' <<<"${LOGS}"; then ADMIN_FAILED=1; break; fi
    if grep -q 'First administrator created from ADMIN_USER' <<<"${LOGS}" &&
      curl -fsS --noproxy '*' -m 4 -o /dev/null "http://localhost:${PORT_VALUE:-8080}/api/v1/health" 2>/dev/null; then
      set_env ADMIN_PASSWORD ""
      ADMIN_PW_REMOVED=1
      break
    fi
    sleep 1
  done
  LOGS=""
fi

# The headline only claims success once MindSift answers (an update, or a start without an admin from here,
# was not waited for above). A server that stopped on its own (a wrong setting, a newer database) says why
# in the log.
HEALTHY=0
if [ "${ADMIN_PW_REMOVED}" = "1" ]; then
  HEALTHY=1
elif [ "${ADMIN_FAILED}" = "0" ]; then
  echo "⏳ Waiting for MindSift to answer..."
  for _ in $(seq 1 90); do
    if curl -fsS --noproxy '*' -m 4 -o /dev/null "http://localhost:${PORT_VALUE:-8080}/api/v1/health" 2>/dev/null; then
      HEALTHY=1
      break
    fi
    sleep 1
  done
fi

echo ""
echo "============================================="
if [ "${HEALTHY}" = "1" ]; then
  echo "✅ MindSift is up and running!"
else
  echo "⚠️  MindSift does not answer yet. If it does not come up in a minute, the log says why:"
  echo "   ${COMPOSE_CMD} logs mindsift"
fi
echo ""
echo "🌐 Open your browser at:"
echo "   ${OPEN_URL}"
if [ "${OPEN_URL}" != "http://localhost:${PORT_VALUE:-8080}" ]; then
  echo "   (on this server also http://localhost:${PORT_VALUE:-8080})"
  if [ -n "${PROXY_NETWORK:-}" ]; then
    echo "   Point your proxy at http://mindsift:8080 (network ${PROXY_NETWORK})."
  else
    echo "   Point your proxy at http://localhost:${PORT_VALUE:-8080}."
  fi
  echo "   Examples: https://github.com/mindsift-app/mindsift/blob/main/Doku/reverse-proxy.md"
fi
echo ""
if [ -n "${ADMIN_NAME:-}" ]; then
  echo "👤 Sign in as \"${ADMIN_NAME}\"; a short wizard then asks the remaining settings."
  if [ "${ADMIN_PW_GENERATED:-0}" = "1" ]; then
    # Shown this once
    echo "🔑 Generated password (shown only now, note it down): ${ADMIN_PW}"
  fi
  if [ "${ADMIN_PW_REMOVED}" = "1" ]; then
    echo "   The account exists, so ADMIN_PASSWORD was removed from .env again (only the first start used it)."
  elif [ "${ADMIN_FAILED}" = "1" ]; then
    echo "⚠️  MindSift could not create the account and did not start; the log says why:"
    echo "   ${COMPOSE_CMD} logs mindsift   (fix .env, then: ${COMPOSE_CMD} up -d)"
  else
    echo "⚠️  MindSift has not confirmed the account yet, so ADMIN_PASSWORD is still in .env. Check the log"
    echo "   (${COMPOSE_CMD} logs mindsift) and delete the password from .env once you can sign in."
  fi
elif [ "${SETUP_CODE_NEEDED:-0}" = "1" ]; then
  echo "💡 On the first visit a wizard guides you through"
  echo "   setting up your admin account."
  # The wizard asks for the one-time code MindSift writes to its log when it starts without an account
  SETUP_CODE=""
  for _ in $(seq 1 30); do
    SETUP_CODE=$(${COMPOSE_CMD} logs mindsift 2>/dev/null | sed -n 's/.*Setup code: \([A-Z0-9]\{4\}-[A-Z0-9]\{4\}-[A-Z0-9]\{4\}\).*/\1/p' | tail -n1 || true)
    if [ -n "${SETUP_CODE}" ]; then break; fi
    sleep 1
  done
  if [ -n "${SETUP_CODE}" ]; then
    echo "🔑 Setup code for the wizard: ${SETUP_CODE}"
    echo "   Valid until the admin exists; after a restart MindSift logs a new one:"
  else
    echo "🔑 The wizard asks for the setup code from MindSift's log:"
  fi
  echo "   ${COMPOSE_CMD} logs mindsift | grep 'Setup code'"
elif [ "${UPDATING}" = "1" ]; then
  if [ "${PULLED}" = "1" ]; then
    echo "🔄 MindSift was updated to the latest image."
  else
    echo "🔄 MindSift was restarted."
  fi
  echo "   Your settings (.env) and your data (data/) were kept; sign in as before."
elif [ "${HAD_DATA}" = "1" ]; then
  echo "📂 The existing data in data/ was kept; sign in with your accounts."
else
  echo "💡 On the first visit a wizard guides you through"
  echo "   setting up your admin account."
fi
ADMIN_PW=""
if [ "${WHISPER:-0}" = "1" ]; then
  echo ""
  echo "🎙️  The speech model downloads on the first start; voice input works"
  echo "   once it is there (a few minutes, see: ${COMPOSE_CMD} logs -f whisper)."
fi
echo "============================================="
