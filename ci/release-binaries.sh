#!/usr/bin/env bash
# Takes the server binary out of a published image, once per platform, and packs it with the licence:
# <dir>/mindsift-<version>-linux-<arch>.tar.gz and their SHA256SUMS. It is the binary of the image, so
# the one that was tested and scanned, and the frontend is embedded in it: the file runs on its own.
# Usage: ci/release-binaries.sh <image> <version> <dir>
# Optional: PLATFORMS (default "linux/amd64 linux/arm64"), ENGINE (default docker). Needs GNU tar.
set -euo pipefail

IMAGE="${1:?usage: ci/release-binaries.sh <image> <version> <dir>}"
VERSION="${2:?usage: ci/release-binaries.sh <image> <version> <dir>}"
OUT="${3:?usage: ci/release-binaries.sh <image> <version> <dir>}"
ENGINE="${ENGINE:-docker}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
mkdir -p "${OUT}"

# e_machine of the ELF header (bytes 18 and 19): what the file was compiled for
elf_machine() { od -An -tx1 -j18 -N2 "$1" | tr -d ' \n'; }

for platform in ${PLATFORMS:-linux/amd64 linux/arm64}; do
  case "${platform}" in
    linux/amd64) machine="3e00" ;;
    linux/arm64) machine="b700" ;;
    *) echo "release-binaries: unknown platform ${platform}" >&2; exit 1 ;;
  esac
  name="mindsift-${VERSION}-${platform//\//-}"
  mkdir -p "${WORK}/${name}"
  "${ENGINE}" pull -q --platform "${platform}" "${IMAGE}" >/dev/null
  # The container is only created to copy the file out of it, never started
  container="$("${ENGINE}" create --platform "${platform}" "${IMAGE}")"
  "${ENGINE}" cp "${container}:/app/mindsift" "${WORK}/${name}/mindsift"
  "${ENGINE}" rm "${container}" >/dev/null
  # An image built for one platform only is handed out whatever platform was asked for
  if [ "$(elf_machine "${WORK}/${name}/mindsift")" != "${machine}" ]; then
    echo "release-binaries: the binary of ${IMAGE} for ${platform} is for another platform" >&2
    exit 1
  fi
  chmod 755 "${WORK}/${name}/mindsift"
  cp "${ROOT}/LICENSE" "${WORK}/${name}/LICENSE"
  tar -C "${WORK}" --owner=0 --group=0 --numeric-owner -czf "${OUT}/${name}.tar.gz" "${name}"
done

(cd "${OUT}" && sha256sum mindsift-*.tar.gz > SHA256SUMS && cat SHA256SUMS)
