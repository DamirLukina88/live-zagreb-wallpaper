// src/wallpaper/power.js — is the computer running on battery?
// Sources, in order: the #power= test override, the host (KDE calls window.wallpaperPower), the
// browser's Battery Status API (Lively's Chromium). Unknown counts as mains power.
import { settings } from './settings.js';

const listeners = [];
let fromHost = null;    // true/false once the host has said
let fromBrowser = null; // true/false once the Battery API has answered

export function onBattery() {
    if (settings.power) return settings.power === 'battery';
    if (fromHost !== null) return fromHost;
    return fromBrowser === true;
}

export function onPowerChange(fn) {
    listeners.push(fn);
}

let last = onBattery();
function changed() {
    const now = onBattery();
    if (now === last) return;
    last = now;
    listeners.forEach(fn => fn(now));
}

window.wallpaperPower = function (state) {
    fromHost = state === true || state === 'battery';
    changed();
};

if (navigator.getBattery) {
    navigator.getBattery().then(b => {
        const read = () => { fromBrowser = !b.charging; changed(); };
        b.addEventListener('chargingchange', read);
        read();
    }).catch(() => {});
}
