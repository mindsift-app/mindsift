#!/bin/sh
# Reference screenshots for refactors.
#
#   e2e/refshots.sh capture before     # image from the working tree, fresh server, pictures to .refshots/shots/before
#   … refactor …
#   e2e/refshots.sh capture after
#   e2e/refshots.sh compare before after   # differing pictures as red masks in .refshots/shots/diff-before-after
#   e2e/refshots.sh drag before        # drag & drop steps (refdrag.mjs), task state to .refshots/shots/before.drag.txt
#   e2e/refshots.sh ws before          # workspace steps (refworkspace.mjs), notes/folders/trash to .refshots/shots/before.ws.txt
#   e2e/refshots.sh lists before       # shopping list steps (reflists.mjs), lists and entries to .refshots/shots/before.lists.txt
#
# Requires podman (or docker via ENGINE=docker). SKIP_BUILD=1 reuses the last image.
set -eu
ENGINE="${ENGINE:-podman}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIR="${REFSHOTS_DIR:-$ROOT/.refshots}"
# Pictures and server data in separate folders: the Playwright container relabels its mount (SELinux :Z),
# which would take the database away from the running server if it lay inside
SHOTS="$DIR/shots"
DATA="$DIR/data"
IMAGE=mindsift-refshots
NAME=mindsift-refshots
PORT="${PORT:-18666}"
PW=mcr.microsoft.com/playwright:v1.48.2-jammy

run_pw() {
  script="${SCRIPT:-refshots.mjs}"
  "$ENGINE" run --rm --network host -e MINDSIFT_URL="http://localhost:$PORT" "$@" \
    -v "$ROOT/e2e":/e2e:Z -v "$SHOTS":/shots:Z -w /e2e "$PW" \
    sh -c "npm install --no-audit --no-fund >/dev/null 2>&1 && node $script"
}

wait_healthy() {
  for _ in $(seq 1 60); do curl -s -m 1 "http://localhost:$PORT/api/v1/health" >/dev/null && return 0; sleep 0.5; done
  echo "Server does not answer" >&2
  return 1
}

mkdir -p "$SHOTS" "$DATA"
case "${1:-}" in
capture|drag|ws|lists)
  mode="$1"
  set_name="${2:?name of the run is missing}"
  if [ "${SKIP_BUILD:-}" != 1 ]; then
    echo "Building the image …"
    # No layer cache (package.json changes with every version anyway) and the previous image removed, so
    # repeated runs do not fill the disk with intermediate images
    old_id="$("$ENGINE" image inspect -f '{{.Id}}' "$IMAGE" 2>/dev/null || true)"
    "$ENGINE" build -q --layers=false --build-arg SKIP_TESTS=1 -t "$IMAGE" "$ROOT" >/dev/null
    new_id="$("$ENGINE" image inspect -f '{{.Id}}' "$IMAGE")"
    if [ -n "$old_id" ] && [ "$old_id" != "$new_id" ]; then "$ENGINE" rmi "$old_id" >/dev/null 2>&1 || true; fi
  fi
  "$ENGINE" rm -f "$NAME" >/dev/null 2>&1 || true
  trap '"$ENGINE" stop "$NAME" >/dev/null 2>&1 || true' EXIT
  # The demo resets its database (with fresh time stamps) on every start. So it is set up once and kept
  # as a template; every capture runs on a fresh copy without demo mode, with exactly the same data.
  # RESEED=1 makes a new template (e.g. after the demo data changed).
  if [ ! -f "$DATA/seed/mindsift.db" ] || [ "${RESEED:-}" = 1 ]; then
    echo "Lege Demo-Daten als Vorlage an …"
    rm -rf "$DATA/seed" && mkdir -p "$DATA/seed"
    "$ENGINE" run -d --rm --name "$NAME" --network host -e PORT="$PORT" -e MINDA_DEMO=true -e DEFAULT_LANGUAGE=de -e DEMO_RESET_MINUTES=0 \
      -e JWT_SECRET=refshots-only -v "$DATA/seed":/data:Z "$IMAGE" >/dev/null
    wait_healthy
    "$ENGINE" stop "$NAME" >/dev/null
  fi
  rm -rf "$DATA/run" && cp -a "$DATA/seed" "$DATA/run"
  "$ENGINE" run -d --rm --name "$NAME" --network host -e PORT="$PORT" -e JWT_SECRET=refshots-only \
    -v "$DATA/run":/data:Z "$IMAGE" >/dev/null
  wait_healthy
  if [ "$mode" = drag ]; then
    SCRIPT=refdrag.mjs run_pw -e OUT="/shots/$set_name.drag.txt"
  elif [ "$mode" = ws ]; then
    SCRIPT=refworkspace.mjs run_pw -e OUT="/shots/$set_name.ws.txt"
  elif [ "$mode" = lists ]; then
    SCRIPT=reflists.mjs run_pw -e OUT="/shots/$set_name.lists.txt"
  else
    rm -rf "${SHOTS:?}/$set_name"
    run_pw -e MODE=capture -e OUT="/shots/$set_name"
  fi
  ;;
compare)
  a="${2:?erste Aufnahme fehlt}"
  b="${3:?zweite Aufnahme fehlt}"
  rm -rf "${SHOTS:?}/diff-$a-$b"
  run_pw -e MODE=compare -e A="/shots/$a" -e B="/shots/$b" -e OUT="/shots/diff-$a-$b"
  ;;
*)
  echo "Aufruf: $0 capture <name> | drag <name> | ws <name> | lists <name> | compare <a> <b>" >&2
  exit 2
  ;;
esac
