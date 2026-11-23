#!/usr/bin/env bash
# Tests of ci/release-check.sh and ci/release-prepare.sh in a throwaway git repository with copies of the
# files they read and stand-ins for the generated Flatpak sources (run by ci/local-checks.sh; no
# containers, no network). Usage: ci/test-release-check.sh
set -euo pipefail
cd "$(dirname "$0")/.."
T="$(mktemp -d)"
S="$(mktemp -d)"
trap 'rm -rf "$T" "$S"' EXIT
DIR=desktop/packaging/flatpak
failures=0
ok() { echo "ok   $1"; }
bad() { echo "FAIL $1" >&2; failures=$((failures + 1)); }
# The test repository's commits: no settings of the machine (hooks, signing), a fixed identity
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1 GIT_AUTHOR_NAME=Test GIT_AUTHOR_EMAIL=test@example.invalid \
  GIT_COMMITTER_NAME=Test GIT_COMMITTER_EMAIL=test@example.invalid
g() { git -C "$T" "$@"; }

# A tree at the release v1.2.0, tagged
mkdir -p "$T/ci" "$T/frontend" "$T/$DIR"
cp ci/version.sh ci/lock-version.sh ci/release-check.sh ci/release-prepare.sh "$T/ci/"
cp desktop/go.mod desktop/go.sum "$T/desktop/"
cp "$DIR/app.mindsift.MindSift.yml" "$DIR/app.mindsift.MindSift.metainfo.xml" "$DIR/check-sources.sh" "$DIR/set-release.sh" \
  "$DIR/sources-sha256.sh" "$T/$DIR/"
for f in go.mod.yml modules.txt node-sources.json; do echo stand-in > "$T/$DIR/$f"; done
printf '{\n  "name": "mindsift-frontend",\n  "version": "1.2.0",\n  "private": true\n}\n' > "$T/frontend/package.json"
sh ci/lock-version.sh frontend/package-lock.json 1.2.0 > "$T/frontend/package-lock.json"
printf '# MindSift\n\n[![License](https://img.shields.io/badge/License-AGPLv3-6b7280?style=flat-square)](LICENSE)\n[![Version](https://img.shields.io/badge/Version-v1.2.0-16a34a?style=flat-square)](CHANGELOG.md)\n' > "$T/README.md"
cat > "$T/CHANGELOG.md" <<'EOF'
# Changelog

## [Unreleased]

## [1.2.0] - 2026-12-01

### Added
- Something.
EOF
sh "$T/$DIR/sources-sha256.sh" "$T" > "$T/$DIR/sources.sha256"
(cd "$T" && sh "$DIR/set-release.sh" v1.2.0 'The release 1.2.0.' >/dev/null)
g init -q -b dev && g add -A && g commit -q -m "chore(release): v1.2.0" && g tag v1.2.0

# check NAME pass|fail TAG [TEXT]: release-check.sh TAG on the tree passes, or fails naming TEXT
check() {
  local out result
  out="$(sh "$T/ci/release-check.sh" "$3" 2>&1)" && result=pass || result=fail
  if [ "$result" != "$2" ]; then bad "$1: expected $2, got $result: $out"; return; fi
  if [ -n "${4:-}" ] && ! printf '%s' "$out" | grep -qF -- "$4"; then bad "$1: the message does not name $4: $out"; return; fi
  ok "$1"
}
# prepare NAME pass|fail ARGS… [-- TEXT]: release-prepare.sh ARGS passes, or fails naming TEXT
prepare() {
  local name="$1" want="$2" text="" out result args=()
  shift 2
  while [ $# -gt 0 ]; do
    if [ "$1" = -- ]; then text="$2"; break; fi
    args+=("$1"); shift
  done
  out="$(TODAY=2026-12-24 sh "$T/ci/release-prepare.sh" "${args[@]}" 2>&1)" && result=pass || result=fail
  if [ "$result" != "$want" ]; then bad "$name: expected $want, got $result: $out"; return; fi
  if [ -n "$text" ] && ! printf '%s' "$out" | grep -qF -- "$text"; then bad "$name: the message does not name $text: $out"; return; fi
  ok "$name"
}
# broken NAME TEXT FILE SED: the tree with SED applied to FILE fails release-check.sh v1.2.0 naming TEXT
broken() {
  cp "$T/$3" "$S/saved"
  sed -i "$4" "$T/$3"
  check "$1" fail v1.2.0 "$2"
  cp "$S/saved" "$T/$3"
}

check "the release commit passes" pass v1.2.0
check "another version fails" fail v1.2.1 "package.json has version '1.2.0'"
check "a tag that is no version fails" fail release-1.2 "no version like v1.2.3"
broken "package-lock.json with another version fails" "package-lock.json has versions" frontend/package-lock.json '9s/1\.2\.0/1.1.0/'
broken "a README badge of another version fails" "version badge" README.md 's/Version-v1\.2\.0-/Version-v1.1.0-/'
broken "a CHANGELOG without [Unreleased] on top fails" "not '## [Unreleased]'" CHANGELOG.md '/^## \[Unreleased\]/d'
broken "a CHANGELOG section without a date fails" "not '## [1.2.0] - YYYY-MM-DD'" CHANGELOG.md 's/^## \[1\.2\.0\] - .*/## [1.2.0]/'
broken "an empty CHANGELOG section fails" "is empty" CHANGELOG.md '/^###\|^- /d'
broken "a manifest on another tag fails" "git source is on tag 'v1.1.0'" "$DIR/app.mindsift.MindSift.yml" 's/^\( *tag: \).*/\1v1.1.0/'
broken "a metainfo without the release fails" "no <release> entry for 1.2.0" "$DIR/app.mindsift.MindSift.metainfo.xml" 's/<release version="1\.2\.0"/<release version="1.1.9"/'

prepare "nothing unreleased: prepare refuses" fail v1.3.0 'Nothing.' -- "[Unreleased] section of CHANGELOG.md is empty"
printf '%s\n' '/^## \[Unreleased\]/a\' '\' '### Fixed\' '- A fix.' > "$S/unreleased.sed"
sed -i -f "$S/unreleased.sed" "$T/CHANGELOG.md"
g commit -q -am "fix: a fix"
prepare "an older version is refused" fail v1.1.0 'Older.' -- "not newer than the tag v1.2.0"
prepare "the tagged version is refused" fail v1.2.0 'Again.' -- "not newer than the tag v1.2.0"
prepare "an unknown option is refused" fail v1.3.0 'New.' --push -- "usage"
prepare "prepare v1.3.0" pass v1.3.0 'Notes & tasks, faster.'
check "the prepared tree passes release-check" pass v1.3.0
[ "$(sh "$T/ci/version.sh" package "$T")" = 1.3.0 ] && ok "package.json has 1.3.0" || bad "package.json was not set"
[ "$(sh ci/lock-version.sh "$T/frontend/package-lock.json" | tr '\n' ' ')" = "1.3.0 1.3.0 " ] && ok "package-lock.json has 1.3.0 twice" || bad "package-lock.json was not set"
cmp -s <(sh ci/lock-version.sh "$T/frontend/package-lock.json" '') <(sh ci/lock-version.sh frontend/package-lock.json '') \
  && ok "nothing else in package-lock.json changed" || bad "package-lock.json changed elsewhere"
grep -qF 'badge/Version-v1.3.0-16a34a' "$T/README.md" && ok "the README badge shows v1.3.0" || bad "the README badge was not set"
[ "$(grep '^## \[' "$T/CHANGELOG.md" | head -n 3 | tr '\n' '|')" = "## [Unreleased]|## [1.3.0] - 2026-12-24|## [1.2.0] - 2026-12-01|" ] \
  && ok "the CHANGELOG has the dated section below a new [Unreleased]" || bad "the CHANGELOG sections are wrong: $(grep '^## \[' "$T/CHANGELOG.md")"
awk '/^## \[1\.3\.0\]/ { s = 1; next } s && /^## / { exit } s' "$T/CHANGELOG.md" | grep -qx -- '- A fix.' \
  && ok "the unreleased entries are in the new section" || bad "the entries did not move into the new section"
grep -q '<release version="1.3.0" date="2026-12-24" type="stable">' "$T/$DIR/app.mindsift.MindSift.metainfo.xml" \
  && ok "the metainfo has the release, dated as the CHANGELOG" || bad "the metainfo entry is missing or misdated"
grep -q '^ *tag: v1.3.0$' "$T/$DIR/app.mindsift.MindSift.yml" && ok "the manifest is on tag v1.3.0" || bad "the manifest's tag was not set"
[ "$(g status --porcelain | wc -l)" -gt 0 ] && [ "$(g log -1 --format=%s)" = "fix: a fix" ] \
  && ok "without --commit nothing is committed" || bad "release-prepare committed without --commit"
prepare "a second run finds nothing unreleased" fail v1.3.0 'Again.' -- "[Unreleased] section of CHANGELOG.md is empty"

# A pre-release, committed by the script
g checkout -q -- . && sed -i -f "$S/unreleased.sed" "$T/CHANGELOG.md" && g commit -q -am "feat: more"
prepare "prepare v1.4.0-rc.1 --commit" pass v1.4.0-rc.1 'A pre-release.' --commit
check "the pre-release passes release-check" pass v1.4.0-rc.1
grep -qF 'badge/Version-v1.4.0--rc.1-16a34a' "$T/README.md" && ok "the badge escapes the pre-release's -" || bad "the pre-release badge is wrong"
grep -q '<release version="1.4.0-rc.1" date="2026-12-24" type="development">' "$T/$DIR/app.mindsift.MindSift.metainfo.xml" \
  && ok "a pre-release is a development release in the metainfo" || bad "the pre-release entry is wrong"
[ "$(g log -1 --format=%s)" = "chore(release): v1.4.0-rc.1" ] && [ -z "$(g status --porcelain)" ] \
  && ok "--commit makes the release commit with all changes" || bad "--commit: $(g log -1 --format=%s), $(g status --porcelain)"
g tag v1.4.0-rc.1
prepare "after the pre-release, its release is newer" fail v1.4.0 'The release.' -- "[Unreleased] section of CHANGELOG.md is empty"
sed -i -f "$S/unreleased.sed" "$T/CHANGELOG.md" && g commit -q -am "fix: another"
prepare "an older pre-release is refused" fail v1.4.0-beta.1 'Older.' -- "not newer than the tag v1.4.0-rc.1"
prepare "prepare v1.4.0 after v1.4.0-rc.1" pass v1.4.0 'The release.'
check "v1.4.0 passes release-check" pass v1.4.0

[ "$failures" = 0 ] || { echo "test-release-check: $failures failed" >&2; exit 1; }
echo "test-release-check: all passed"
