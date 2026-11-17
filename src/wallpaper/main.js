// src/wallpaper/main.js — wallpaper entry: the game's Zagreb terrace background plus the weather card.
import { sunPosition } from '../game/sun.js';
import { createZagrebBackground } from '../game/zagreb-bg.js';
import { settings, onSettingsChange, onPauseChange } from './settings.js';
import { fetchWeather, cachedWeather } from './weather-api.js';
import { renderPanel, renderUpdateNotice, tr } from './panel.js';
import { hostOutdated } from './version.js';
import { onBattery, onPowerChange } from './power.js';

// Battery first (see the top of src/game/zagreb-bg.js): the picture is still unless precipitation
// animates, a still picture is sharp (it is drawn once), animation is half resolution, and on
// battery nothing animates at all unless the user asked for it.
function applyEngine() {
    const dpr = window.devicePixelRatio || 1;
    globalThis.__WP_FPS__ = settings.fps;
    globalThis.__WP_SCALES__ = { still: settings.quality === 'low' ? 0.5 : Math.min(dpr, 2), moving: 0.5 };
    globalThis.__WP_ON_BATTERY__ = onBattery() && !settings.animBattery;
}
applyEngine();

const canvas = document.getElementById('weather-canvas');
const overlay = document.getElementById('weather-overlay');
const REFETCH_MS = 15 * 60 * 1000;
let weather = null;
let lastFetch = 0;

const bg = createZagrebBackground(canvas, overlay, {
    onArtError() { console.warn('Zagreb artwork failed to load'); }
});
bg.setEnabled(true);
if (settings.clock) bg.setTestClock(settings.clock);
if (settings.season) bg.setTestSeason(settings.season);
if (settings.seasonmix) bg.setTestSeason(settings.seasonmix);

// ------------------------------------------------------------------
// Multi-display: span geometry and where the weather card goes
// ------------------------------------------------------------------
// KDE runs one page per display and sends view/desk/scene. Lively's span layout is one page over
// all displays: their real layout comes from the browser's Window Management API when it is
// allowed (sizes, positions, portrait displays, the primary display); otherwise the page is split
// into `slots` equal displays side by side.
let detected = null; // [{ x, y, w, h, primary }] in screen pixels, from getScreenDetails()

async function detectScreens() {
    if (typeof window.getScreenDetails !== 'function') return;
    try {
        const perm = await navigator.permissions.query({ name: 'window-management' }).catch(() => null);
        if (perm && perm.state === 'denied') return;
        const details = await Promise.race([
            window.getScreenDetails(),
            new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 5000))
        ]);
        const read = () => {
            detected = details.screens.map(s => ({ x: s.left, y: s.top, w: s.width, h: s.height, primary: !!s.isPrimary }));
            applyLayout();
        };
        details.addEventListener('screenschange', read);
        read();
    } catch (err) {
        console.info('Screen layout not available, using equal displays:', err && err.message);
    }
}

function spanConfig() {
    if (settings.layout !== 'span') return null;
    if (settings.view && settings.desk && settings.scene) {
        return { view: settings.view, desk: settings.desk, scene: settings.scene };
    }
    const w = window.innerWidth, h = window.innerHeight;
    if (detected && detected.length > 1) {
        // The span window covers the bounding box of all displays; map screen pixels onto the page
        const minX = Math.min(...detected.map(s => s.x)), minY = Math.min(...detected.map(s => s.y));
        const dw = Math.max(...detected.map(s => s.x + s.w)) - minX;
        const dh = Math.max(...detected.map(s => s.y + s.h)) - minY;
        const kx = w / dw, ky = h / dh;
        const byLeft = [...detected].sort((a, b) => a.x - b.x || a.y - b.y);
        // sceneDisplay 0 = automatic: the primary display (else the largest, if none is marked primary)
        const pick = settings.slot >= 1 && settings.slot <= byLeft.length ? byLeft[settings.slot - 1]
            : detected.find(s => s.primary) || [...detected].sort((a, b) => b.w * b.h - a.w * a.h)[0];
        const scene = { x: (pick.x - minX) * kx, y: (pick.y - minY) * ky, w: pick.w * kx, h: pick.h * ky };
        return { view: { x: 0, y: 0, w, h }, desk: { w, h }, scene };
    }
    const n = settings.slots || 1;
    if (n < 2) return null;
    const slot = Math.min(n, settings.slot >= 1 ? settings.slot : Math.ceil(n / 2)) - 1;
    const sw = w / n;
    return { view: { x: 0, y: 0, w, h }, desk: { w, h }, scene: { x: slot * sw, y: 0, w: sw, h } };
}

// The card sits in the top-right corner of the scene display, and only where that display is
function placeCard(span) {
    const panel = document.getElementById('weather-panel');
    if (!panel) return;
    if (!span) {
        panel.style.display = '';
        panel.style.right = panel.style.top = '';
        return;
    }
    const { view: v, scene: s } = span;
    const left = Math.max(s.x, v.x), right = Math.min(s.x + s.w, v.x + v.w);
    const top = Math.max(s.y, v.y), bottom = Math.min(s.y + s.h, v.y + v.h);
    if (right - left < 200 || bottom - top < 200) {
        panel.style.display = 'none';
        return;
    }
    panel.style.display = '';
    panel.style.right = `${Math.round(v.x + v.w - right) + 24}px`;
    panel.style.top = `${Math.round(top - v.y) + 24}px`;
}

let lastSpanKey = '';
function applyLayout() {
    const span = spanConfig();
    const key = JSON.stringify(span);
    placeCard(span);
    if (key === lastSpanKey) return;
    lastSpanKey = key;
    bg.setLayout(span);
}
applyLayout();
window.addEventListener('resize', applyLayout);
// Only Lively's span needs to ask (KDE sends the geometry); asking is harmless elsewhere
if (settings.layout === 'span' && !settings.view) detectScreens();
onSettingsChange((s, changed) => {
    if (changed.includes('layout') && s.layout === 'span' && !s.view && !detected) detectScreens();
});

onPauseChange(paused => bg.setPaused(paused));

// Lively gives no address parameters to old packages, but it does call livelyPropertyListener
const showUpdate = () => renderUpdateNotice(hostOutdated(settings.host, settings.hosted), settings.lang);
showUpdate();
onPowerChange(() => { applyEngine(); bg.start(); });

function isDayAt(date, lat, lon) {
    if (lat != null && lon != null) return sunPosition(date, lat, lon).altitude > -0.833;
    const h = date.getHours();
    return h >= 6 && h < 20;
}

function apply(w) {
    if (!w) return;
    weather = w;
    const now = settings.clock || new Date();
    const day = isDayAt(now, w.latitude, w.longitude);
    const code = settings.wx !== null ? settings.wx : w.weathercode;
    const pick = (test, real) => (test !== null && test !== undefined ? test : real ?? null);
    bg.setEnv({
        lat: w.latitude, lon: w.longitude, utcOffsetSeconds: w.utc_offset_seconds, tempC: w.temperature,
        cloudPct: pick(settings.cloud, w.cloudPct), windDir: pick(settings.winddir, w.windDir),
        snowDepthCm: pick(settings.snow, w.snowDepthCm), dryness: pick(settings.dry, w.dryness),
        advent: settings.advent
    });
    bg.setWeather(code, day, w.windspeed);
    canvas.classList.add('wx-ready');
    overlay.classList.add('wx-ready');
    bg.show();
    renderPanel({ ...w, weathercode: code, is_day: day ? 1 : 0 }, settings.lang);
}

apply(cachedWeather() || {
    city: settings.city,
    country: 'HR',
    latitude: 45.815,
    longitude: 15.9819,
    temperature: 18,
    weathercode: settings.wx !== null ? settings.wx : 0,
    windspeed: 10,
    is_day: 1,
    utc_offset_seconds: 3600,
    daily: { time: [], weathercode: [], temperature_2m_max: [], temperature_2m_min: [], sunrise: [], sunset: [] }
});

// Fast retry after boot (the network is often not up yet when the desktop starts)
const RETRY_MS = [60 * 1000, 120 * 1000, 300 * 1000];
let retries = 0;
let retryTimer = null;

async function refresh() {
    clearTimeout(retryTimer);
    retryTimer = null;
    lastFetch = Date.now();
    try {
        const w = await fetchWeather(settings.city);
        retries = 0;
        apply(w);
    } catch (err) {
        console.warn('Weather fetch error:', err);
        if (err && err.message === 'City not found') {
            const cond = document.getElementById('wp-cond');
            if (cond) cond.textContent = tr('weather_not_found', settings.lang);
            return;
        }
        const wait = RETRY_MS[Math.min(retries, RETRY_MS.length - 1)];
        retries++;
        retryTimer = setTimeout(refresh, wait);
    }
}
refresh();

// Every minute: re-evaluate day/night; refetch every 15 minutes
function tick() {
    if (weather) {
        const now = settings.clock || new Date();
        const code = settings.wx !== null ? settings.wx : weather.weathercode;
        bg.setWeather(code, isDayAt(now, weather.latitude, weather.longitude), weather.windspeed);
    }
    if (Date.now() - lastFetch >= REFETCH_MS) refresh();
}
// The still picture is redrawn by this tick alone. It fires on the whole minute, so every display
// (each runs its own page) redraws at the same moment with the same clouds.
(function everyMinute() {
    setTimeout(() => { tick(); everyMinute(); }, 60000 - (Date.now() % 60000) + 50);
})();
document.addEventListener('visibilitychange', () => { if (!document.hidden) tick(); });
document.addEventListener('resume', tick);

// Service worker: offline copy of the page, checks GitHub Pages for a new build hourly
const SW_CHECK_MS = 3600 * 1000;
if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.protocol === 'http:')) {
    let lastCheck = Date.now();
    navigator.serviceWorker.register('./sw.js').then(reg => {
        const check = () => {
            if (document.hidden || Date.now() - lastCheck < SW_CHECK_MS) return;
            lastCheck = Date.now();
            reg.update().catch(() => {});
        };
        setInterval(check, SW_CHECK_MS);
        document.addEventListener('visibilitychange', check);
        document.addEventListener('resume', check);
    }).catch(err => console.warn('SW registration skipped:', err));
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (reloading) return;
        reloading = true;
        window.location.reload();
    });
}

onSettingsChange((s, changed) => {
    if (changed.includes('lang') && weather) renderPanel(weather, s.lang);
    if (changed.includes('lang') || changed.includes('host')) showUpdate();
    if (changed.includes('city')) { retries = 0; refresh(); }
    if (changed.includes('layout')) applyLayout();
    if (['quality', 'fps', 'animBattery'].some(k => changed.includes(k))) { applyEngine(); bg.start(); }
});
