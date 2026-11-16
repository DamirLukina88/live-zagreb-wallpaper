// src/wallpaper/settings.js — wallpaper settings from the URL hash, localStorage and the hosts.
// KDE passes settings in the hash and later through window.wallpaperSettings(); Lively calls
// window.livelyPropertyListener(name, value) once per property.
//
// Multi-display (see README):
//   layout  'clone' (default: the whole scene on this display) or 'span' (one scene over all displays)
//   view    this page's rectangle on the desktop, x,y,w,h in CSS pixels      } sent by KDE, one page
//   desk    the whole desktop's size, w,h                                      } per display. Lively
//   scene   the display that carries the terrace and the weather card, x,y,w,h } spans one page, so
//   slots / slot  Lively: if the browser cannot report the displays, the page is split into `slots`
//                 equal displays; the scene is on `slot` (1-based from the left, 0 = primary/middle)

const num = s => (s === null || s === '' || isNaN(Number(s)) ? null : Number(s));
function rect(s, n = 4) {
    if (!s) return null;
    const v = (Array.isArray(s) ? s : String(s).split(',')).map(Number);
    if (v.length !== n || v.some(x => !Number.isFinite(x))) return null;
    return n === 4 ? { x: v[0], y: v[1], w: v[2], h: v[3] } : { w: v[0], h: v[1] };
}
const rectOf = (r, n = 4) => (r && typeof r === 'object' && !Array.isArray(r) ? rect(n === 4 ? [r.x, r.y, r.w, r.h] : [r.w, r.h], n) : rect(r, n));

function readHash() {
    const raw = (window.location.hash || '').replace(/^#/, '');
    const p = new URLSearchParams(raw);
    return {
        city: p.get('city') || null,
        lang: p.get('lang') || null,
        sharp: p.has('sharp') ? p.get('sharp') === '1' || p.get('sharp') === 'true' : null,
        fps: num(p.get('fps')),
        clock: p.get('clock') || null,
        wx: p.has('wx') ? parseInt(p.get('wx'), 10) : null,
        season: p.get('season') || null,
        layout: p.get('layout') || null,
        view: rect(p.get('view')),
        desk: rect(p.get('desk'), 2),
        scene: rect(p.get('scene')),
        slots: num(p.get('slots')),
        slot: num(p.get('slot'))
    };
}

function readStored() {
    try {
        const s = localStorage.getItem('wp_settings');
        if (s) return JSON.parse(s);
    } catch {}
    return {};
}

// Geometry is not stored: it belongs to the display this page is on, which the host sends each time
function store(s) {
    try {
        localStorage.setItem('wp_settings', JSON.stringify({ city: s.city, lang: s.lang, sharp: s.sharp, fps: s.fps, layout: s.layout, slots: s.slots, slot: s.slot }));
    } catch {}
}
// Frames per second while precipitation moves (15 by default); otherwise the picture is still (zagreb-bg redraws it once a minute)
export const DEFAULT_FPS = 15;
const clampFps = v => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.max(5, Math.min(30, n)) : DEFAULT_FPS;
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

const listeners = [];
let cityTimer = null;

export function onSettingsChange(fn) {
    listeners.push(fn);
}

function notify(changed = []) {
    store(settings);
    listeners.forEach(fn => fn(settings, changed));
}

// immediate: skip the 500 ms debounce that city typing gets
export function updateSettings(next, immediate = false) {
    const changed = [];
    let cityChanged = false;
    if (next.city !== undefined && next.city !== settings.city) {
        settings.city = String(next.city).trim() || 'Zagreb';
        changed.push('city');
        cityChanged = true;
    }
    if (next.lang !== undefined && next.lang !== settings.lang) {
        settings.lang = next.lang === 'en' ? 'en' : 'hr';
        changed.push('lang');
    }
    if (next.sharp !== undefined && next.sharp !== settings.sharp) {
        settings.sharp = !!next.sharp;
        changed.push('sharp');
    }
    if (next.fps !== undefined && next.fps !== null) {
        const fps = clampFps(next.fps);
        if (fps !== settings.fps) {
            settings.fps = fps;
            changed.push('fps');
        }
    }
    if (next.layout !== undefined) {
        const layout = next.layout === 'span' ? 'span' : 'clone';
        if (layout !== settings.layout) {
            settings.layout = layout;
            changed.push('layout');
        }
    }
    for (const [k, n] of [['view', 4], ['desk', 2], ['scene', 4]]) {
        if (next[k] === undefined) continue;
        const r = rectOf(next[k], n);
        if (!same(r, settings[k])) {
            settings[k] = r;
            if (!changed.includes('layout')) changed.push('layout');
        }
    }
    for (const k of ['slots', 'slot']) {
        if (next[k] === undefined) continue;
        // slot 0 = automatic (the primary display)
        const v = Math.max(k === 'slot' ? 0 : 1, Math.min(8, Math.round(Number(next[k]) || 0)));
        if (v !== settings[k]) {
            settings[k] = v;
            if (!changed.includes('layout')) changed.push('layout');
        }
    }
    if (cityChanged && !immediate) {
        clearTimeout(cityTimer);
        cityTimer = setTimeout(() => notify(changed), 500);
    } else if (changed.length > 0) {
        notify(changed);
    }
}

const fromHash = readHash();
const stored = readStored();

// clock, wx and season are test overrides (hash only), used by the render checks
export const settings = {
    city: fromHash.city || stored.city || 'Zagreb',
    lang: fromHash.lang || stored.lang || 'hr',
    sharp: fromHash.sharp !== null ? fromHash.sharp : stored.sharp ?? false,
    fps: clampFps(fromHash.fps ?? stored.fps ?? DEFAULT_FPS),
    clock: fromHash.clock ? new Date(fromHash.clock) : null,
    wx: fromHash.wx !== null && !isNaN(fromHash.wx) ? fromHash.wx : null,
    season: fromHash.season || null,
    layout: (fromHash.layout || stored.layout) === 'span' ? 'span' : 'clone',
    view: fromHash.view,
    desk: fromHash.desk,
    scene: fromHash.scene,
    slots: Math.max(1, Math.min(8, Math.round(fromHash.slots || stored.slots || 3))),
    slot: Math.max(0, Math.min(8, Math.round(fromHash.slot ?? stored.slot ?? 0)))
};

window.wallpaperSettings = function (s) {
    if (!s || typeof s !== 'object') return;
    updateSettings({
        city: s.city, lang: s.lang, sharp: s.sharp, fps: s.fps,
        layout: s.layout, view: s.view, desk: s.desk, scene: s.scene
    });
};

// Pause: KDE calls wallpaperPaused(true/false) when windows cover this display; Lively calls
// livelyWallpaperPlaybackChanged with {"IsPaused": ...} under its own pause rules
const pauseListeners = [];
export function onPauseChange(fn) {
    pauseListeners.push(fn);
}
window.wallpaperPaused = function (paused) {
    pauseListeners.forEach(fn => fn(!!paused));
};
window.livelyWallpaperPlaybackChanged = function (data) {
    try {
        const d = typeof data === 'string' ? JSON.parse(data) : data;
        if (d && typeof d.IsPaused === 'boolean') window.wallpaperPaused(d.IsPaused);
    } catch {}
};

window.livelyPropertyListener = function (name, value) {
    switch (name) {
        case 'city':
            updateSettings({ city: value });
            break;
        case 'lang':
            updateSettings({ lang: value === 1 || value === 'en' ? 'en' : 'hr' }, true);
            break;
        case 'sharp':
            updateSettings({ sharp: !!value }, true);
            break;
        case 'fps':
            updateSettings({ fps: value }, true);
            break;
        case 'layout': // dropdown: 0 clone, 1 span
            updateSettings({ layout: value === 1 || value === 'span' ? 'span' : 'clone' }, true);
            break;
        case 'spanDisplays':
            updateSettings({ slots: value }, true);
            break;
        case 'sceneDisplay':
            updateSettings({ slot: value }, true);
            break;
    }
};
