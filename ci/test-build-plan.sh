#!/usr/bin/env bash
# Checks build-plan.sh against a fake registry (labels given per case). Usage: ci/test-build-plan.sh
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
PLAN=ci/build-plan.sh
IMAGE=registry.example/mindsift
SHA="$(git rev-parse HEAD)"
TREE="$(git rev-parse HEAD^{tree})"
MOCK="$(mktemp)"
trap 'rm -f "$MOCK"' EXIT
# The fake registry answers from $DEV_TREE, $LATEST_TREE and $LATEST_SHA
cat >"$MOCK" <<'EOF'
#!/usr/bin/env bash
case "$1 $2" in
  *:dev\ io.mindsift.tree) echo "${DEV_TREE:-}" ;;
  *:latest\ io.mindsift.tree) echo "${LATEST_TREE:-}" ;;
  *:latest\ org.opencontainers.image.revision) echo "${LATEST_SHA:-}" ;;
esac
EOF
chmod +x "$MOCK"

fails=0
expect() { # name, REF, expected "action skip_tests tags", env assignments…
  local name="$1" ref="$2" want="$3"
  shift 3
  local out
  out="$(env "$@" REF="$ref" IMAGE="$IMAGE" PKG_VERSION=0.10.0 LABEL_CMD="$MOCK" GITHUB_OUTPUT= "$PLAN")"
  local got
  got="$(echo "$out" | sed -n 's/^action=//p') $(echo "$out" | sed -n 's/^skip_tests=//p') $(echo "$out" | sed -n 's/^tags=//p')"
  if [ "$got" = "$want" ]; then
    echo "OK   $name: $got"
  else
    echo "FEHL $name: erwartet '$want', bekommen '$got'"
    fails=$((fails + 1))
  fi
}

expect "dev baut mit Tests" refs/heads/dev "build 0 dev"
expect "main nach getestetem dev" refs/heads/main "build 1 latest" DEV_TREE="$TREE"
expect "main mit anderem Stand" refs/heads/main "build 0 latest" DEV_TREE=0000
expect "Tag auf latest-Commit" refs/tags/v0.10.0 "retag 1 v0.10.0 stable" LATEST_SHA="$SHA" LATEST_TREE="$TREE"
expect "Tag, latest fehlt, dev getestet" refs/tags/v0.10.0 "build 1 v0.10.0 stable" DEV_TREE="$TREE"
expect "Tag auf unbekanntem Stand" refs/tags/v0.10.0 "build 0 v0.10.0 stable"
expect "Vorabversion ohne stable" refs/tags/v0.11.0-rc.1 "retag 1 v0.11.0-rc.1" LATEST_SHA="$SHA"
expect "Feature-Branch" refs/heads/feat/x "build 0 feat-x"

if [ "$fails" -gt 0 ]; then
  echo "$fails FEHLGESCHLAGEN"
  exit 1
fi
echo "ALLE FÄLLE BESTANDEN"
