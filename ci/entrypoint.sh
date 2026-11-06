#!/bin/sh
# Starts MindSift as the unprivileged user mindsift (uid/gid 1000) instead of root. Started as root (the
# default), it first hands the data folder to that user, so installations from before v0.87.3, whose
# data/ belongs to root, keep working without manual steps. Started with --user / user: it runs as given.
set -e

if [ "$(id -u)" = "0" ]; then
  dirs="${DATA_DIR:-/data}"
  case "${DATABASE_URL:-}" in
    sqlite://*) dirs="$dirs $(dirname "${DATABASE_URL#sqlite://}")" ;;
  esac
  for d in $dirs; do
    mkdir -p "$d"
    # Only when something there does not belong to mindsift yet (a full chown on every start would be slow)
    if [ -n "$(find "$d" ! -user mindsift -print -quit 2>/dev/null)" ]; then
      echo "MindSift: handing $d to the user mindsift (uid 1000)"
      chown -R mindsift:mindsift "$d"
    fi
  done
  exec su-exec mindsift "$@"
fi

exec "$@"
