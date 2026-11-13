#!/bin/sh
# Writes THIRD_PARTY_LICENSES.txt: the licenses of everything built into the server binary. The npm part
# comes from ci/third-party-licenses-npm.mjs (run in the frontend stage, where node_modules is); the Go
# part is made here from the modules the package really imports (go list -deps, for $GOOS/$GOARCH),
# each with the license files of its module (and AUTHORS, which BSD licenses refer to), plus Go's
# standard library. Needs only the go tool and the downloaded modules. Fails when a Go module has no
# license file.
# Usage: ci/third-party-licenses.sh <npm part> <go package> > THIRD_PARTY_LICENSES.txt
set -eu

NPM_PART="${1:?usage: ci/third-party-licenses.sh <npm part> <go package>}"
GO_PKG="${2:?usage: ci/third-party-licenses.sh <npm part> <go package>}"
LICENSE_FILES='^(licen[cs]e|copying|notice|patents|authors)([.-].*)?$'

heading() {
  printf '%s\n' "================================================================================"
  printf '%s\n' "$1"
  printf '%s\n' "================================================================================"
}

cat <<'EOF'
MindSift is licensed under the GNU Affero General Public License v3.0 (see LICENSE).

The server binary includes the following third-party software: the web app's npm packages (bundled
into the frontend that is embedded in the binary) and the Go modules and standard library it is
compiled from. Each is listed with its version and the license texts it ships.

EOF

cat "${NPM_PART}"

heading "Go standard library $(go env GOVERSION) (Go, BSD-3-Clause)"
cat "$(go env GOROOT)/LICENSE"
printf '\n'
if [ -f "$(go env GOROOT)/PATENTS" ]; then cat "$(go env GOROOT)/PATENTS"; printf '\n'; fi
printf '\n'

MODULES="$(go list -deps -f '{{with .Module}}{{if not .Main}}{{.Path}} {{.Version}} {{if .Replace}}{{.Replace.Dir}}{{else}}{{.Dir}}{{end}}{{end}}{{end}}' "${GO_PKG}" | sort -u)"
[ -n "${MODULES}" ] || { echo "third-party-licenses: no Go modules found for ${GO_PKG}" >&2; exit 1; }
printf '%s\n' "${MODULES}" | while read -r path version dir; do
  files="$(ls -1 "${dir}" | grep -iE "${LICENSE_FILES}" | sort || true)"
  if ! printf '%s\n' "${files}" | grep -qiE '^(licen[cs]e|copying)'; then
    echo "third-party-licenses: Go module ${path} ${version} has no license file in ${dir}" >&2
    exit 1
  fi
  heading "${path} ${version} (Go module)"
  for f in ${files}; do
    cat "${dir}/${f}"
    printf '\n'
  done
  printf '\n'
done
