#!/usr/bin/env bash
# The checks of the pipeline on this machine, before every push: the pipeline itself only tests GitHub's
# main (ci/build-plan.sh, TEST_REFS). The steps of the test stage of the Dockerfile, in containers (no
# local Node or Go needed): tsc, ESLint and Vitest for the frontend, go vet and go test with a single
# database connection for the backend, plus the cases of the build plan. Only here, not in the image
# build: gofmt, staticcheck (settings in staticcheck.conf) and golangci-lint (settings in .golangci.yml).
#   ci/local-checks.sh          frontend, backend, golangci-lint, build plan (in parallel)
#   E2E=1 ci/local-checks.sh    additionally the browser tests (e2e/run.sh, a few minutes)
# Exits non-zero when anything fails; the log of each part is printed at the end.
set -uo pipefail
ENGINE="${ENGINE:-podman}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LOGS="$(mktemp -d)"
trap 'rm -rf "$LOGS"' EXIT
cd "$ROOT"

# staticcheck is no dependency of MindSift (not in go.mod): it runs at this version from the module cache
STATICCHECK="honnef.co/go/tools/cmd/staticcheck@2026.2.2"
# golangci-lint runs from its own image, pinned like the other images here
GOLANGCI_LINT_IMAGE="docker.io/golangci/golangci-lint:v2.15.0-alpine"
# Same Node as the Dockerfile
NODE_IMAGE="docker.io/library/node:26.13.0-alpine"

# Named volumes keep npm and Go downloads between runs. npm ci as in the Dockerfile: exactly the versions of
# package-lock.json, and a lockfile that does not match package.json fails here as it would in the build.
frontend() {
  "$ENGINE" run --rm -v "$ROOT/frontend":/app:z -v mindsift-npm-cache:/root/.npm -e NO_COLOR=1 -e FORCE_COLOR=0 -w /app "$NODE_IMAGE" \
    sh -c 'npm ci --no-audit --no-fund --loglevel=error && npx tsc --noEmit && npm run lint && npm run test:run'
}
# The Go packages of the image build (cmd/ and internal/), not ./...: that would also walk frontend/node_modules,
# which has Go files of its own and is deleted and rebuilt by npm ci in the frontend part at the same time
backend() {
  "$ENGINE" run --rm -v "$ROOT":/src:z -v mindsift-go-cache:/go/pkg/mod -v mindsift-go-build:/root/.cache/go-build -w /src \
    -e DB_MAX_CONNS=1 -e CGO_ENABLED=0 -e STATICCHECK="$STATICCHECK" docker.io/library/golang:1.27-alpine \
    sh -c 'test -z "$(gofmt -l internal cmd)" || { echo "gofmt:"; gofmt -l internal cmd; exit 1; }; go vet ./cmd/... ./internal/... && go run "$STATICCHECK" ./cmd/... ./internal/... && go test -timeout 5m ./cmd/... ./internal/...'
}
# The standard linters of golangci-lint (.golangci.yml) over the same packages, read-only
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
    echo "===== $part: ok ($(grep -E 'Tests +[0-9]+ passed|^ok |ALL CASES PASSED|All checks passed|^0 issues' "$log" | tail -n 3 | tr -s ' ' | paste -sd ';' -))"
  fi
done
echo "Took $(( $(date +%s) - start )) s"
[ ${#failed[@]} -eq 0 ]
