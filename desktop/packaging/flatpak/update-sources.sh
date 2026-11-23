#!/bin/sh
# Generates the sources of the Flatpak manifest that list the app's dependencies, in containers (no local
# Go or Python needed), next to this script:
#   go.mod.yml, modules.txt   from desktop/go.mod and desktop/go.sum (flatpak-go-mod: one archive of
#                             proxy.golang.org per module, unpacked into desktop/vendor/<path>, and the
#                             vendor/modules.txt of `go mod vendor`)
#   node-sources.json         from frontend/package-lock.json (flatpak-node-generator: every package as a
#                             file of the npm cache in flatpak-node/, for `npm ci --offline`)
#   sources.sha256            the checksums of those three inputs, which check-sources.sh compares
# Run it after every change of desktop/go.mod, desktop/go.sum or frontend/package-lock.json and commit the
# result; check-sources.sh (in ci/local-checks.sh and the release build) fails until then.
#   desktop/packaging/flatpak/update-sources.sh
# Optional: ENGINE (default podman).
#
# The tools are pinned, and like every dependency only taken once their release is 14 days old
# (AGENTS.md): flatpak-go-mod v0.1.0 (2024-07-25); flatpak-node-generator at commit 9d86d336 of
# flatpak/flatpak-builder-tools (2026-10-25), its Python packages as PyPI had them on PYPI_BEFORE.
set -eu
cd "$(dirname "$0")/../../.."
ROOT="$PWD"
OUT=desktop/packaging/flatpak
ENGINE="${ENGINE:-podman}"
GO_IMAGE=docker.io/library/golang:1.27.4-alpine
PYTHON_IMAGE=docker.io/library/python:3.14.9-alpine3.24
FLATPAK_GO_MOD=github.com/dennwc/flatpak-go-mod@v0.1.0
NODE_GENERATOR="https://github.com/flatpak/flatpak-builder-tools/archive/9d86d336a39b9af38b86f114b6ce5820fe260f91.tar.gz#subdirectory=node"
PYPI_BEFORE=2026-11-09T00:00:00Z

$ENGINE volume create mindsift-desktop-gomod >/dev/null 2>&1 || true
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# Go: flatpak-go-mod runs `go mod vendor` and `go mod download` in desktop/, which needs the main module
# (replace => ../) next to it, so it works on a copy of the Go sources (the repository without the
# frontend). -dest-pref: the module is desktop/ of the source tree.
$ENGINE run --rm -v "$ROOT":/src:ro,z -v "$WORK":/out:z -v mindsift-desktop-gomod:/go/pkg/mod "$GO_IMAGE" sh -c "set -e
  mkdir /tmp/src
  tar -C /src --exclude=./.git --exclude=./frontend --exclude=./desktop/out --exclude=./desktop/vendor -cf - . | tar -C /tmp/src -xf -
  GOBIN=/tmp/bin go install $FLATPAK_GO_MOD
  cd /tmp/src/desktop
  # (into a folder on the same file system: the tool moves vendor/modules.txt there)
  mkdir /tmp/gen
  /tmp/bin/flatpak-go-mod -dest-pref desktop/ -out /tmp/gen .
  test -s /tmp/gen/go.mod.yml && test -s /tmp/gen/modules.txt
  cp /tmp/gen/go.mod.yml /tmp/gen/modules.txt /out/"

# npm: flatpak-node-generator reads the lockfile; the registry's packages are listed with the checksums of
# package-lock.json
$ENGINE run --rm -v "$ROOT/frontend/package-lock.json":/in/package-lock.json:ro,z -v "$WORK":/out:z "$PYTHON_IMAGE" sh -c "set -e
  pip install --quiet --no-cache-dir --root-user-action=ignore --uploaded-prior-to=$PYPI_BEFORE '$NODE_GENERATOR'
  flatpak-node-generator npm /in/package-lock.json -o /out/node-sources.json"

cp "$WORK/go.mod.yml" "$WORK/modules.txt" "$WORK/node-sources.json" "$OUT/"
sha256sum desktop/go.mod desktop/go.sum frontend/package-lock.json > "$OUT/sources.sha256"
ls -l "$OUT/go.mod.yml" "$OUT/modules.txt" "$OUT/node-sources.json" "$OUT/sources.sha256"
