#!/usr/bin/env bash
# Decides per CI run: build with tests, build without tests, or only retag an existing image.
# Tests run before every push on the developer's machine (ci/local-checks.sh); the pipeline itself only
# tests the branches listed in TEST_REFS (GitHub: refs/heads/main, the public release). The images carry
# the git tree and commit as labels (io.mindsift.tree, org.opencontainers.image.revision).
#   branch in TEST_REFS -> build and test
#   other branches      -> build without tests, tag :dev, :latest or the branch name
#   v*                  -> retag :latest when it was built from this commit, else build (tests skipped
#                          when :latest has the same tree); :stable only for releases without "-"
# Security scan (ci/trivy-scan.sh): always for tags; for branches only when Dockerfile, go.mod or
# go.sum differ from the image last published under that tag (label io.mindsift.deps), since
# everything else in the image does not change its known vulnerabilities.
# Inputs (environment): REF, COMMIT (default HEAD), IMAGE, PKG_VERSION (default from package.json),
# TEST_REFS (space separated refs whose builds run the tests, default none),
# LABEL_CMD (prints a label of a remote image: LABEL_CMD <image> <label>; for tests)
set -euo pipefail

REF="${REF:-}"
COMMIT="${COMMIT:-HEAD}"
IMAGE="${IMAGE:-}"
PKG_VERSION="${PKG_VERSION:-}"
if [ -z "${PKG_VERSION}" ] && [ -f frontend/package.json ]; then
  PKG_VERSION="$(sed -nE 's/^  "version": "([^"]+)".*/\1/p' frontend/package.json | head -n1)"
fi

SHA="$(git rev-parse "${COMMIT}^{commit}")"
TREE="$(git rev-parse "${COMMIT}^{tree}")"
# Base image, Go version and modules: the inputs that decide which known vulnerabilities the image has
DEPS="$(git rev-parse "${COMMIT}:Dockerfile" "${COMMIT}:go.mod" "${COMMIT}:go.sum" | sha256sum | cut -c1-16)"

# Label of an image in the registry ("" when the image or label does not exist)
image_label() {
  if [ -n "${LABEL_CMD:-}" ]; then
    ${LABEL_CMD} "$1" "$2" 2>/dev/null || true
    return
  fi
  docker pull -q "$1" >/dev/null 2>&1 || return 0
  docker inspect -f "{{ index .Config.Labels \"$2\" }}" "$1" 2>/dev/null | sed 's/^<no value>$//' || true
}

ACTION="build"
SKIP_TESTS="0"
APP_VERSION=""
TAGS=""
SOURCE_IMAGE=""
REASON=""
SCAN="1"

TEST_REFS="${TEST_REFS:-}"
tested_here() { case " ${TEST_REFS} " in *" ${REF} "*) return 0 ;; esac; return 1; }

case "${REF}" in
  refs/heads/dev)
    TAGS="dev"
    if tested_here; then REASON="dev: build with all tests"; else SKIP_TESTS="1"; REASON="dev: tested locally, build without tests"; fi
    ;;
  refs/heads/main)
    TAGS="latest"
    APP_VERSION="v${PKG_VERSION}"
    if tested_here; then REASON="main: build with all tests"; else SKIP_TESTS="1"; REASON="main: tested locally, build without tests"; fi
    ;;
  refs/tags/v*)
    TAG_NAME="${REF#refs/tags/}"
    TAGS="${TAG_NAME}"
    case "${TAG_NAME}" in *-*) ;; *) TAGS="${TAG_NAME} stable" ;; esac
    if [ -n "${IMAGE}" ] && [ "$(image_label "${IMAGE}:latest" org.opencontainers.image.revision)" = "${SHA}" ]; then
      ACTION="retag"
      SOURCE_IMAGE="${IMAGE}:latest"
      SKIP_TESTS="1"
      REASON="tag ${TAG_NAME}: :latest was built from this commit, retag without building"
    else
      APP_VERSION="${TAG_NAME}"
      if [ -n "${IMAGE}" ] && [ "$(image_label "${IMAGE}:latest" io.mindsift.tree)" = "${TREE}" ]; then
        SKIP_TESTS="1"
        REASON="tag ${TAG_NAME}: code already tested, build without tests"
      else
        REASON="tag ${TAG_NAME}: build with all tests"
      fi
    fi
    ;;
  *)
    TAGS="$(echo "${REF#refs/heads/}" | sed 's#/#-#g' | tr '[:upper:]' '[:lower:]')"
    if tested_here; then REASON="branch ${REF}: build with all tests"; else SKIP_TESTS="1"; REASON="branch ${REF}: tested locally, build without tests"; fi
    ;;
esac

case "${REF}" in
  refs/tags/v*) ;;
  *)
    PREVIOUS="${TAGS%% *}"
    if [ -n "${IMAGE}" ] && [ "$(image_label "${IMAGE}:${PREVIOUS}" io.mindsift.deps)" = "${DEPS}" ]; then
      SCAN="0"
    fi
    ;;
esac

{
  echo "action=${ACTION}"
  echo "skip_tests=${SKIP_TESTS}"
  echo "app_version=${APP_VERSION}"
  echo "tags=${TAGS}"
  echo "source_image=${SOURCE_IMAGE}"
  echo "sha=${SHA}"
  echo "tree=${TREE}"
  echo "deps=${DEPS}"
  echo "scan=${SCAN}"
  echo "reason=${REASON}"
} | tee -a "${GITHUB_OUTPUT:-/dev/null}"
