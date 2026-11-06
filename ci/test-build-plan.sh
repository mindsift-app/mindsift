#!/usr/bin/env bash
# Checks build-plan.sh against a fake registry (labels given per case). Usage: ci/test-build-plan.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PLAN=ci/build-plan.sh
IMAGE=registry.example/mindsift
SHA="$(git rev-parse HEAD)"
TREE="$(git rev-parse HEAD^{tree})"
DEPS="$(git rev-parse HEAD:Dockerfile HEAD:go.mod HEAD:go.sum | sha256sum | cut -c1-16)"
MOCK="$(mktemp)"
trap 'rm -f "$MOCK"' EXIT
# The fake registry answers from $DEV_TREE, $LATEST_TREE, $LATEST_SHA, $DEV_DEPS and $LATEST_DEPS
cat >"$MOCK" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  *:dev\ io.mindsift.tree) echo "${DEV_TREE:-}" ;;
  *:latest\ io.mindsift.tree) echo "${LATEST_TREE:-}" ;;
  *:latest\ org.opencontainers.image.revision) echo "${LATEST_SHA:-}" ;;
  *:dev\ io.mindsift.deps) echo "${DEV_DEPS:-}" ;;
  *:latest\ io.mindsift.deps) echo "${LATEST_DEPS:-}" ;;
esac
EOF
chmod +x "$MOCK"

fails=0
expect() { # name, REF, expected "action skip_tests scan tags", env assignments…
  local name="$1" ref="$2" want="$3"
  shift 3
  local out
  out="$(env "$@" REF="$ref" IMAGE="$IMAGE" PKG_VERSION=0.10.0 LABEL_CMD="$MOCK" GITHUB_OUTPUT= "$PLAN")"
  local got
  got="$(echo "$out" | sed -n 's/^action=//p') $(echo "$out" | sed -n 's/^skip_tests=//p') $(echo "$out" | sed -n 's/^scan=//p') $(echo "$out" | sed -n 's/^tags=//p')"
  if [ "$got" = "$want" ]; then
    echo "OK   $name: $got"
  else
    echo "FEHL $name: erwartet '$want', bekommen '$got'"
    fails=$((fails + 1))
  fi
}

expect "dev builds without tests" refs/heads/dev "build 1 1 dev"
expect "dev, dependencies unchanged" refs/heads/dev "build 1 0 dev" DEV_DEPS="$DEPS"
expect "dev, dependencies changed" refs/heads/dev "build 1 1 dev" DEV_DEPS=0000
expect "main without tests (Gitea)" refs/heads/main "build 1 1 latest"
expect "main, dependencies unchanged" refs/heads/main "build 1 0 latest" LATEST_DEPS="$DEPS"
expect "main with tests (GitHub)" refs/heads/main "build 0 1 latest" TEST_REFS=refs/heads/main
expect "dev stays untested on GitHub" refs/heads/dev "build 1 1 dev" TEST_REFS=refs/heads/main
expect "tag on the latest commit" refs/tags/v0.10.0 "retag 1 1 v0.10.0 stable" LATEST_SHA="$SHA" LATEST_TREE="$TREE" LATEST_DEPS="$DEPS"
expect "tag, latest has the same code" refs/tags/v0.10.0 "build 1 1 v0.10.0 stable" LATEST_TREE="$TREE"
expect "tag, only dev has the code" refs/tags/v0.10.0 "build 0 1 v0.10.0 stable" DEV_TREE="$TREE"
expect "tag on unknown code" refs/tags/v0.10.0 "build 0 1 v0.10.0 stable"
expect "pre-release without stable" refs/tags/v0.11.0-rc.1 "retag 1 1 v0.11.0-rc.1" LATEST_SHA="$SHA"
expect "feature branch" refs/heads/feat/x "build 1 1 feat-x"

if [ "$fails" -gt 0 ]; then
  echo "$fails FEHLGESCHLAGEN"
  exit 1
fi
echo "ALL CASES PASSED"
