# The two build stages run on the platform of the building machine ($BUILDPLATFORM), whatever platform
# the image is for: the frontend is the same everywhere and Go cross-compiles. A build for several
# platforms therefore checks and builds once; only the binary and the last stage exist per platform.

# ==============================================================================
# Stage 1: Frontend Check & Build (Cached npm dependencies layer)
# ==============================================================================
FROM --platform=$BUILDPLATFORM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
# npm ci installs exactly what package-lock.json lists and stops when it does not match package.json
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY frontend/ ./
# Version shown in the header: the git tag for releases (set by CI), otherwise "<package version>-dev"
ARG APP_VERSION=""
ARG SKIP_TESTS=0
RUN if [ "$SKIP_TESTS" != "1" ]; then \
      npx tsc --noEmit && npm run lint && npm run test:run; \
    else \
      echo "Skipping frontend tests (SKIP_TESTS=1)"; \
    fi && \
    APP_VERSION="${APP_VERSION}" npm run build

# ==============================================================================
# Stage 2: Go Backend Lint, Unit Tests & Binary Build (Cached Go module & sqlite layer)
# ==============================================================================
FROM --platform=$BUILDPLATFORM golang:1.27-alpine AS backend-builder
WORKDIR /app
RUN apk add --no-cache git ca-certificates

# Cache Go modules & pre-compile heavy dependencies (modernc.org/sqlite) in a dedicated layer.
# The versions come from go.mod/go.sum only, so an update there is what ends up in the binary.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go mod download && \
    CGO_ENABLED=0 go build \
      modernc.org/sqlite \
      github.com/go-chi/chi/v5 \
      github.com/go-chi/cors \
      github.com/golang-jwt/jwt/v5 \
      github.com/gorilla/websocket \
      golang.org/x/crypto/bcrypt \
      golang.org/x/net/html

# Copy application source & compiled frontend SPA assets for go:embed
COPY cmd/ ./cmd/
COPY internal/ ./internal/
# The route list the API test checks the router against (internal/api/openapi_test.go)
COPY Doku/api/openapi.json ./Doku/api/openapi.json
COPY --from=frontend-builder /app/frontend/dist ./cmd/server/dist

ARG SKIP_TESTS=0
# Check the downloaded modules against go.sum, run static analysis (go vet) and the unit tests (go test).
# go.mod and go.sum are used as committed.
# The tests run with a single database connection: code that needs a second one while holding one hangs
# here at once (and fails after the timeout) instead of deadlocking the pool under load.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go mod verify && \
    if [ "$SKIP_TESTS" != "1" ]; then \
      CGO_ENABLED=0 go vet ./... && \
      DB_MAX_CONNS=1 CGO_ENABLED=0 go test -v -timeout 5m ./...; \
    else \
      echo "Skipping backend tests (SKIP_TESTS=1)"; \
    fi

# Compile the binary for the platform of the image (set by the builder, e.g. linux/arm64). SQLite is pure
# Go (modernc.org/sqlite), so this needs neither a C toolchain nor emulation. Declared only here, so the
# steps above are the same for every platform and run once.
ARG TARGETOS
ARG TARGETARCH
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS="${TARGETOS}" GOARCH="${TARGETARCH}" go build -ldflags="-s -w" -o /app/mindsift ./cmd/server

# ==============================================================================
# Stage 3: Minimal Production Runtime (< 35 MB)
# ==============================================================================
# The only stage on the platform of the image: its RUN step needs emulation (QEMU) when that is not the
# platform of the building machine.
FROM alpine:3.24
# The code state the image was built from (CI: decides whether a later build may skip the tests)
ARG GIT_SHA=""
ARG GIT_TREE=""
# Hash of Dockerfile, go.mod and go.sum (CI: decides whether a later build needs a security scan)
ARG GIT_DEPS=""
LABEL org.opencontainers.image.revision="${GIT_SHA}" io.mindsift.tree="${GIT_TREE}" io.mindsift.deps="${GIT_DEPS}"
# MindSift runs as the user mindsift (uid/gid 1000), not as root; the entrypoint hands /data over first.
# apk upgrade: security fixes of the base system released after the alpine image itself
RUN apk upgrade --no-cache && \
    apk add --no-cache ca-certificates tzdata su-exec && \
    addgroup -S -g 1000 mindsift && adduser -S -D -H -u 1000 -G mindsift mindsift && \
    mkdir -p /data /tmp && chown mindsift:mindsift /data && \
    chmod 1777 /tmp

WORKDIR /app
COPY --from=backend-builder /app/mindsift /app/mindsift
COPY ci/entrypoint.sh /app/entrypoint.sh

ENV PORT=8080
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8080
# State for docker ps, Portainer, Dockge and depends_on (condition: service_healthy). busybox wget is part
# of Alpine, so this needs no extra package. Shell form: $PORT is read when the check runs, so a port changed
# for the container is followed. -Y off: an HTTP_PROXY set for outgoing requests must not catch 127.0.0.1.
# Runs as the container's user (root unless --user is set), needs no files. Podman ignores it in OCI images
# (its own default build format, and the published images built by buildx); docker-compose.yml repeats it.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -q -Y off -T 4 -O /dev/null "http://127.0.0.1:${PORT:-8080}/api/v1/health" || exit 1
ENTRYPOINT ["/app/entrypoint.sh", "/app/mindsift"]
