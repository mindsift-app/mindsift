#!/bin/sh
# Checks that the Flatpak manifest's files fit the source tree, before a release is tagged (run by
# ci/local-checks.sh and ci/release-desktop.sh; no containers, no network):
#   - go.mod.yml, modules.txt and node-sources.json were generated from the desktop/go.mod, desktop/go.sum
#     and frontend/package-lock.json of the tree (sources.sha256, written by update-sources.sh; MindSift's
#     own version in the lockfile does not count, see sources-sha256.sh)
#   - the manifest's git source is the tag of frontend/package.json's version, and its commit (when given)
#     the one that tag points to
#   - the metainfo has a <release> entry for that version, and its screenshots are on main or that tag
# A build from the git source takes all of these as they are in the tag; set-release.sh sets the tag and
# the metainfo for a new version.
# Usage: desktop/packaging/flatpak/check-sources.sh [<repository root>]
set -eu
ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$ROOT"
DIR=desktop/packaging/flatpak
MANIFEST="$DIR/app.mindsift.MindSift.yml"
METAINFO="$DIR/app.mindsift.MindSift.metainfo.xml"
status=0
fail() { echo "check-sources: $*" >&2; status=1; }

for f in go.mod.yml modules.txt node-sources.json sources.sha256; do
  [ -s "$DIR/$f" ] || fail "$DIR/$f is missing: run $DIR/update-sources.sh"
done
if [ -s "$DIR/sources.sha256" ] && [ "$(sh "$DIR/sources-sha256.sh" "$ROOT" 2>&1)" != "$(cat "$DIR/sources.sha256")" ]; then
  fail "the generated sources do not fit desktop/go.mod, desktop/go.sum or frontend/package-lock.json any more: run $DIR/update-sources.sh and commit the result"
fi

version="$(sh ci/version.sh package "$ROOT")"
tag="$(sed -n 's/^ *tag: *\([^ ]*\) *$/\1/p' "$MANIFEST")"
commit="$(sed -n 's/^ *commit: *\([0-9a-f]*\) *$/\1/p' "$MANIFEST")"
[ "$tag" = "v$version" ] || fail "the manifest's git source is on tag '$tag', frontend/package.json has $version: run $DIR/set-release.sh v$version"
if [ -n "$commit" ] && [ -n "$tag" ] && git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
  [ "$(git rev-parse "$tag^{commit}")" = "$commit" ] || fail "the manifest's commit $commit is not the one of $tag"
fi
grep -q "<release version=\"$version\"" "$METAINFO" || fail "the metainfo has no <release> entry for $version: run $DIR/set-release.sh v$version"
other="$(grep -o 'https://raw.githubusercontent.com/mindsift-app/mindsift/[^/]*/screenshots/' "$METAINFO" \
  | grep -v -e '/main/screenshots/' -e "/v$version/screenshots/" || true)"
[ -z "$other" ] || fail "the metainfo's screenshots are on neither main nor v$version: run $DIR/set-release.sh v$version"
exit "$status"
