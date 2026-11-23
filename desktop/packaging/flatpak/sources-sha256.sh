#!/bin/sh
# Prints the checksums of the inputs of the generated Flatpak sources, as update-sources.sh writes them to
# sources.sha256 and check-sources.sh compares them: desktop/go.mod, desktop/go.sum and
# frontend/package-lock.json. The lockfile is hashed with MindSift's own version left out
# (ci/lock-version.sh): node-sources.json lists the npm packages only, so a release that only raises the
# version needs no new sources. POSIX sh, sha256sum without options (BusyBox too).
# Usage: desktop/packaging/flatpak/sources-sha256.sh [<repository root>]
set -eu
ROOT="${1:-$(cd "$(dirname "$0")/../../.." && pwd)}"
cd "$ROOT"
sha256sum desktop/go.mod desktop/go.sum
# (in two steps: a failing lock-version.sh must fail here, not hash its empty output)
normalized="$(sh ci/lock-version.sh frontend/package-lock.json '')"
lock="$(printf '%s\n' "$normalized" | sha256sum)"
printf '%s  frontend/package-lock.json\n' "${lock%% *}"
