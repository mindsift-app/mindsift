#!/bin/sh
# MindSift's own version in frontend/package-lock.json: the two lines npm writes it to, the top-level
# "version" and the one of the root package (packages.""). Everything else in the lockfile is left alone,
# so no npm install is needed to change it.
#   ci/lock-version.sh <package-lock.json>             prints the two versions, one per line
#   ci/lock-version.sh <package-lock.json> <version>   prints the lockfile with both set to <version> (an
#                                                      empty <version> gives the normalized lockfile whose
#                                                      checksum desktop/packaging/flatpak/sources.sha256 holds)
# Fails when the lockfile lacks either line. POSIX sh and awk only (BusyBox too).
set -eu
LOCK="${1:?usage: ci/lock-version.sh <package-lock.json> [<version>]}"
if [ $# -ge 2 ]; then mode="set"; else mode="print"; fi
awk -v mode="$mode" -v version="${2:-}" '
  function value(line) { sub(/^ *"version": "/, "", line); sub(/".*/, "", line); return line }
  function swap(line) { sub(/"version": "[^"]*"/, "\"version\": \"" version "\"", line); return line }
  # top level: the first "version" indented by two spaces
  !top && /^  "version": "/ { top = 1; if (mode == "print") print value($0); else $0 = swap($0) }
  # the root package: the first "version" of the block "": { … } of packages
  /^    "": \{$/ { inroot = 1 }
  inroot && /^      "version": "/ { inroot = 0; root = 1; if (mode == "print") print value($0); else $0 = swap($0) }
  inroot && /^    \}/ { inroot = 0 }
  mode == "set" { print }
  END { if (!top || !root) { print "lock-version: " FILENAME " has no top-level or root package version" > "/dev/stderr"; exit 1 } }
' "$LOCK"
