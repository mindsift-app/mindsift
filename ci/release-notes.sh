#!/usr/bin/env bash
# Prints the CHANGELOG section of one version as the text of its GitHub release.
#   ci/release-notes.sh v0.87.4   (with or without the leading v)
# Versions before 0.80.0 are read from CHANGELOG-archive.md. Fails when neither file has a section for
# that version or the section is empty.
set -euo pipefail
VERSION="${1#v}"
CHANGELOG="${CHANGELOG:-$(dirname "$0")/../CHANGELOG.md}"
ARCHIVE="${CHANGELOG%.md}-archive.md"
[ -f "$ARCHIVE" ] || ARCHIVE=/dev/null
notes="$(awk -v v="$VERSION" '
  found && FNR == 1 { exit }
  index($0, "## [" v "]") == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' "$CHANGELOG" "$ARCHIVE" | sed -e '/./,$!d')"
if [ -z "$notes" ]; then
  echo "No CHANGELOG section for ${VERSION}" >&2
  exit 1
fi
printf '%s\n' "$notes"
