#!/usr/bin/env bash
# Adds the Flatpak bundle of a release to MindSift's own Flatpak repository (an OSTree repository served by
# GitHub Pages from the gh-pages branch of a separate git repository, by default flatpak.mindsift.app), so
# installed apps get the release through GNOME Software, Discover or `flatpak update`.
#   1. Checks the bundle against the release's SHA256SUMS (when given) and that it is the app for x86_64
#      carrying <tag> in its metainfo, and that <tag> is no pre-release and not older than the release
#      the repository holds (the branch only moves forward).
#   2. Clones the branch (or starts it when the remote has none), imports the bundle into a scratch repo and
#      commits it onto app/app.mindsift.MindSift/x86_64/stable of repo/, whatever branch the bundle was
#      built with (bundles up to v0.98.0 are on master, later ones on stable and carry this repository as
#      their origin; build-commit-from rewrites the ref binding, the previous release becomes the parent).
#      The same bundle twice makes no new commit.
#   3. Updates the summary and appstream branches, static deltas, prunes all but the last KEEP old
#      versions, signs commits and summary with the GPG key.
#   4. Writes the site around repo/: mindsift.flatpakrepo, app.mindsift.MindSift.flatpakref (both with the
#      public key), the key as mindsift.gpg, icon.png, index.html, .nojekyll; CNAME stays as it is (a new
#      branch gets the host of an https SITE_URL).
#   5. Commits all of it as a single commit without history (the OSTree repo keeps its own history;
#      git history would keep every pruned release forever) and force-pushes it, unless nothing changed.
# Usage: ci/flatpak-repo.sh <tag, e.g. v1.2.0> <bundle.flatpak> <git remote>
# Env: FLATPAK_GPG_PRIVATE_KEY (required, ASCII-armored secret key without passphrase), SHA256SUMS (path
# of the release's checksum file), SITE_URL (default https://flatpak.mindsift.app), PAGES_BRANCH (default
# gh-pages), KEEP (old versions kept, default 5), PUSH (default 1; 0 leaves the result in WORKDIR),
# WORKDIR (default a temporary folder, removed at the end unless given). Git reaches the remote as
# configured, e.g. GIT_SSH_COMMAND with a deploy key. Needs flatpak, ostree, gpg, git.
set -euo pipefail

TAG="${1:?usage: ci/flatpak-repo.sh <tag> <bundle.flatpak> <git remote>}"
BUNDLE="${2:?usage: ci/flatpak-repo.sh <tag> <bundle.flatpak> <git remote>}"
REMOTE="${3:?usage: ci/flatpak-repo.sh <tag> <bundle.flatpak> <git remote>}"
: "${FLATPAK_GPG_PRIVATE_KEY:?FLATPAK_GPG_PRIVATE_KEY must hold the ASCII-armored signing key}"
SITE_URL="${SITE_URL:-https://flatpak.mindsift.app}"
SITE_URL="${SITE_URL%/}"
PAGES_BRANCH="${PAGES_BRANCH:-gh-pages}"
KEEP="${KEEP:-5}"
PUSH="${PUSH:-1}"
APP_ID=app.mindsift.MindSift
ARCH=x86_64
REF="app/${APP_ID}/${ARCH}/stable"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

fail() { echo "flatpak-repo: $*" >&2; exit 1; }
case "${TAG}" in
  *-*) fail "${TAG} is a pre-release; only releases go to the stable branch" ;;
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) fail "the tag must look like v1.2.3, not '${TAG}'" ;;
esac
case "${KEEP}" in ''|*[!0-9]*) fail "KEEP must be a number" ;; esac
[ -s "${BUNDLE}" ] || fail "no bundle at ${BUNDLE}"
BUNDLE="$(cd "$(dirname "${BUNDLE}")" && pwd)/$(basename "${BUNDLE}")"

if [ -n "${WORKDIR:-}" ]; then
  mkdir -p "${WORKDIR}"
  WORK="$(cd "${WORKDIR}" && pwd)"
else
  WORK="$(mktemp -d)"
  trap 'gpgconf --homedir "${WORK}/gnupg" --kill all >/dev/null 2>&1 || true; rm -rf "${WORK}"' EXIT
fi
SITE="${WORK}/site"
rm -rf "${SITE}" "${WORK}/import" "${WORK}/gnupg"

# 1. The bundle
if [ -n "${SHA256SUMS:-}" ]; then
  name="$(basename "${BUNDLE}")"
  want="$(awk -v n="${name}" '$2 == n || $2 == "*" n { print $1 }' "${SHA256SUMS}")"
  [ -n "${want}" ] || fail "${SHA256SUMS} has no checksum for ${name}"
  [ "$(sha256sum "${BUNDLE}" | cut -d' ' -f1)" = "${want}" ] || fail "${name} does not match its checksum in SHA256SUMS"
fi
ostree init --repo="${WORK}/import" --mode=archive-z2
flatpak build-import-bundle --no-update-summary "${WORK}/import" "${BUNDLE}" >/dev/null
src_ref="$(ostree refs --repo="${WORK}/import" | grep "^app/${APP_ID}/${ARCH}/" || true)"
[ "$(printf '%s\n' "${src_ref}" | grep -c .)" = 1 ] || fail "the bundle holds no single ref app/${APP_ID}/${ARCH}/… (found: ${src_ref:-none})"
ostree cat --repo="${WORK}/import" "${src_ref}" "/files/share/metainfo/${APP_ID}.metainfo.xml" \
  | grep -qF "<release version=\"${TAG#v}\"" || fail "the bundle's metainfo has no release ${TAG#v}; is it the bundle of ${TAG}?"

# The signing key, in a keyring of its own
export GNUPGHOME="${WORK}/gnupg"
mkdir -m 700 "${GNUPGHOME}"
printf '%s\n' "${FLATPAK_GPG_PRIVATE_KEY}" | gpg --batch --quiet --import
KEY="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
[ -n "${KEY}" ] || fail "FLATPAK_GPG_PRIVATE_KEY holds no secret key"
GPG_KEY_B64="$(gpg --batch --export "${KEY}" | base64 -w0)"

# 2. The branch, or a new one
if git ls-remote --exit-code --heads "${REMOTE}" "${PAGES_BRANCH}" >/dev/null 2>&1; then
  git clone --quiet --depth 1 --branch "${PAGES_BRANCH}" "${REMOTE}" "${SITE}"
else
  echo "flatpak-repo: ${REMOTE} has no branch ${PAGES_BRANCH} yet, starting it"
  git init --quiet "${SITE}"
  git -C "${SITE}" remote add origin "${REMOTE}"
fi
# OSTree's lock file and scratch space are not part of the site
printf '%s\n' /repo/.lock /repo/tmp/ /repo/state/ >> "${SITE}/.git/info/exclude"
[ -d "${SITE}/repo/objects" ] || ostree init --repo="${SITE}/repo" --mode=archive-z2
# git keeps no empty folders, ostree needs them
mkdir -p "${SITE}"/repo/refs/{heads,remotes,mirrors} "${SITE}"/repo/{tmp,extensions,state}
before="$(ostree rev-parse --repo="${SITE}/repo" "${REF}" 2>/dev/null || true)"
# The branch only moves forward: an older release on top would downgrade every installation
if [ -n "${before}" ]; then
  current="$(ostree show --repo="${SITE}/repo" "${before}" | sed -n 's/^ *MindSift \(v[0-9][^ ]*\)$/\1/p' | head -1)"
  if [ -n "${current}" ] && [ "${current}" != "${TAG}" ] \
    && [ "$(printf '%s\n%s\n' "${current}" "${TAG}" | sort -V | tail -1)" != "${TAG}" ]; then
    fail "${REF} already holds ${current}, newer than ${TAG}"
  fi
fi
flatpak build-commit-from --no-update-summary --src-repo="${WORK}/import" --src-ref="${src_ref}" \
  --subject="MindSift ${TAG}" --gpg-homedir="${GNUPGHOME}" --gpg-sign="${KEY}" "${SITE}/repo" "${REF}"
after="$(ostree rev-parse --repo="${SITE}/repo" "${REF}")"

# 3. Summary, appstream, deltas, pruning (only when there is something new: the summary carries a
# timestamp, so a rerun of the same release would otherwise always push)
if [ "${before}" != "${after}" ] || [ ! -f "${SITE}/repo/summary.sig" ]; then
  flatpak build-update-repo --title=MindSift --default-branch=stable --generate-static-deltas \
    --prune --prune-depth="${KEEP}" --gpg-homedir="${GNUPGHOME}" --gpg-sign="${KEY}" "${SITE}/repo"
else
  echo "flatpak-repo: ${REF} already holds this bundle (${after})"
  # build-commit-from still copied the bundle's own commit object; nothing refers to it
  ostree prune --repo="${SITE}/repo" --refs-only --depth=-1 >/dev/null
fi

# 4. The site around the repo
gpg --batch --armor --export "${KEY}" > "${SITE}/mindsift.gpg"
install -m 644 "${ROOT}/desktop/packaging/linux/icons/hicolor/128x128/apps/${APP_ID}.png" "${SITE}/icon.png"
: > "${SITE}/.nojekyll"
# The custom domain of Pages lives in CNAME; a new branch gets the one of SITE_URL
case "${SITE_URL}" in
  https://*) [ -s "${SITE}/CNAME" ] || printf '%s\n' "${SITE_URL#https://}" > "${SITE}/CNAME" ;;
esac
cat > "${SITE}/mindsift.flatpakrepo" <<EOF
[Flatpak Repo]
Title=MindSift
Url=${SITE_URL}/repo/
Homepage=https://mindsift.app/
Comment=The MindSift desktop app
Description=Notes, tasks and lists in one app: the MindSift desktop app, local or connected to a MindSift server.
Icon=${SITE_URL}/icon.png
DefaultBranch=stable
GPGKey=${GPG_KEY_B64}
EOF
cat > "${SITE}/${APP_ID}.flatpakref" <<EOF
[Flatpak Ref]
Name=${APP_ID}
Branch=stable
Title=MindSift
Url=${SITE_URL}/repo/
Homepage=https://mindsift.app/
Comment=Notes, tasks and lists in one app
Icon=${SITE_URL}/icon.png
IsRuntime=false
SuggestRemoteName=mindsift
RuntimeRepo=https://dl.flathub.org/repo/flathub.flatpakrepo
GPGKey=${GPG_KEY_B64}
EOF
cat > "${SITE}/index.html" <<EOF
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>MindSift Flatpak repository</title>
<style>
body { font-family: system-ui, sans-serif; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #222; }
pre { background: #f2f2f2; padding: .75rem 1rem; overflow-x: auto; border-radius: 6px; }
code { font-family: ui-monospace, monospace; }
h1 img { width: 48px; height: 48px; vertical-align: middle; margin-right: .5rem; }
</style>
</head>
<body>
<h1><img src="icon.png" alt="">MindSift Flatpak repository</h1>
<p>The MindSift desktop app for Linux (x86_64) as a Flatpak, with updates through GNOME Software, KDE
Discover or <code>flatpak update</code>. Latest release: <strong>${TAG}</strong>. The runtime
(GNOME Platform) comes from Flathub.</p>
<h2>Install</h2>
<p>Open <a href="${APP_ID}.flatpakref">${APP_ID}.flatpakref</a> with your software center, or run:</p>
<pre><code>flatpak install --user ${SITE_URL}/${APP_ID}.flatpakref</code></pre>
<p>Or add the repository and install from it:</p>
<pre><code>flatpak remote-add --user --if-not-exists mindsift ${SITE_URL}/mindsift.flatpakrepo
flatpak install --user mindsift ${APP_ID}</code></pre>
<p>Run it with <code>flatpak run ${APP_ID}</code> or from your app menu. Updates:
<code>flatpak update</code>.</p>
<h2>Signature</h2>
<p>Commits and summary are signed with the key <a href="mindsift.gpg">mindsift.gpg</a>
(fingerprint <code>${KEY}</code>); both files above carry it, so Flatpak checks every download.</p>
<p><a href="https://mindsift.app/">mindsift.app</a> &middot;
<a href="https://github.com/mindsift-app/mindsift/releases">all releases</a></p>
</body>
</html>
EOF

# 5. One commit without history, pushed when something changed
git -C "${SITE}" add -A
if git -C "${SITE}" rev-parse --verify --quiet HEAD >/dev/null && git -C "${SITE}" diff --cached --quiet; then
  echo "flatpak-repo: nothing changed, nothing to push"
  exit 0
fi
git -C "${SITE}" checkout --quiet --orphan "flatpak-repo-new"
git -C "${SITE}" -c user.name=MindSift -c user.email=noreply@mindsift.app commit --quiet -m "MindSift ${TAG}"
if [ "${PUSH}" = 1 ]; then
  git -C "${SITE}" push --quiet --force origin "HEAD:refs/heads/${PAGES_BRANCH}"
  echo "flatpak-repo: ${TAG} pushed to ${PAGES_BRANCH} (${REF} = ${after})"
else
  echo "flatpak-repo: ${TAG} committed in ${SITE}, not pushed (PUSH=${PUSH})"
fi
