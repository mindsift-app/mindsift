#!/bin/sh
# Starts MindSift as the unprivileged user mindsift (uid/gid 1000) instead of root. Started as root (the
# default), it first hands the data folder to that user, so installations from before v0.87.3, whose
# data/ belongs to root, keep working without manual steps. Where it may not change owners (NFS with
# root_squash, SMB/CIFS) it goes on if mindsift can write there and stops with a hint otherwise. Started
# with --user / user: it runs as given.
set -e

# Database, keys, backups and media only for MindSift itself, not for other accounts on the host:
# new files 0600, new folders 0700
umask 077

dirs="${DATA_DIR:-/data}"
case "${DATABASE_URL:-}" in
  sqlite://*) dirs="$dirs $(dirname "${DATABASE_URL#sqlite://}")" ;;
esac

# The umask only covers new files: database, keys and media of older installations stayed readable for
# group and others. Taken away once, only when something there still is (not a full pass on every start).
# Only the files of the user MindSift runs as ($2); started with --user, others are left as they are.
make_private() {
  if [ -n "$(find "$1" -user "$2" -perm /077 -print -quit 2>/dev/null)" ]; then
    echo "MindSift: making $1 private (no access for group and others)"
    chmod -R go-rwx "$1" 2>/dev/null || true
  fi
}

# How to give the folder to MindSift when the container cannot (NFS with root_squash, a CIFS mount, a
# read-only volume); Doku/operations.md, "Network storage and rootless Podman".
ownership_help() {
  echo "MindSift: give $1 to uid $2 on the host or the NAS (chown -R $2:$2 <folder>; with rootless Podman: podman unshare chown -R $2:$2 <folder>), or start the container with user: \"<uid>:<gid>\" of the folder's owner. See Doku/operations.md, \"Network storage and rootless Podman\"."
}

# Can the user $2 create files in $1? (MindSift writes the database, keys, backups and media there.)
writable_as() {
  probe="$1/.mindsift-write-test.$$"
  if su-exec "$2" sh -c 'umask 077 && : > "$1" && rm -f "$1"' sh "$probe" 2>/dev/null; then
    return 0
  fi
  return 1
}

if [ "$(id -u)" = "0" ]; then
  for d in $dirs; do
    # Root in the container may not create it either (NFS with root_squash): the check below says why
    mkdir -p "$d" 2>/dev/null || true
    # Only when something there does not belong to mindsift yet (a full chown on every start would be slow)
    if [ -n "$(find "$d" ! -user mindsift -print -quit 2>/dev/null)" ]; then
      echo "MindSift: handing $d to the user mindsift (uid 1000)"
      # Not allowed on NFS with root_squash and on most CIFS/SMB mounts: no reason to stop as long as
      # mindsift can still write there (a share mapped to uid 1000, a folder open to it)
      if ! chown -R mindsift:mindsift "$d" 2>/dev/null; then
        echo "MindSift: changing the owner of $d is not allowed here (network storage such as NFS with root_squash or SMB/CIFS?); leaving the owners as they are"
      fi
    fi
    if ! writable_as "$d" mindsift; then
      echo "MindSift: ERROR: the user mindsift (uid 1000) cannot write to $d, so MindSift cannot store its database there."
      ownership_help "$d" 1000
      exit 1
    fi
    make_private "$d" mindsift
  done
  exec su-exec mindsift "$@"
fi

for d in $dirs; do
  if [ -d "$d" ] && [ ! -w "$d" ]; then
    echo "MindSift: WARNING: $d is not writable for uid $(id -u), the user this container runs as; MindSift will fail to open its database there."
    ownership_help "$d" "$(id -u)"
  fi
  [ -d "$d" ] && make_private "$d" "$(id -u)"
done
exec "$@"
