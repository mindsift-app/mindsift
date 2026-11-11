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

# set_env <key> <value>: sets the key in .env, also when it is only there as a comment
set_env() {
  KEY="$1" VALUE="$2" awk '
    !done && ($0 ~ "^" ENVIRON["KEY"] "=" || $0 ~ "^# ?" ENVIRON["KEY"] "=") {
      print ENVIRON["KEY"] "=" ENVIRON["VALUE"]; done = 1; next
    }
    { print }
    END { if (!done) print ENVIRON["KEY"] "=" ENVIRON["VALUE"] }
  ' .env >.env.tmp && mv .env.tmp .env
}

echo "📥 Downloading the configuration files..."
REPO_RAW_URL="https://raw.githubusercontent.com/mindsift-app/mindsift/main"

curl -fsSL "${REPO_RAW_URL}/docker-compose.yml" -o docker-compose.yml

BASE_URL=""
if [ -f .env ]; then
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

  # Time zone of this server for due dates and alarms
  HOST_TZ=$(timedatectl show -p Timezone --value 2>/dev/null || true)
  if [ -z "${HOST_TZ}" ] && [ -f /etc/timezone ]; then HOST_TZ=$(head -n1 /etc/timezone); fi
  if [ -z "${HOST_TZ}" ]; then HOST_TZ=$(readlink /etc/localtime 2>/dev/null | sed -n 's#.*zoneinfo/##p' || true); fi
  if [ -n "${HOST_TZ}" ]; then set_env TZ "${HOST_TZ}"; fi

  WHISPER=0
  STT_MODEL=""
  PROXY_NETWORK=""

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

echo "🚀 Starting MindSift..."
${COMPOSE_CMD} up -d

PORT_VALUE=$(sed -n 's/^PORT=//p' .env | head -n1)
OPEN_URL="http://localhost:${PORT_VALUE:-8080}"
if [ -n "${BASE_URL}" ] && [ "${BASE_URL}" != "http://localhost:8080" ]; then OPEN_URL="${BASE_URL}"; fi

echo ""
echo "============================================="
echo "✅ MindSift is up and running!"
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
echo "💡 On the first visit a wizard guides you through"
echo "   setting up your admin account."
if [ "${WHISPER:-0}" = "1" ]; then
  echo ""
  echo "🎙️  The speech model downloads on the first start; voice input works"
  echo "   once it is there (a few minutes, see: ${COMPOSE_CMD} logs -f whisper)."
fi
echo "============================================="
