#!/bin/sh
# gofmt, go vet and go test for the desktop app's own Go module (desktop/go.mod, which the checks of the
# server's packages do not reach). Runs inside GO_IMAGE of ci/images.env with the repository as working
# directory (the module replaces the server's module with ../): ci/local-checks.sh and
# .github/workflows/pr.yaml start it in that image.
#
# Without cgo and without GTK: the Linux build of the app needs cgo with the GTK 4 / WebKitGTK 6.0
# headers (desktop/build.sh installs them into a Debian image on every build). Here Wails' purego build
# tag stands in for cgo, so the package compiles in the plain Alpine image; vet and the tests then cover
# every file but the three that only exist with cgo (webview_linux.go, filedrop_linux.go,
# download_linux.go: the GTK and WebKit calls), which the real builds compile (desktop/build.sh, the
# Flatpak build). The Windows files are vetted for GOOS=windows as well (that build has no cgo anyway).
# Usage (inside the container): sh ci/desktop-go-checks.sh
set -eu
cd desktop
export CGO_ENABLED=0 GOFLAGS=-mod=readonly
files="$(gofmt -l ./*.go internal tools)"
[ -z "$files" ] || { echo "desktop-go-checks: not formatted with gofmt:"; echo "$files"; exit 1; }
go vet -p 2 -tags purego ./...
GOOS=windows go vet -p 2 ./...
go test -p 2 -tags purego ./...
echo "desktop-go-checks: ok"
