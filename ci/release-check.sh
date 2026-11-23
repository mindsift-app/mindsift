#!/bin/sh
# Checks that the tree is the release commit of a version: every file that names MindSift's version names
# this one, and the CHANGELOG has its section. Run as the first step of a tag's build on GitHub, before
# anything is built, pushed or retagged (.github/workflows/build-and-publish.yaml), by
# RELEASE=1 ci/local-checks.sh and at the end of ci/release-prepare.sh, which writes all of it.
#   - the tag is v1.2.3 or v1.2.3-suffix (ci/version.sh)
#   - frontend/package.json and the two version lines of frontend/package-lock.json (ci/lock-version.sh)
#   - the version badge at the top of README.md
#   - CHANGELOG.md: "## [Unreleased]" is its first section, "## [1.2.3] - YYYY-MM-DD" the second, and that
#     one is not empty (ci/release-notes.sh makes the release page's text of it)
#   - the Flatpak manifest's git source is on the tag, the metainfo has a <release> entry for the version,
#     and the generated Flatpak sources fit the tree (desktop/packaging/flatpak/check-sources.sh)
# Usage: ci/release-check.sh <tag, e.g. v1.2.3> [<repository root>]
# POSIX sh, sed, grep and awk (BusyBox too); no containers, no network.
set -eu
TAG="${1:?usage: ci/release-check.sh <tag> [<repository root>]}"
ROOT="${2:-$(cd "$(dirname "$0")/.." && pwd)}"
cd "$ROOT"
status=0
fail() { echo "release-check: $*" >&2; status=1; }

sh ci/version.sh check "$TAG" || exit 1
v="${TAG#v}"

pkg="$(sh ci/version.sh package "$ROOT" 2>/dev/null || true)"
[ "$pkg" = "$v" ] || fail "frontend/package.json has version '$pkg', not $v"
lock="$(sh ci/lock-version.sh frontend/package-lock.json 2>/dev/null | tr '\n' ' ' || true)"
[ "$lock" = "$v $v " ] || fail "frontend/package-lock.json has versions '$lock', not $v twice (top level and packages.\"\")"

# shields.io writes a - in a badge's text as --
badge="$(printf '%s' "$v" | sed 's/-/--/g')"
grep -qF "https://img.shields.io/badge/Version-v$badge-" README.md \
  || fail "the version badge in README.md is not v$v ($(grep -o 'img.shields.io/badge/Version-[^)]*' README.md | head -n 1))"

# The first two sections of the CHANGELOG: [Unreleased], then this version with a date and some text
sections="$(grep '^## \[' CHANGELOG.md | head -n 2)"
first="$(printf '%s\n' "$sections" | sed -n 1p)"
second="$(printf '%s\n' "$sections" | sed -n 2p)"
[ "$first" = "## [Unreleased]" ] || fail "the first section of CHANGELOG.md is '$first', not '## [Unreleased]'"
printf '%s\n' "$second" | grep -Eqx "## \[$(printf '%s' "$v" | sed 's/[.]/\\./g')\] - [0-9]{4}-[0-9]{2}-[0-9]{2}" \
  || fail "the section below [Unreleased] in CHANGELOG.md is '$second', not '## [$v] - YYYY-MM-DD'"
text="$(awk -v head="$second" '
  $0 == head { found = 1; next }
  found && /^## \[/ { exit }
  found && NF { print }
' CHANGELOG.md)"
[ -n "$second" ] && [ -z "$text" ] && fail "the section $second of CHANGELOG.md is empty"

# The Flatpak manifest and metainfo (and the generated sources), as the release's desktop build needs them;
# check-sources.sh compares them with frontend/package.json, so they name $v once that one does
tag="$(sed -n 's/^ *tag: *\([^ ]*\) *$/\1/p' desktop/packaging/flatpak/app.mindsift.MindSift.yml)"
[ "$tag" = "$TAG" ] || fail "the Flatpak manifest's git source is on tag '$tag', not $TAG (desktop/packaging/flatpak/set-release.sh)"
grep -q "<release version=\"$v\"" desktop/packaging/flatpak/app.mindsift.MindSift.metainfo.xml \
  || fail "the Flatpak metainfo has no <release> entry for $v (desktop/packaging/flatpak/set-release.sh)"
sh desktop/packaging/flatpak/check-sources.sh "$ROOT" || status=1

[ "$status" = 0 ] || { echo "release-check: $TAG is not ready, see above (ci/release-prepare.sh writes all of it)" >&2; exit 1; }
echo "release-check: ok, the tree is the release commit of $TAG"
