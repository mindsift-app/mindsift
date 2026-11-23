#!/bin/sh
# Builds the Flatpak bundle of the desktop app in containers: desktop/out/mindsift-desktop-linux-amd64.flatpak
#   desktop/packaging/flatpak/build.sh                  the working tree, as v<package.json>-dev
#   APP_VERSION=v1.2.0 desktop/packaging/flatpak/build.sh
#                                                       the tag v1.2.0 when it exists (as the release does),
#                                                       else the working tree with that version
#   FLATPAK_GPG_PRIVATE_KEY="$(cat key.asc)" …          the bundle gets the own Flatpak repository as its
#                                                       origin (bundle.sh), so installs of it get updates
#   CHECK_SCREENSHOTS=0 …                               a tag build without the screenshot check (tags
#                                                       from before the PNG screenshots, v0.99.0 and older)
# Install it with: flatpak install --user mindsift-desktop-linux-amd64.flatpak (the GNOME runtime comes
# from Flathub).
#
# The build is the one Flathub makes, with the manifest app.mindsift.MindSift.yml as it is: its git source
# (the tag), the generated Go and npm sources (update-sources.sh), and inside the SDK without network the
# frontend, desktop/vendor, the binary and THIRD_PARTY_LICENSES.txt. Only the source differs by state:
# 1. A tag (APP_VERSION names a tag of the checkout, as in the release workflow): the manifest's tag must
#    be APP_VERSION; its commit is pinned to the one the tag points to (set-release.sh drops it before
#    tagging). flatpak-builder clones the tag from GitHub, so the build takes the tag's files, not the
#    working tree's. The bundle must carry the release's metainfo entry and every screenshot of it.
# 2. Anything else (development builds, the Gitea builds of main): the git source is swapped for the working
#    tree, staged in desktop/out/flatpak/src (the files git knows or would add, uncommitted changes
#    included, ignored ones such as node_modules left out), with the version in desktop/app-version.
# flatpak-builder runs in a Debian container with SYS_ADMIN (bubblewrap needs its own namespaces), with the
# runtimes cached in the podman/docker volume mindsift-flatpak and the downloaded sources (git mirror, Go
# module archives, npm packages) in mindsift-flatpak-sources; the binary is built inside the GNOME SDK with
# the Go and Node extensions, so glibc, GTK and WebKitGTK are the runtime's. The ref is on the branch
# stable, the one of the own Flatpak repository; bundle.sh makes the bundle (with the repository as its
# origin when FLATPAK_GPG_PRIVATE_KEY holds its signing key).
# Like desktop/build.sh it runs with podman and bind mounts locally; the CI workflow sets ENGINE=docker
# COPY_MODE=1 and the sources are copied into the containers instead.
set -eu
cd "$(dirname "$0")/../../.."
ROOT="$PWD"
ENGINE="${ENGINE:-podman}"
COPY_MODE="${COPY_MODE:-0}"
FLATPAK_IMAGE=docker.io/library/debian:trixie-20261027-slim
APP_ID=app.mindsift.MindSift
DIR=desktop/packaging/flatpak
# GNOME 51 (released 2026-09) is a branch: its security rebuilds come along, as they do for every user of
# the runtime. The Go and Node extensions are pinned to a commit, so a new Go or Node only comes in
# deliberately (14-day rule): f9e1ac9f… is Go 1.27.3, published on Flathub 2026-10-21; eb3f0d47… is the
# Node 24 extension published 2026-09-19 (the next one, 2026-11-12, was too young on 2026-11-23).
GNOME_BRANCH=51
EXT_BRANCH=26.08
GO_EXT_COMMIT=f9e1ac9f0c6f95e0df3a4a972a9b7d008715b336c9558098678045a24b81c102
NODE_EXT_COMMIT=eb3f0d4736b50b678eb7ad130ee0cb553711872a9be175cb6d812208ea8f5ed5
STAGE=desktop/out/flatpak
OUT=desktop/out/mindsift-desktop-linux-amd64.flatpak
APP_VERSION="${APP_VERSION:-v$(sed -n 's/.*"version": "\(.*\)".*/\1/p' frontend/package.json | head -1)-dev}"
case "$APP_VERSION" in
  v[0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "APP_VERSION must look like v1.2.3 or v1.2.3-suffix, not '$APP_VERSION'" >&2; exit 1 ;;
esac

rm -rf "$STAGE" && mkdir -p "$STAGE"
cp "$DIR/$APP_ID.yml" "$DIR/go.mod.yml" "$DIR/modules.txt" "$DIR/node-sources.json" "$DIR/bundle.sh" "$STAGE/"
MANIFEST="$STAGE/$APP_ID.yml"
TAG_BUILD=0
if git rev-parse -q --verify "refs/tags/$APP_VERSION" >/dev/null 2>&1; then
  TAG_BUILD=1
  tag="$(sed -n 's/^ *tag: *\([^ ]*\) *$/\1/p' "$MANIFEST")"
  [ "$tag" = "$APP_VERSION" ] || { echo "the manifest's git source is on tag '$tag', not $APP_VERSION: build from a checkout of $APP_VERSION (set-release.sh sets the tag before tagging)" >&2; exit 1; }
  commit="$(git rev-parse "$APP_VERSION^{commit}")"
  given="$(sed -n 's/^ *commit: *\([0-9a-f]*\) *$/\1/p' "$MANIFEST")"
  if [ -z "$given" ]; then
    sed -i "s|^\( *\)tag: .*\$|&\\
\1commit: $commit|" "$MANIFEST"
  elif [ "$given" != "$commit" ]; then
    echo "the manifest's commit $given is not the one of $APP_VERSION ($commit)" >&2; exit 1
  fi
  echo "flatpak: building tag $APP_VERSION ($commit) from the manifest's git source"
else
  # The working tree's files that git knows or would add, deleted ones skipped; the screenshots are not
  # needed. The git source (type, url, tag, commit) becomes a dir source of them.
  mkdir -p "$STAGE/src"
  git ls-files -z --cached --others --exclude-standard -- . ':!screenshots' \
    | xargs -0 sh -c 'for f; do [ -e "$f" ] && printf "%s\0" "$f"; done' sh \
    | tar -C "$ROOT" --null -T - -cf - | tar -C "$STAGE/src" -xf -
  printf '%s\n' "$APP_VERSION" > "$STAGE/src/desktop/app-version"
  awk '
    /^ *- type: git$/ { sub(/type: git$/, "type: dir"); print; ind = $0; sub(/-.*/, "", ind); print ind "  path: src"; skip = 1; next }
    skip && /^ *(url|tag|commit|branch): / { next }
    { skip = 0; print }
  ' "$DIR/$APP_ID.yml" > "$MANIFEST"
  grep -q '^ *path: src$' "$MANIFEST" && ! grep -q '^ *- type: git$' "$MANIFEST" \
    || { echo "could not swap the manifest's git source for the working tree" >&2; exit 1; }
  echo "flatpak: building the working tree as $APP_VERSION"
fi
# A release build checks that the bundle has the release's metainfo entry and every screenshot of the
# metainfo: flatpak-builder's appstreamcli compose downloads each one and silently drops those it cannot
# load (no WebP, nothing unreachable)
CHECK_RELEASE="$TAG_BUILD"
CHECK_SCREENSHOTS="${CHECK_SCREENSHOTS:-$TAG_BUILD}"

$ENGINE volume create mindsift-flatpak >/dev/null 2>&1 || true
$ENGINE volume create mindsift-flatpak-sources >/dev/null 2>&1 || true

# run_in IMAGE WORKDIR CMD [options]: CMD in IMAGE with $STAGE at /stage (WORKDIR below it) and the cache
# volumes mounted; in COPY_MODE the stage is copied in and back out.
VOLUMES="-v mindsift-flatpak:/var/lib/flatpak -v mindsift-flatpak-sources:/state"
run_in() {
  image="$1"; workdir="$2"; cmd="$3"; opts="${4:-}"
  if [ "$COPY_MODE" != "1" ]; then
    $ENGINE run --rm $opts $VOLUMES -v "$ROOT/$STAGE":/stage:Z -w "/stage/$workdir" "$image" sh -c "$cmd"
    return
  fi
  id="$($ENGINE create $opts $VOLUMES -w "/stage/$workdir" "$image" sh -c "$cmd")"
  status=0
  $ENGINE cp "$ROOT/$STAGE/." "$id:/stage" && $ENGINE start -a "$id" || status=$?
  if [ "$status" = 0 ]; then
    rm -rf "${ROOT:?}/$STAGE" && mkdir -p "$ROOT/$STAGE"
    $ENGINE cp "$id:/stage/." "$ROOT/$STAGE" || status=$?
  fi
  $ENGINE rm -f "$id" >/dev/null
  return "$status"
}

# Build the app and the bundle. flatpak-builder runs every step in bubblewrap, which needs namespaces and
# mounts of its own (proc too): instead of --privileged only what that takes, SYS_ADMIN, NET_ADMIN (the
# loopback of a sandbox without network, e.g. the icon check of the export), no seccomp and AppArmor
# profile, and /proc without the engine's masked paths (bwrap cannot mount proc over them; Docker calls
# this systempaths=unconfined, podman unmask=ALL). No devices, no other capabilities.
SANDBOX_OPTS="--cap-add SYS_ADMIN --cap-add NET_ADMIN --security-opt seccomp=unconfined --security-opt apparmor=unconfined"
case "$ENGINE" in
  *podman*) SANDBOX_OPTS="$SANDBOX_OPTS --security-opt unmask=ALL" ;;
  *) SANDBOX_OPTS="$SANDBOX_OPTS --security-opt systempaths=unconfined" ;;
esac
# The signing key of the own Flatpak repository goes into this container only, as an environment variable
# passed by name (its value is not on the command line); the script moves it into a file only root can
# read and drops the variable before anything else runs, so the build steps do not inherit it.
if [ -n "${FLATPAK_GPG_PRIVATE_KEY:-}" ]; then
  export FLATPAK_GPG_PRIVATE_KEY
  SANDBOX_OPTS="$SANDBOX_OPTS -e FLATPAK_GPG_PRIVATE_KEY"
fi
# Downloads (git mirror, archives, npm packages) stay in /state/builder between builds; the build and export
# folders and the build cache of flatpak-builder go. The build steps themselves have no network (the manifest grants
# none), as on Flathub.
# (librsvg2-common: flatpak-builder runs appstreamcli compose in this container, which reads the SVG icon;
# git and unzip: the git source and the Go module archives; gpg and gpg-agent: bundle.sh signs with the repository's key)
run_in "$FLATPAK_IMAGE" . "set -e
  key=
  if [ -n \"\${FLATPAK_GPG_PRIVATE_KEY:-}\" ]; then
    key=\$(mktemp)
    printf '%s\\n' \"\$FLATPAK_GPG_PRIVATE_KEY\" > \"\$key\"
  fi
  unset FLATPAK_GPG_PRIVATE_KEY
  apt-get update -qq >/dev/null
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq --no-install-recommends flatpak flatpak-builder librsvg2-common ca-certificates git unzip gpg gpg-agent >/dev/null
  flatpak remote-add --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
  for ref in org.gnome.Platform//$GNOME_BRANCH org.gnome.Sdk//$GNOME_BRANCH org.freedesktop.Sdk.Extension.golang//$EXT_BRANCH org.freedesktop.Sdk.Extension.node24//$EXT_BRANCH; do
    flatpak info \$ref >/dev/null 2>&1 || flatpak install -y --noninteractive flathub \$ref
  done
  flatpak update -y --noninteractive org.gnome.Platform//$GNOME_BRANCH org.gnome.Sdk//$GNOME_BRANCH
  flatpak update -y --noninteractive --commit=$GO_EXT_COMMIT org.freedesktop.Sdk.Extension.golang//$EXT_BRANCH
  flatpak update -y --noninteractive --commit=$NODE_EXT_COMMIT org.freedesktop.Sdk.Extension.node24//$EXT_BRANCH
  # (everything below /state: flatpak-builder wants its state, build and export folders on one file system)
  trap 'rm -rf /state/app /state/repo /state/builder/build /state/builder/cache /state/builder/checksums /state/builder/rofiles' EXIT
  flatpak-builder --state-dir=/state/builder --disable-rofiles-fuse --force-clean --default-branch=stable --repo=/state/repo /state/app $APP_ID.yml
  metainfo=/state/app/files/share/metainfo/$APP_ID.metainfo.xml
  if [ $CHECK_RELEASE = 1 ]; then
    grep -q '<release version=\"${APP_VERSION#v}\"' \$metainfo || { echo \"the metainfo of $APP_VERSION has no <release> entry for it (set-release.sh)\" >&2; exit 1; }
  fi
  if [ $CHECK_SCREENSHOTS = 1 ]; then
    want=\$(grep -o '<screenshot[ >]' \$metainfo | wc -l)
    got=\$(gzip -dc /state/app/files/share/app-info/xmls/$APP_ID.xml.gz | grep -o '<screenshot[ >]' | wc -l)
    [ \"\$got\" = \"\$want\" ] || { echo \"the bundle's appstream data has \$got of \$want screenshots: compose drops those it cannot download or read (PNG or JPEG at the tag's URL)\" >&2; exit 1; }
  fi
  sh bundle.sh /state/repo mindsift.flatpak \$key
  rm -f \$key
  rm -rf src bundle.sh" "$SANDBOX_OPTS"

mv "$STAGE/mindsift.flatpak" "$OUT"
rm -rf "$STAGE"
ls -la "$OUT"
