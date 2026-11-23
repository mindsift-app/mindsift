#!/bin/sh
# Tests of check-sources.sh and set-release.sh on a copy of the files they read, with stand-ins for the
# generated sources (run by ci/local-checks.sh; no containers, no network).
# Usage: desktop/packaging/flatpak/test-check-sources.sh
set -eu
cd "$(dirname "$0")/../../.."
SRC="$PWD"
T="$(mktemp -d)"
trap 'rm -rf "$T"' EXIT
DIR=desktop/packaging/flatpak
failures=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1" >&2; failures=$((failures + 1)); }

# A tree with the files the scripts read; version 1.2.0 throughout
mkdir -p "$T/frontend" "$T/$DIR"
cp desktop/go.mod desktop/go.sum "$T/desktop/"
cp frontend/package-lock.json "$T/frontend/"
cp "$DIR/app.mindsift.MindSift.yml" "$DIR/app.mindsift.MindSift.metainfo.xml" "$DIR/check-sources.sh" "$DIR/set-release.sh" "$T/$DIR/"
printf '{\n  "name": "mindsift",\n  "version": "1.2.0"\n}\n' > "$T/frontend/package.json"
printf '## [Unreleased]\n\n## [1.2.0] - 2026-12-01\n\n## [1.3.0-rc.1] - 2026-12-05\n' > "$T/CHANGELOG.md"
for f in go.mod.yml modules.txt node-sources.json; do echo stand-in > "$T/$DIR/$f"; done
(cd "$T" && sha256sum desktop/go.mod desktop/go.sum frontend/package-lock.json > "$DIR/sources.sha256")
(cd "$T" && sh "$DIR/set-release.sh" v1.2.0 'Notes & tasks <faster> \ a|b.' >/dev/null 2>&1) || true

# expect NAME pass|fail [TEXT]: check-sources.sh on the tree passes, or fails naming TEXT
expect() {
  out="$(sh "$T/$DIR/check-sources.sh" "$T" 2>&1)" && result=pass || result=fail
  if [ "$result" != "$2" ]; then bad "$1: expected $2, got $result: $out"; return; fi
  if [ -n "${3:-}" ] && ! printf '%s' "$out" | grep -qF "$3"; then bad "$1: the message does not name $3: $out"; return; fi
  ok "$1"
}

expect "a tree as set-release.sh and update-sources.sh leave it passes" pass
grep -q '^ *tag: v1.2.0$' "$T/$DIR/app.mindsift.MindSift.yml" && ok "set-release.sh moves the manifest's tag" || bad "set-release.sh did not move the tag"
grep -q '^ *commit:' "$T/$DIR/app.mindsift.MindSift.yml" && bad "set-release.sh kept the old tag's commit" || ok "set-release.sh drops the old tag's commit"
grep -q '<release version="1.2.0" date="2026-12-01" type="stable">' "$T/$DIR/app.mindsift.MindSift.metainfo.xml" \
  && ok "set-release.sh adds the release entry with the CHANGELOG's date" || bad "set-release.sh did not add the release entry"
grep -qF '<p>Notes &amp; tasks &lt;faster&gt; \ a|b.</p>' "$T/$DIR/app.mindsift.MindSift.metainfo.xml" \
  && ok "set-release.sh writes the summary as XML text" || bad "the summary is not in the entry as XML text"
grep -q 'mindsift/main/screenshots/' "$T/$DIR/app.mindsift.MindSift.metainfo.xml" \
  && bad "set-release.sh left screenshots on main" || ok "set-release.sh points the screenshots at the tag"

cp "$T/desktop/go.sum" "$T/go.sum.orig"
echo "example.com/x v1.0.0 h1:x=" >> "$T/desktop/go.sum"
expect "a changed desktop/go.sum fails" fail update-sources.sh
cp "$T/go.sum.orig" "$T/desktop/go.sum"
cp "$T/frontend/package-lock.json" "$T/lock.orig"
echo " " >> "$T/frontend/package-lock.json"
expect "a changed frontend/package-lock.json fails" fail update-sources.sh
cp "$T/lock.orig" "$T/frontend/package-lock.json"
rm "$T/$DIR/node-sources.json"
expect "a missing node-sources.json fails" fail update-sources.sh
echo stand-in > "$T/$DIR/node-sources.json"
expect "restored, the tree passes again" pass

sed -i 's/"version": "1.2.0"/"version": "1.3.0-rc.1"/' "$T/frontend/package.json"
expect "a new version without set-release.sh fails" fail set-release.sh
(cd "$T" && sh "$DIR/set-release.sh" v1.3.0-rc.1 'A pre-release.' >/dev/null 2>&1) || bad "set-release.sh v1.3.0-rc.1 failed"
expect "after set-release.sh the new version passes" pass
grep -q '<release version="1.3.0-rc.1" date="2026-12-05" type="development">' "$T/$DIR/app.mindsift.MindSift.metainfo.xml" \
  && ok "a pre-release gets type development" || bad "the pre-release entry is wrong"
[ "$(grep -c '<release version="1.2.0"' "$T/$DIR/app.mindsift.MindSift.metainfo.xml")" = 1 ] \
  && ok "the older entry stays once" || bad "the older entry is missing or doubled"
sed -i 's|<release version="1.3.0-rc.1"|<release version="9.9.9"|' "$T/$DIR/app.mindsift.MindSift.metainfo.xml"
expect "a metainfo without the version's entry fails" fail "no <release> entry"

[ "$failures" = 0 ] || { echo "test-check-sources: $failures failed" >&2; exit 1; }
echo "test-check-sources: all passed"
