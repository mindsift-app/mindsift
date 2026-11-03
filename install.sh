#!/usr/bin/env bash
set -euo pipefail

echo "============================================="
echo "🧠 MindSift — quick install"
echo "============================================="

# 1. Check that Docker / Compose is available
COMPOSE_CMD=""
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
elif command -v podman &>/dev/null && podman compose version &>/dev/null; then
  COMPOSE_CMD="podman compose"
else
  echo "❌ Error: Docker Compose (or Podman Compose) was not found."
  echo "Please install Docker (https://docs.docker.com/get-docker/) and try again."
  exit 1
fi

INSTALL_DIR="${MINDSIFT_DIR:-mindsift}"
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

echo "📥 Downloading the configuration files..."
REPO_RAW_URL="https://raw.githubusercontent.com/mindsift-app/mindsift/main"

curl -fsSL "${REPO_RAW_URL}/docker-compose.yml" -o docker-compose.yml
curl -fsSL "${REPO_RAW_URL}/.env.example" -o .env

# Generate a random JWT secret if the default value is still there
if grep -q "change_this_to_a_secure_random_key_min_32_chars" .env; then
  RANDOM_SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32 || openssl rand -hex 16 2>/dev/null || date +%s%N)
  sed -i "s/change_this_to_a_secure_random_key_min_32_chars/${RANDOM_SECRET}/g" .env
fi

echo "🚀 Starting the MindSift container..."
${COMPOSE_CMD} up -d

echo ""
echo "============================================="
echo "✅ MindSift is up and running!"
echo ""
echo "🌐 Open your browser at:"
echo "   http://localhost:8080"
echo ""
echo "💡 On the first visit a wizard guides you through"
echo "   setting up your admin account."
echo "============================================="
