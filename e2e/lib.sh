# shellcheck shell=bash
# Shared by the scripts in e2e/ that start MindSift in a container (run.sh, screenshots.sh, refshots.sh,
# video-tour.sh); sourced by bash: . "$ROOT/e2e/lib.sh" (with ROOT the repository).
# It sets ENGINE (default podman) and reads the pinned images (PLAYWRIGHT_IMAGE, DEX_IMAGE, ALPINE_IMAGE …)
# from ci/images.env.
ENGINE="${ENGINE:-podman}"
# shellcheck source=../ci/images.env
. "$ROOT/ci/images.env"

# free_port [PORT…]: a port in 18100-18999 that nothing listens on, none of the ones given (so several
# servers of one run, and several runs at once, get different ports). Fails when none of 50 tries is free.
free_port() {
  local p
  for p in $(shuf -i 18100-18999 -n 50); do
    case " $* " in *" $p "*) continue ;; esac
    if ! (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "$p"; return 0; fi
  done
  echo "free_port: no free port found in 18100-18999" >&2
  return 1
}

# wait_http URL [WHAT [CONTAINER]]: waits up to 30 seconds for URL to answer; when it does not, prints the
# end of CONTAINER's log (when given) and ends the script (exit 1, its EXIT trap cleans up) instead of
# running the tests against a server that is not there.
wait_http() {
  for _ in $(seq 1 60); do
    curl -s -m 1 "$1" >/dev/null && return 0
    sleep 0.5
  done
  echo "${2:-$1} does not answer after 30 s" >&2
  [ -z "${3:-}" ] || "$ENGINE" logs --tail 30 "$3" >&2 || true
  exit 1
}

# wait_healthy PORT [CONTAINER]: wait_http for MindSift's health endpoint on PORT
wait_healthy() { wait_http "http://localhost:$1/api/v1/health" "MindSift on port $1" "${2:-}"; }

# start_demo NAME IMAGE PORT [ENGINE RUN OPTIONS…]: starts IMAGE as container NAME in demo mode on PORT
# (host network), straight with the app, not the entrypoint that hands /data to uid 1000: test data in a
# mounted folder stays the host user's, so the scripts can remove it. Language, data folder (-v …:/data:Z),
# --rm and the like come as options.
start_demo() {
  local name="$1" image="$2" port="$3"
  shift 3
  "$ENGINE" run -d --entrypoint /app/mindsift --name "$name" --network host -e PORT="$port" -e MINDSIFT_DEMO=true \
    "$@" "$image" >/dev/null
}
