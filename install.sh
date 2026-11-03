#!/usr/bin/env bash
set -euo pipefail

echo "============================================="
echo "🧠 MindSift — Schnell-Installation"
echo "============================================="

# 1. Prüfen ob Docker / Compose verfügbar ist
COMPOSE_CMD=""
if command -v docker &>/dev/null && docker compose version &>/dev/null; then
  COMPOSE_CMD="docker compose"
elif command -v docker-compose &>/dev/null; then
  COMPOSE_CMD="docker-compose"
elif command -v podman &>/dev/null && podman compose version &>/dev/null; then
  COMPOSE_CMD="podman compose"
else
  echo "❌ Fehler: Docker Compose (oder Podman Compose) wurde nicht gefunden."
  echo "Bitte installiere Docker (https://docs.docker.com/get-docker/) und versuche es erneut."
  exit 1
fi

INSTALL_DIR="${MINDSIFT_DIR:-mindsift}"
mkdir -p "${INSTALL_DIR}"
cd "${INSTALL_DIR}"

echo "📥 Lade Konfigurationsdateien herunter..."
REPO_RAW_URL="https://raw.githubusercontent.com/mindsift-app/mindsift/main"

curl -fsSL "${REPO_RAW_URL}/docker-compose.yml" -o docker-compose.yml
curl -fsSL "${REPO_RAW_URL}/.env.example" -o .env

# Zufälliges JWT-Secret generieren falls Standardwert vorhanden
if grep -q "change_this_to_a_secure_random_key_min_32_chars" .env; then
  RANDOM_SECRET=$(head -c 32 /dev/urandom | base64 | tr -dc 'a-zA-Z0-9' | head -c 32 || openssl rand -hex 16 2>/dev/null || date +%s%N)
  sed -i "s/change_this_to_a_secure_random_key_min_32_chars/${RANDOM_SECRET}/g" .env
fi

echo "🚀 Starte MindSift Container..."
${COMPOSE_CMD} up -d

echo ""
echo "============================================="
echo "✅ MindSift wurde erfolgreich gestartet!"
echo ""
echo "🌐 Öffne deinen Browser unter:"
echo "   http://localhost:8080"
echo ""
echo "💡 Beim ersten Aufruf wirst du automatisch durch"
echo "   die Ersteinrichtung deines Admin-Kontos geführt."
echo "============================================="
