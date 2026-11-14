#!/usr/bin/env bash
# The checks of the pipeline on this machine, before every push: the pipeline itself only tests GitHub's
# main (ci/build-plan.sh, TEST_REFS). The steps of the test stage of the Dockerfile, in containers (no
# local Node or Go needed): tsc, ESLint and Vitest for the frontend, go vet and go test with a single
# database connection for the backend, plus the cases of the build plan. Only here, not in the image
# build: gofmt and golangci-lint (settings in .golangci.yml, staticcheck among its linters).
#   ci/local-checks.sh          frontend (with the size of the bundle), backend, golangci-lint, build plan (in parallel)
#   E2E=1 ci/local-checks.sh    additionally the browser tests (e2e/run.sh, a few minutes)
# Exits non-zero when anything fails; the log of each part is printed at the end.
set -uo pipefail
ENGINE="${ENGINE:-podman}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT
cd "$ROOT"

# golangci-lint runs from its own image, pinned like the other images here
GOLANGCI_LINT_IMAGE="docker.io/golangci/golangci-lint:v2.15.0-alpine"
# Same Node and Go as the Dockerfile
NODE_IMAGE="docker.io/library/node:26.13.1-alpine"
GO_IMAGE="docker.io/library/golang:1.27.4-alpine"

# Upper bounds for the compressed size (gzip, kB) of the start chunk (index-*.js: shell and sign-in pages) and of
# the app chunk (mainViews-*.js), a little above the build of 2026-11 (about 170 and 240 kB; the texts of every
# language, German included, are chunks of their own). Going over them is not wrong as such, but should be a
# decision: raise the bound, or load the new part on demand (Doku/architecture.md).
MAX_START_KB=180
MAX_APP_KB=255

# Named volumes keep npm and Go downloads between runs. npm ci as in the Dockerfile: exactly the versions of
# package-lock.json, and a lockfile that does not match package.json fails here as it would in the build.
# The build goes to a folder inside the container, not to frontend/dist; then the size of the two chunks.
frontend() {
  "$ENGINE" run --rm -v "$ROOT/frontend":/app:z -v mindsift-npm-cache:/root/.npm -e NO_COLOR=1 -e FORCE_COLOR=0 -w /app \
    -e MAX_START_KB="$MAX_START_KB" -e MAX_APP_KB="$MAX_APP_KB" "$NODE_IMAGE" \
    sh -c 'npm ci --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npm run lint && npm run test:run &&
      npx vite build --outDir /tmp/dist --logLevel error && for chunk in index:$MAX_START_KB mainViews:$MAX_APP_KB; do
        name=${chunk%%:*} max=${chunk#*:} file=$(ls /tmp/dist/assets/${chunk%%:*}-*.js)
        kb=$(( $(gzip -c "$file" | wc -c) / 1000 ))
        echo "bundle: $name $kb kB gzip (at most $max)"
        [ "$kb" -le "$max" ] || { echo "bundle: $name is larger than $max kB, see MAX_START_KB/MAX_APP_KB in ci/local-checks.sh"; exit 1; }
      done'
}
# Tests of calendar days, due dates, alarms, summaries and backups, run once more in a zone far from UTC
# (the container itself runs on UTC): code that takes time.Now() where the server's zone is meant fails
# there. All of internal/clock and internal/domain, and these tests of internal/api and internal/storage
# (one group: go test -run splits a pattern at a top-level | and (?i) would cover only the first part).
TZ_RUN_ZONE="Asia/Tokyo"
TZ_RUN_TESTS='(?i)(time|zone|alarm|due|digest|summar|backup|today|clock|day|date|greet|remind|sched|calendar|week|journal|repeat|recur|midnight|overdue|deadline|retention|expir|trash|hour|month|filter|center|completed|done|notif)'

# The Go packages of the image build (cmd/ and internal/), not ./...: that would also walk frontend/node_modules,
# which has Go files of its own and is deleted and rebuilt by npm ci in the frontend part at the same time.
# The time zone run: -count=1, since the test cache does not notice a change of TZ and would only replay the
# results of the first run (code that reads TZ through the time package is not tracked). ZONEINFO names Go's
# own zone data, as the Alpine image has no /usr/share/zoneinfo; clock's TestProcessRunsInTZ fails when the
# zone is not in effect.
# -timeout 20m per package: internal/api alone takes about four minutes and far longer beside the other parts
# and other builds on the machine (a passing run is not slowed by the higher bound).
backend() {
  "$ENGINE" run --rm -v "$ROOT":/src:z -v mindsift-go-cache:/go/pkg/mod -v mindsift-go-build:/root/.cache/go-build -w /src \
    -e DB_MAX_CONNS=1 -e CGO_ENABLED=0 -e TZ_RUN_ZONE="$TZ_RUN_ZONE" -e TZ_RUN_TESTS="$TZ_RUN_TESTS" "$GO_IMAGE" \
    sh -c 'test -z "$(gofmt -l internal cmd)" || { echo "gofmt:"; gofmt -l internal cmd; exit 1; }; go vet ./cmd/... ./internal/... && go test -timeout 20m ./cmd/... ./internal/... &&
      echo "time zone run: TZ=$TZ_RUN_ZONE" && export TZ="$TZ_RUN_ZONE" ZONEINFO="$(go env GOROOT)/lib/time/zoneinfo.zip" &&
      go test -count=1 ./internal/clock/ ./internal/domain/ && go test -count=1 -timeout 20m -run "$TZ_RUN_TESTS" ./internal/api/ ./internal/storage/'
}
# The standard linters of golangci-lint (.golangci.yml, staticcheck included) over the same packages, read-only
lint() {
  "$ENGINE" run --rm -v "$ROOT":/src:ro,z -v mindsift-go-cache:/go/pkg/mod -v mindsift-golangci-cache:/root/.cache -w /src \
    -e CGO_ENABLED=0 "$GOLANGCI_LINT_IMAGE" golangci-lint run ./cmd/... ./internal/...
}
plan() { bash ci/test-build-plan.sh; }

start=$(date +%s)
pids=()
for part in frontend backend lint plan; do
  "$part" >"$LOGS/$part.log" 2>&1 &
  pids+=("$!:$part")
done
failed=()
for entry in "${pids[@]}"; do
  wait "${entry%%:*}" || failed+=("${entry#*:}")
done
if [ "${E2E:-}" = 1 ] && [ ${#failed[@]} -eq 0 ]; then
  bash e2e/run.sh >"$LOGS/e2e.log" 2>&1 || failed+=(e2e)
fi

for log in "$LOGS"/*.log; do
  part="$(basename "$log" .log)"
  if printf '%s\n' "${failed[@]}" | grep -qx "$part"; then
    echo "===== $part: FAILED"
    tail -n 60 "$log"
  else
    echo "===== $part: ok ($(grep -E 'Tests +[0-9]+ passed|^bundle: |^ok |ALL CASES PASSED|All checks passed|^0 issues' "$log" | tail -n 3 | tr -s ' ' | paste -sd ';' -))"
  fi
done
echo "Took $(( $(date +%s) - start )) s"
[ ${#failed[@]} -eq 0 ]
