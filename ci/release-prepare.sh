#!/bin/sh
# Writes the release commit's changes for a new version (the version steps of the release, AGENTS.md):
#   1. checks the version: v1.2.3 or v1.2.3-suffix, newer than every v* tag of the repository (SemVer
#      order, ci/version.sh compare), and that the CHANGELOG's [Unreleased] section has entries
#   2. frontend/package.json and MindSift's two version lines in frontend/package-lock.json
#      (ci/lock-version.sh; no npm install, nothing else in the lockfile changes)
#   3. the version badge at the top of README.md
#   4. CHANGELOG.md: the entries of [Unreleased] become the section "## [1.2.3] - <today>", with a new,
#      empty [Unreleased] above it
#   5. the generated Flatpak sources, only when desktop/go.mod, desktop/go.sum or the npm packages of the
#      lockfile changed since they were made (desktop/packaging/flatpak/update-sources.sh, in containers;
#      a new version alone needs none)
#   6. the Flatpak manifest and metainfo (desktop/packaging/flatpak/set-release.sh with <summary>, dated as
#      the new CHANGELOG section)
#   7. ci/release-check.sh over the result
# It does not commit unless --commit is given, so the changes can be looked at (git diff) first; the
# release commit is "chore(release): v1.2.3" (what --commit writes, with exactly these files). Nothing is
# tagged or pushed.
# Usage: ci/release-prepare.sh <version, e.g. v1.2.3> '<one sentence in English about the release, for
#        the software centers>' [--commit]
# Optional: TODAY (YYYY-MM-DD, default today's date), ENGINE (for update-sources.sh).
set -eu
USAGE="usage: ci/release-prepare.sh <version, e.g. v1.2.3> '<summary sentence>' [--commit]"
VERSION="${1:?$USAGE}"
SUMMARY="${2:?$USAGE}"
COMMIT=0
case "${3:-}" in
  "") ;;
  --commit) COMMIT=1 ;;
  *) echo "$USAGE" >&2; exit 2 ;;
esac
cd "$(dirname "$0")/.."
DIR=desktop/packaging/flatpak
v="${VERSION#v}"
TODAY="${TODAY:-$(date +%Y-%m-%d)}"
FILES="frontend/package.json frontend/package-lock.json README.md CHANGELOG.md $DIR/app.mindsift.MindSift.yml
  $DIR/app.mindsift.MindSift.metainfo.xml $DIR/go.mod.yml $DIR/modules.txt $DIR/node-sources.json $DIR/sources.sha256"
die() { echo "release-prepare: $*" >&2; exit 1; }

# 1. The version, the tags and the CHANGELOG
sh ci/version.sh check "$VERSION"
printf '%s\n' "$TODAY" | grep -Eqx '[0-9]{4}-[0-9]{2}-[0-9]{2}' || die "TODAY must be YYYY-MM-DD, not '$TODAY'"
for tag in $(git tag --list 'v*'); do
  sh ci/version.sh check "$tag" 2>/dev/null || continue
  [ "$(sh ci/version.sh compare "$VERSION" "$tag")" = 1 ] || die "$VERSION is not newer than the tag $tag"
done
if [ "$COMMIT" = 1 ]; then
  # shellcheck disable=SC2086 # (the list of files)
  git diff --quiet HEAD -- $FILES || die "--commit: the release files have uncommitted changes, commit them first or leave out --commit"
fi
grep -qx '## \[Unreleased\]' CHANGELOG.md || die "CHANGELOG.md has no section '## [Unreleased]'"
entries="$(awk '
  $0 == "## [Unreleased]" { found = 1; next }
  found && /^## \[/ { exit }
  found && NF { print }
' CHANGELOG.md)"
[ -n "$entries" ] || die "the [Unreleased] section of CHANGELOG.md is empty: nothing to release"

# 2. package.json and package-lock.json (into a temporary file each, then over the original)
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
awk -v v="$v" '!done && /^  "version": "/ { sub(/"version": "[^"]*"/, "\"version\": \"" v "\""); done = 1 } { print }' \
  frontend/package.json > "$tmp" && cat "$tmp" > frontend/package.json
sh ci/lock-version.sh frontend/package-lock.json "$v" > "$tmp" && cat "$tmp" > frontend/package-lock.json

# 3. The README badge (shields.io writes a - in its text as --)
badge="$(printf '%s' "$v" | sed 's/-/--/g')"
sed "s|\(img\.shields\.io/badge/Version-\)v[0-9][0-9.]*\(--[0-9A-Za-z.]*\)*-|\1v$badge-|" README.md > "$tmp" && cat "$tmp" > README.md

# 4. The CHANGELOG: the new section's heading below a new [Unreleased]
awk -v head="## [$v] - $TODAY" '{ print } $0 == "## [Unreleased]" && !done { print ""; print head; done = 1 }' \
  CHANGELOG.md > "$tmp" && cat "$tmp" > CHANGELOG.md

# 5. The generated Flatpak sources, when their inputs changed
if [ "$(sh "$DIR/sources-sha256.sh")" != "$(cat "$DIR/sources.sha256" 2>/dev/null)" ]; then
  echo "release-prepare: the Flatpak's Go or npm sources are out of date, regenerating them (update-sources.sh)"
  sh "$DIR/update-sources.sh"
fi

# 6. The Flatpak manifest and metainfo (the date from the new CHANGELOG section)
sh "$DIR/set-release.sh" "$VERSION" "$SUMMARY"

# 7. All of it
sh ci/release-check.sh "$VERSION"

if [ "$COMMIT" = 1 ]; then
  # shellcheck disable=SC2086 # (the list of files)
  git add -- $FILES
  git commit -q -m "chore(release): $VERSION"
  echo "release-prepare: committed $(git log -1 --format='%h %s')"
else
  echo "release-prepare: $VERSION is prepared. Look at the changes (git diff), then commit them:"
  echo "  git add $(echo $FILES) && git commit -m 'chore(release): $VERSION'"
fi
