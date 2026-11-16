// src/wallpaper/version.js — is the installed host package (KDE plugin, Lively package) current?
// The page itself updates from GitHub Pages; the package around it does not. Hosts from 1.2.0 on
// send their version as #host=kde-1.2.0 / #host=lively-1.2.0; older ones send nothing.
// Raise MIN_HOST only when a release changes the package (QML, settings, Lively properties).
export const MIN_HOST = '1.2.0';

const parts = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
function older(a, b) {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
    }
    return false;
}

// host: the #host= value, or null. A page opened directly in a browser (no host, no wallpaper
// settings in the address) is not a package and gets no notice.
export function hostOutdated(host, inWallpaper) {
    if (!host) return !!inWallpaper;
    const m = /^(kde|lively)-(\d+(?:\.\d+){0,2})$/.exec(host);
    return m ? older(m[2], MIN_HOST) : false;
}
