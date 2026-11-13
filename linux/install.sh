#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PKG_DIR="$SCRIPT_DIR/skill-issue-wallpaper"

if [[ ! -d "$PKG_DIR" ]]; then
    PKG_DIR="$(cd "$SCRIPT_DIR/../kde/skill-issue-wallpaper" 2>/dev/null && pwd || true)"
fi
if [[ ! -d "$PKG_DIR" ]]; then
    PKG_DIR="$(cd "$SCRIPT_DIR/../dist/kde/skill-issue-wallpaper" 2>/dev/null && pwd || true)"
fi

if [[ -z "$PKG_DIR" || ! -f "$PKG_DIR/metadata.json" ]]; then
    echo "ERROR: Could not find KDE wallpaper package directory (skill-issue-wallpaper)." >&2
    exit 1
fi

if ! command -v kpackagetool6 >/dev/null 2>&1; then
    echo "ERROR: kpackagetool6 not found. Please install KDE Plasma 6 (kpackage)." >&2
    exit 1
fi

echo "=== Live Zagreb Wallpaper (KDE Plasma 6) Setup ==="
if kpackagetool6 -t Plasma/Wallpaper -s hr.tsrb.skillissue.wallpaper >/dev/null 2>&1; then
    echo "Updating existing wallpaper plugin..."
    kpackagetool6 -t Plasma/Wallpaper -u "$PKG_DIR"
else
    echo "Installing wallpaper plugin..."
    kpackagetool6 -t Plasma/Wallpaper -i "$PKG_DIR"
fi

echo ""
echo "Done! To enable:"
echo "  1. Right-click your desktop -> Configure Desktop and Wallpaper..."
echo "  2. Set Wallpaper Type to: Skill Issue: Zagreb Weather"
echo "  3. Configure City, Language (HR/EN), and Sharp mode."
