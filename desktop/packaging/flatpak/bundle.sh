#!/bin/sh
# Makes the single-file bundle of the app from the OSTree repository flatpak-builder exported it to.
# Called by build.sh inside its flatpak container (needs flatpak, and gpg with gpg-agent when signing).
# Usage: bundle.sh <repo> <out.flatpak> [<signing key file>]
#
# With a signing key (the ASCII-armored secret key of the own Flatpak repository, FLATPAK_GPG_PRIVATE_KEY
# in the release workflow) the bundle carries that repository as its origin: the commit is signed with the
# key, and the bundle gets the repository's URL and public key. `flatpak install` of the bundle then adds
# (or reuses) a remote for https://flatpak.mindsift.app/repo/ that trusts the key, and `flatpak update`
# takes new releases from there. Without a key (local and Gitea builds) the bundle has no origin and is
# installed as before, without updates.
# The ref is app/app.mindsift.MindSift/x86_64/stable, the one of the repository (build.sh builds with
# --default-branch=stable). No collection ID, as in the repository.
# Env: FLATPAK_REPO_URL (default https://flatpak.mindsift.app/repo/; must be the repository's URL exactly,
# so an existing remote of the repository is reused).
set -eu
REPO="${1:?usage: bundle.sh <repo> <out.flatpak> [<signing key file>]}"
OUT="${2:?usage: bundle.sh <repo> <out.flatpak> [<signing key file>]}"
KEY_FILE="${3:-}"
APP_ID=app.mindsift.MindSift
BRANCH=stable
REPO_URL="${FLATPAK_REPO_URL:-https://flatpak.mindsift.app/repo/}"

if [ -z "$KEY_FILE" ]; then
  echo "bundle: no signing key, the bundle gets no origin repository (no updates after installing it)"
  flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo "$REPO" "$OUT" "$APP_ID" "$BRANCH"
  exit 0
fi

GNUPGHOME="$(mktemp -d)"
export GNUPGHOME
trap 'gpgconf --kill all >/dev/null 2>&1 || true; rm -rf "$GNUPGHOME"' EXIT
gpg --batch --quiet --import "$KEY_FILE"
fpr="$(gpg --batch --with-colons --list-secret-keys | awk -F: '$1 == "fpr" { print $10; exit }')"
[ -n "$fpr" ] || { echo "bundle: the signing key file holds no secret key" >&2; exit 1; }
gpg --batch --export "$fpr" > "$GNUPGHOME/repo.gpg"
# flatpak install checks the bundle's commit against the key it carries
flatpak build-sign --gpg-homedir="$GNUPGHOME" --gpg-sign="$fpr" "$REPO" "$APP_ID" "$BRANCH"
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  --repo-url="$REPO_URL" --gpg-keys="$GNUPGHOME/repo.gpg" "$REPO" "$OUT" "$APP_ID" "$BRANCH"
echo "bundle: origin $REPO_URL, signed with $fpr"
