#!/usr/bin/env bash
# Builds the desktop app of a release with desktop/build.sh and desktop/packaging/flatpak/build.sh and puts
# the files of the release page into <dir>, under the names the website links to
# (releases/latest/download/<name>):
#   mindsift-desktop-linux-amd64.tar.gz       the Linux binary with LICENSE, THIRD_PARTY_LICENSES.txt and
#                                             README.txt (GTK 4 / WebKitGTK 6.0)
#   mindsift-desktop-linux-amd64.flatpak      the Flatpak bundle (runtime from Flathub)
#   mindsift-desktop-windows-amd64.exe        the Windows app
#   mindsift-desktop-THIRD_PARTY_LICENSES.txt the license file of both binaries, for the bare .exe
# Checks that each file is for its platform and carries <version>. The files land in <dir> only when all
# were built. SHA256SUMS is written by ci/release-binaries.sh over every file in the folder.
# Usage: ci/release-desktop.sh <version, e.g. v1.2.0> <dir>
# Optional: ENGINE (default docker), COPY_MODE (default 1, see desktop/build.sh). Needs GNU tar.
set -euo pipefail

VERSION="${1:?usage: ci/release-desktop.sh <version> <dir>}"
OUT="${2:?usage: ci/release-desktop.sh <version> <dir>}"
case "${VERSION}" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "release-desktop: the version must look like v1.2.3, not '${VERSION}'" >&2; exit 1 ;;
esac
export ENGINE="${ENGINE:-docker}" COPY_MODE="${COPY_MODE:-1}" APP_VERSION="${VERSION}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
D="${ROOT}/desktop/out"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

# The previous build's files must not be taken for this one's
rm -f "${D}"/mindsift-desktop-* "${D}/THIRD_PARTY_LICENSES.txt" "${D}/third-party-npm.txt"
"${ROOT}/desktop/build.sh" all
SKIP_FRONTEND=1 "${ROOT}/desktop/packaging/flatpak/build.sh"

fail() { echo "release-desktop: $*" >&2; exit 1; }
# The version is linked in as a plain string (-X main.version)
grep -qaF "${VERSION}" "${D}/mindsift-desktop-linux-amd64" || fail "the Linux binary does not carry ${VERSION}"
grep -qaF "${VERSION}" "${D}/mindsift-desktop-windows-amd64.exe" || fail "the Windows exe does not carry ${VERSION}"
# ELF for x86-64 (e_machine 0x3e) and PE for x86-64 (machine 0x8664 behind the "PE\0\0" signature)
[ "$(od -An -tx1 -j18 -N2 "${D}/mindsift-desktop-linux-amd64" | tr -d ' \n')" = "3e00" ] || fail "the Linux binary is not for x86-64"
pe="$(od -An -tu4 -j60 -N4 "${D}/mindsift-desktop-windows-amd64.exe" | tr -d ' ')"
[ "$(od -An -tx1 -j"${pe}" -N6 "${D}/mindsift-desktop-windows-amd64.exe" | tr -d ' \n')" = "504500006486" ] || fail "the Windows exe is not for x86-64"
# The bundle's version is in its metainfo (flatpak/build.sh); the build fails when build-bundle does
[ -s "${D}/mindsift-desktop-linux-amd64.flatpak" ] || fail "the Flatpak bundle is missing"
grep -q '^github.com/wailsapp/wails/v3 ' "${D}/THIRD_PARTY_LICENSES.txt" || fail "THIRD_PARTY_LICENSES.txt lists no Wails"

name=mindsift-desktop-linux-amd64
mkdir -p "${WORK}/files" "${WORK}/${name}"
install -m 755 "${D}/mindsift-desktop-linux-amd64" "${WORK}/${name}/mindsift-desktop"
install -m 644 "${ROOT}/LICENSE" "${D}/THIRD_PARTY_LICENSES.txt" "${ROOT}/desktop/packaging/linux/README.txt" "${WORK}/${name}/"
tar -C "${WORK}" --owner=0 --group=0 --numeric-owner -czf "${WORK}/files/${name}.tar.gz" "${name}"
cp "${D}/mindsift-desktop-linux-amd64.flatpak" "${D}/mindsift-desktop-windows-amd64.exe" "${WORK}/files/"
cp "${D}/THIRD_PARTY_LICENSES.txt" "${WORK}/files/mindsift-desktop-THIRD_PARTY_LICENSES.txt"

mkdir -p "${OUT}"
mv "${WORK}"/files/* "${OUT}/"
ls -l "${OUT}"
