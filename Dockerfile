# ==============================================================================
# Stage 1: Frontend Check & Build (Cached npm dependencies layer)
# ==============================================================================
FROM node:22-alpine AS frontend-builder
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN --mount=type=cache,target=/root/.npm npm install --no-audit --no-fund
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
FROM golang:1.27-alpine AS backend-builder
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
      golang.org/x/crypto/bcrypt

# Copy application source & compiled frontend SPA assets for go:embed
COPY cmd/ ./cmd/
COPY internal/ ./internal/
COPY --from=frontend-builder /app/frontend/dist ./cmd/server/dist

ARG SKIP_TESTS=0
# Run go mod tidy, static analysis (go vet), unit tests (go test), and compile final binary.
# The tests run with a single database connection: code that needs a second one while holding one hangs
# here at once (and fails after the timeout) instead of deadlocking the pool under load.
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    go mod tidy && \
    if [ "$SKIP_TESTS" != "1" ]; then \
      CGO_ENABLED=0 go vet ./... && \
      DB_MAX_CONNS=1 CGO_ENABLED=0 go test -v -timeout 5m ./...; \
    else \
      echo "Skipping backend tests (SKIP_TESTS=1)"; \
    fi && \
    CGO_ENABLED=0 go build -ldflags="-s -w" -o /app/mindsift ./cmd/server

# ==============================================================================
# Stage 3: Minimal Production Runtime (< 35 MB)
# ==============================================================================
FROM alpine:3.24
# The code state the image was built from (CI: decides whether a later build may skip the tests)
ARG GIT_SHA=""
ARG GIT_TREE=""
LABEL org.opencontainers.image.revision="${GIT_SHA}" io.mindsift.tree="${GIT_TREE}"
RUN apk add --no-cache ca-certificates tzdata && \
    mkdir -p /data /tmp && \
    chmod 1777 /tmp

WORKDIR /app
COPY --from=backend-builder /app/mindsift /app/mindsift

ENV PORT=8080
ENV DATA_DIR=/data
VOLUME ["/data"]

EXPOSE 8080
ENTRYPOINT ["/app/mindsift"]
