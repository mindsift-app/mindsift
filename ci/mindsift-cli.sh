#!/bin/sh
# The command line in the image: `docker exec <container> mindsift users` (mindsift help lists the
# commands). docker exec runs as root, while the server runs as the owner of the data folder (uid 1000,
# see entrypoint.sh): files the command writes (a backup, the database's -wal and -shm when the server
# is stopped) must belong to that user too, or the server could not use them. So as root it switches to
# the owner of the database folder first; started as another user it runs as given.
set -e
umask 077

dir="${DATA_DIR:-/data}"
case "${DATABASE_URL:-}" in
  sqlite://*) dir="$(dirname "${DATABASE_URL#sqlite://}")" ;;
esac

if [ "$(id -u)" = "0" ] && owner="$(stat -c '%u:%g' "$dir" 2>/dev/null)" && [ "${owner%%:*}" != "0" ]; then
  exec su-exec "$owner" /app/mindsift "$@"
fi
exec /app/mindsift "$@"
