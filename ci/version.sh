#!/bin/sh
# MindSift's version, read and checked in one place for the CI scripts, the workflows and the desktop
# builds. A version is v1.2.3 (a release) or v1.2.3-suffix (a pre-release such as v1.2.3-rc.1, or a
# development build, v1.2.3-dev); frontend/package.json holds it without the v.
#   ci/version.sh package [<root>]   the version of frontend/package.json, e.g. 1.2.3
#   ci/version.sh dev [<root>]       the version of a development build: v<package.json>-dev
#   ci/version.sh check <version>    fails (with a message) unless <version> is v1.2.3 or v1.2.3-suffix
#   ci/version.sh release <version>  fails unless <version> is a release, v1.2.3 without suffix
#   ci/version.sh compare <a> <b>    prints -1, 0 or 1 as <a> is older than, as new as or newer than <b> (SemVer)
#   ci/version.sh app [<version>]    <version> when given (checked), else the development version: the
#                                    APP_VERSION of the builds, e.g. APP_VERSION="$(ci/version.sh app "${APP_VERSION:-}")"
# POSIX sh with sed, grep and awk only (BusyBox too).
set -eu
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
USAGE="usage: ci/version.sh package|dev [<root>] | check|release <version> | compare <a> <b> | app [<version>]"

package() {
  v="$(sed -n 's/^  "version": "\([^"]*\)".*/\1/p' "${1:-$ROOT}/frontend/package.json" | head -n 1)"
  [ -n "$v" ] || { echo "version: no version in ${1:-$ROOT}/frontend/package.json" >&2; exit 1; }
  printf '%s\n' "$v"
}
# v, three numbers without leading zeros, optionally - and dot-separated letters, digits and hyphens
valid() {
  printf '%s\n' "$1" | grep -Eqx 'v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-[0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*)?'
}

case "${1:-}" in
  package) package "${2:-}" ;;
  dev) printf 'v%s-dev\n' "$(package "${2:-}")" ;;
  check)
    valid "${2:-}" || { echo "version: '${2:-}' is no version like v1.2.3 or v1.2.3-suffix" >&2; exit 1; }
    ;;
  release)
    valid "${2:-}" && case "$2" in *-*) false ;; esac \
      || { echo "version: '${2:-}' is no release version like v1.2.3 (without suffix)" >&2; exit 1; }
    ;;
  compare)
    valid "${2:-}" && valid "${3:-}" || { echo "$USAGE" >&2; exit 2; }
    # SemVer order (2.0.0, section 11): the numbers numerically, a pre-release below its release, then the
    # pre-release identifiers one by one (numeric ones numerically and below alphanumeric ones; with equal
    # identifiers so far, more of them is newer)
    awk -v a="${2#v}" -v b="${3#v}" '
      function pre(s) { return index(s, "-") ? substr(s, index(s, "-") + 1) : "" }
      function cmp(a, b,    pa, pb, xa, ya, na, nb, i, x, y) {
        pa = pre(a); pb = pre(b)
        split(a, xa, /[.-]/); split(b, ya, /[.-]/)
        for (i = 1; i <= 3; i++) if (xa[i] + 0 != ya[i] + 0) return xa[i] + 0 < ya[i] + 0 ? -1 : 1
        if (pa == pb) return 0
        if (pa == "") return 1
        if (pb == "") return -1
        na = split(pa, xa, "."); nb = split(pb, ya, ".")
        for (i = 1; i <= na && i <= nb; i++) {
          x = xa[i]; y = ya[i]
          if (x == y) continue
          if (x ~ /^[0-9]+$/ && y ~ /^[0-9]+$/) return x + 0 < y + 0 ? -1 : 1
          if (x ~ /^[0-9]+$/) return -1
          if (y ~ /^[0-9]+$/) return 1
          return x < y ? -1 : 1
        }
        return na < nb ? -1 : (na > nb ? 1 : 0)
      }
      BEGIN { print cmp(a, b) }'
    ;;
  app)
    if [ -n "${2:-}" ]; then
      valid "$2" || { echo "APP_VERSION must look like v1.2.3 or v1.2.3-suffix, not '$2'" >&2; exit 1; }
      printf '%s\n' "$2"
    else
      printf 'v%s-dev\n' "$(package)"
    fi
    ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac
