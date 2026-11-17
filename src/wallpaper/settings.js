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
// Weather card corners: top right (default), top left, bottom right, bottom left
export const CARD_CORNERS = ['tr', 'tl', 'br', 'bl'];
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
        quality: p.get('quality') || null,
        animBattery: p.has('animbattery') ? p.get('animbattery') === '1' : null,
        fps: num(p.get('fps')),
        clock: p.get('clock') || null,
        wx: p.has('wx') ? parseInt(p.get('wx'), 10) : null,
        season: p.get('season') || null,
        seasonmix: p.get('seasonmix') || null,
        cloud: num(p.get('cloud')),
        winddir: num(p.get('winddir')),
        snow: num(p.get('snow')),
        dry: num(p.get('dry')),
        advent: p.has('advent') ? p.get('advent') === '1' : null,
        soontest: p.get('soontest') || null,
        card: p.get('card') || null,
        showCard: p.has('showcard') ? p.get('showcard') !== '0' : null,
        power: p.get('power') || null,
        host: p.get('host') || null,
        any: raw.length > 0,
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
        localStorage.setItem('wp_settings', JSON.stringify({ city: s.city, lang: s.lang, quality: s.quality, animBattery: s.animBattery, fps: s.fps, layout: s.layout, slots: s.slots, slot: s.slot, card: s.card, showCard: s.showCard }));
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
    if (next.quality !== undefined && next.quality !== null) {
        const q = next.quality === 'low' ? 'low' : 'auto';
        if (q !== settings.quality) {
            settings.quality = q;
            changed.push('quality');
        }
    }
    if (next.animBattery !== undefined && next.animBattery !== null && !!next.animBattery !== settings.animBattery) {
        settings.animBattery = !!next.animBattery;
        changed.push('animBattery');
    }
    if (next.fps !== undefined && next.fps !== null) {
        const fps = clampFps(next.fps);
        if (fps !== settings.fps) {
            settings.fps = fps;
            changed.push('fps');
        }
    }
    // The weather card: which corner of the scene display, and whether it is shown at all
    if (next.card !== undefined && next.card !== null) {
        const card = CARD_CORNERS.includes(next.card) ? next.card : 'tr';
        if (card !== settings.card) {
            settings.card = card;
            changed.push('card');
        }
    }
    if (next.showCard !== undefined && next.showCard !== null && !!next.showCard !== settings.showCard) {
        settings.showCard = !!next.showCard;
        changed.push('card');
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

// clock, wx, season and power are test overrides (hash only), used by the render checks and the benchmark
export const settings = {
    city: fromHash.city || stored.city || 'Zagreb',
    lang: fromHash.lang || stored.lang || 'hr',
    // 'auto': a still picture is sharp, animated precipitation is half resolution; 'low': always half.
    // (The old Sharp switch is gone: hosts that still send it are ignored.)
    quality: (fromHash.quality || stored.quality) === 'low' ? 'low' : 'auto',
    animBattery: fromHash.animBattery !== null ? fromHash.animBattery : stored.animBattery ?? false,
    fps: clampFps(fromHash.fps ?? stored.fps ?? DEFAULT_FPS),
    clock: fromHash.clock ? new Date(fromHash.clock) : null,
    wx: fromHash.wx !== null && !isNaN(fromHash.wx) ? fromHash.wx : null,
    season: fromHash.season || null,
    // more test overrides: seasonmix=autumn,winter,0.5  cloud=0..100  winddir=0..360 (from)
    // snow=<cm lying>  dry=0..1  advent=1|0
    seasonmix: fromHash.seasonmix,
    cloud: fromHash.cloud,
    winddir: fromHash.winddir,
    snow: fromHash.snow,
    dry: fromHash.dry,
    advent: fromHash.advent,
    // soontest=rain:40 (rain starts in 40 min), rain-until:30 (it stops in 30 min), snow:20 ...
    soontest: fromHash.soontest,
    card: CARD_CORNERS.includes(fromHash.card || stored.card) ? (fromHash.card || stored.card) : 'tr',
    showCard: fromHash.showCard !== null ? fromHash.showCard : stored.showCard ?? true,
    power: fromHash.power === 'battery' || fromHash.power === 'ac' ? fromHash.power : null,
    // host package version (#host=kde-1.2.0); hosted: opened by a wallpaper host, not typed into a browser
    host: fromHash.host,
    hosted: fromHash.any,
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
        city: s.city, lang: s.lang, quality: s.quality, animBattery: s.animBattery, fps: s.fps,
        card: s.card, showCard: s.showCard,
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
    // Only Lively calls this: an old package has no #host= in its address, but it is a host
    if (!settings.hosted) {
        settings.hosted = true;
        notify(["host"]);
    }
    switch (name) {
        case 'city':
            updateSettings({ city: value });
            break;
        case 'lang':
            updateSettings({ lang: value === 1 || value === 'en' ? 'en' : 'hr' }, true);
            break;
        case 'quality': // dropdown: 0 automatic, 1 always low
            updateSettings({ quality: value === 1 || value === 'low' ? 'low' : 'auto' }, true);
            break;
        case 'animBattery':
            updateSettings({ animBattery: !!value }, true);
            break;
        case 'fps':
            updateSettings({ fps: value }, true);
            break;
        case 'layout': // dropdown: 0 clone, 1 span
            updateSettings({ layout: value === 1 || value === 'span' ? 'span' : 'clone' }, true);
            break;
        case 'cardCorner': // dropdown: 0 top right, 1 top left, 2 bottom right, 3 bottom left
            updateSettings({ card: CARD_CORNERS[Number(value)] || 'tr' }, true);
            break;
        case 'showCard':
            updateSettings({ showCard: !!value }, true);
            break;
        case 'spanDisplays':
            updateSettings({ slots: value }, true);
            break;
        case 'sceneDisplay':
            updateSettings({ slot: value }, true);
            break;
    }
};
