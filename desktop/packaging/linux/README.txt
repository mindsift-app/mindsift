MindSift desktop for Linux (x86-64)
===================================

mindsift-desktop is the MindSift desktop app as a single file: local instances that keep their data on
this computer (no account, no port opened) and connections to MindSift servers.

Start it with ./mindsift-desktop. At the first start it adds itself to the application menu
(~/.local/share/applications/app.mindsift.MindSift.desktop and its icons); when the file moves, the
entry follows at the next start. The data lives in ~/.local/share/MindSift.

It needs GTK 4 and WebKitGTK 6.0 from the system:

  Debian 13 / Ubuntu 24.04 or newer:  sudo apt install libgtk-4-1 libwebkitgtk-6.0-4
  Fedora:                             sudo dnf install gtk4 webkitgtk6.0
  Arch Linux:                         sudo pacman -S gtk4 webkitgtk-6.0

Older distributions without WebKitGTK 6.0 can use the Flatpak bundle instead
(mindsift-desktop-linux-amd64.flatpak on the same release page), which brings its own runtime.

The tray icon needs a StatusNotifier host (KDE and most desktops; GNOME with the AppIndicator
extension).

MindSift is licensed under the GNU Affero General Public License v3.0 (LICENSE).
THIRD_PARTY_LICENSES.txt lists the third-party software built into the app with its licenses.

https://mindsift.app/  -  https://github.com/mindsift-app/mindsift
