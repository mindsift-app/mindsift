#!/usr/bin/env bash
# Prints the CHANGELOG section of one version as the text of its GitHub release.
#   ci/release-notes.sh v0.87.4   (with or without the leading v)
# Fails when CHANGELOG.md has no section for that version or the section is empty.
set -euo pipefail
VERSION="${1#v}"
CHANGELOG="${CHANGELOG:-$(dirname "$0")/../CHANGELOG.md}"
notes="$(awk -v v="$VERSION" '
  index($0, "## [" v "]") == 1 { found = 1; next }
  found && /^## \[/ { exit }
  found { print }
' "$CHANGELOG" | sed -e '/./,$!d')"
if [ -z "$notes" ]; then
  echo "No CHANGELOG section for ${VERSION}" >&2
  exit 1
fi
printf '%s\n' "$notes"
