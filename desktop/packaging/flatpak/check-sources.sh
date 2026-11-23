#!/bin/sh
# Checks that the Flatpak manifest's files fit the source tree, before a release is tagged (run by
# ci/local-checks.sh and ci/release-desktop.sh; no containers, no network):
#   - go.mod.yml, modules.txt and node-sources.json were generated from the desktop/go.mod, desktop/go.sum
#     and frontend/package-lock.json of the tree (sources.sha256, written by update-sources.sh; MindSift's
#     own version in the lockfile does not count, see sources-sha256.sh)
#   - modules.txt lists every package the desktop app imports from MindSift's own module (directly or
#     through its packages) and every other non-standard package imported there
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

# modules.txt is what the build vendors: the packages of MindSift's own module are copied in from the list
# there (see the manifest), the others come from the module archives. desktop/go.mod does not change when the
# app imports one more package of a module it already has, so the import lines are compared as well: those of
# desktop/ with its tests (`go mod vendor` lists what the main module's tests need), then, package by
# package, those of the own module's packages it reaches (without tests). Every package of the own module and
# every other non-standard one (a dot in the first element) imported there has to be in modules.txt.
own=github.com/mindsift-app/mindsift
# go_imports FILE…: the import paths of Go files (single imports and import blocks, up to the first declaration)
go_imports() {
  awk 'FNR == 1 { block = 0; done = 0 }
    done { next }
    /^(func|type|var|const)[ (]/ { done = 1; next }
    /^import \(/ { block = 1; next }
    block && /^\)/ { block = 0; next }
    (block || /^import /) && match($0, /"[^"]+"/) { print substr($0, RSTART + 1, RLENGTH - 2) }' "$@"
}
if [ -s "$DIR/modules.txt" ]; then
  W="$(mktemp -d)"
  trap 'rm -rf "$W"' EXIT
  find desktop \( -name vendor -o -name node_modules -o -name testdata -o -name out \) -prune -o -name '*.go' -print >"$W/files"
  if [ ! -s "$W/files" ]; then
    fail "no Go files in desktop/ to compare with modules.txt"
  else
    # shellcheck disable=SC2046 # file names without spaces
    go_imports $(cat "$W/files") | sort -u >"$W/imports"
    # (each pattern file for grep -f starts with a line no path matches: BusyBox grep takes an empty one as
    # matching everything)
    echo "#" >"$W/seen"
    # the own module's packages reached so far, until no new one comes up
    while :; do
      grep "^$own/" "$W/imports" | grep -v "^$own/desktop\(/\|\$\)" | sort -u >"$W/own"
      grep -vxF -f "$W/seen" "$W/own" >"$W/new" || true
      [ -s "$W/new" ] || break
      cat "$W/new" >>"$W/seen"
      while read -r pkg; do
        dir="${pkg#"$own"/}"
        files=""
        [ ! -d "$dir" ] || files="$(find "$dir" -maxdepth 1 -name '*.go' ! -name '*_test.go')"
        if [ -z "$files" ]; then
          fail "$pkg is imported, but $dir has no Go files"
          continue
        fi
        # shellcheck disable=SC2086 # file names without spaces
        go_imports $files >>"$W/imports"
      done <"$W/new"
      sort -u -o "$W/imports" "$W/imports"
    done
    { echo "#"; sed -n "\|^# $own |,\|^# |{\|^$own/|p}" "$DIR/modules.txt"; } >"$W/own-listed"
    missing="$(grep -vxF -f "$W/own-listed" "$W/own" || true)"
    [ -z "$missing" ] || fail "the desktop app imports packages of MindSift's own module that modules.txt does not list: $(echo "$missing" | tr '\n' ' ')- run $DIR/update-sources.sh and commit the result"
    { echo "#"; grep -v '^#' "$DIR/modules.txt"; } >"$W/listed"
    missing="$(grep -v -e "^$own/" -e "^$own\$" "$W/imports" | grep '^[^/]*\.' | grep -vxF -f "$W/listed" || true)"
    [ -z "$missing" ] || fail "the desktop app imports packages that modules.txt does not list: $(echo "$missing" | tr '\n' ' ')- run $DIR/update-sources.sh and commit the result"
  fi
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
