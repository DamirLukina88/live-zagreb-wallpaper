// src/wallpaper/version.js — is the installed host package (KDE plugin, Lively package) current?
// The page itself updates from GitHub Pages; the package around it does not. Hosts from 1.2.0 on
// send their version as #host=kde-1.2.0 / #host=lively-1.2.0; older ones send nothing.
// Raise a host's minimum only when a release changes that package (QML, settings, Lively
// properties); the other host keeps its own, so its users are not asked to reinstall for nothing.
export const MIN_HOST = {
    kde: '1.3.2', // 1.3.2: pause fixes (a minimized window paused it; each display checks only its own windows)
    lively: '1.3.0' // 1.3.0: weather card corner and show/hide settings
};

const parts = v => String(v).split('.').map(n => parseInt(n, 10) || 0);
function older(a, b) {
    const x = parts(a), y = parts(b);
    for (let i = 0; i < 3; i++) {
        if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
    }
    return false;
}

// host: the #host= value, or null. A page opened directly in a browser (no host, no old plugin's
// sharp= in the address, no Lively callback) is not a package and gets no notice, even with test
// settings such as wx= or clock= in the address.
export function hostOutdated(host, inWallpaper) {
    if (!host) return !!inWallpaper;
    const m = /^(kde|lively)-(\d+(?:\.\d+){0,2})$/.exec(host);
    return m ? older(m[2], MIN_HOST[m[1]]) : false;
}
