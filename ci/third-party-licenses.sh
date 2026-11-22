#!/bin/sh
# Writes THIRD_PARTY_LICENSES.txt: the licenses of everything built into the server binary. The npm part
# comes from ci/third-party-licenses-npm.mjs (run in the frontend stage, where node_modules is); the Go
# part is made here from the modules the package really imports (go list -deps, for $GOOS/$GOARCH),
# each with the license files of its module (and AUTHORS, which BSD licenses refer to), plus Go's
# standard library. Needs only the go tool and the downloaded modules. Fails when a Go module has no
# license file. MindSift's own module is never listed (the desktop app imports it as a dependency).
# Usage: ci/third-party-licenses.sh <npm part> <go package> > THIRD_PARTY_LICENSES.txt
# Optional: SUBJECT (what the file is for, default "The server binary"); GO_PLATFORMS, e.g.
# "linux/amd64 windows/amd64": one file for the binaries of several platforms, with the modules imported
# on any of them (cgo as go's default: on for the native platform, off for cross builds). Without it the
# environment's GOOS/GOARCH count.
# Offline vendor builds (GOFLAGS=-mod=vendor, no module cache): go reports no module directory then, so
# the license files are taken from vendor/<module path>/ next to the main module's go.mod instead. That
# folder must hold the license files of each module (as flatpak-go-mod's module archives do; plain
# `go mod vendor` copies only some).
set -euo pipefail

NPM_PART="${1:?usage: ci/third-party-licenses.sh <npm part> <go package>}"
GO_PKG="${2:?usage: ci/third-party-licenses.sh <npm part> <go package>}"
LICENSE_FILES='^(licen[cs]e|copying|notice|patents|authors)([.-].*)?$'
SUBJECT="${SUBJECT:-The server binary}"

heading() {
  printf '%s\n' "================================================================================"
  printf '%s\n' "$1"
  printf '%s\n' "================================================================================"
}

cat <<EOF
MindSift is licensed under the GNU Affero General Public License v3.0 (see LICENSE).

${SUBJECT} includes the following third-party software: the web app's npm packages (bundled
into the frontend that is embedded in the binary) and the Go modules and standard library it is
compiled from. Each is listed with its version and the license texts it ships.

EOF

cat "${NPM_PART}"

heading "Go standard library $(go env GOVERSION) (Go, BSD-3-Clause)"
cat "$(go env GOROOT)/LICENSE"
printf '\n'
if [ -f "$(go env GOROOT)/PATENTS" ]; then cat "$(go env GOROOT)/PATENTS"; printf '\n'; fi
printf '\n'

list_modules() {
  go list -deps -f '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}} {{if .Replace}}{{.Replace.Dir}}{{else}}{{.Dir}}{{end}}{{end}}{{end}}' "${GO_PKG}"
}
if [ -n "${GO_PLATFORMS:-}" ]; then
  MODULES="$(for p in ${GO_PLATFORMS}; do GOOS="${p%/*}" GOARCH="${p#*/}" list_modules; done | sort -u)"
else
  MODULES="$(list_modules | sort -u)"
fi
MODULES="$(printf '%s\n' "${MODULES}" | { grep -v '^github.com/mindsift-app/mindsift ' || true; })"
[ -n "${MODULES}" ] || { echo "third-party-licenses: no Go modules found for ${GO_PKG}" >&2; exit 1; }
# One file name per line, each used as a whole (no word splitting or globbing). grep without -q reads all
# of its input, so pipefail never sees the writer cut off.
VENDOR_DIR="$(dirname "$(go env GOMOD)")/vendor"
printf '%s\n' "${MODULES}" | while read -r path version dir; do
  if [ -z "${dir}" ]; then
    dir="${VENDOR_DIR}/${path}"
    [ -d "${dir}" ] || { echo "third-party-licenses: Go module ${path} ${version} has no directory (module cache) and none in ${VENDOR_DIR}" >&2; exit 1; }
  fi
  files="$(ls -1 "${dir}" | { grep -iE "${LICENSE_FILES}" || true; } | sort)"
  if ! printf '%s\n' "${files}" | grep -iE '^(licen[cs]e|copying)' >/dev/null; then
    echo "third-party-licenses: Go module ${path} ${version} has no license file in ${dir}" >&2
    exit 1
  fi
  heading "${path} ${version} (Go module)"
  printf '%s\n' "${files}" | while IFS= read -r f; do
    cat "${dir}/${f}"
    printf '\n'
  done
  printf '\n'
done
