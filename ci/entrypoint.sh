#!/bin/sh
# Starts MindSift as the unprivileged user mindsift (uid/gid 1000) instead of root. Started as root (the
# default), it first hands the data folder to that user, so installations from before v0.87.3, whose
# data/ belongs to root, keep working without manual steps. Started with --user / user: it runs as given.
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

if [ "$(id -u)" = "0" ]; then
  for d in $dirs; do
    mkdir -p "$d"
    # Only when something there does not belong to mindsift yet (a full chown on every start would be slow)
    if [ -n "$(find "$d" ! -user mindsift -print -quit 2>/dev/null)" ]; then
      echo "MindSift: handing $d to the user mindsift (uid 1000)"
      chown -R mindsift:mindsift "$d"
    fi
    make_private "$d" mindsift
  done
  exec su-exec mindsift "$@"
fi

for d in $dirs; do
  [ -d "$d" ] && make_private "$d" "$(id -u)"
done
exec "$@"
