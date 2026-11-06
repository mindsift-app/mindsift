#!/usr/bin/env bash
# Scans a local image with Trivy: prints every finding, then fails when it has known HIGH or CRITICAL
# vulnerabilities that already have a fix, or leaked secrets. Unfixed and unrated findings only show up
# in the log. Usage: ci/trivy-scan.sh <image>
# Trivy runs in a container and gets the image as a tar on stdin, so it needs neither the docker socket
# nor a shared folder (both differ between GitHub and the Gitea runner).
# Optional SARIF_DIR (a host folder) receives trivy.sarif for GitHub's security tab.
set -euo pipefail

IMAGE="${1:?usage: ci/trivy-scan.sh <image>}"
TRIVY_IMAGE="${TRIVY_IMAGE:-docker.io/aquasec/trivy:0.76.0}"

MOUNT=()
if [ -n "${SARIF_DIR:-}" ]; then
  mkdir -p "${SARIF_DIR}"
  MOUNT=(-v "$(cd "${SARIF_DIR}" && pwd):/out:Z")
fi

docker save "${IMAGE}" | docker run --rm -i "${MOUNT[@]}" -e SARIF="${SARIF_DIR:+1}" --entrypoint sh "${TRIVY_IMAGE}" -c '
  set -e
  cat > /tmp/image.tar
  trivy image --quiet --input /tmp/image.tar --scanners vuln,secret,misconfig
  if [ -n "${SARIF}" ]; then
    trivy image --quiet --skip-db-update --input /tmp/image.tar --scanners vuln,secret \
      --format sarif --output /out/trivy.sarif
  fi
  echo "Gate: HIGH/CRITICAL vulnerabilities with a fix, leaked secrets"
  trivy image --quiet --skip-db-update --input /tmp/image.tar --scanners vuln,secret \
    --severity HIGH,CRITICAL --ignore-unfixed --exit-code 1 --format table
'
echo "Trivy: no HIGH/CRITICAL vulnerabilities with a fix and no secrets in ${IMAGE}"
