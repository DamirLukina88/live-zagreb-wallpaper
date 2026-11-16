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

# From a git clone the page inside the plugin (its offline copy) is not there until it is built
if [[ -n "$PKG_DIR" && -f "$PKG_DIR/metadata.json" && ! -f "$PKG_DIR/contents/web/app.js" ]]; then
    REPO_DIR="$(cd "$PKG_DIR/../.." && pwd)"
    if [[ -f "$REPO_DIR/package.json" ]] && command -v npm >/dev/null 2>&1; then
        echo "Building the wallpaper page (first run from a git clone)..."
        (cd "$REPO_DIR" && npm ci --no-audit --no-fund && npm run build)
    else
        echo "ERROR: this is a git clone without a built page. Install Node.js and run 'npm ci && npm run build'," >&2
        echo "       or download the ready setup archive:" >&2
        echo "       https://github.com/DamirLukina88/live-zagreb-wallpaper/releases/latest/download/Live-Zagreb-Wallpaper-Linux-Setup.tar.gz" >&2
        exit 1
    fi
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
echo "  3. Configure City, Language (HR/EN), Quality and the multi-display layout."
echo ""
echo "After an update, restart Plasma to load the new plugin:  systemctl --user restart plasma-plasmashell"
