#!/bin/sh
# East Room's installer for macOS and Linux. It is short: read it before you run it.
#
#   curl -LsSf https://raw.githubusercontent.com/intesarjawad/eastroom/main/install.sh | sh
#
# It asks for no password and writes only inside your home folder:
#   1. uv, if you do not have it. uv fetches Python and keeps East Room apart from everything else.
#   2. East Room itself, with PDF support.
#   3. An East Room icon: in Applications on a Mac, in the app menu on Linux.
# Run the same line again to update. To take it all away again:
#
#   curl -LsSf https://raw.githubusercontent.com/intesarjawad/eastroom/main/install.sh | sh -s -- --uninstall
#
# Your books live in ~/.eastroom and are never touched by either.
set -eu

SOURCE=${EASTROOM_SOURCE:-https://github.com/intesarjawad/eastroom/archive/refs/heads/main.tar.gz}
APP="$HOME/Applications/East Room.app"
ENTRY="${XDG_DATA_HOME:-$HOME/.local/share}/applications/eastroom.desktop"
AGENT="$HOME/Library/LaunchAgents/eastroom.home.plist"

say() { printf '%s\n' "$*"; }
stop() {
  printf '\nEast Room was not installed: %s\nNext step: %s\n' "$1" "$2" >&2
  exit 1
}

uninstall() {
  if [ -f "$AGENT" ]; then # "Start with the computer" was on
    launchctl bootout "gui/$(id -u)/eastroom.home" 2>/dev/null || true
    rm -f "$AGENT"
  fi
  rm -rf "$APP"
  rm -f "$ENTRY"
  if command -v uv >/dev/null 2>&1; then uv tool uninstall eastroom 2>/dev/null || true; fi
  say "East Room is removed. Your books are still in $HOME/.eastroom: delete that folder to remove them too."
}

mac_icon() { # $1: where the package keeps its pictures
  mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
  sips -s format icns "$1/icon-512.png" --out "$APP/Contents/Resources/East Room.icns" >/dev/null 2>&1 || true
  cat >"$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleName</key><string>East Room</string>
  <key>CFBundleIdentifier</key><string>com.intesarjawad.eastroom</string>
  <key>CFBundleExecutable</key><string>East Room</string>
  <key>CFBundleIconFile</key><string>East Room</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1</string>
  <key>LSUIElement</key><true/>
</dict></plist>
PLIST
  # the icon starts East Room and shows it in the browser; pressed again, it shows the one that runs
  cat >"$APP/Contents/MacOS/East Room" <<RUN
#!/bin/sh
mkdir -p "\$HOME/Library/Logs"
exec "$2" >>"\$HOME/Library/Logs/East Room.log" 2>&1
RUN
  chmod +x "$APP/Contents/MacOS/East Room"
}

linux_icon() {
  mkdir -p "$(dirname "$ENTRY")"
  cat >"$ENTRY" <<ENTRY
[Desktop Entry]
Type=Application
Name=East Room
Comment=Read whole books in the author's own words
Exec="$2"
Icon=$1/icon-512.png
Terminal=false
Categories=Office;Viewer;
ENTRY
}

main() {
  case "$(uname -s)" in
    Darwin) system=mac ;;
    Linux) system=linux ;;
    *) stop "this installer is for macOS and Linux." "On Windows, use the PowerShell line in the README: https://github.com/intesarjawad/eastroom#install" ;;
  esac
  if [ "${1:-}" = "--uninstall" ]; then
    uninstall
    return
  fi
  command -v curl >/dev/null 2>&1 || stop "the curl command is missing." "Install curl with your system's package manager, then run this line again."

  if ! command -v uv >/dev/null 2>&1; then
    say "Getting uv, the tool that installs East Room and its Python..."
    curl -LsSf https://astral.sh/uv/install.sh | sh >/dev/null 2>&1 || stop "uv could not be downloaded." "Check your internet connection, then run this line again."
    PATH="${XDG_BIN_HOME:-$HOME/.local/bin}:$HOME/.cargo/bin:$PATH"
    export PATH
    command -v uv >/dev/null 2>&1 || stop "uv was downloaded but cannot be found." "Close this window, open a new Terminal, and run this line again."
  fi

  say "Installing East Room..."
  uv tool install --quiet --force --python 3.13 "eastroom[pdf] @ $SOURCE" || stop "the download or the setup failed (the lines above say where)." "Check your internet connection and run this line again. If it fails the same way, send those lines to https://github.com/intesarjawad/eastroom/issues"
  uv tool update-shell >/dev/null 2>&1 || true # so that "eastroom" also works when typed in a new Terminal
  # East Room was called Devour at first: that command and its icon go. Its books are taken over at the first start.
  uv tool uninstall devour-reader >/dev/null 2>&1 || true
  rm -rf "$HOME/Applications/Devour.app"
  rm -f "${XDG_DATA_HOME:-$HOME/.local/share}/applications/devour.desktop"

  bin="$(uv tool dir --bin)/eastroom"
  [ -x "$bin" ] || stop "the eastroom command is not where uv said it would be ($bin)." "Send this line to https://github.com/intesarjawad/eastroom/issues"
  web="$("$(uv tool dir)/eastroom/bin/python" -c 'import eastroom, pathlib; print(pathlib.Path(eastroom.__file__).parent / "web")')"

  if [ "$system" = mac ]; then
    mac_icon "$web" "$bin"
    say ""
    say "East Room is installed. It is opening in your browser now."
    say "Next time: open East Room from your Applications folder, or press Command and Space and type East Room."
    [ -n "${EASTROOM_NO_OPEN:-}" ] || open "$APP"
  else
    linux_icon "$web" "$bin"
    say ""
    say "East Room is installed. It is opening in your browser now."
    say "Next time: open East Room from your app menu, or type eastroom in a terminal."
    [ -n "${EASTROOM_NO_OPEN:-}" ] || (nohup "$bin" >/dev/null 2>&1 &)
  fi
  say "To add a book, drop its file on the page."
}

main "$@" # the last line: a download that stops half way runs nothing
