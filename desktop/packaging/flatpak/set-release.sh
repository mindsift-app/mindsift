#!/bin/sh
# Prepares the Flatpak files for a release, before the tag (ci/release-prepare.sh runs it): a build
# from the manifest's git source takes the manifest and the metainfo as they are in the tag, so both must
# name the release already.
#   - the manifest's git source moves to the tag; its commit line goes (it is unknown before tagging,
#     build.sh pins the commit the tag points to)
#   - the metainfo gets a <release> entry for the version at the top of <releases> (unless it has one):
#     the summary as its description (one sentence in English, what the software centers show), dated as
#     the CHANGELOG section of the version (else today), type development for pre-releases
#   - the metainfo's screenshot URLs point at the tag instead of main or an older tag, so the software
#     centers show the images of that release, which never change
# Usage: desktop/packaging/flatpak/set-release.sh <version, e.g. v1.2.0> '<summary>' [<date YYYY-MM-DD>]
set -eu
USAGE="usage: set-release.sh <version, e.g. v1.2.0> '<summary sentence>' [<date>]"
VERSION="${1:?$USAGE}"
SUMMARY="${2:?$USAGE}"
cd "$(dirname "$0")/../../.."
sh ci/version.sh check "$VERSION"
DIR=desktop/packaging/flatpak
MANIFEST="$DIR/app.mindsift.MindSift.yml"
METAINFO="$DIR/app.mindsift.MindSift.metainfo.xml"
release="${VERSION#v}"
date="${3:-$(sed -n "s/^## \[$(printf '%s' "$release" | sed 's/[.]/\\./g')\] - \([0-9-]*\).*/\1/p" CHANGELOG.md | head -1)}"
[ -n "$date" ] || date="$(date -u +%Y-%m-%d)"

old="$(sed -n 's/^ *tag: *\([^ ]*\) *$/\1/p' "$MANIFEST")"
if [ "$old" != "$VERSION" ]; then
  sed -i -e "s|^\( *tag: *\).*\$|\1$VERSION|" -e '/^ *commit: *[0-9a-f]* *$/d' "$MANIFEST"
fi

if ! grep -q "<release version=\"$release\"" "$METAINFO"; then
  type=stable
  case "$release" in *-*) type=development ;; esac
  # XML text, then safe in sed's replacement (\, | and & escaped)
  text="$(printf '%s' "$SUMMARY" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g' -e 's/[\\|&]/\\&/g')"
  entry="    <release version=\"$release\" date=\"$date\" type=\"$type\">\\
      <description>\\
        <p>$text</p>\\
      </description>\\
      <url type=\"details\">https://github.com/mindsift-app/mindsift/releases/tag/$VERSION</url>\\
    </release>"
  sed -i "s|^\( *\)<releases>\$|&\\
$entry|" "$METAINFO"
fi

sed -i "s|https://raw.githubusercontent.com/mindsift-app/mindsift/[^/]*/screenshots/|https://raw.githubusercontent.com/mindsift-app/mindsift/$VERSION/screenshots/|" "$METAINFO"

sh "$DIR/check-sources.sh"
echo "set-release: $MANIFEST and $METAINFO name $VERSION ($date)"
