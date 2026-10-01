#!/bin/sh
# Install the H/Ai extension into VS Code from the latest GitHub release (or a local .vsix given as $1).
set -eu
URL="https://github.com/SnapBlock/hai-browser/releases/latest/download/hai-browser.vsix"

CODE="${CODE:-}"
if [ -z "$CODE" ]; then
  for c in code \
    "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code" \
    "$HOME/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code"; do
    if command -v "$c" >/dev/null 2>&1; then CODE="$c"; break; fi
  done
fi
if [ -z "$CODE" ]; then
  echo "Could not find VS Code's 'code' command. In VS Code run 'Shell Command: Install code command in PATH', or set CODE=/path/to/code." >&2
  exit 1
fi

if [ $# -gt 0 ]; then
  VSIX="$1"
else
  TMP="$(mktemp -d)"
  trap 'rm -rf "$TMP"' EXIT
  VSIX="$TMP/hai-browser.vsix"
  echo "Downloading $URL"
  curl -fsSL "$URL" -o "$VSIX"
fi

"$CODE" --install-extension "$VSIX" --force
echo "H/Ai is installed. Open (or reload) VS Code and click 'Connect Claude Code' when it asks."
