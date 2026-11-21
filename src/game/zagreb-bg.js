// src/zagreb-bg.js — the game's background: the Zagreb Cathedral seen from a terrace in the Upper
// Town, under the real sky of the player's weather city.
//
// One painting (public/bg/zagreb-<season>.webp, sky transparent) with everything else drawn live:
//   - the sky, sun, moon, stars and clouds follow the sun's real height for the city, date and time,
//     blending through night, blue hour, golden hour and day;
//   - weather is physically plausible: cloud, rain, snow and fog drain the colour and hide the sun,
//     steady rain and snow fall from one grey sheet, distance fades into the air;
//   - night lights sit on the painted windows and are mirrored in the wet terrace;
//   - the terrace half-freezes in snow and frost; a rainbow may follow daytime rain.
// Calm rules, as for every background: 30 fps cap, half resolution, dim and quarter speed while
// playing, a soft glow instead of lightning flashes (none while playing), one still frame under
// prefers-reduced-motion.
//
// Designed and approved in the local studio (studio/weather/styles-zagreb.js and engine.js, not
// deployed); see wiki/decisions/zagreb-terrace-background.md. Change both together.

import * as SUN from './sun.js';
import { ZAGREB_LIGHTS } from './zagreb-lights.js';
import { codeToWx } from './weather-bg.js';
import { moonPosition, moonPass, skyAngle } from './moon.js';

const FRAME_MS = 1000 / 30;
// Wallpaper: battery first. Every frame makes the desktop compositor repaint the whole display,
// which is most of the GPU cost. The host page (src/wallpaper/main.js) sets on globalThis:
//   __WP_FPS__         frames per second while something animates (rain, snow, hail, a storm, the
//                      fade to new weather). Setting it turns wallpaper mode on: otherwise the
//                      picture is STILL and is drawn only when the page calls start() (once a
//                      minute, so the sun, sky, clouds and night lights follow the clock).
//   __WP_ON_BATTERY__  true: never animate; rain and snow are a still picture too.
//   __WP_SCALES__      { still, moving }: canvas scale for a still picture (sharp, it is drawn
//                      once) and while precipitation animates (low, it is drawn every frame).
// Without __WP_FPS__ (the game) every frame is FRAME_MS and the clouds drift as before.
const WP = typeof globalThis !== 'undefined' ? globalThis : {};
const wpFrameMs = () => (typeof WP.__WP_FPS__ === 'number' && WP.__WP_FPS__ > 0 ? 1000 / Math.min(WP.__WP_FPS__, 30) : 0);
const WP_MAX_PIXELS = 3840 * 2160; // a sharp still picture never needs a larger canvas than 4K
// Scale factor for canvas backing store: native 1:1 on standard screens, and up to 2x
// on high-DPI/mobile displays (retina/AMOLED) so the 1200x896 artwork renders crisp.
// Wallpaper: __WP_SCALES__ (see above); lowRes = precipitation is animating.
function getScale(lowRes) {
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    const sc = WP.__WP_SCALES__;
    if (sc && typeof sc === 'object') {
        const want = Number(lowRes ? sc.moving : sc.still) || 0.5;
        const cap = Math.sqrt(WP_MAX_PIXELS / Math.max(1, window.innerWidth * window.innerHeight));
        return Math.min(want, cap);
    }
    return Math.min(Math.max(1, dpr), 2);
}
const POOL = { rain: 160, snow: 140, hail: 60 };
const ART_BASE = 'bg/';
// The site caches .webp files for a year (public/_headers), so a changed painting is only seen
// if its address changes: bump this number whenever any public/bg/ image is regenerated.
const ART_VERSION = 1;
const artUrl = name => `${ART_BASE}zagreb-${name}.webp?v=${ART_VERSION}`;

// Vibrant look: punchier colour and contrast, as a CSS filter plus a light vignette
const LOOK_CSS = 'contrast(1.1) saturate(1.35) brightness(1.03)';
const LOOK_VIGNETTE = 0.16;

// ------------------------------------------------------------------
// Colour and random helpers
// ------------------------------------------------------------------
const hexCache = new Map();
function hex(c) {
    let v = hexCache.get(c);
    if (v) return v;
    const s = c.replace('#', '');
    v = [0, 2, 4].map(i => parseInt(s.slice(i, i + 2), 16));
    if (hexCache.size > 4000) hexCache.clear();
    hexCache.set(c, v);
    return v;
}
const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
function mix(a, b, t) {
    const A = hex(a), B = hex(b), k = clamp(t);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * k).toString(16).padStart(2, '0')).join('');
}
function rgba(c, a) {
    const A = hex(c);
    return `rgba(${A[0]},${A[1]},${A[2]},${a})`;
}
function rng(seed) {
    let s = (seed >>> 0) || 1;
    return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
}
// 0 below a, 1 above b (a > b turns it round), eased in between
const smoothstep = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };

// opts.onArtError: called once if the painting cannot be loaded
export function createZagrebBackground(canvas, overlay, opts = {}) {
    const ctx = canvas.getContext('2d');
    const octx = overlay.getContext('2d');
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    // Where the weather is and how cold (set by weather.js); the test panel can pin the clock or season
    // Wallpaper only (null = not known, the scene then behaves as in the game): cloudPct 0..100,
    // windDir degrees the wind comes from, snowDepthCm lying snow, dryness 0 wet .. 1 dry,
    // advent true/false to force the Advent look on or off (null = by the calendar)
    const ENV = { lat: null, lon: null, utcOffsetSeconds: null, tempC: null, cloudPct: null, windDir: null, snowDepthCm: null, dryness: null, advent: null };
    const TEST = { clock: null, season: null };
    // A holiday look paints its own scene on top (src/holiday.js); the terrace then steps aside
    // and only the sky, sun, moon, clouds and weather are drawn here
    let sceneryHidden = false;
    const S = {
        wx: wxFor(0, true, 0), enabled: true, paused: false, t: 0, last: 0, anim: null, W: 1, H: 1, st: {},
        clouds: [], pools: { rain: [], snow: [], hail: [] }, L: { a: 0, x: 0.5, next: 3 },
        drawn: false, shown: false, prev: null, fade: 0, dead: false
    };
    // Wallpaper span across several displays (setLayout). Each page draws its own window into one
    // "world" the size of the whole desktop: sky, sun, moon, stars and clouds run across all of it,
    // the terrace is fitted into the scene display's rectangle and carried on across the other
    // displays (drawExtension). Rain, snow, the vignette and the veil stay per display.
    // In canvas pixels: DW/DH world size, OX/OY this canvas inside it, RX/RY/RW/RH the scene rectangle.
    // Without a span the world is this canvas, so every formula below reduces to the original one.
    let SPAN = null; // { view: {x,y,w,h}, desk: {w,h}, scene: {x,y,w,h} } in CSS pixels
    const WORLD = { span: false, DW: 1, DH: 1, OX: 0, OY: 0, RX: 0, RY: 0, RW: 1, RH: 1, key: '' };
    canvas.style.filter = LOOK_CSS;

    // The shared weather model, plus a key so the light is recomputed only when the weather changes
    function wxFor(code, isDay, windKmh) {
        const wx = codeToWx(code, isDay, windKmh);
        // Wallpaper: snow lies for as long as the weather service measures it on the ground, not
        // only while it falls: a light dusting from about 1 cm, fully white from 5 cm (the user's
        // choice, 2026-11-17). It is painted into the artwork itself (snowyArt), so it takes the
        // hour's light like everything else. Without a measurement, falling snow settles a little.
        const depth = ENV.snowDepthCm;
        wx.lying = typeof depth === 'number'
            ? (depth > 0.2 ? Math.round(clamp(depth / 5) * 20) / 20 : 0)
            : (wx.snow > 0 ? Math.round(wx.snowCover * 0.6 * 20) / 20 : 0);
        // Wallpaper: in dry weather (codes 0-3) the amount of cloud follows the measured cover in
        // 10 % steps, so 20 % and 60 % look different; rain, snow, storms and fog keep their own
        // skies. Steps keep the clouds from reshuffling on every small change.
        if (code <= 3 && typeof ENV.cloudPct === 'number') {
            // ...but never against the weather the card reports: "partly cloudy" always shows
            // some clouds, "clear" no more than a few (the code and the hourly cover come from
            // different model steps and often disagree)
            const [lo, hi] = [[0, 0.1], [0.1, 0.4], [0.3, 0.7], [0.7, 1]][code];
            wx.cloud = Math.round(clamp(ENV.cloudPct / 100, lo, hi) * 10) / 10;
            wx.dark = wx.cloud > 0.9 ? 0.15 : 0;
        }
        wx.key = code + '|' + (isDay ? 1 : 0) + '|' + wx.wind + '|' + wx.lying + '|' + wx.cloud;
        return wx;
    }

    // The scenery: one painting of the terrace, town and cathedral with a transparent sky
    const sceneryImg = new Image();
    let imgLoaded = false;
    sceneryImg.onload = () => {
        imgLoaded = true;
        kick();
    };
    // Without the artwork there is no scene: the caller falls back to the Film photo hills
    sceneryImg.onerror = () => { if (opts.onArtError) opts.onArtError(); };
    sceneryImg.src = artUrl('spring'); // spring: the original painting

    // ------------------------------------------------------------------
    // Light model: sky, sun, scene tint and lights all follow the sun's real height
    // ------------------------------------------------------------------
    const ZAGREB = { lat: 45.815, lon: 15.982 };
    const HORIZON = 520 / 896; // the hill line on the cutout
    const lerp = (a, b, t) => a + (b - a) * t;

    // Now (or the test panel's clock) at the weather city; Zagreb until the first weather arrives
    function env() {
        return { date: TEST.clock || new Date(), lat: ENV.lat == null ? ZAGREB.lat : ENV.lat, lon: ENV.lon == null ? ZAGREB.lon : ENV.lon };
    }

    // Where the cutout sits on the canvas: bottom-anchored, cathedral centred
    function layout(W, H) {
        const iw = sceneryImg.naturalWidth || 1200, ih = sceneryImg.naturalHeight || 896;
        const aspect = iw / ih;
        if (W / H > aspect) return { drawX: 0, drawY: H - W / aspect, drawW: W, drawH: W / aspect, W, H };
        return { drawX: (W - H * aspect) * 0.5, drawY: 0, drawW: H * aspect, drawH: H, W, H };
    }
    // The cutout fitted into the scene rectangle, in world coordinates; ox/oy: the rectangle's corner
    function sceneGeom() {
        const g = layout(WORLD.RW, WORLD.RH);
        g.drawX += WORLD.RX;
        g.drawY += WORLD.RY;
        g.ox = WORLD.RX;
        g.oy = WORLD.RY;
        return g;
    }

    // Clear-sky look at each sun altitude (degrees); values in between are blended.
    // top/mid/hor: sky colours. glow: colour and strength of the light around the sun's place on
    // the horizon. tint: multiplied over the scenery. lum: overall brightness. stars, lights: 0..1.
    const KEYS = [
        { alt: -18, top: '#070b16', mid: '#0b1222', hor: '#121b30', glow: '#3a3048', glowK: 0, tint: '#121c34', tintA: 0.72, lum: 0.06, stars: 1, lights: 1 },
        { alt: -12, top: '#0a1122', mid: '#101c36', hor: '#1c2c4c', glow: '#4a3c58', glowK: 0.08, tint: '#16223e', tintA: 0.68, lum: 0.10, stars: 0.9, lights: 1 },
        { alt: -6, top: '#14254d', mid: '#27437a', hor: '#5c6f9c', glow: '#c9856b', glowK: 0.30, tint: '#3c5087', tintA: 0.56, lum: 0.25, stars: 0.2, lights: 1 },
        { alt: -4, top: '#1f3a6e', mid: '#4a6aa5', hor: '#c98f7c', glow: '#ff9a5c', glowK: 0.55, tint: '#5a699b', tintA: 0.44, lum: 0.36, stars: 0.1, lights: 0.9 },
        { alt: -1, top: '#33598f', mid: '#86a0c8', hor: '#f7b07a', glow: '#ff9e4a', glowK: 0.85, tint: '#aa96a0', tintA: 0.32, lum: 0.55, stars: 0, lights: 0.55 },
        { alt: 2, top: '#3f6fae', mid: '#a9c0dc', hor: '#fbc98a', glow: '#ffb65c', glowK: 0.85, tint: '#ffd6aa', tintA: 0.26, lum: 0.72, stars: 0, lights: 0.15 },
        { alt: 6, top: '#4478b8', mid: '#b5cfe8', hor: '#f6ddb4', glow: '#ffd596', glowK: 0.5, tint: '#ffe8c8', tintA: 0.14, lum: 0.86, stars: 0, lights: 0 },
        { alt: 12, top: '#4b7cb6', mid: '#9fc0e4', hor: '#cfdff2', glow: '#fff0cf', glowK: 0.2, tint: '#ffffff', tintA: 0, lum: 1, stars: 0, lights: 0 },
        { alt: 90, top: '#4b7cb6', mid: '#9fc0e4', hor: '#cfdff2', glow: '#fff0cf', glowK: 0.2, tint: '#ffffff', tintA: 0, lum: 1, stars: 0, lights: 0 }
    ];
    const SUN_COLOR = [[-2, '#ff6a36'], [1, '#ff8f45'], [5, '#ffc070'], [12, '#ffe6b0'], [25, '#fff8e2']];
    // What a grey sky looks like in full daylight: [top, middle, horizon]
    const GREY = {
        overcast: ['#6e7f96', '#8c9bb0', '#abb8c8'],
        rain: ['#65768d', '#8494a9', '#a3b2c4'],
        fog: ['#9aa5b3', '#b3bcc8', '#c5ccd6'],
        snow: ['#a4adb9', '#bcc4ce', '#d3d9e0'],
        storm: ['#424855', '#5a616f', '#717887']
    };

    function keyAt(alt) {
        const a = clamp(alt, KEYS[0].alt, 90);
        let i = 0;
        while (i < KEYS.length - 2 && KEYS[i + 1].alt <= a) i++;
        const A = KEYS[i], B = KEYS[i + 1], u = clamp((a - A.alt) / (B.alt - A.alt));
        const out = { alt };
        for (const k of ['top', 'mid', 'hor', 'glow', 'tint']) out[k] = mix(A[k], B[k], u);
        for (const k of ['glowK', 'tintA', 'lum', 'stars', 'lights']) out[k] = lerp(A[k], B[k], u);
        return out;
    }
    function colorAt(table, v) {
        if (v <= table[0][0]) return table[0][1];
        for (let i = 0; i < table.length - 1; i++) {
            if (v <= table[i + 1][0]) return mix(table[i][1], table[i + 1][1], (v - table[i][0]) / (table[i + 1][0] - table[i][0]));
        }
        return table[table.length - 1][1];
    }

    // The light for this frame. Recomputed when the sun has moved a tenth of a degree, the minute
    // or the weather changes, or the canvas is resized.
    let LIGHT = null;
    function computeLight(f) {
        const { W, H, wx } = f;
        const e = env();
        const alt = SUN.sunPosition(e.date, e.lat, e.lon).altitude;
        const sm = seasonMix(e);
        const artA = seasonArt(sm.from), artB = sm.t > 0 ? seasonArt(sm.to) : artA;
        const season = sm.t > 0 ? `${sm.from}>${sm.to}@${sm.t.toFixed(3)}|${artB === sceneryImg}` : sm.from;
        // Wallpaper: after about two days without rain the terrace dries (the user's dry-floor
        // paintings, bg/zagreb-<season>-dry.webp): it fades from the wet to the dry painting
        const dry = dryLevel();
        const dryA = dry > 0 ? dryArt(sm.from) : null, dryB = dry > 0 && sm.t > 0 ? dryArt(sm.to) : dryA;
        const wetArt = sm.t > 0 ? blendedArt(artA, artB, sm.t) : artA;
        // only once the dry paintings and the real season paintings (not the spring stand-in) are in
        const dryOk = !!(dryA && dryB) && (artA !== sceneryImg || sm.from === 'spring');
        const plain = dry > 0 && dryOk
            ? mixArt('dry', wetArt, sm.t > 0 ? mixArt('dryseason', dryA, dryB, sm.t) : dryA, dry)
            : wetArt;
        const art = wx.lying > 0.02 ? snowyArt(plain, wx.lying, season) : plain;
        const key = [Math.round(alt * 10), wx.key, W, H, Math.floor(e.date.getTime() / 60000), season, artA === sceneryImg, ENV.tempC, WORLD.key, dryOk ? dry : 0, moonAlbedo ? 1 : 0].join('|');
        if (LIGHT && LIGHT.key === key) return LIGHT;
        const RH = WORLD.RH;

        const L = keyAt(alt);
        L.key = key;
        L.season = season;
        L.art = art;
        const g = L.geom = sceneGeom();
        L.horizonY = g.drawY + HORIZON * g.drawH;

        // Where the day or night is: 0 at sunrise (sunset), 1 at sunset (next sunrise)
        const now = e.date.getTime(), DAY = 86400000;
        const today = SUN.sunTimes(e.date, e.lat, e.lon);
        let dayP = 0.5, nightP = 0.5;
        if (today.sunrise && today.sunset) {
            const rise = today.sunrise.getTime(), set = today.sunset.getTime();
            dayP = (now - rise) / (set - rise);
            if (now >= set) {
                const next = SUN.sunTimes(new Date(now + DAY), e.lat, e.lon).sunrise;
                nightP = next ? (now - set) / (next.getTime() - set) : 0.5;
            } else if (now < rise) {
                const prev = SUN.sunTimes(new Date(now - DAY), e.lat, e.lon).sunset;
                nightP = prev ? (now - prev.getTime()) / (rise - prev.getTime()) : 0.5;
            }
        }
        L.times = today;
        L.snowCover = wx.snowCover || 0;
        // Half-frozen terrace: with lying snow or ice, or when the air is at or below freezing.
        // 0 = wet, 1 = mostly ice.
        const cold = typeof ENV.tempC === 'number' ? clamp((1 - ENV.tempC) / 5) : 0;
        L.lying = wx.lying || 0;
        L.dry = dryOk ? dry : 0;
        // Ice sheets only for frost and freezing rain: with snow on the ground or falling, none
        const snowy = L.lying > 0.02 || wx.snow > 0;
        L.frost = snowy ? 0 : clamp(Math.max(L.snowCover * 0.9, cold));
        // Fog, falling snow and rain hide the distance: how much the far town fades into the air
        L.haze = Math.max(wx.fog * 0.85, wx.snow * 0.5, wx.rain * 0.28);

        // The sun is always in view: it rises on the left, crosses the sky and sets on the right.
        // Its height on screen follows the real altitude, so winter days stay low.
        L.sunX = W * (0.29 + 0.56 * clamp(dayP, -0.08, 1.08)); // between the trees on either side
        // (in a span the arc runs from the scene's top, not the top of the tallest display)
        const skyH = L.horizonY - WORLD.RY;
        L.sunY = alt >= 0 ? L.horizonY - Math.pow(clamp(alt / 65), 0.8) * skyH * 0.86 : L.horizonY - alt * RH * 0.012;
        // Wallpaper: the moon is where it really is. It crosses the same arc as the sun, from its
        // rise to its set, at its real height, so some nights it is low, late or not up at all.
        const mPos = moonPosition(e.date, e.lat, e.lon), mAlt = mPos.altitude;
        // Tonight's tilt: the lit side faces the sun, the moon's north points to the pole
        const sPos = SUN.sunPosition(e.date, e.lat, e.lon);
        L.moonLight = skyAngle(mAlt, mPos.azimuth, sPos.altitude, sPos.azimuth);
        L.moonNorth = skyAngle(mAlt, mPos.azimuth, e.lat, 0);
        L.moonAlt = mAlt;
        const pass = moonPass(e.date, e.lat, e.lon);
        const mp = pass.rise && pass.set ? (now - pass.rise.getTime()) / (pass.set.getTime() - pass.rise.getTime()) : 0.5;
        L.moonX = W * (0.24 + 0.62 * clamp(mp));
        // (a high winter full moon would leave the screen: the whole disc and its halo stay in view)
        const moonTop = WORLD.RY + Math.min(WORLD.RW, RH) * MOON_R * 5;
        L.moonY = Math.max(moonTop, L.horizonY - Math.pow(clamp(mAlt / 65), 0.8) * skyH * 0.86 - RH * 0.03);
        L.moonUp = clamp(mAlt / 3); // fades in as it clears the horizon
        L.lowSun = clamp(1 - Math.abs(alt - 1) / 9); // 1 around sunrise and sunset, 0 by mid-morning

        // Weather: how much of the clear-sky colour survives, and what grey replaces the rest
        const cover = clamp((wx.cloud - 0.3) / 0.6);
        let cs = (1 - cover) * (1 - wx.fog * 0.8);
        if (wx.thunder) cs *= 0.3;
        L.cs = cs = Math.max(cs, 0.06);
        const grey = wx.thunder ? GREY.storm : wx.fog > 0.4 ? GREY.fog : wx.snow > 0 ? GREY.snow : wx.rain > 0.1 ? GREY.rain : GREY.overcast;
        const dim = c => mix('#070a11', c, Math.pow(L.lum, 0.9)); // a grey sky is as dark as the hour
        L.top = mix(dim(grey[0]), L.top, cs);
        L.mid = mix(dim(grey[1]), L.mid, cs);
        L.hor = mix(dim(grey[2]), L.hor, cs);
        L.glowA = L.glowK * (0.12 + 0.88 * cs) * (alt > -14 ? 1 : 0);
        L.pinkA = cs * clamp(1 - Math.abs(alt + 1) / 5) * 0.2; // pink band opposite the low sun

        // Scenery: the hour's tint loses its colour under cloud, then the weather adds its wash
        L.tint = mix(L.tint, mix(L.tint, '#8a8f98', 0.7), 1 - cs);
        const day = clamp(L.lum * 1.3);
        L.wash = wx.thunder ? '#505866' : wx.rain > 0.05 ? '#b9c6d7' : '#cdd6e2';
        L.washA = (wx.thunder ? 0.42 : wx.rain > 0.05 ? 0.28 : wx.cloud > 0.65 ? 0.22 : 0) * day;
        L.warmA = L.glowK * cs * 0.3 * (alt > -6 ? 1 : 0);

        const clearView = (1 - clamp((wx.cloud - 0.4) / 0.5)) * (1 - wx.fog * 0.6);
        L.sunVis = clearView * clamp((alt + 1.5) / 1.5);
        L.sunCol = colorAt(SUN_COLOR, alt);
        L.moon = currentMoon(e.date);
        // Only a full moon is drawn (the user's choice, 2026-11-18): the nights around full
        // moon, the whole disc lit; other nights there is no moon
        L.moonFull = L.moon.lit >= MOON_FULL;
        L.moonVis = L.moonFull ? clearView * clamp((-alt - 2) / 4) * L.moonUp : 0;
        L.moonA = L.moonVis * L.moon.lit;
        L.starVis = L.stars * (1 - clamp(wx.cloud / 0.7)) * (1 - wx.fog * 0.7);
        // Lamps and windows also come on under a dark daytime storm or thick fog
        L.lights = Math.max(L.lights, wx.thunder && L.lum > 0.5 ? 0.3 : 0, wx.fog > 0.5 && L.lum > 0.5 ? 0.2 : 0);

        // Clouds: bright tops, shaded bases, both as dark as the hour and warmed by a low sun
        const bright = Math.pow(L.lum, 0.7);
        L.cloudLit = mix('#1c2436', mix(mix('#ffffff', L.glow, L.lowSun * cs * 0.3), '#b4bdc9', cover * 0.5), bright);
        L.cloudShade = mix('#0f1420', mix('#9fb0c6', '#7a6a8c', L.lowSun * cs), bright);
        L.sheet = mix(L.mid, '#05070b', 0.42);
        L.fog = mix('#141a26', mix('#cad3de', L.glow, L.lowSun * cs * 0.2), Math.pow(L.lum, 0.8));

        LIGHT = L;
        return L;
    }

    function drawSun(f, L) {
        if (L.sunVis <= 0.02) return;
        const { ctx } = f;
        const r = Math.min(f.RW, f.RH) * 0.032 * (1 + 0.35 * L.lowSun);
        const halo = r * (6 + 8 * L.lowSun);
        const g = ctx.createRadialGradient(L.sunX, L.sunY, 0, L.sunX, L.sunY, halo);
        g.addColorStop(0, rgba(L.sunCol, 0.8 * L.sunVis));
        g.addColorStop(0.2, rgba(L.sunCol, 0.34 * L.sunVis));
        g.addColorStop(0.5, rgba(L.sunCol, 0.1 * L.sunVis));
        g.addColorStop(1, rgba(L.sunCol, 0));
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = g;
        ctx.fillRect(L.sunX - halo, L.sunY - halo, halo * 2, halo * 2);
        ctx.restore();

        const core = mix(L.sunCol, '#ffffff', 0.8 - 0.35 * L.lowSun);
        const d = ctx.createRadialGradient(L.sunX, L.sunY, 0, L.sunX, L.sunY, r);
        d.addColorStop(0, rgba(core, L.sunVis));
        d.addColorStop(0.82, rgba(core, L.sunVis));
        d.addColorStop(1, rgba(L.sunCol, 0));
        ctx.fillStyle = d;
        ctx.beginPath();
        ctx.arc(L.sunX, L.sunY, r, 0, 6.2832);
        ctx.fill();
    }

    // ------------------------------------------------------------------
    // Seasons: the same painting with its foliage recoloured (studio/weather/tools/make-seasons.py).
    // Spring is the original. Whole months of the weather city's own calendar, the other way
    // round south of the equator. Buildings are identical in every version, so the night lights
    // are shared. Only the season in use is downloaded.
    // ------------------------------------------------------------------
    const SEASONS = ['winter', 'spring', 'summer', 'autumn'];
    const SEASON_ART = { spring: sceneryImg };
    // Wallpaper: seasons do not flip on the 1st of a month. Each one arrives on a date typical for
    // Zagreb and the two paintings cross-fade over three weeks around it, a step a day (the user's
    // choice, 2026-11-17). South of the equator the calendar is shifted by half a year.
    // TEST.season: 'autumn', or 'autumn,winter,0.5' for a fixed blend.
    const SEASON_STARTS = [['spring', 2, 20], ['summer', 5, 1], ['autumn', 9, 8], ['winter', 10, 25]]; // month (0-based), day
    const SEASON_FADE_DAYS = 21;
    function seasonMix(e) {
        if (TEST.season) {
            const p = String(TEST.season).split(',');
            if (p.length === 3 && SEASONS.includes(p[0]) && SEASONS.includes(p[1])) return { from: p[0], to: p[1], t: clamp(Number(p[2]) || 0) };
            if (SEASONS.includes(p[0])) return { from: p[0], to: p[0], t: 0 };
        }
        // The date where the weather is, not where the device is
        const offMs = typeof ENV.utcOffsetSeconds === 'number' ? ENV.utcOffsetSeconds * 1000 : -e.date.getTimezoneOffset() * 60000;
        const local = new Date(e.date.getTime() + offMs);
        let day = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()) / 86400000;
        if (e.lat < 0) day += 182;
        const year = new Date(day * 86400000).getUTCFullYear();
        const lead = Math.floor(SEASON_FADE_DAYS / 2); // the fade starts this many days before the date
        let cur = null;
        for (const y of [year - 1, year]) {
            SEASON_STARTS.forEach(([name, m, d], i) => {
                const c = Date.UTC(y, m, d) / 86400000;
                if (day >= c - lead && (!cur || c > cur.c)) cur = { name, c, i };
            });
        }
        const t = clamp((day - (cur.c - lead)) / SEASON_FADE_DAYS);
        if (t >= 1) return { from: cur.name, to: cur.name, t: 0 };
        return { from: SEASON_STARTS[(cur.i + 3) % 4][0], to: cur.name, t };
    }
    // Two paintings blended exactly, colour and cut-out outline alike (bare branches fade in)
    const blendCache = { key: '', canvas: null };
    function blendedArt(a, b, t) {
        // A painting still loading has no size yet: use the other one meanwhile (a 0x0 blend would
        // make every later drawImage throw, and the key would keep it after the load)
        if (!a.naturalWidth || !b.naturalWidth) return a.naturalWidth ? a : b;
        const key = [a.src, b.src, t.toFixed(3)].join('|');
        if (blendCache.key === key) return blendCache.canvas;
        const c = blendCache.canvas || (blendCache.canvas = document.createElement('canvas'));
        c.width = a.naturalWidth; // also clears a reused canvas
        c.height = a.naturalHeight;
        const g = c.getContext('2d');
        g.globalAlpha = 1 - t;
        g.drawImage(a, 0, 0);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = t;
        g.drawImage(b, 0, 0, c.width, c.height);
        blendCache.key = key;
        return c;
    }
    // Wallpaper: lying snow painted into the artwork (painting pixels, so it is the same on every
    // display and lit by lightLayer like the rest). Subtle and natural, no white caps (the user's
    // wish): the terrace floor goes from a patchy dusting with wet ground showing through to an
    // even layer; the kerb and the top rail collect a little; roofs pale; tree crowns get sparse
    // flecks. Rows are the painting's own (896 high): floor from 668, kerb top 649-662, top rail
    // 598-601, town roofs 548-640 between the trees.
    const snowCache = { key: '', canvas: null };
    let snowNoise = null;
    function snowField(W, H) {
        if (snowNoise && snowNoise.W === W && snowNoise.H === H) return snowNoise;
        const rnd = rng(31337);
        const N = 128, lat = new Float32Array(N * N);
        for (let i = 0; i < lat.length; i++) lat[i] = rnd();
        const noise = (x, y) => {
            const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
            const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
            const x0 = xi & 127, x1 = (xi + 1) & 127, y0 = (yi & 127) * N, y1 = ((yi + 1) & 127) * N;
            const a = lat[y0 + x0], b = lat[y0 + x1], c = lat[y1 + x0], d = lat[y1 + x1];
            return a + (b - a) * u + (c - a + (a - b + d - c) * u) * w;
        };
        const field = new Float32Array(W * H), fine = new Float32Array(W * H);
        const floor = 668 / 896 * H, sx = W / 1200;
        for (let y = 0; y < H; y++) {
            // On the floor, patches grow toward the viewer (perspective): wide and flat far away
            const depth = y >= floor ? (y - floor) / (H - floor) : 0;
            const kx = 1 / ((26 + 60 * depth) * sx), ky = 1 / ((5 + 22 * depth) * sx);
            for (let x = 0; x < W; x++) {
                let v = 0, amp = 0.5, norm = 0, px = x * kx, py = y * ky;
                for (let o = 0; o < 4; o++) {
                    v += noise(px, py) * amp;
                    norm += amp;
                    px = px * 2.1 + 13.7;
                    py = py * 2.1 + 5.3;
                    amp *= 0.5;
                }
                field[y * W + x] = v / norm;
                // Grain: snow is many small specks, a few pixels wide, larger toward the viewer
                const gx = x / ((1.6 + 5 * depth) * sx), gy = y / ((0.9 + 3.2 * depth) * sx);
                fine[y * W + x] = 0.6 * noise(gx + 57.1, gy + 11.3) + 0.4 * noise(gx * 2.3 + 3.7, gy * 2.3 + 91.9);
            }
        }
        return (snowNoise = { W, H, field, fine });
    }
    function snowyArt(src, amount, seasonKey) {
        const key = [seasonKey, src.src || 'blend', amount, src.naturalWidth || src.width].join('|');
        if (snowCache.key === key) return snowCache.canvas;
        const W = src.naturalWidth || src.width, H = src.naturalHeight || src.height;
        if (!W || !H) return src; // the painting is still loading
        const c = snowCache.canvas || (snowCache.canvas = document.createElement('canvas'));
        c.width = W;
        c.height = H;
        // read back on every change of snow: kept in main memory (see bgCanvas)
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(src, 0, 0, W, H);
        const img = g.getImageData(0, 0, W, H), px = img.data;
        const { field, fine } = snowField(W, H);
        const k = H / 896, sx = W / 1200;
        const floorY = 668 * k, kerb0 = 649 * k, kerb1 = 662 * k, rail0 = 598 * k, rail1 = 602 * k;
        const town0 = 548 * k, town1 = 640 * k, townL = 300 * sx, townR = 1060 * sx;
        const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
        const SNOW = [234, 239, 246];
        const a = amount;
        for (let y = 0; y < H; y++) {
            for (let x = 0; x < W; x++) {
                const i = (y * W + x) * 4;
                if (px[i + 3] < 8) continue; // sky
                const n = field[y * W + x], f = fine[y * W + x];
                const r = px[i], gg = px[i + 1], b = px[i + 2];
                const lum = 0.3 * r + 0.59 * gg + 0.11 * b;
                let cover = 0, tone = 1;
                if (y >= floorY) {
                    // A fine grain of specks that grows denser with depth; thinner and thicker areas
                    // drift softly across the floor, so there are no shapes and no hard edges
                    const m = 0.55 * f + 0.45 * n;
                    const thr = 0.78 - 0.62 * a;
                    cover = smooth(thr - 0.16, thr + 0.16, m);
                    cover = cover * (0.55 + 0.45 * smooth(0.15, 0.8, a)) + a * a * 0.35;
                    // Deep snow is not flat: soft ridges and a faint grain stay visible
                    tone = 0.84 + 0.1 * n + 0.06 * f;
                } else if (y >= kerb0 && y < kerb1) {
                    cover = clamp(a * 1.5) * (0.6 + 0.3 * n);
                    tone = 0.95;
                } else if (y >= rail0 && y < rail1 && b > r && lum < 90) {
                    cover = clamp(a * 1.4) * 0.5;
                    tone = 0.92;
                } else if (y >= town0 && y < town1 && x > townL && x < townR) {
                    // Roofs: reddish tiles pale, the lit ones most
                    // (the painted tiles are muted: about 20-35 levels redder than green/blue)
                    const red = clamp((r - Math.max(gg, b) - 6) / 22);
                    cover = a * 0.85 * red * (0.6 + 0.4 * smooth(60, 170, lum)) * (0.65 + 0.35 * f);
                    tone = 0.9;
                } else if (y < floorY) {
                    // Tree crowns and other foliage: sparse pale flecks on the lit side
                    const fleck = smooth(0.5, 0.75, 0.6 * f + 0.4 * n) * smooth(60, 180, lum);
                    cover = a * 0.45 * fleck;
                    tone = 0.92;
                }
                if (cover <= 0.004) continue;
                const s = clamp(cover) * (0.9 + 0.1 * a); // deep snow hides the painted reflections
                px[i] = r + (SNOW[0] * tone - r) * s;
                px[i + 1] = gg + (SNOW[1] * tone - gg) * s;
                px[i + 2] = b + (SNOW[2] * tone - b) * s;
            }
        }
        g.putImageData(img, 0, 0);
        snowCache.key = key;
        return c;
    }
    // Dry-floor paintings (wallpaper only), loaded the first time the terrace is dry
    const DRY_ART = {};
    function dryArt(season) {
        let img = DRY_ART[season];
        if (!img) {
            img = DRY_ART[season] = new Image();
            img.onload = () => kick();
            img.src = `${ART_BASE}zagreb-${season}-dry.webp?v=${ART_VERSION}`;
        }
        return img.complete && img.naturalWidth > 0 ? img : null;
    }
    // How dry the terrace looks, 0 wet .. 1 dry, in steps of a tenth. Wet while it rains, snows or
    // after rain; ENV.dryness (0..1 over about two days without rain) from the weather service.
    function dryLevel() {
        if (!wallpaper() || typeof ENV.dryness !== 'number') return 0;
        const wx = S.wx;
        if (wx.rain > 0 || wx.snow > 0 || wx.hail > 0) return 0;
        // the floor starts to look dry from about half-way, fully dry at the end
        return Math.round(clamp((ENV.dryness - 0.35) / 0.65) * 10) / 10;
    }
    // Any two paintings blended, cached by name (kept apart from the season blend's cache)
    const mixCache = {};
    function mixArt(name, a, b, t) {
        // As in blendedArt: a painting still loading has no size, and a 0x0 result would be kept
        const size = x => x.naturalWidth || x.width || 0;
        if (!size(a) || !size(b)) return size(a) ? a : b;
        const key = [a.src || a.width, b.src || b.width, t.toFixed(3), name === 'dry' ? blendCache.key : ''].join('|');
        const hit = mixCache[name];
        if (hit && hit.key === key) return hit.canvas;
        const c = (hit && hit.canvas) || document.createElement('canvas');
        c.width = a.naturalWidth || a.width;
        c.height = a.naturalHeight || a.height;
        const g = c.getContext('2d');
        g.globalAlpha = 1 - t;
        g.drawImage(a, 0, 0, c.width, c.height);
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = t;
        g.drawImage(b, 0, 0, c.width, c.height);
        mixCache[name] = { key, canvas: c };
        return c;
    }

    // The season's artwork, or the spring original while it is still loading (or if it fails)
    function seasonArt(season) {
        let img = SEASON_ART[season];
        if (!img) {
            img = SEASON_ART[season] = new Image();
            img.onload = () => kick();
            img.src = artUrl(season);
        }
        return img.complete && img.naturalWidth > 0 ? img : sceneryImg;
    }

    let rainbowActiveUntil = 0; // wall-clock time (Date.now()) when the current rainbow ends
    let lastHadRain = false;

    // Seeded starfield for night sky. 90 on one screen; a span uses more of the same sequence so
    // the density stays the same over the wider world.
    const STARS = [];
    const STAR_COUNT = 90, STAR_MAX = 400;
    (function initStars() {
        let s = 98765;
        const rng = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
        for (let i = 0; i < STAR_MAX; i++) {
            STARS.push({
                x: rng(),
                y: rng() * 0.45,
                r: 0.6 + rng() * 1.3,
                twinkle: rng() * 6.28,
                speed: 1.5 + rng() * 2.5
            });
        }
    })();

    // Rain ripples on the wet terrace. They live only on the floor itself: the floor starts at
    // 74.6% of the artwork's height (below the kerb), so ripples are placed from 77% down.
    // Sizes are fractions of the painting's width, so a ring is as large on a 4K display as on a
    // small one. Light rain uses the first few drops of the pool, heavy rain all of them.
    const RIPPLE_TOP = 0.77, RIPPLE_SPAN = 0.21;
    const RIPPLES = [];
    for (let i = 0; i < 40; i++) {
        RIPPLES.push({
            x: 0.03 + Math.random() * 0.94,
            y: RIPPLE_TOP + Math.random() * RIPPLE_SPAN,
            maxR: 0.012 + Math.random() * 0.016,
            life: Math.random(),
            speed: 0.45 + Math.random() * 0.5
        });
    }

    // Rainbow: one thin band of smoothly blended colour that adds light to the sky, with the sky a
    // touch brighter inside the bow, darker between the bows, and a faint reversed outer bow.
    // It spans the whole view as one centred arch, whatever side the sun is on.
    // [radius as a fraction of the bow's radius, red, green, blue, strength, fades with a low sun]
    const BOW = [
        [0.780, 255, 255, 255, 0.00, 0],
        [0.900, 255, 255, 255, 0.10, 0], // brighter sky inside the bow
        [0.915, 150, 90, 255, 0.50, 1],  // violet
        [0.932, 70, 130, 255, 0.66, 1],  // blue
        [0.949, 60, 215, 120, 0.72, 1],  // green
        [0.966, 255, 236, 80, 0.80, 0.5], // yellow
        [0.983, 255, 150, 50, 0.84, 0],  // orange
        [1.000, 255, 60, 50, 0.80, 0],   // red
        [1.010, 255, 60, 50, 0.00, 0],
        [1.170, 0, 0, 20, 0.00, 0],      // darker band between the bows
        [1.185, 255, 70, 55, 0.24, 0],   // outer bow, colours reversed
        [1.203, 255, 236, 90, 0.27, 0.5],
        [1.221, 70, 220, 130, 0.24, 1],
        [1.239, 90, 110, 255, 0.19, 1],
        [1.255, 150, 90, 255, 0.00, 1]
    ];
    function drawRainbow(f, L, alpha) {
        if (alpha <= 0.01) return;
        const { ctx, W, H, RW, RH } = f;
        const alt = clamp(L.alt, 2, 40);
        // One full arc across the view, centred over the cathedral (the user's choice, 2026-11-11)
        const R = Math.min(RW * 0.44, RH * 0.56);
        const cx = f.RX + RW * 0.49, cy = f.RY + RH * 0.68;
        const cool = 0.25 + 0.75 * clamp(alt / 10); // near the horizon the sun is red, so is the bow

        const r0 = R * BOW[0][0], r1 = R * BOW[BOW.length - 1][0];
        const g = ctx.createRadialGradient(cx, cy, r0, cx, cy, r1);
        for (const [rr, cr, cg, cb, a, fade] of BOW) {
            const k = a * (1 - fade * (1 - cool));
            g.addColorStop((rr * R - r0) / (r1 - r0), `rgba(${cr},${cg},${cb},${k.toFixed(3)})`);
        }
        ctx.save();
        ctx.fillStyle = g;
        // Strength chosen by the user with the studio dial on 2026-11-12 (35% of the first tuning).
        // Painted once for colour (a pale sky would wash a purely additive bow out), then once
        // more as added light so it still glows instead of sitting on the sky like paint
        ctx.globalAlpha = Math.min(1, alpha * 0.147);
        ctx.fillRect(0, 0, W, H);
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = Math.min(1, alpha * 0.193);
        ctx.fillRect(0, 0, W, H);
        ctx.restore();
    }

    // Tonight's moon phase
    const currentMoon = date => SUN.moonPhase(date || new Date());

    // The near side, north up: NASA's LRO map (CGI Moon Kit, public domain) seen from the Earth,
    // web/bg/moon-nearside.webp. Loaded on first use; until then no moon is drawn.
    const MOON_FULL = 0.9; // lit share from which the moon is drawn full: about 3 days either side of full moon, about 6 nights a month (the user's choice, 2026-11-21)
    const MOON_R = 0.032; // disc radius as a share of the scene's smaller side
    let moonPhoto = null, moonAlbedo = null;
    function moonFace() {
        if (moonAlbedo) return moonAlbedo;
        if (!moonPhoto) {
            moonPhoto = new Image();
            moonPhoto.onload = () => kick();
            moonPhoto.src = `${ART_BASE}moon-nearside.webp?v=${ART_VERSION}`;
        }
        if (!(moonPhoto.complete && moonPhoto.naturalWidth > 0)) return null;
        const n = moonPhoto.naturalWidth;
        const c = document.createElement('canvas');
        c.width = c.height = n;
        const g = c.getContext('2d');
        g.drawImage(moonPhoto, 0, 0);
        const d = g.getImageData(0, 0, n, n).data, map = new Float32Array(n * n);
        for (let i = 0; i < map.length; i++) map[i] = d[i * 4] / 180; // bright highlands about 1
        return (moonAlbedo = { n, map });
    }

    // The moon disc, drawn pixel by pixel as a lit sphere (the unlit part is left transparent, so
    // the sky shows through; a crescent also shows the faint earthshine). `light` is the screen
    // angle toward the sun, `north` toward the celestial pole, `alt` the moon's altitude (low, it
    // turns yellow). Kept until the size, phase or angles change noticeably.
    let moonCache = { key: '', canvas: null };
    // Drawn at twice the size and scaled down, so the limb and the terminator are smooth
    const MOON_SS = 2;
    function moonDisc(r0, m, light = 0, north = -Math.PI / 2, alt = 45) {
        const r = r0 * MOON_SS;
        const q = a => Math.round(a / 0.03);
        const key = [Math.round(r * 2), Math.round(m.phase * 300), q(light), q(north), Math.round(clamp(alt, 0, 20))].join('|');
        if (moonCache.key === key) return moonCache.canvas;
        const face = moonFace();
        if (!face) return null;

        const size = Math.ceil(r * 2 + 4);
        const c = moonCache.canvas || document.createElement('canvas');
        c.width = c.height = size;
        const g = c.getContext('2d');
        const img = g.createImageData(size, size), px = img.data;
        const fn = face.n, fm = face.map;
        // bilinear look-up in the face, coordinates -1..1
        const albedo = (fx, fy) => {
            const u = clamp((fx + 1) / 2 * fn - 0.5, 0, fn - 1.001), v = clamp((fy + 1) / 2 * fn - 0.5, 0, fn - 1.001);
            const i = u | 0, j = v | 0, a = u - i, b = v - j, k = j * fn + i;
            return (fm[k] * (1 - a) + fm[k + 1] * a) * (1 - b) + (fm[k + fn] * (1 - a) + fm[k + fn + 1] * a) * b;
        };
        // Where the sun is, seen from the moon: E = 0 new, PI full; its direction on the disc
        const E = m.phase * 2 * Math.PI, se = Math.abs(Math.sin(E));
        const sx = se * Math.cos(light), sy = se * Math.sin(light), sz = -Math.cos(E);
        // The face turned so its north points to the pole
        const nx = Math.cos(north), ny = Math.sin(north); // north on screen
        // Low in the sky the light comes through more air: warmer and dimmer
        const low = Math.pow(clamp(1 - alt / 18), 1.6);
        const warm = [1, 1 - 0.12 * low, 1 - 0.3 * low], dimLow = 1 - 0.2 * low;
        const earth = 0.07 * clamp(1 - m.lit / 0.4); // earthshine on a crescent
        const cx = size / 2, cy = size / 2;
        for (let j = 0; j < size; j++) {
            for (let i = 0; i < size; i++) {
                const x = (i + 0.5 - cx) / r, y = (j + 0.5 - cy) / r;
                const rr = x * x + y * y;
                const edge = smoothstep(0, 3.2, (1 - Math.sqrt(rr)) * r + 0.8); // soft limb, about 1.5 px on screen
                if (edge <= 0) continue;
                const z = Math.sqrt(Math.max(0, 1 - rr));
                // face coordinates: right = north turned a quarter clockwise, down = away from north
                const fx = x * -ny + y * nx, fy = -(x * nx + y * ny);
                const alb = albedo(fx * 0.985, fy * 0.985) || 0.8;
                // Lommel-Seeliger: the full moon is evenly bright to the limb; the light falls
                // off toward the terminator, which the crater-rough ground makes a little ragged
                let mu0 = x * sx + y * sy + z * sz;
                
                const lit = mu0 > 0 ? Math.min(1.1, (2 * mu0) / (mu0 + z + 0.02)) * smoothstep(0, 0.14, mu0) : 0;
                const b = alb * lit * dimLow;
                const a = clamp(lit * 5);
                const k = (j * size + i) * 4;
                // a soft warm grey, not paper white: the sky around it is the brightest it gets
                const R = 196 * warm[0], G = 194 * warm[1], B = 186 * warm[2];
                // the dark side: only the earthshine, over the sky
                const ea = earth * (0.6 + 0.4 * alb) * (1 - a);
                const A = a + ea;
                if (A <= 0.003) continue;
                px[k] = Math.min(255, (R * b * a + 90 * alb * ea) / A);
                px[k + 1] = Math.min(255, (G * b * a + 102 * alb * ea) / A);
                px[k + 2] = Math.min(255, (B * b * a + 122 * alb * ea) / A);
                px[k + 3] = Math.round(255 * A * edge);
            }
        }
        g.putImageData(img, 0, 0);
        moonCache = { key, canvas: c };
        return c;
    }

    // ------------------------------------------------------------------
    // Night lights
    // ------------------------------------------------------------------
    // Positions come from zagreb-lights.js
    const TINT = { amber: [255, 200, 90], yellow: [255, 222, 120], white: [255, 240, 210] };
    const hash01 = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

    // The wet terrace mirrors the scene, and the artwork already paints that reflection. Measured
    // on the 1200x896 cutout: the distant town mirrors about y = 628.5 (spire tip 391 -> 866), the
    // railing and anything standing on the terrace edge about y = 660. The floor starts at y = 668,
    // so reflections of low buildings fall behind the kerb and are not drawn.
    const MIRROR_FAR = 628.5 / 896, MIRROR_NEAR = 660 / 896, FLOOR_TOP = 668 / 896;

    // Floodlit areas: a soft upward wash that only lands on the scenery, never on the sky.
    // Static, so it is drawn once per layout onto its own canvas.
    let floodCache = { key: '', canvas: null };
    function floodLayer(list, geom) {
        const floods = list.filter(L => L.t === 'flood');
        if (!floods.length) return null;
        const key = JSON.stringify([floods, geom]);
        if (floodCache.key === key) return floodCache.canvas;
        const c = floodCache.canvas || document.createElement('canvas');
        c.width = geom.W;
        c.height = geom.H;
        const g = c.getContext('2d');
        g.setTransform(1, 0, 0, 1, -geom.ox, -geom.oy); // the canvas covers only the scene rectangle
        const sc = geom.drawW / 1200;
        const tmp = document.createElement('canvas');
        tmp.width = tmp.height = 64;
        for (const L of floods) {
            const x = geom.drawX + L.x * geom.drawW, y = geom.drawY + L.y * geom.drawH;
            const rx = Math.max(2, L.w * sc / 2), ry = Math.max(2, L.h * sc / 2);
            // Work in a unit circle stretched to the ellipse, so the edge fades out softly
            g.save();
            g.translate(x, y);
            g.scale(rx, ry);
            // Brightest at the foot of the area, fading upward; then faded toward the rim
            const wash = g.createLinearGradient(0, 1, 0, -1);
            wash.addColorStop(0, 'rgba(255, 216, 150, 0.62)');
            wash.addColorStop(0.6, 'rgba(255, 206, 138, 0.34)');
            wash.addColorStop(1, 'rgba(255, 200, 130, 0.1)');
            const rim = g.createRadialGradient(0, 0, 0.35, 0, 0, 1);
            rim.addColorStop(0, 'rgba(0,0,0,1)');
            rim.addColorStop(1, 'rgba(0,0,0,0)');
            const t = tmp.getContext('2d');
            t.clearRect(0, 0, 64, 64);
            t.globalCompositeOperation = 'source-over';
            t.save();
            t.translate(32, 32);
            t.scale(32, 32);
            t.fillStyle = wash;
            t.fillRect(-1, -1, 2, 2);
            t.globalCompositeOperation = 'destination-in';
            t.fillStyle = rim;
            t.fillRect(-1, -1, 2, 2);
            t.restore();
            g.drawImage(tmp, -1, -1, 2, 2);
            g.restore();
        }
        g.globalCompositeOperation = 'destination-in';
        g.drawImage(sceneryImg, geom.drawX, geom.drawY, geom.drawW, geom.drawH);
        g.globalCompositeOperation = 'source-over';
        floodCache = { key, canvas: c };
        return c;
    }

    // Wallpaper: on a sharp canvas (scale above 0.5) the windows would be hard one-pixel
    // rectangles and the floodlit walls would show the cut-out's edges. Both look right at half
    // resolution (the low-quality look, which the user prefers), so all the lights and their
    // reflections are drawn on a half-resolution layer of the scene rectangle and scaled up.
    let lightsBuf = null;
    function drawLightsSoft(f, geom, k) {
        if (k <= 0.01) return;
        const q = 0.5 / S.scale;
        const w = Math.max(1, Math.ceil(geom.W * q)), h = Math.max(1, Math.ceil(geom.H * q));
        const c = lightsBuf || (lightsBuf = document.createElement('canvas'));
        if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
        const g = c.getContext('2d');
        g.clearRect(0, 0, w, h);
        const low = {
            ox: 0, oy: 0, W: w, H: h,
            drawX: (geom.drawX - geom.ox) * q, drawY: (geom.drawY - geom.oy) * q, drawW: geom.drawW * q, drawH: geom.drawH * q
        };
        drawLights({ ...f, ctx: g, W: w, H: h }, low, k, ZAGREB_LIGHTS, 'all');
        // The layer is soft already, so the cheapest smoothing scales it up with no visible
        // difference; 'high' cost about 140 ms per redraw on a 4K display at night (2026-11-17)
        const prevQ = f.ctx.imageSmoothingQuality;
        f.ctx.imageSmoothingQuality = 'low';
        f.ctx.drawImage(c, geom.ox, geom.oy, geom.W, geom.H);
        f.ctx.imageSmoothingQuality = prevQ;
    }

    // k: how strongly the lights are on, 0..1
    // list: the painting's lights, or the extra lamps along the extended railing (span)
    // part: 'all', or only the 'flood' wash, or only the 'points' (see drawLightsSoft)
    // Wallpaper: the town goes to sleep (the user's choices, 2026-11-17). Each house window has its
    // own bedtime between 22:00 and 01:00, about one in ten stays lit all night, and about four in
    // ten come back on between 05:30 and 06:30 while it is still dark; each fades over a minute.
    // The cathedral's floodlights fade out from 23:45 to midnight and return at dusk. Lamps, the
    // clock and the tower openings stay on. In the weather city's own time.
    function localHours() {
        const d = env().date;
        const off = typeof ENV.utcOffsetSeconds === 'number' ? ENV.utcOffsetSeconds * 1000 : -d.getTimezoneOffset() * 60000;
        const t = new Date(d.getTime() + off);
        return t.getUTCHours() + t.getUTCMinutes() / 60 + t.getUTCSeconds() / 3600;
    }
    // Advent in Zagreb: from the first Advent Sunday (the Sunday from 27 November to 3 December)
    // to 6 January, in the weather city's own date. ENV.advent true/false forces it (tests).
    function adventNow() {
        if (!wallpaper()) return false;
        if (ENV.advent === true || ENV.advent === false) return ENV.advent;
        const d = env().date;
        const off = typeof ENV.utcOffsetSeconds === 'number' ? ENV.utcOffsetSeconds * 1000 : -d.getTimezoneOffset() * 60000;
        const t = new Date(d.getTime() + off);
        const y = t.getUTCFullYear(), m = t.getUTCMonth(), day = t.getUTCDate();
        if (m === 0) return day <= 6;
        const dec3 = new Date(Date.UTC(y, 11, 3));
        const first = Date.UTC(y, 11, 3 - dec3.getUTCDay()); // the Sunday on or before 3 December
        return Date.UTC(y, m, day) >= first;
    }
    function windowOn(i, h, advent) {
        if (!wallpaper()) return 1;
        const h24 = h < 12 ? h + 24 : h; // evening hours run on past midnight: 01:00 = 25
        if (hash01(i * 5.1 + 0.3) < 0.1) return 1; // night owls
        const bedtime = 22 + 3 * hash01(i * 3.7 + 1.1) + (advent ? 1 : 0); // Advent evenings run later
        const asleep = clamp((h24 - bedtime) * 60); // one-minute fade
        if (h < 12 && hash01(i * 2.9 + 7.7) < 0.4) {
            const wake = 5.5 + hash01(i * 1.3 + 4.2);
            return Math.max(1 - asleep, clamp((h - wake) * 60));
        }
        return 1 - asleep;
    }
    function floodOn(h) {
        if (!wallpaper()) return 1;
        const h24 = h < 12 ? h + 24 : h;
        return 1 - clamp((h24 - 23.75) / 0.25);
    }

    // Advent string lights: warm-white bulbs with a few coloured ones, hanging in shallow arcs
    // from the top rail between the posts (painting pixels: posts about every 87 px from x 10,
    // top rail at row 600), reflected in the wet floor like the lamps.
    const ADVENT_COLOURS = ['255,70,60', '70,210,110', '90,140,255', '255,200,70'];
    const GARLAND = (() => {
        const bulbs = [];
        for (let p0 = 10; p0 < 1200; p0 += 87) {
            const p1 = Math.min(1199, p0 + 87);
            const n = 9;
            for (let j = 1; j < n; j++) {
                const u = j / n;
                const id = bulbs.length;
                bulbs.push({
                    x: (p0 + (p1 - p0) * u) / 1200,
                    y: (600 + 2 + 7 * Math.sin(Math.PI * u)) / 896, // sags about 7 px in the middle
                    col: hash01(id * 3.17 + 0.5) < 0.22 ? ADVENT_COLOURS[id % ADVENT_COLOURS.length] : '255,214,150',
                    ph: hash01(id * 1.93 + 4.1) * 6.2832
                });
            }
        }
        return bulbs;
    })();
    function drawGarland(f, geom, k) {
        const { ctx, t, wx, W, H } = f;
        const sc = geom.drawW / 1200;
        const r = Math.max(0.8, 1.15 * sc);
        const floorY = geom.drawY + FLOOR_TOP * geom.drawH;
        const wet = wx.rain > 0.15;
        const snowed = LIGHT ? LIGHT.lying : 0;
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        for (const b of GARLAND) {
            const x = geom.drawX + b.x * geom.drawW, y = geom.drawY + b.y * geom.drawH;
            if (x < -10 || x > W + 10) continue;
            const a = clamp(k * (0.75 + 0.25 * Math.sin(t * 1.3 + b.ph)));
            const glow = r * 3.4;
            const g = ctx.createRadialGradient(x, y, 0, x, y, glow);
            g.addColorStop(0, `rgba(${b.col},${(a * 0.9).toFixed(3)})`);
            g.addColorStop(0.3, `rgba(${b.col},${(a * 0.35).toFixed(3)})`);
            g.addColorStop(1, `rgba(${b.col},0)`);
            ctx.fillStyle = g;
            ctx.fillRect(x - glow, y - glow, glow * 2, glow * 2);
            // In the floor, mirrored about the near mirror line, dimmer and smeared
            const ry = geom.drawY + (2 * MIRROR_NEAR - b.y) * geom.drawH;
            const ra = a * (wet ? 0.22 : 0.3) * (1 - 0.9 * snowed);
            if (ry > floorY && ry < H + 10 && ra > 0.01) {
                const sw = r * 1.6, sh = r * (wet ? 4.5 : 3.4);
                ctx.save();
                ctx.translate(x, ry);
                ctx.scale(1, sh / sw);
                const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, sw);
                rg.addColorStop(0, `rgba(${b.col},${ra.toFixed(3)})`);
                rg.addColorStop(1, `rgba(${b.col},0)`);
                ctx.fillStyle = rg;
                ctx.fillRect(-sw, -sw, sw * 2, sw * 2);
                ctx.restore();
            }
        }
        ctx.restore();
    }

    function drawLights(f, geom, k, list = ZAGREB_LIGHTS, part = 'all') {
        if (k <= 0.01) return;
        const { ctx, t, wx, W, H } = f;
        const sc = geom.drawW / 1200;
        const tonight = Math.floor((env().date.getTime() + (typeof ENV.utcOffsetSeconds === 'number' ? ENV.utcOffsetSeconds * 1000 : 0) - 12 * 3600000) / 86400000); // changes at noon, local
        const haze = 1 + wx.fog * 1.2; // fog spreads the glow

        const floorY = geom.drawY + FLOOR_TOP * geom.drawH;
        // Rain breaks the mirror up: reflections shimmer more and lose a little strength
        const wet = wx.rain > 0.15 ? 1 : 0;

        const hours = localHours();
        const advent = list === ZAGREB_LIGHTS && adventNow();
        const floodK = floodOn(hours);
        const flood = part === 'points' || floodK <= 0.01 ? null : floodLayer(list, geom);
        if (flood) {
            ctx.save();
            ctx.globalCompositeOperation = 'screen';
            ctx.globalAlpha = k * 0.85 * floodK;
            ctx.drawImage(flood, geom.ox, geom.oy);
            // The floodlit walls again, upside down in the wet floor
            ctx.beginPath();
            ctx.rect(0, floorY, W, H - floorY);
            ctx.clip();
            ctx.globalAlpha = k * floodK * (wet ? 0.26 : 0.34) * (1 - 0.95 * Math.max(LIGHT ? LIGHT.lying : 0, LIGHT ? LIGHT.dry || 0 : 0)); // none in snow or on a dry floor
            ctx.translate(0, 2 * (geom.drawY + MIRROR_FAR * geom.drawH));
            ctx.scale(1, -1);
            ctx.drawImage(flood, geom.ox, geom.oy);
            ctx.restore();
        }
        if (part === 'flood') return;

        list.forEach((L, i) => {
            if (L.t === 'flood') return;
            const x = geom.drawX + L.x * geom.drawW, y = geom.drawY + L.y * geom.drawH;
            if (x < -20 || x > W + 20 || y < -20 || y > H + 20) return;
            // About one window in eight stays dark, a different set each night
            if (L.t === 'win' && !advent && hash01(i * 7.3 + tonight) < 0.12) return; // in Advent every window is lit

            const flick = 1 + Math.sin(t * (0.5 + hash01(i) * 1.2) + i * 1.7) * 0.07 + Math.sin(t * 0.23 + i) * 0.04;
            // Distant pinpoints twinkle through the air; nearer lights only breathe
            const awake = L.t === 'win' ? windowOn(i, hours, advent) : 1;
            if (awake <= 0.01) return;
            const a = clamp(k * awake * (L.t === 'far' ? 0.55 + 0.45 * Math.sin(t * (1.1 + hash01(i) * 1.6) + i * 3.1) : flick));
            const rw = Math.max(1.2, L.w * sc), rh = Math.max(1.2, L.h * sc);
            const rgb = (L.t === 'clock' ? [255, 246, 220] : L.t === 'lamp' ? [255, 226, 160] : TINT[L.c] || TINT.amber).join(',');

            // Reflection in the wet terrace: same spot mirrored, dimmer and smeared downward
            const ry = geom.drawY + (2 * (L.t === 'lamp' ? MIRROR_NEAR : MIRROR_FAR) - L.y) * geom.drawH;
            if (ry > floorY && ry < H + 10) {
                const shimmer = Math.sin(t * (wet ? 2.6 : 0.7) + i * 2.3);
                const rx = x + shimmer * (wet ? 0.9 : 0.35) * sc;
                const frost = LIGHT ? LIGHT.frost : 0; // ice reflects less sharply than water
                const snowed = Math.max(LIGHT ? LIGHT.lying : 0, LIGHT ? 0.85 * (LIGHT.dry || 0) : 0); // snow or a dry floor: no mirror
                const ra = a * (wet ? 0.3 : 0.4) * (0.85 + 0.15 * shimmer) * (1 - 0.45 * frost) * (1 - 0.9 * snowed);
                const sw = Math.max(rw, 1.4) * 1.3, sh = Math.max(rh, rw) * (wet ? 3.4 : 2.6);
                ctx.save();
                ctx.translate(rx, ry);
                ctx.scale(1, sh / sw);
                const rg = ctx.createRadialGradient(0, 0, 0, 0, 0, sw);
                rg.addColorStop(0, `rgba(${rgb},${ra.toFixed(3)})`);
                rg.addColorStop(0.45, `rgba(${rgb},${(ra * 0.4).toFixed(3)})`);
                rg.addColorStop(1, `rgba(${rgb},0)`);
                ctx.fillStyle = rg;
                ctx.fillRect(-sw, -sw, sw * 2, sw * 2);
                ctx.restore();
            }


            // Tight glow around the source
            const bloom = Math.max(rw, rh) * (L.t === 'lamp' ? 3.2 : L.t === 'clock' ? 2.2 : 1.5) * haze;
            const g = ctx.createRadialGradient(x, y, 0, x, y, bloom);
            g.addColorStop(0, `rgba(${rgb},${(a * (L.t === 'lamp' ? 0.5 : 0.3)).toFixed(3)})`);
            g.addColorStop(1, `rgba(${rgb},0)`);
            ctx.fillStyle = g;
            ctx.fillRect(x - bloom, y - bloom, bloom * 2, bloom * 2);

            ctx.fillStyle = `rgba(${rgb},${(a * 0.92).toFixed(3)})`;
            if (L.t === 'win') {
                ctx.fillRect(x - rw / 2, y - rh / 2, rw, rh);
                if (advent && hash01(i * 4.3 + 2.2) < 0.35) {
                    // A few coloured lights in the window or on the balcony beside it
                    const tw = 0.6 + 0.4 * Math.sin(t * (0.8 + hash01(i * 9.1) * 1.4) + i);
                    const col = ADVENT_COLOURS[Math.floor(hash01(i * 6.7 + 3.3) * ADVENT_COLOURS.length)];
                    ctx.fillStyle = `rgba(${col},${(a * 0.8 * tw).toFixed(3)})`;
                    const dx = (hash01(i * 2.1) < 0.5 ? -1 : 1) * rw * 1.2;
                    ctx.beginPath();
                    ctx.arc(x + dx, y + rh * 0.6, Math.max(0.9, rw * 0.35), 0, 6.2832);
                    ctx.fill();
                    ctx.fillStyle = `rgba(${rgb},${(a * 0.92).toFixed(3)})`;
                }
            } else if (L.t === 'tower') {
                // Arched opening: a rectangle with a rounded top
                ctx.beginPath();
                ctx.moveTo(x - rw / 2, y + rh / 2);
                ctx.lineTo(x - rw / 2, y - rh / 2 + rw / 2);
                ctx.arc(x, y - rh / 2 + rw / 2, rw / 2, Math.PI, 0, false);
                ctx.lineTo(x + rw / 2, y + rh / 2);
                ctx.closePath();
                ctx.fill();
            } else {
                ctx.beginPath();
                ctx.arc(x, y, rw / 2, 0, 6.2832);
                ctx.fill();
                if (L.t === 'lamp') {
                    // Faint pool of light under the lamp, fading out to its edge (a flat ellipse
                    // showed as a ring)
                    const pr = rw * 5 * haze, ph = rw * 1.6;
                    ctx.save();
                    ctx.translate(x, y + rw * 2.5);
                    ctx.scale(1, ph / pr);
                    const pg = ctx.createRadialGradient(0, 0, 0, 0, 0, pr);
                    pg.addColorStop(0, `rgba(${rgb},${(a * 0.15).toFixed(3)})`);
                    pg.addColorStop(0.5, `rgba(${rgb},${(a * 0.07).toFixed(3)})`);
                    pg.addColorStop(1, `rgba(${rgb},0)`);
                    ctx.fillStyle = pg;
                    ctx.fillRect(-pr, -pr, pr * 2, pr * 2);
                    ctx.restore();
                }
            }
        });
        if (advent) drawGarland(f, geom, k);
    }

    function drawMoon(f, p, m) {
        const { ctx } = f;
        if (m.lit < 0.03) return; // new moon: nothing to see

        const disc = moonDisc(p.r, SUN.moonFromPhase(0.5), LIGHT && LIGHT.moonLight, LIGHT && LIGHT.moonNorth, LIGHT ? LIGHT.moonAlt : 45);
        if (!disc) return;
        const dw = disc.width / MOON_SS;
        ctx.save();
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(disc, p.x - dw / 2, p.y - dw / 2, dw, dw);
        ctx.restore();
        // Glare: the bright disc bleeds a little light over its own edge, as it does in the eye,
        // so it sits in the sky instead of on it
        const bloomR = p.r * 1.45;
        const b = ctx.createRadialGradient(p.x, p.y, p.r * 0.85, p.x, p.y, bloomR);
        b.addColorStop(0, 'rgba(200, 206, 218, 0.10)');
        b.addColorStop(0.4, 'rgba(180, 192, 214, 0.035)');
        b.addColorStop(1, 'rgba(190, 205, 230, 0)');
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.fillStyle = b;
        ctx.fillRect(p.x - bloomR, p.y - bloomR, bloomR * 2, bloomR * 2);
        ctx.restore();
    }

    // ------------------------------------------------------------------
    // Clouds and the lit scenery layer
    // ------------------------------------------------------------------
    // Cloud shapes are white masks built once, on first use; the hour's colours are stamped onto
    // copies only when the light changes, and only for the shapes that are on screen.
    // A shape is a cumulus outline (a low wide body with a few towers on top) eroded by fractal
    // noise, so the edge billows and frays instead of being a heap of round puffs. `shade` is the
    // cloud's own shadow (its underside and the creases between billows), `under` the base that
    // catches a low sun. Each cloud is also mirrored and re-proportioned from its seed, so eight
    // shapes give many different clouds.
    const CLOUD_VARIANTS = 8;
    const cloudMasks = [];
    function cloudMask(v) {
        if (cloudMasks[v]) return cloudMasks[v];
        // Always-low quality keeps the small sprites; a sharp picture gets finer ones
        const fine = !(WP.__WP_SCALES__ && Number(WP.__WP_SCALES__.still) <= 0.5);
        const W = fine ? 384 : 256, H = W / 2;
        const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
        {
            const rnd = rng(v * 977 + 13);
            // Value noise on a seeded lattice, summed over octaves
            const N = 64, lattice = new Float32Array(N * N);
            for (let i = 0; i < lattice.length; i++) lattice[i] = rnd();
            const noise = (x, y) => {
                const xi = Math.floor(x), yi = Math.floor(y);
                const fx = x - xi, fy = y - yi;
                const u = fx * fx * (3 - 2 * fx), w = fy * fy * (3 - 2 * fy);
                const x0 = xi & 63, x1 = (xi + 1) & 63, y0 = (yi & 63) * N, y1 = ((yi + 1) & 63) * N;
                const a = lattice[y0 + x0], b = lattice[y0 + x1], c = lattice[y1 + x0], d = lattice[y1 + x1];
                return a + (b - a) * u + (c - a + (a - b + d - c) * u) * w;
            };
            // billow: rounded lumps with sharp creases between them (cauliflower), not plain fuzz
            const fbm = (x, y, oct, billow) => {
                let sum = 0, amp = 0.5, norm = 0;
                for (let o = 0; o < oct; o++) {
                    sum += (billow ? Math.abs(2 * noise(x, y) - 1) : noise(x, y)) * amp;
                    norm += amp;
                    x = x * 2.03 + 17.1;
                    y = y * 2.03 + 9.7;
                    amp *= 0.55;
                }
                return sum / norm;
            };

            // The outline: a rounded heap of overlapping lobes, widest low down and domed on top
            const baseY = H * 0.66;
            const lobes = [];
            const cx0 = W * (0.47 + 0.06 * rnd());
            lobes.push({ x: cx0, y: baseY - H * 0.08, rx: W * (0.25 + 0.05 * rnd()), ry: H * (0.17 + 0.04 * rnd()) });
            const extra = 5 + Math.floor(rnd() * 3);
            for (let i = 0; i < extra; i++) {
                const off = (rnd() - 0.5) * 2; // -1 left .. 1 right
                const dome = Math.sqrt(1 - 0.8 * off * off); // the heap is highest near the middle
                const rx = W * (0.07 + 0.07 * rnd()) * (0.7 + 0.5 * dome);
                const ry = rx * (0.7 + 0.25 * rnd());
                lobes.push({ x: cx0 + off * W * 0.24, y: baseY - H * (0.06 + 0.3 * dome * (0.35 + 0.65 * rnd())), rx, ry });
            }
            // Where the cloud's top is in each column, for shading from the top down (smoothed, so
            // the side of a tower leaves no vertical line in the shadow)
            const rawTop = new Float32Array(W).fill(baseY), colTop = new Float32Array(W);
            for (let x = 0; x < W; x++) {
                for (const l of lobes) {
                    const k = (x - l.x) / l.rx;
                    if (Math.abs(k) < 1) rawTop[x] = Math.min(rawTop[x], l.y - l.ry * Math.sqrt(1 - k * k));
                }
            }
            const R = Math.round(W * 0.05);
            for (let x = 0; x < W; x++) {
                let sum = 0, n = 0;
                for (let k = -R; k <= R; k++) {
                    const j = x + k;
                    if (j >= 0 && j < W) { sum += rawTop[j]; n++; }
                }
                colTop[x] = sum / n;
            }

            const mk = () => {
                const c = document.createElement('canvas');
                c.width = W;
                c.height = H;
                return c;
            };
            const body = mk(), shade = mk(), under = mk(), rim = mk();
            // First pass: coverage, how deep inside the cloud each point is, and how far down
            const A = new Float32Array(W * H), T = new Float32Array(W * H), D = new Float32Array(W * H), TOP = new Float32Array(W * H);
            const fq = 5 / W; // the largest billows are about a fifth of the cloud wide
            for (let y = 0; y < H; y++) {
                for (let x = 0; x < W; x++) {
                    // Warp the coordinates a little so the billows curl
                    const wx = x + (fbm(x * fq * 0.8 + 31, y * fq * 0.8 + 7, 2) - 0.5) * W * 0.09;
                    const wy = y + (fbm(x * fq * 0.8 + 3, y * fq * 0.8 + 53, 2) - 0.5) * H * 0.12;
                    // Lobes melt into one another (a smooth union), so the outline has no steps.
                    // Below the base line each lobe is squashed, which flattens the underside.
                    let sum = 0;
                    for (const l of lobes) {
                        const dx = (wx - l.x) / l.rx;
                        let dy = (wy - l.y) / l.ry;
                        if (wy > baseY) dy += (wy - baseY) / l.ry * 0.3;
                        sum += Math.exp(7 * (1 - Math.sqrt(dx * dx + dy * dy)));
                    }
                    const e = Math.log(sum) / 7;
                    if (e < -0.7) continue;
                    const n = fbm(x * fq, y * fq * 1.2, 5, true); // about 0.1 in a crease .. 0.6 on a lump
                    const soft = fbm(x * fq * 1.3 + 11, y * fq * 1.3 + 71, 4); // plain fuzz, about 0.3 .. 0.7
                    // The underside has no edge: it thins out downward, unevenly, like haze under a cloud
                    const low = fbm(x * fq * 0.6 + 5, 3.3, 2);
                    const flat = smooth(baseY + H * 0.2, baseY - H * 0.12, y + (low - 0.5) * H * 0.2 + (soft - 0.5) * H * 0.12);
                    // Keep clear of the sprite's edges
                    const edge = smooth(0, W * 0.04, Math.min(x, W - 1 - x, y, H - 1 - y));
                    // Sunlit crowns have a crisp, billowed edge; toward the base it frays into haze
                    const top = smooth(baseY + H * 0.05, baseY - H * 0.25, y);
                    const rough = (n - 0.34) * (0.55 + 0.7 * top) + (soft - 0.5) * (0.9 - 0.55 * top);
                    const v = e + rough;
                    const alpha = smooth(-0.08, 0.44 - 0.18 * top, v) * flat * edge;
                    if (alpha <= 0.004) continue;
                    const i = y * W + x;
                    A[i] = alpha;
                    T[i] = smooth(-0.05, 0.5, v) * flat;
                    D[i] = clamp((y - colTop[x]) / Math.max(1, baseY + H * 0.1 - colTop[x]));
                    TOP[i] = top;
                }
            }
            // The depth field, blurred a little, is a height map: its slope gives each billow a
            // rounded surface, lit from above, so the cloud has form instead of a flat fill
            const Tb = new Float32Array(W * H), tmp = new Float32Array(W * H);
            const rb = Math.max(1, Math.round(W / 128));
            for (let pass = 0; pass < 2; pass++) {
                const [src, dst, dx, dy] = pass ? [tmp, Tb, 0, W] : [T, tmp, 1, 0];
                const step = dx + dy, len = pass ? H : W;
                for (let o = 0; o < (pass ? W : H); o++) {
                    const base = pass ? o : o * W;
                    for (let k = 0; k < len; k++) {
                        let sum = 0, cnt = 0;
                        for (let q = -rb; q <= rb; q++) {
                            const kk = k + q;
                            if (kk < 0 || kk >= len) continue;
                            sum += src[base + kk * step];
                            cnt++;
                        }
                        dst[base + k * step] = sum / cnt;
                    }
                }
            }
            const gb = body.getContext('2d'), gs = shade.getContext('2d'), gu = under.getContext('2d'), gr = rim.getContext('2d');
            const ib = gb.createImageData(W, H), is = gs.createImageData(W, H), iu = gu.createImageData(W, H), ir = gr.createImageData(W, H);
            const slope = W / 40;
            const lx = 0.28, ly = -0.82, lz = 0.5; // light from above and a little to the side
            for (let y = 1; y < H - 1; y++) {
                for (let x = 1; x < W - 1; x++) {
                    const i = y * W + x, alpha = A[i];
                    if (alpha <= 0.004) continue;
                    const gx = (Tb[i + 1] - Tb[i - 1]) * slope, gy = (Tb[i + W] - Tb[i - W]) * slope;
                    const lam = (-gx * lx - gy * ly + lz) / Math.sqrt(gx * gx + gy * gy + 1);
                    const depth = D[i], top = TOP[i];
                    // Shadow: the base is darker, and so is the side of each billow turned from the
                    // light. Soft and broad, never dark lines in the creases.
                    const form = smooth(0.62, -0.05, lam) * (0.35 + 0.55 * top);
                    const sh = Math.min(0.9, 0.7 * smooth(0.25, 1.0, depth) + 0.55 * form);
                    // Rim: the thin outer fringe, which glows when the sun or moon is behind it
                    const thin = smooth(0.55, 0.05, Tb[i]);
                    const k = i * 4;
                    ib.data[k] = ib.data[k + 1] = ib.data[k + 2] = 255;
                    ib.data[k + 3] = Math.round(alpha * 255);
                    is.data[k] = is.data[k + 1] = is.data[k + 2] = 255;
                    is.data[k + 3] = Math.round(alpha * sh * 255);
                    iu.data[k] = iu.data[k + 1] = iu.data[k + 2] = 255;
                    iu.data[k + 3] = Math.round(alpha * smooth(0.62, 1.0, depth) * 255);
                    ir.data[k] = ir.data[k + 1] = ir.data[k + 2] = 255;
                    ir.data[k + 3] = Math.round(alpha * thin * 255);
                }
            }
            gb.putImageData(ib, 0, 0);
            gs.putImageData(is, 0, 0);
            gu.putImageData(iu, 0, 0);
            gr.putImageData(ir, 0, 0);
            return (cloudMasks[v] = { body, shade, under, rim });
        }
    }
    // One tinted copy of a mask; the canvas is kept and re-coloured when the light changes
    function stamp(mask, color, into) {
        const c = into || document.createElement('canvas');
        c.width = mask.width; // also clears a reused canvas
        c.height = mask.height;
        const x = c.getContext('2d');
        x.drawImage(mask, 0, 0);
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = color;
        x.fillRect(0, 0, c.width, c.height);
        return c;
    }
    const CLOUD_TINT = { body: ['body', 'cloudLit'], shade: ['shade', 'cloudShade'], under: ['under', 'glow'], sheet: ['body', 'sheet'], haze: ['body', 'hor'] };
    const cloudCache = new Map(); // "variant|kind" -> { key, canvas }
    // Far clouds are small on screen, which squeezes a mask's soft edge into a pixel or two: they
    // use copies of the masks blurred once, so they stay as soft as the near ones
    const softMasks = new Map();
    function softMask(variant, name) {
        const id = variant + '|' + name;
        let c = softMasks.get(id);
        if (c) return c;
        const m = cloudMask(variant)[name];
        c = document.createElement('canvas');
        c.width = m.width;
        c.height = m.height;
        const g = c.getContext('2d');
        try { g.filter = `blur(${Math.round(m.width / 64)}px)`; } catch (_) {}
        g.drawImage(m, 0, 0);
        softMasks.set(id, c);
        return c;
    }
    function cloudSprite(L, variant, kind, soft = false) {
        const [mask, colour] = CLOUD_TINT[kind];
        const id = variant + '|' + kind + (soft ? '|soft' : '');
        let hit = cloudCache.get(id);
        if (hit && hit.key === L[colour]) return hit.canvas;
        hit = { key: L[colour], canvas: stamp(soft ? softMask(variant, mask) : cloudMask(variant)[mask], L[colour], hit && hit.canvas) };
        cloudCache.set(id, hit);
        return hit.canvas;
    }

    // Half-frozen terrace: milky sheets of ice with a few hairline cracks lie on the water, and
    // open wet patches stay between them. Sheets are small and flat far away, large near the eye.
    // Their places are fixed (seeded), so the ice does not jump when the light changes.
    const ICE = [];
    (function seedIce() {
        const rnd = rng(8128);
        for (let i = 0; i < 46; i++) {
            const d = Math.pow(rnd(), 0.8); // 0 at the railing, 1 at the bottom edge
            ICE.push({ x: rnd() * 1.1 - 0.05, d, w: 0.7 + rnd() * 0.9, a: 0.55 + rnd() * 0.45, tilt: (rnd() - 0.5) * 0.25, crack: rnd() });
        }
    })();
    function drawIce(x, L, layer = L.geom) {
        const g0 = L.geom;
        const floorY = g0.drawY + FLOOR_TOP * g0.drawH, bottom = g0.drawY + g0.drawH;
        const light = 0.3 + 0.7 * L.lum; // ice is only as bright as the light on it
        x.save();
        x.globalCompositeOperation = 'source-over';
        // A matte film over the whole floor dulls the mirror (full-canvas gradient, no edge)
        const film = x.createLinearGradient(0, floorY - g0.drawH * 0.01, 0, bottom);
        film.addColorStop(0, 'rgba(206, 222, 236, 0)');
        film.addColorStop(0.1, `rgba(206, 222, 236, ${(0.16 * L.frost * light).toFixed(3)})`);
        film.addColorStop(1, `rgba(214, 228, 240, ${(0.24 * L.frost * light).toFixed(3)})`);
        x.fillStyle = film;
        x.fillRect(layer.ox, layer.oy, layer.W, layer.H);

        const n = Math.round(ICE.length * (0.35 + 0.65 * L.frost));
        for (let i = 0; i < n; i++) {
            const s = ICE[i];
            const cx = g0.drawX + s.x * g0.drawW, cy = floorY + (0.04 + 0.96 * s.d) * (bottom - floorY);
            const rx = g0.drawW * (0.03 + 0.11 * s.d) * s.w, ry = rx * (0.16 + 0.1 * s.d);
            x.save();
            x.translate(cx, cy);
            x.rotate(s.tilt * 0.2);
            x.scale(rx, ry);
            const sheet = x.createRadialGradient(0, 0, 0.25, 0, 0, 1);
            const a = 0.42 * s.a * L.frost * light;
            sheet.addColorStop(0, `rgba(224, 236, 246, ${a.toFixed(3)})`);
            sheet.addColorStop(0.78, `rgba(214, 230, 244, ${(a * 0.85).toFixed(3)})`);
            sheet.addColorStop(1, 'rgba(214, 230, 244, 0)');
            x.fillStyle = sheet;
            x.fillRect(-1, -1, 2, 2);
            x.restore();
            if (s.crack > 0.55) {
                // A hairline crack across the sheet
                x.strokeStyle = `rgba(245, 250, 255, ${(0.3 * L.frost * light).toFixed(3)})`;
                x.lineWidth = Math.max(0.5, g0.drawW / 1200 * (0.6 + 0.8 * s.d));
                x.beginPath();
                x.moveTo(cx - rx * 0.7, cy + ry * (s.crack - 0.8));
                x.lineTo(cx - rx * 0.1, cy - ry * 0.25 * s.tilt * 4);
                x.lineTo(cx + rx * 0.25, cy + ry * 0.2);
                x.lineTo(cx + rx * 0.75, cy - ry * (s.crack - 0.6));
                x.stroke();
            }
        }
        x.restore();
    }

    // The hour's light on a layer of scenery, exactly as the painting gets it. x: a context whose
    // transform maps world coordinates onto its canvas; g0: the layer's rectangle (ox, oy, W, H)
    // plus the painting's placement (drawX/Y/W/H); drawBase(x): paints the unlit layer, and is
    // used again at the end as the outline that cuts the light back off the sky.
    function lightLayer(x, L, g0, drawBase) {
        x.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in x) x.imageSmoothingQuality = 'high';
        drawBase(x);
        const fill = () => x.fillRect(g0.ox, g0.oy, g0.W, g0.H);

        x.globalCompositeOperation = 'multiply';
        if (L.tintA > 0.01) {
            x.fillStyle = rgba(L.tint, L.tintA);
            fill();
        }
        if (L.washA > 0.01) {
            x.fillStyle = rgba(L.wash, L.washA);
            fill();
        }
        if (L.warmA > 0.01) {
            // Low sun: warm light falling across the scene from the sun's side
            x.globalCompositeOperation = 'overlay';
            const warm = x.createRadialGradient(L.sunX, L.horizonY, 0, L.sunX, L.horizonY, L.geom.W * 0.95);
            warm.addColorStop(0, rgba(L.glow, L.warmA));
            warm.addColorStop(1, rgba(L.glow, 0));
            x.fillStyle = warm;
            fill();
        }
        if (L.moonA > 0.01) {
            x.globalCompositeOperation = 'screen';
            const moon = x.createLinearGradient(0, L.geom.oy, 0, L.geom.oy + L.geom.H);
            moon.addColorStop(0, `rgba(65, 100, 165, ${(0.2 * L.moonA).toFixed(3)})`);
            moon.addColorStop(0.5, `rgba(45, 75, 130, ${(0.1 * L.moonA).toFixed(3)})`);
            moon.addColorStop(1, 'rgba(25, 40, 80, 0)');
            x.fillStyle = moon;
            fill();
        }
        if (L.haze > 0.02) {
            // Air between here and the town: thickest at the skyline, thin on the terrace
            x.globalCompositeOperation = 'source-over';
            const hy = L.horizonY, bottom = g0.drawY + g0.drawH;
            const air = x.createLinearGradient(0, hy - g0.drawH * 0.2, 0, bottom);
            air.addColorStop(0, rgba(L.hor, L.haze));
            air.addColorStop(0.3, rgba(L.hor, L.haze * 0.92));
            air.addColorStop(0.5, rgba(L.hor, L.haze * 0.3));
            air.addColorStop(1, rgba(L.hor, L.haze * 0.1));
            x.fillStyle = air;
            fill();
        }
        const skyA = clamp(L.lowSun * 1.2) * L.cs * 0.6;
        if (skyA > 0.02) {
            // The wet terrace mirrors the sky: at dawn and dusk it takes the horizon's colour
            // (hue only, the painted reflections keep their light and dark)
            x.globalCompositeOperation = 'color';
            const floorY = g0.drawY + FLOOR_TOP * g0.drawH;
            const mirror = x.createLinearGradient(0, floorY - g0.drawH * 0.02, 0, g0.drawY + g0.drawH);
            mirror.addColorStop(0, rgba(L.hor, 0));
            mirror.addColorStop(0.12, rgba(L.hor, skyA));
            mirror.addColorStop(1, rgba(L.mid, skyA * 0.8));
            x.fillStyle = mirror;
            fill();
        }
        if (L.frost > 0.05) drawIce(x, L, g0);
        if (L.snowCover > 0.05) {
            // Lying snow: the whole scene pales a little, the open terrace floor most of all.
            // One full-canvas gradient, so there is no edge anywhere.
            x.globalCompositeOperation = 'screen';
            const b = 0.25 + 0.75 * L.lum; // snow is only as bright as the light on it
            const snow = x.createLinearGradient(0, g0.drawY + g0.drawH * 0.45, 0, g0.drawY + g0.drawH);
            snow.addColorStop(0, `rgba(226, 234, 244, ${(0.10 * L.snowCover * b).toFixed(3)})`);
            snow.addColorStop(0.45, `rgba(232, 239, 247, ${(0.20 * L.snowCover * b).toFixed(3)})`);
            snow.addColorStop(1, `rgba(238, 243, 250, ${(0.40 * L.snowCover * b).toFixed(3)})`);
            x.fillStyle = snow;
            fill();
        }
        // Cut everything back to the layer's own outline (bare winter trees let the sky through)
        x.globalCompositeOperation = 'destination-in';
        drawBase(x);
        x.globalCompositeOperation = 'source-over';
    }

    // The scenery with the hour's light on it, on its own canvas so the tint never touches the
    // sky. Redrawn only when the light changes.
    let sceneCache = { key: '', canvas: null };
    function sceneLayer(L) {
        if (sceneCache.key === L.key) return sceneCache.canvas;
        const g0 = L.geom;
        const c = sceneCache.canvas || document.createElement('canvas');
        c.width = g0.W;
        c.height = g0.H;
        const x = c.getContext('2d');
        x.setTransform(1, 0, 0, 1, -g0.ox, -g0.oy); // the canvas covers only the scene rectangle
        lightLayer(x, L, g0, ctx => ctx.drawImage(L.art, g0.drawX, g0.drawY, g0.drawW, g0.drawH));
        sceneCache = { key: L.key, canvas: c };
        return c;
    }

    // ------------------------------------------------------------------
    // Span only: frosted milk-glass side displays matched to the main scene
    // ------------------------------------------------------------------
    // Side displays sample the live sky/clouds plus a ping-pong mirrored copy of the outer 35%
    // of the lit painting, blur them heavily so no shapes remain visible, and cover them with
    // an adaptive day/night milk-glass finish and subtle etched-glass micro-grain.
    const GLASS_STRIP_FRAC = 0.35;
    const GLASS_SCALE = 10;
    const GLASS_PAD = 18;
    const GLASS_BLUR_PX = 8;
    const glassBuf = { work: null, grain: null };
    // The blurred pane is costly (a blur filter) and shows no detail, so while precipitation
    // animates it is rebuilt at most once a second per side; a still picture always rebuilds it.
    const GLASS_REFRESH_MS = 1000;
    const glassAt = {};

    function glassCanvas(slot, w, h) {
        const c = glassBuf[slot] || (glassBuf[slot] = document.createElement('canvas'));
        if (c.width !== w || c.height !== h) {
            c.width = w;
            c.height = h;
        }
        return c;
    }

    // Subtle monochrome etched-glass noise tile, generated once
    function glassGrainPattern(ctx) {
        if (!glassBuf.grain) {
            const size = 128;
            const c = glassBuf.grain = document.createElement('canvas');
            c.width = c.height = size;
            const g = c.getContext('2d');
            const img = g.createImageData(size, size);
            const d = img.data;
            const rnd = rng(4242);
            for (let i = 0; i < d.length; i += 4) {
                const v = rnd() > 0.5 ? 255 : 0;
                d[i] = d[i + 1] = d[i + 2] = v;
                d[i + 3] = Math.round(rnd() * 90);
            }
            g.putImageData(img, 0, 0);
        }
        return ctx.createPattern(glassBuf.grain, 'repeat');
    }

    // Stretch the 1px border of [pad, pad, sw, sh] into the outer padding so blur() never darkens edges
    function padWorkEdges(g, pad, sw, sh) {
        const c = g.canvas;
        g.drawImage(c, pad, pad, 1, sh, 0, pad, pad, sh);
        g.drawImage(c, pad + sw - 1, pad, 1, sh, pad + sw, pad, pad, sh);
        g.drawImage(c, 0, pad, sw + pad * 2, 1, 0, 0, sw + pad * 2, pad);
        g.drawImage(c, 0, pad + sh - 1, sw + pad * 2, 1, 0, pad + sh, sw + pad * 2, pad);
    }

    // Ping-pong mirror the outer strip of the lit scene onto the small working canvas
    function drawMirroredStrip(wg, scene, L, side, rect, pad, sw, sh) {
        const { RX, RY, RW, RH } = WORLD;
        const stripWorldW = Math.max(24, RW * GLASS_STRIP_FRAC);
        const stripSrcW = Math.max(24, Math.round(scene.width * GLASS_STRIP_FRAC));
        const kx = sw / rect.w;
        const ky = sh / rect.h;
        const seamX = side < 0 ? RX : RX + RW;
        const sy0 = pad + (RY - rect.y) * ky;
        const dstH = RH * ky;
        const dstBottom = pad + sh;

        wg.save();
        wg.beginPath();
        wg.rect(pad, pad, sw, sh);
        wg.clip();
        wg.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in wg) wg.imageSmoothingQuality = 'high';

        const maxDist = side < 0 ? Math.max(0, seamX - rect.x) : Math.max(0, rect.x + rect.w - seamX);
        const kStart = Math.max(0, Math.floor((side < 0 ? seamX - (rect.x + rect.w) : rect.x - seamX) / stripWorldW));
        const kEnd = Math.ceil(maxDist / stripWorldW);

        const srcX = side < 0 ? 0 : scene.width - stripSrcW;
        // Bottom terrace sample to extend downward smoothly onto taller portrait displays
        const floorSrcH = Math.max(4, Math.round(scene.height * 0.08));
        const floorSrcY = scene.height - floorSrcH;

        for (let k = kStart; k <= kEnd; k++) {
            const tileA = seamX + side * k * stripWorldW;
            const tileB = seamX + side * (k + 1) * stripWorldW;
            const leftW = Math.min(tileA, tileB);
            const dx = pad + (leftW - rect.x) * kx;
            const dw = stripWorldW * kx;
            // Even tiles mirror outward from the seam; odd tiles reverse back for C0 continuity
            const mirror = (k % 2 === 0);

            wg.save();
            if (mirror) {
                wg.translate(dx + dw, 0);
                wg.scale(-1, 1);
                wg.drawImage(scene, srcX, 0, stripSrcW, scene.height, 0, sy0, dw + 0.5, dstH);
                if (sy0 + dstH < dstBottom) {
                    wg.drawImage(scene, srcX, floorSrcY, stripSrcW, floorSrcH, 0, sy0 + dstH - 0.5, dw + 0.5, dstBottom - (sy0 + dstH) + 1);
                }
            } else {
                wg.drawImage(scene, srcX, 0, stripSrcW, scene.height, dx, sy0, dw + 0.5, dstH);
                if (sy0 + dstH < dstBottom) {
                    wg.drawImage(scene, srcX, floorSrcY, stripSrcW, floorSrcH, dx, sy0 + dstH - 0.5, dw + 0.5, dstBottom - (sy0 + dstH) + 1);
                }
            }
            wg.restore();
        }
        wg.restore();
    }

    function drawExtension(f) {
        if (!WORLD.span || sceneryHidden || !imgLoaded || sceneryImg.naturalWidth === 0) return;
        if (SPAN && SPAN.glass === false) return; // glass off: the sky alone continues over the sides
        const L = LIGHT;
        if (!L) return;
        const { RX, RW, OX, OY } = WORLD;
        const vx0 = OX, vx1 = OX + S.W;
        const scene = sceneLayer(L);
        const ctx = f.ctx;

        for (const side of [-1, 1]) {
            const a = Math.max(vx0, side < 0 ? 0 : RX + RW), b = Math.min(vx1, side < 0 ? RX : WORLD.DW);
            if (b - a < 1) continue;
            const rect = { x: Math.floor(a), y: OY, w: Math.ceil(b - a), h: S.H };

            const sw = clamp(Math.round(rect.w / GLASS_SCALE), 48, 280) | 0;
            const sh = clamp(Math.round(rect.h / GLASS_SCALE), 48, 280) | 0;
            const pad = GLASS_PAD;
            const ww = sw + pad * 2, wh = sh + pad * 2;
            const slot = side < 0 ? 'blurredL' : 'blurredR';
            const stamp = `${ww}x${wh}|${rect.x},${rect.y},${rect.w},${rect.h}`;
            const nowMs = performance.now();
            const cached = glassAt[slot];
            // Wallpaper: this runs only when the cached background is rebuilt (once a minute)
            const reuse = !wallpaper() && moving() && cached && cached.stamp === stamp && nowMs - cached.at < GLASS_REFRESH_MS;
            if (!reuse) {
            const work = glassCanvas('work', ww, wh);
            const wg = work.getContext('2d');
            wg.setTransform(1, 0, 0, 1, 0, 0);
            wg.clearRect(0, 0, ww, wh);
            wg.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in wg) wg.imageSmoothingQuality = 'high';

            // 1. Copy the live sky and drifting clouds already drawn on this side slice
            const sx = rect.x - OX, sy = rect.y - OY;
            wg.drawImage(ctx.canvas, sx, sy, rect.w, rect.h, pad, pad, sw, sh);

            // 2. Overlay the ping-pong mirrored outer 35% of the lit painting
            drawMirroredStrip(wg, scene, L, side, rect, pad, sw, sh);
            padWorkEdges(wg, pad, sw, sh);

            // 3. Heavy blur at downscaled resolution so no shapes remain visible
            const fresh = glassCanvas(slot, ww, wh);
            const bg = fresh.getContext('2d');
            bg.setTransform(1, 0, 0, 1, 0, 0);
            bg.clearRect(0, 0, ww, wh);
            bg.save();
            bg.filter = `blur(${GLASS_BLUR_PX}px)`;
            bg.drawImage(work, 0, 0);
            bg.restore();
            glassAt[slot] = { stamp, at: nowMs };
            }
            const blurred = glassBuf[slot];

            // 4. Draw back onto the world slice and apply the adaptive milk-glass finish
            ctx.save();
            ctx.beginPath();
            ctx.rect(rect.x, rect.y, rect.w, rect.h);
            ctx.clip();
            ctx.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(blurred, pad, pad, sw, sh, rect.x, rect.y, rect.w, rect.h);

            const lum = L.lum;
            // Adaptive milky frost: cool translucent white in daylight/dusk, dark smoked-frost at night
            const frostA = 0.045 + 0.235 * Math.pow(lum, 0.78);
            ctx.fillStyle = `rgba(228, 236, 246, ${frostA.toFixed(3)})`;
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

            if (lum < 0.35) {
                const smokeA = (1 - lum / 0.35) * 0.14;
                ctx.fillStyle = `rgba(8, 13, 22, ${smokeA.toFixed(3)})`;
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            }

            // Subtle vertical light diffusion across the frosted glass pane
            const sheen = ctx.createLinearGradient(0, rect.y, 0, rect.y + rect.h);
            sheen.addColorStop(0, `rgba(255, 255, 255, ${(0.015 + 0.075 * lum).toFixed(3)})`);
            sheen.addColorStop(0.5, 'rgba(255, 255, 255, 0)');
            sheen.addColorStop(1, `rgba(12, 18, 28, ${(0.04 + 0.04 * (1 - lum)).toFixed(3)})`);
            ctx.fillStyle = sheen;
            ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

            // Faint etched-glass micro-grain
            const pat = glassGrainPattern(ctx);
            if (pat) {
                ctx.globalAlpha = 0.03 + 0.04 * lum;
                ctx.fillStyle = pat;
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            }
            ctx.restore();
        }
    }

    let flakeCanvas = null;
    function snowSprite() {
        if (flakeCanvas) return flakeCanvas;
        const c = flakeCanvas = document.createElement('canvas');
        c.width = c.height = 32;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(255,255,255,1)');
        grad.addColorStop(0.35, 'rgba(250,252,255,0.85)');
        grad.addColorStop(0.7, 'rgba(245,249,255,0.3)');
        grad.addColorStop(1, 'rgba(245,249,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 32, 32);
        return c;
    }

    // Hail and snow grains fall fast. As small hard bright dots they make some monitors draw a dark
    // trail behind each one (pixel overdrive), so they are soft-edged, a little less bright and
    // stretched along their fall like a short motion blur.
    let hailCanvas = null;
    function hailSprite() {
        if (hailCanvas) return hailCanvas;
        const c = hailCanvas = document.createElement('canvas');
        c.width = c.height = 32;
        const g = c.getContext('2d');
        const grad = g.createRadialGradient(16, 16, 0, 16, 16, 16);
        grad.addColorStop(0, 'rgba(240,247,255,1)');
        grad.addColorStop(0.45, 'rgba(235,245,255,0.8)');
        grad.addColorStop(0.75, 'rgba(232,243,255,0.25)');
        grad.addColorStop(1, 'rgba(232,243,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, 0, 32, 32);
        return c;
    }

    // ------------------------------------------------------------------
    // The scene's layers, called in order by frame() below
    // ------------------------------------------------------------------
    const zagrebStyle = {
        // Gentle wind: rain leans at most about 15 degrees and clouds drift slowly even in a gale
        tune: { slantBase: 0.04, slantWind: 0.22, snowWind: 1.7, hailBase: 0.03, hailWind: 0.1, cloudBase: 0.004, cloudWind: 0.012 },

        // Rain, snow and fog take their brightness from the hour, so they never look pasted on
        palette(wx) {
            const lum = LIGHT ? LIGHT.lum : 1;
            const k = 0.3 + 0.7 * lum;
            return {
                rain: `rgba(215, 230, 245, ${(0.45 * k).toFixed(3)})`,
                ice: `rgba(225, 242, 255, ${(0.65 * k).toFixed(3)})`,
                snow: `rgba(250, 252, 255, ${(0.85 * (0.45 + 0.55 * lum)).toFixed(3)})`,
                hail: `rgba(235, 245, 255, ${(0.88 * (0.45 + 0.55 * lum)).toFixed(3)})`,
                fog: LIGHT ? LIGHT.fog : '#cad3de',
                glow: '#ffe8b5',
                veil: '#16191f'
            };
        },

        sky(f) {
            const { ctx, W, H, wx, t } = f;
            const L = computeLight(f);
            const hy = clamp(L.horizonY / H, 0.2, 0.95);

            // Sky: zenith to the hill line, in full-canvas gradients only
            const sky = ctx.createLinearGradient(0, 0, 0, H);
            sky.addColorStop(0, L.top);
            sky.addColorStop(hy * 0.55, L.mid);
            sky.addColorStop(hy, L.hor);
            sky.addColorStop(1, L.hor);
            ctx.fillStyle = sky;
            ctx.fillRect(0, 0, W, H);

            // Twilight glow over the sun's place on the horizon, and the pink band opposite it
            const glowAt = (x, color, a, squash, radius) => {
                if (a <= 0.01) return;
                ctx.save();
                ctx.translate(x, L.horizonY);
                ctx.scale(1, squash);
                const g = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
                g.addColorStop(0, rgba(color, a));
                g.addColorStop(0.35, rgba(color, a * 0.45));
                g.addColorStop(1, rgba(color, 0));
                ctx.fillStyle = g;
                ctx.fillRect(-W * 2, -H * 4, W * 4, H * 8);
                ctx.restore();
            };
            glowAt(L.sunX, L.glow, L.glowA, 0.6, Math.max(f.RW, f.RH) * 0.8);
            glowAt(W - L.sunX, '#d98fae', L.pinkA, 0.45, f.RW * 0.7);

            // Stars come out through dusk and fade behind cloud and fog
            if (L.starVis > 0.05) {
                ctx.save();
                const nStars = Math.min(STAR_MAX, Math.round(STAR_COUNT * (W * H) / (f.RW * f.RH)));
                for (let i = 0; i < nStars; i++) {
                    const s = STARS[i];
                    const alpha = L.starVis * (0.4 + 0.6 * Math.sin(t * s.speed + s.twinkle));
                    if (alpha <= 0.02) continue;
                    ctx.fillStyle = `rgba(235, 245, 255, ${alpha.toFixed(3)})`;
                    ctx.beginPath();
                    ctx.arc(s.x * W, s.y * H, s.r, 0, 6.2832);
                    ctx.fill();
                }
                ctx.restore();
            }

            drawSun(f, L);
            if (L.moonVis > 0.02) {
                ctx.save();
                ctx.globalAlpha = L.moonVis;
                drawMoon(f, { x: L.moonX, y: L.moonY, r: Math.min(f.RW, f.RH) * MOON_R }, L.moon);
                ctx.restore();
            }

            // Rainbow: possible only with the sun up but lower than 42 degrees, and never in rain,
            // snow, hail, fog, heavy cloud or at night. When daytime rain clears there is a 20%
            // chance of one, lasting up to an hour.
            // Wall-clock time: in a span every display runs its own page, and they must agree
            const now = Date.now();
            const possible = L.alt > 0.5 && L.alt < 42 && !(wx.snow > 0 || wx.hail > 0 || wx.fog > 0.4 || wx.rain > 0.05 || wx.cloud > 0.55);
            let targetRainbow = 0;
            if (!possible) rainbowActiveUntil = 0;
            // Wallpaper: the 20 % chance comes from the hour, not Math.random(), so all displays of a
            // span decide alike and the bow does not stop at a display's edge
            else if (lastHadRain && (wallpaper() ? hash01(Math.floor(now / 3600000) * 0.731 + 0.17) : Math.random()) < 0.20) rainbowActiveUntil = now + 3600 * 1000;
            if (possible && now < rainbowActiveUntil) targetRainbow = 0.85 * (0.5 + 0.5 * L.cs);
            lastHadRain = wx.rain > 0.15;
            // Wallpaper: the sky is redrawn once a minute, often with no time passing (dt 0), so the
            // bow takes its strength at once; the game eases it in
            const ease = wallpaper() ? 1 : Math.min(1, f.dt * 1.5);
            f.st.rainbowAlpha = (f.st.rainbowAlpha || 0) + (targetRainbow - (f.st.rainbowAlpha || 0)) * ease;
            drawRainbow(f, L, f.st.rainbowAlpha);
        },

        // Snow: soft flakes at different distances. Far ones are small and faint, most are mid-sized,
        // and a few close to the eye are large, blurred and nearly transparent.
        snow(f, list) {
            const { ctx, wx } = f;
            const lum = LIGHT ? LIGHT.lum : 1;
            const flake = snowSprite();
            const bright = 0.4 + 0.6 * lum;
            ctx.save();
            for (const p of list) {
                const near = p.s > 0.95; // about one flake in twenty drifts past close up
                const depth = (p.z - 0.4) / 0.6; // 0 far .. 1 near
                if (wx.grains) {
                    // Grains: small, fast and soft (see hailSprite)
                    const w = Math.max(1.5, p.r * 1.7), h = w * 2.1;
                    ctx.globalAlpha = (0.26 + 0.3 * depth) * bright;
                    ctx.drawImage(flake, p.x - w, p.y - h, w * 2, h * 2);
                    continue;
                }
                const size = near ? p.r * (2.2 + 1.4 * depth) : p.r * (0.75 + 1.0 * depth * depth);
                ctx.globalAlpha = (near ? 0.26 : 0.4 + 0.5 * depth) * bright;
                ctx.drawImage(flake, p.x - size, p.y - size, size * 2, size * 2);
            }
            ctx.restore();
        },

        // Soft clouds lit by the hour: separate puffs in fair weather, one grey sheet with darker
        // patches when it is overcast, raining or stormy. Far clouds sit lower, smaller and paler.
        // part: 'body' (the cloud's fill only), 'rest' (its shading) or both. Drawing every body
        // first and then every cloud's shading melts overlapping clouds into one mass, instead
        // of a front cloud's edge cutting a hard step across the one behind it.
        cloud(f, c, part) {
            // Sizes follow the scene rectangle, so clouds are as big in a span as on one screen
            const { ctx, wx, RW: W, RH: H } = f;
            const L = LIGHT;
            if (!L) return;
            const variant = c.seed % CLOUD_VARIANTS;
            const depth = c.d; // 0.45 far .. 1 near

            ctx.save();
            if (wx.cloud >= 0.9 || wx.fog > 0.4) {
                if (c.far || part === 'rest') { ctx.restore(); return; }
                const w = W * (0.8 + 0.5 * c.s), h = w * 0.24;
                // Snow comes from an even, pale sheet; rain a little more broken; storms heavy
                ctx.globalAlpha = (wx.thunder ? 0.34 : (wx.snow > 0 || wx.fog > 0.4) ? 0.04 : wx.rain > 0 ? 0.11 : 0.12) * (0.55 + 0.45 * depth);
                // Spread over the whole sky (storms hang heavier overhead), so the sheet has no edge
                const band = wx.thunder ? 0.6 : 0.9;
                ctx.drawImage(cloudSprite(L, variant, 'sheet'), c.px - w / 2, f.RY + (L.horizonY - f.RY) * (0.02 + band * ((c.seed % 89) / 89)) - h / 2, w, h);
                ctx.restore();
                return;
            }
            // The same shape is mirrored and made a little flatter or taller from the cloud's seed
            const persp = wpFrameMs() > 0;
            const skyH = L.horizonY - f.RY;
            let w, h, y;
            if (persp) {
                // Perspective: near clouds are large and high, far ones small, flat and low,
                // crowding just above the hills
                // near clouds keep their size; far ones shrink but stretch wide and flat
                const size = depth >= 0.45 ? 0.74 + 0.6 * (depth - 0.45) / 0.55 : 0.16 + 0.58 * Math.pow(depth / 0.45, 1.2);
                w = c.s * Math.min(W * 0.34, H * 0.46) * size * (1 + 0.3 * clamp((0.5 - depth) / 0.5));
                h = w * 0.5 * (0.6 + 0.4 * Math.min(1, depth / 0.6)) * (0.86 + 0.3 * ((c.seed % 53) / 53));
                y = L.horizonY - skyH * (0.03 + 0.8 * Math.pow(depth, 1.35)) + ((c.seed % 97) / 97 - 0.5) * skyH * 0.05 * depth - h * 0.6;
            } else {
                w = c.s * Math.min(W * 0.34, H * 0.46) * (0.4 + 0.6 * depth);
                h = w * 0.5 * (0.86 + 0.3 * ((c.seed % 53) / 53));
                y = f.RY + skyH * (0.80 - 0.72 * depth) + ((c.seed % 97) / 97 - 0.5) * skyH * 0.08 - h / 2;
            }
            ctx.translate(c.px, 0);
            if ((c.seed >> 3) & 1) ctx.scale(-1, 1);
            // Far clouds are small on screen, which squeezes their soft edge into a pixel or two:
            // a blur in step with their size keeps them as soft as the near ones (wallpaper only,
            // where the picture is drawn once a minute)
            const soft = persp && depth < 0.6;
            const x = -w / 2;
            const a = persp ? 0.62 + 0.33 * depth : 0.5 + 0.42 * depth;
            if (part !== 'rest') {
                ctx.globalAlpha = a;
                ctx.drawImage(cloudSprite(L, variant, 'body', soft), x, y, w, h);
            }
            if (part === 'body') { ctx.restore(); return; }
            // Far clouds show less of their own shadow (air flattens contrast)
            ctx.globalAlpha = a * 0.6 * (persp ? 0.35 + 0.65 * depth : 1);
            ctx.drawImage(cloudSprite(L, variant, 'shade', soft), x, y, w, h);
            if (persp && depth < 0.85) {
                // ...and take on the colour of the air near the horizon (at sunset, its glow)
                ctx.globalAlpha = a * 0.45 * Math.pow(1 - depth, 1.4);
                ctx.drawImage(cloudSprite(L, variant, 'haze', soft), x, y, w, h);
            }
            // Low sun: the undersides nearest the sun catch its colour
            const warm = a * L.lowSun * L.cs * (0.35 + 0.65 * clamp(1 - Math.abs(c.px - L.sunX) / (W * 0.7)));
            if (warm > 0.02) {
                ctx.globalAlpha = warm;
                ctx.drawImage(cloudSprite(L, variant, 'under', soft), x, y, w, h);
            }
            ctx.restore();
        },

        // Midground / Foreground: Zagreb Terrace & Cathedral Cutout
        // part: 'all' (default), 'base' (the lit painting only, for the cached background) or
        // 'live' (night lights and rain ripples, drawn every frame over that background)
        scene(f, part = 'all') {
            const { ctx, W, H, wx, t } = f;

            // In a span, a display that does not show any of the scene rectangle skips it entirely
            const inView = WORLD.RX < WORLD.OX + S.W && WORLD.RX + WORLD.RW > WORLD.OX
                && WORLD.RY < WORLD.OY + S.H && WORLD.RY + WORLD.RH > WORLD.OY;
            if (inView && !sceneryHidden && imgLoaded && sceneryImg.naturalWidth > 0) {
                const L = LIGHT || computeLight(f);
                const geom = L.geom;
                const { drawX, drawY, drawW, drawH } = geom;

                // 1. The cutout, already lit for this hour and weather
                if (part !== 'live') ctx.drawImage(sceneLayer(L), geom.ox, geom.oy);
                if (part === 'base') return;

                ctx.save();

                // 2. Night lights: windows, clock, tower openings, lamps and floodlit areas
                if (wallpaper() && S.scale > 0.5) drawLightsSoft(f, geom, L.lights);
                else drawLights(f, geom, L.lights);

                // 3. Rain ripples, only on the terrace floor: never on the kerb, the railing, the
                // town or another display. Everything is clipped to the painting's floor.
                if (wx.rain > 0.15) {
                    const floorTopY = drawY + drawH * FLOOR_TOP + 1;
                    const floorBottomY = drawY + drawH;
                    const bright = 0.55 + 0.45 * L.lum;
                    const rgb = L.lum < 0.3 ? '175, 200, 245' : '255, 255, 255';
                    const count = Math.min(RIPPLES.length, Math.round(10 + 30 * wx.rain));

                    ctx.save();
                    ctx.beginPath();
                    ctx.rect(drawX, floorTopY, drawW, floorBottomY - floorTopY);
                    ctx.clip();
                    ctx.lineWidth = Math.max(1, drawW / 1100);

                    for (let i = 0; i < count; i++) {
                        const rp = RIPPLES[i];
                        rp.life += f.dt * rp.speed;
                        if (rp.life >= 1) {
                            rp.life = 0;
                            rp.x = 0.03 + Math.random() * 0.94;
                            rp.y = RIPPLE_TOP + Math.random() * RIPPLE_SPAN;
                        }
                        const rx = drawX + rp.x * drawW;
                        const ry = drawY + rp.y * drawH;

                        // Rings are smaller far away (near the railing) and larger close to the eye,
                        // and a drop is drawn only if its largest ring lies wholly on the floor
                        const depth = (rp.y - FLOOR_TOP) / (1 - FLOOR_TOP);
                        const fullR = rp.maxR * drawW * (0.4 + 0.9 * depth);
                        if (rx - fullR < drawX || rx + fullR > drawX + drawW) continue;
                        if (ry - fullR * 0.35 < floorTopY || ry + fullR * 0.35 > floorBottomY) continue;

                        const ring = (life, strength) => {
                            if (life <= 0.02) return;
                            const r = fullR * (0.12 + 0.88 * Math.sqrt(life));
                            ctx.strokeStyle = `rgba(${rgb}, ${((1 - life) * strength * bright).toFixed(3)})`;
                            ctx.beginPath();
                            ctx.ellipse(rx, ry, r, r * 0.35, 0, 0, 6.2832);
                            ctx.stroke();
                        };
                        ring(rp.life, 0.5);
                        ring(rp.life - 0.3, 0.3); // a second ring follows the first
                        if (rp.life < 0.2) {
                            // The splash where the drop lands: a small bright crown that dies quickly
                            const a = (1 - rp.life / 0.2) * 0.6 * bright;
                            const sr = fullR * 0.16;
                            ctx.fillStyle = `rgba(${rgb}, ${a.toFixed(3)})`;
                            ctx.beginPath();
                            ctx.ellipse(rx, ry - sr * 0.5, sr * 0.55, sr * (0.6 + rp.life * 4), 0, 0, 6.2832);
                            ctx.fill();
                        }
                    }
                    ctx.restore();
                }

                ctx.restore();
            }
        },

        post(f) {
            const { ctx, W, H, playing, wx } = f;

            // Camera Look: Subtle natural vignette
            const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.hypot(W, H) * 0.56);
            vg.addColorStop(0, 'rgba(0,0,0,0)');
            vg.addColorStop(1, LIGHT && LIGHT.lum < 0.3 ? 'rgba(0,0,0,0.38)' : 'rgba(10,18,30,0.22)');
            ctx.fillStyle = vg;
            ctx.fillRect(0, 0, W, H);

            // Calm rules: muted veil, dimming more while playing
            ctx.fillStyle = rgba('#16191f', playing ? 0.44 : 0.08);
            ctx.fillRect(0, 0, W, H);
        }
    };

    // ------------------------------------------------------------------
    // Engine: canvas size, particles, the frame and the loop
    // ------------------------------------------------------------------
    // keepFade: the canvas only changes scale (still <-> animating), so a running fade goes on
    function resize(keepFade) {
        const scale = getScale(lowRes());
        S.scale = scale;
        S.W = Math.max(1, Math.round(window.innerWidth * scale));
        S.H = Math.max(1, Math.round(window.innerHeight * scale));
        canvas.width = S.W;
        canvas.height = S.H;
        S.blank = true; // resizing clears the canvas: it needs a picture even while paused
        canvas.style.imageRendering = 'auto';
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        if (!keepFade) {
            S.prev = null; // a snapshot of another window size cannot be blended
            S.fade = 0;
        }
        BG.blend = 0; // nor can the last minute's picture (BG exists before the first resize)
        S.st = {};
        // This scene needs no grain or vignette layer; keep the overlay canvas clear
        overlay.width = S.W;
        overlay.height = S.H;
        octx.clearRect(0, 0, overlay.width, overlay.height);
        const p = rng(42);
        for (const k of Object.keys(POOL)) {
            S.pools[k] = [];
            for (let i = 0; i < POOL[k]; i++) S.pools[k].push({ x: p() * S.W * 1.3, y: p() * S.H, z: 0.4 + p() * 0.6, s: p(), dx: 0, dy: 0, r: 1 });
        }
        updateWorld();
    }

    // World geometry for this canvas (see SPAN above); falls back to "the world is this canvas"
    function updateWorld() {
        const v = SPAN && SPAN.view, d = SPAN && SPAN.desk, sc = SPAN && SPAN.scene;
        const ok = v && d && sc && v.w > 0 && v.h > 0 && d.w > 0 && d.h > 0 && sc.w > 0 && sc.h > 0;
        if (!ok) {
            Object.assign(WORLD, { span: false, DW: S.W, DH: S.H, OX: 0, OY: 0, RX: 0, RY: 0, RW: S.W, RH: S.H, key: '' });
            return;
        }
        const k = S.W / v.w; // CSS pixels to this canvas's pixels
        const r = Math.round;
        Object.assign(WORLD, {
            span: true, DW: r(d.w * k), DH: r(d.h * k), OX: r(v.x * k), OY: r(v.y * k),
            RX: r(sc.x * k), RY: r(sc.y * k), RW: r(sc.w * k), RH: r(sc.h * k)
        });
        WORLD.key = [WORLD.DW, WORLD.DH, WORLD.RX, WORLD.RY, WORLD.RW, WORLD.RH].join(',');
    }

    function seedClouds() {
        const r = rng(7);
        // A span keeps the same number of clouds per scene-width of sky
        const widen = WORLD.span ? Math.max(1, WORLD.DW / WORLD.RW) : 1;
        const n = S.wx.cloud < 0.05 ? 0 : Math.round((3 + S.wx.cloud * 9) * widen);
        S.clouds = [];
        for (let i = 0; i < n; i++) {
            S.clouds.push({ x: r() * 1.5 - 0.25, y: 0.05 + r() * 0.33, s: 0.7 + r() * 0.7, d: 0.45 + r() * 0.55, seed: Math.floor(r() * 1e6) });
        }
        // Wallpaper: clouds in the distance, so the sky has depth (the user's wish, 2026-11-17).
        // Small, flat and hazy, crowding toward the horizon; their number follows the cover. They
        // are only drawn as separate clouds (an overcast sheet ignores them).
        if (wpFrameMs() > 0) {
            const r2 = rng(911);
            const nf = S.wx.cloud < 0.05 ? 0 : Math.round(S.wx.cloud * 28 * widen);
            for (let i = 0; i < nf; i++) {
                const d = 0.04 + 0.4 * Math.pow(r2(), 1.6); // most of them far away
                S.clouds.push({ x: r2() * 1.5 - 0.25, y: 0, s: 0.7 + r2() * 0.7, d, seed: Math.floor(r2() * 1e6), far: true });
            }
        }
        for (const c of S.clouds) c.x0 = c.x;
        S.clouds.sort((a, b) => a.d - b.d);
    }

    // Wallpaper: which way the wind blows across the view. The terrace looks east over Zagreb, so a
    // north wind blows left to right (+1) and a south wind right to left (-1). Wind straight toward
    // or away from the viewer still moves things a little (at least a quarter). Without a known
    // direction (the game): null, and clouds drift right, rain leans left, as they always did.
    function windSide() {
        if (typeof ENV.windDir !== 'number') return null;
        const c = Math.cos(ENV.windDir * Math.PI / 180);
        return (c < 0 ? -1 : 1) * Math.max(0.25, Math.abs(c));
    }

    function stepPrecip(dt, t) {
        const { W, H, wx } = S;
        const side = windSide();
        const across = side === null ? -1 : side; // rain, snow and hail move this way
        const T = zagrebStyle.tune;
        const mod = wx.showers ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * 0.22)) : 1;
        const out = { rain: [], snow: [], hail: [] };
        const wrap = p => {
            if (p.y > H + 4) { p.y -= H + 8 + p.s * H * 0.2; p.x = p.s * W * 1.3; p.s = (p.s * 7.13 + 0.31) % 1; }
            if (p.x < -W * 0.15) p.x += W * 1.3;
            if (p.x > W * 1.2) p.x -= W * 1.3;
        };
        const unit = Math.max(1, H / 300);
        let n = Math.round(POOL.rain * wx.rain * mod);
        for (let i = 0; i < n; i++) {
            const p = S.pools.rain[i];
            const vy = H * (wx.drizzle ? 0.45 : 1.05) * (0.55 + 0.45 * p.z);
            const slant = T.slantBase + wx.wind * T.slantWind;
            p.x += across * vy * slant * dt;
            p.y += vy * dt;
            wrap(p);
            const len = H * (wx.drizzle ? 0.012 : 0.03) * p.z;
            p.dx = across * len * slant;
            p.dy = len;
            out.rain.push(p);
        }
        n = Math.round(POOL.snow * wx.snow * mod);
        for (let i = 0; i < n; i++) {
            const p = S.pools.snow[i];
            p.x += (across * H * 0.012 * (1 + wx.wind * T.snowWind) + Math.sin(t * 0.9 + p.s * 20) * H * 0.01) * dt;
            p.y += H * (wx.grains ? 0.2 : 0.065) * (0.5 + 0.5 * p.z) * dt;
            wrap(p);
            p.r = (wx.grains ? 0.5 : 1) * (0.7 + p.z * 1.3) * unit;
            out.snow.push(p);
        }
        n = Math.round(POOL.hail * wx.hail);
        for (let i = 0; i < n; i++) {
            const p = S.pools.hail[i];
            const vy = H * 1.25 * (0.7 + 0.3 * p.z);
            p.x += across * vy * (T.hailBase + wx.wind * T.hailWind) * dt;
            p.y += vy * dt;
            wrap(p);
            p.r = (0.7 + p.z * 0.8) * unit;
            out.hail.push(p);
        }
        return out;
    }

    // Overcast, rain, snow, storms and fog: a dozen faint sheets stretched across the whole sky.
    // Drawn at full size they cost more than everything else in the frame together (the canvas
    // rasterises each one over most of the screen), so they go onto a quarter-resolution layer
    // that is scaled up once. Their masks are already stretched four to eight times, so the
    // smaller layer loses nothing that can be seen.
    const SHEET_SCALE = 0.25;
    let sheetCanvas = null;
    function drawCloudList(fw) {
        for (const c of S.clouds) zagrebStyle.cloud(fw, c, 'body');
        for (const c of S.clouds) zagrebStyle.cloud(fw, c, 'rest');
    }
    function drawSheets(fw) {
        const q = SHEET_SCALE;
        const w = Math.max(1, Math.ceil(S.W * q)), h = Math.max(1, Math.ceil(S.H * q));
        if (!sheetCanvas) sheetCanvas = document.createElement('canvas');
        if (sheetCanvas.width !== w || sheetCanvas.height !== h) {
            sheetCanvas.width = w;
            sheetCanvas.height = h;
        }
        const sx = sheetCanvas.getContext('2d');
        sx.setTransform(1, 0, 0, 1, 0, 0);
        sx.clearRect(0, 0, w, h);
        sx.setTransform(q, 0, 0, q, -WORLD.OX * q, -WORLD.OY * q);
        const fs = { ...fw, ctx: sx };
        for (const c of S.clouds) zagrebStyle.cloud(fs, c);
        const dst = fw.ctx;
        dst.save();
        dst.setTransform(1, 0, 0, 1, 0, 0);
        dst.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in dst) dst.imageSmoothingQuality = 'high';
        dst.drawImage(sheetCanvas, 0, 0, w, h, 0, 0, w / q, h / q);
        dst.restore();
    }

    // ------------------------------------------------------------------
    // Wallpaper: the background is drawn once and kept until the minute, the sun or the weather
    // changes; each frame then only adds what moves (lights, ripples, rain, snow, fog, lightning).
    // ------------------------------------------------------------------
    // The vignettes and veils are applied here in floating point, with a fixed dither, instead of
    // as canvas gradients: over a dark sky a gradient covers only a few 8-bit levels and shows as
    // rings. The colour look is baked in afterwards, so the page needs no CSS filter.
    const BG = { key: '', work: null, out: null, old: null, blend: 0, wall: undefined, dither: null };
    function bgCanvas(name) {
        let c = BG[name];
        if (!c) {
            c = BG[name] = document.createElement('canvas');
            // The work canvas is read back every rebuild (shadeAndDither): keep it in main memory
            // (the attribute counts only on the first getContext call)
            if (name === 'work') c.getContext('2d', { willReadFrequently: true });
        }
        if (c.width !== S.W || c.height !== S.H) {
            c.width = S.W;
            c.height = S.H;
        }
        return c;
    }
    // Triangular noise of about +-1 level, fixed per pixel so a rebuilt picture does not shimmer
    function ditherTable(n) {
        if (BG.dither && BG.dither.length >= n) return BG.dither;
        const d = new Float32Array(n);
        let s = 0x9e3779b9;
        const r = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
        for (let i = 0; i < n; i++) d[i] = r() + r() - 1;
        return (BG.dither = d);
    }
    // The same vignettes and veils as post() and frame() draw for the game, applied per pixel
    function shadeAndDither(g, W, H) {
        const img = g.getImageData(0, 0, W, H);
        const px = img.data;
        const dither = ditherTable(W * H);
        const night = LIGHT && LIGHT.lum < 0.3;
        const cx = W / 2, cy = H / 2, minWH = Math.min(W, H), diag = Math.hypot(W, H);
        // post(): radial vignette to black at night, to a cool dark blue by day
        const a0 = minWH * 0.32, b0 = diag * 0.56, A1 = night ? 0.38 : 0.22;
        const C1 = night ? [0, 0, 0] : [10, 18, 30];
        // frame(): the look's vignette to black
        const a1 = minWH * 0.3, b1 = diag * 0.55, A2 = LOOK_VIGNETTE;
        // post() veil 0.08 and the calm veil 0.1, both #16191f
        const V = [0x16, 0x19, 0x1f];
        // Per pixel the four layers reduce to v * m + add[c]; inside both inner radii they are constant
        const mIn = 0.92 * 0.9;
        const addIn = V.map(c => c * 0.08 * 0.9 + c * 0.1);
        const a02 = a0 * a0, a12 = a1 * a1, inner2 = Math.min(a02, a12);
        for (let y = 0, i = 0, k = 0; y < H; y++) {
            const dy = y + 0.5 - cy, dy2 = dy * dy;
            for (let x = 0; x < W; x++, i += 4, k++) {
                const dx = x + 0.5 - cx, d2 = dx * dx + dy2;
                const n = dither[k];
                if (d2 <= inner2) {
                    px[i] = px[i] * mIn + addIn[0] + n;
                    px[i + 1] = px[i + 1] * mIn + addIn[1] + n;
                    px[i + 2] = px[i + 2] * mIn + addIn[2] + n;
                    continue;
                }
                const d = Math.sqrt(d2);
                const t0 = d2 <= a02 ? 0 : d >= b0 ? 1 : (d - a0) / (b0 - a0);
                const t1 = d2 <= a12 ? 0 : d >= b1 ? 1 : (d - a1) / (b1 - a1);
                const al0 = A1 * t0, k1 = (1 - A2 * t1) * 0.9;
                // post() vignette, post() veil 0.08, the look's vignette, the calm veil 0.1
                const m = (1 - al0) * 0.92 * k1, w0 = t0 * al0 * 0.92 * k1;
                px[i] = px[i] * m + C1[0] * w0 + V[0] * (0.08 * k1 + 0.1) + n; // Uint8ClampedArray rounds and clamps
                px[i + 1] = px[i + 1] * m + C1[1] * w0 + V[1] * (0.08 * k1 + 0.1) + n;
                px[i + 2] = px[i + 2] * m + C1[2] * w0 + V[2] * (0.08 * k1 + 0.1) + n;
            }
        }
        g.putImageData(img, 0, 0);
    }

    // Build the background (sky, clouds, glass panes, the lit painting, vignettes, look) for now
    function buildBackground(fw, L, minuteWall) {
        const work = bgCanvas('work');
        const g = work.getContext('2d');
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.globalAlpha = 1;
        g.globalCompositeOperation = 'source-over';
        g.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in g) g.imageSmoothingQuality = 'high';
        g.clearRect(0, 0, S.W, S.H);
        g.setTransform(1, 0, 0, 1, -WORLD.OX, -WORLD.OY);
        const fb = { ...fw, ctx: g };
        zagrebStyle.sky(fb);
        placeClouds(fb, minuteWall, 0);
        if (fb.wx.cloud >= 0.9 || fb.wx.fog > 0.4) drawSheets(fb);
        else drawCloudList(fb);
        drawExtension(fb);
        zagrebStyle.scene(fb, 'base');
        g.setTransform(1, 0, 0, 1, 0, 0);
        shadeAndDither(g, S.W, S.H);
        const out = bgCanvas('out');
        const o = out.getContext('2d');
        o.setTransform(1, 0, 0, 1, 0, 0);
        o.clearRect(0, 0, S.W, S.H);
        o.filter = LOOK_CSS;
        o.drawImage(work, 0, 0);
        o.filter = 'none';
        return out;
    }

    // Clouds drift with the wind. The wallpaper takes their places from the wall clock instead
    // of the page's own running time: in a span every display runs its own page, and all of
    // them must agree so a cloud crosses from one to the next.
    const CLOUD_CROSS_S = 3600, CLOUD_BLEND_S = 3;
    function placeClouds(fw, wall, dt) {
        const wx = fw.wx;
        const T = zagrebStyle.tune;
        const side = windSide();
        const dir = side === null ? 1 : side; // clouds and rain go the same way (wallpaper)
        // Wallpaper: the picture is redrawn once a minute, so the clouds drift very slowly, about an
        // hour across the scene display (the user's choice, 2026-11-18): a little faster in wind,
        // far ones slower. Each minute's step is blended in (CLOUD_BLEND_S, see frame()).
        const speed = c => (wallpaper()
            ? dir * (WORLD.RW / WORLD.DW) / CLOUD_CROSS_S * (0.6 + 0.5 * c.d) * (0.85 + 0.75 * wx.wind)
            : dir * (T.cloudBase + wx.wind * T.cloudWind) * c.d * (WORLD.RW / WORLD.DW));
        const byClock = WORLD.span || wallpaper();
        for (const c of S.clouds) {
            if (byClock) {
                c.x = (((c.x0 + 0.3 + wall * speed(c)) % 1.6) + 1.6) % 1.6 - 0.3;
            } else {
                c.x += dt * speed(c);
                if (c.x > 1.3) c.x = -0.3;
                if (c.x < -0.3) c.x = 1.3;
            }
            c.px = c.x * fw.W;
        }
    }

    function frame(dtReal, playing) {
        // Benchmark hook (tools/bench.mjs): count frames and time them when the page asks for it
        const stats = globalThis.__WP_STATS__ || null;
        const t0 = stats ? performance.now() : 0;
        const { W, H, wx } = S;
        const dt = dtReal * (playing ? 0.25 : 1);
        S.t += dt;
        const t = S.t;
        const pal = zagrebStyle.palette(wx);
        // f: this canvas (precipitation, vignette, veil); fw: the world (sky, clouds, scene, fog,
        // lightning). Without a span they are the same size and fw's transform is the identity.
        const f = { ctx, W, H, wx, t, dt, st: S.st, pal, clouds: S.clouds, playing, RX: 0, RY: 0, RW: W, RH: H };
        const fw = { ...f, W: WORLD.DW, H: WORLD.DH, RX: WORLD.RX, RY: WORLD.RY, RW: WORLD.RW, RH: WORLD.RH };
        const toWorld = () => ctx.setTransform(1, 0, 0, 1, -WORLD.OX, -WORLD.OY);
        const toCanvas = () => ctx.setTransform(1, 0, 0, 1, 0, 0);
        toWorld();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';

        // Wallpaper: the background is cached (buildBackground) and redrawn only when the minute,
        // the light, the weather or the size changes; the game draws everything every frame.
        const cached = wallpaper() && !playing;
        if (cached) {
            // The clock to the whole minute, so displays redrawn a moment apart show the same sky
            // (wall-clock time, as the page's minute tick uses: the page's own clock stops while
            // the computer sleeps, and would fall out of step with the tick and the other displays)
            const wall = Math.floor(Date.now() / 60000) * 60;
            const L = computeLight(fw);
            const key = [L.key, wall, S.W, S.H, sceneryHidden, imgLoaded].join('|');
            if (BG.key !== key || !BG.out) {
                const b0 = stats ? performance.now() : 0;
                // A new minute (the clouds have moved, the sun and sky with them): the new picture
                // is blended in over a few seconds instead of replacing the old one at once. The
                // two pictures swap canvases, so nothing is copied. Not on battery, not paused.
                if (BG.out && BG.wall !== undefined && wall !== BG.wall && !animOff() && !reduced() && !S.paused) {
                    [BG.old, BG.out] = [BG.out, BG.old];
                    BG.blend = 1;
                }
                buildBackground(fw, L, wall);
                BG.key = key;
                BG.wall = wall;
                if (stats) {
                    stats.builds = (stats.builds || 0) + 1;
                    stats.buildMs = performance.now() - b0;
                }
            }
            if (canvas.style.filter) canvas.style.filter = '';
            toCanvas();
            ctx.drawImage(BG.out, 0, 0);
            if (BG.blend > 0 && BG.old) {
                ctx.globalAlpha = BG.blend * BG.blend * (3 - 2 * BG.blend); // eased: starts and ends gently
                ctx.drawImage(BG.old, 0, 0, S.W, S.H);
                ctx.globalAlpha = 1;
                BG.blend = Math.max(0, BG.blend - dtReal / CLOUD_BLEND_S);
            }
            toWorld();
            zagrebStyle.scene(fw, 'live');
        } else {
            if (canvas.style.filter !== LOOK_CSS) canvas.style.filter = LOOK_CSS;
            zagrebStyle.sky(fw);
            placeClouds(fw, WORLD.span ? Date.now() / 1000 : 0, dt);
            if (wx.cloud >= 0.9 || wx.fog > 0.4) drawSheets(fw);
            else drawCloudList(fw);
            drawExtension(fw);
            zagrebStyle.scene(fw);
        }

        // Rain, snow and hail, in front of the scene
        toCanvas();
        const pr = stepPrecip(dt, t);
        if (pr.rain.length) {
            ctx.strokeStyle = wx.freezing ? pal.ice : pal.rain;
            ctx.lineWidth = (wx.drizzle ? 0.8 : 1) * (S.scale || 1);
            ctx.beginPath();
            for (const p of pr.rain) {
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x + p.dx, p.y + p.dy);
            }
            ctx.stroke();
        }
        if (pr.snow.length) zagrebStyle.snow(f, pr.snow);
        if (pr.hail.length) {
            const stone = hailSprite();
            const bright = 0.45 + 0.55 * (LIGHT ? LIGHT.lum : 1);
            for (const p of pr.hail) {
                const w = Math.max(1.6, p.r * 1.15), h = w * 2.1;
                ctx.globalAlpha = (0.5 + 0.22 * (p.z - 0.4) / 0.6) * bright;
                ctx.drawImage(stone, p.x - w, p.y - h, w * 2, h * 2);
            }
            ctx.globalAlpha = 1;
        }

        // Fog bands
        toWorld();
        {
            const { W, H } = fw;
            if (wx.fog > 0) {
                ctx.fillStyle = rgba(pal.fog, wx.fog * 0.16);
                ctx.fillRect(0, 0, W, H);
                for (let i = 0; i < 3; i++) {
                    const y = H * (0.42 + i * 0.17) + Math.sin(t * 0.05 + i * 2) * H * 0.02;
                    const g = ctx.createLinearGradient(0, y - H * 0.16, 0, y + H * 0.16);
                    g.addColorStop(0, rgba(pal.fog, 0));
                    g.addColorStop(0.5, rgba(pal.fog, wx.fog * 0.3));
                    g.addColorStop(1, rgba(pal.fog, 0));
                    ctx.fillStyle = g;
                    ctx.fillRect(0, y - H * 0.16, W, H * 0.32);
                }
            }

            // Lightning: a soft glow every 7-15 s, never a white flash, none while playing
            if (wx.thunder) {
                const L = S.L;
                if (playing) {
                    L.a = 0;
                } else {
                    L.next -= dtReal;
                    if (L.next <= 0) {
                        L.a = 0.22;
                        L.x = 0.2 + Math.random() * 0.6;
                        L.next = 7 + Math.random() * 8;
                    }
                    L.a *= Math.pow(0.03, dtReal);
                }
                if (L.a > 0.004) {
                    const x = L.x * W, y = H * 0.16, r = Math.max(W, H) * 0.5;
                    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
                    g.addColorStop(0, rgba(pal.glow, L.a));
                    g.addColorStop(1, rgba(pal.glow, 0));
                    ctx.fillStyle = g;
                    ctx.fillRect(0, 0, W, H);
                }
            }
        }
        toCanvas();

        // The vignettes and veils (already in the cached background in wallpaper mode)
        if (!cached) {
            zagrebStyle.post(f);

            // Vibrant look vignette
            const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
            vg.addColorStop(0, 'rgba(0,0,0,0)');
            vg.addColorStop(1, `rgba(0,0,0,${LOOK_VIGNETTE})`);
            ctx.fillStyle = vg;
            ctx.fillRect(0, 0, W, H);

            // Calm veil: mute the scene, more while the snake is moving
            ctx.fillStyle = rgba(pal.veil, playing ? 0.42 : 0.1);
            ctx.fillRect(0, 0, W, H);
        }

        // A weather change cross-fades from the last picture instead of cutting
        if (S.prev && S.fade > 0) {
            ctx.globalAlpha = S.fade;
            ctx.drawImage(S.prev, 0, 0, W, H);
            ctx.globalAlpha = 1;
            S.fade -= dtReal / 1.2;
            if (S.fade <= 0) S.prev = null;
        }
        // Nothing is worth showing until the painting itself has arrived
        if (imgLoaded) S.drawn = true;
        S.blank = !imgLoaded;
        if (S.shown) show();
        if (stats) {
            const ms = performance.now() - t0;
            stats.frames = (stats.frames || 0) + 1;
            stats.ms = (stats.ms || 0) + ms;
            stats.max = Math.max(stats.max || 0, ms);
            stats.w = W;
            stats.h = H;
        }
    }

    // The canvases start transparent (CSS) and fade in once there is a picture worth showing
    function show() {
        S.shown = true;
        if (!S.drawn || canvas.classList.contains('wx-ready')) return;
        canvas.classList.add('wx-ready');
        overlay.classList.add('wx-ready');
    }

    const reduced = () => !!(mq && mq.matches);
    const isPlaying = () => document.body.classList.contains('playing-mode');

    // Wallpaper mode (see the top of this file)
    const wallpaper = () => wpFrameMs() > 0;
    const animOff = () => wallpaper() && !!WP.__WP_ON_BATTERY__;
    const precip = () => {
        const wx = S.wx;
        return wx.rain > 0 || wx.snow > 0 || wx.hail > 0 || !!wx.thunder;
    };
    // Something on screen moves every frame (not just the slow sky): precipitation, lightning, a fade
    const moving = () => !animOff() && (precip() || S.fade > 0 || BG.blend > 0);
    const still = () => wallpaper() && !moving();
    // The canvas is low resolution only while precipitation is drawn every frame
    const lowRes = () => wallpaper() && !animOff() && precip();

    function stopTimers() {
        if (S.anim) cancelAnimationFrame(S.anim);
        S.anim = null;
    }

    // One bad frame (e.g. an image half loaded) must neither stop the animation nor reach the page
    // that asked for a redraw (the weather card would not update)
    let fails = 0, retryTimer = null;
    function safeFrame(dt, playing) {
        try {
            frame(dt, playing);
            fails = 0;
        } catch (err) {
            console.warn('Frame failed:', err);
            // A frame that stopped half-way can leave a clip or a transform behind (save() without
            // restore()): the next one starts from clean drawing state. Only the visible canvas
            // keeps a picture, so it is redrawn even while paused.
            const reset = c => {
                const g = c.getContext('2d');
                if (typeof g.reset === 'function') g.reset();
                else c.width = c.width; // eslint-disable-line no-self-assign
            };
            for (const c of [canvas, BG.work, sheetCanvas, lightsBuf]) if (c) reset(c);
            ctx.imageSmoothingEnabled = true;
            if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
            S.blank = true;
            // Try again soon (a still picture is not redrawn until the next minute otherwise),
            // backing off from one second to a minute if it keeps failing
            fails++;
            if (!retryTimer && !S.dead) {
                retryTimer = setTimeout(() => { retryTimer = null; kick(); }, Math.min(60000, 1000 * 2 ** (fails - 1)));
            }
        }
    }

    function loop(now) {
        S.anim = null;
        if (S.dead || !S.enabled) return;
        if (animOff() && S.fade > 0) { // no fades without animation
            S.fade = 0;
            S.prev = null;
        }
        if (wallpaper() && getScale(lowRes()) !== S.scale) resize(true);
        // Paused or hidden: draw nothing more, but never leave a cleared (empty or half) canvas
        if (S.paused || document.hidden) {
            if (S.blank) safeFrame(0, false);
            return;
        }
        if (reduced()) {
            safeFrame(0, false); // one still picture
            return;
        }
        if (still()) {
            // One picture; no time passes, and nothing is scheduled until the page calls again
            safeFrame(0, false);
            // ...unless that picture started a blend (a new minute): animate until it is done
            if (!still()) {
                S.last = now;
                S.anim = requestAnimationFrame(loop);
            }
            return;
        }
        const ms = wpFrameMs() || FRAME_MS;
        const elapsed = now - S.last;
        // Half a display frame of tolerance, and the next frame is due one period after this one
        // was due (not after it was drawn), so the average rate is the rate asked for
        if (elapsed >= ms - 8) {
            S.last = Number.isFinite(elapsed) && elapsed < ms * 2 ? S.last + ms : now;
            safeFrame(Number.isFinite(elapsed) ? Math.min(elapsed, 100) / 1000 : 0, isPlaying());
            if (still()) {
                // The fade just ended: draw the clean, sharp still picture and stop
                loop(now);
                return;
            }
        }
        S.anim = requestAnimationFrame(loop);
    }

    // A change asks for a redraw at the next animation frame (it runs before the next paint, so a
    // cleared canvas is never shown), and changes made together cost one frame: the page sets the
    // layout, the place and the weather in one go at start-up and with every weather update, and
    // each used to rebuild the whole background on its own
    function kick() {
        stopTimers();
        if (S.dead) return;
        S.last = -Infinity; // draw at the next frame
        S.anim = requestAnimationFrame(loop);
    }

    const onResize = () => { resize(false); kick(); };
    resize(false);
    seedClouds();
    window.addEventListener('resize', onResize);
    document.addEventListener('visibilitychange', kick);
    if (mq && mq.addEventListener) mq.addEventListener('change', kick);

    return {
        setWeather(code, isDay, windKmh) {
            // The same weather again (the minute tick): just redraw, keeping the clouds where they are
            const next = wxFor(code, isDay, windKmh);
            if (S.wx && next.key === S.wx.key) {
                kick();
                return;
            }
            // Keep the current picture to fade from, unless nothing has been shown yet
            if (S.drawn && canvas.classList.contains('wx-ready') && !reduced() && !animOff()) {
                const snap = document.createElement('canvas');
                snap.width = S.W; snap.height = S.H;
                snap.getContext('2d').drawImage(canvas, 0, 0);
                S.prev = snap;
                S.fade = 1;
            }
            S.wx = next;
            seedClouds();
            kick();
        },
        // Where the weather city is, its clock and its temperature (null = not known yet)
        setEnv(e) {
            Object.assign(ENV, e);
            kick();
        },
        setEnabled(v) {
            S.enabled = v;
            canvas.style.display = overlay.style.display = v ? 'block' : 'none';
            kick();
        },
        start: kick,
        // Fade the background in (call once the first weather is known, or after a timeout)
        show() { show(); kick(); },
        // Test panel: pin the clock (a Date) or the season, or null to follow the real ones
        setTestClock(date) { TEST.clock = date || null; kick(); },
        setTestSeason(name) { TEST.season = name || null; kick(); },
        // Hide the terrace and town while a holiday scene covers the ground (true = hidden)
        setSceneryHidden(v) { sceneryHidden = !!v; kick(); },
        // Wallpaper: span one scene over several displays, or null for this canvas alone.
        // { view: {x,y,w,h}, desk: {w,h}, scene: {x,y,w,h} } in CSS pixels (see SPAN)
        setLayout(span) {
            SPAN = span || null;
            // The cached background holds this display's place on the desktop and the side glass,
            // neither of which is in its key: rebuild it now, not at the next minute
            BG.key = '';
            resize(false);
            seedClouds();
            kick();
        },
        // Wallpaper: stop drawing and keep the last picture (a window covers the display)
        setPaused(v) {
            S.paused = !!v;
            kick();
        },
        // Stop for good and let another background use the canvases
        dispose() {
            S.dead = true;
            clearTimeout(retryTimer);
            stopTimers();
            window.removeEventListener('resize', onResize);
            document.removeEventListener('visibilitychange', kick);
            if (mq && mq.removeEventListener) mq.removeEventListener('change', kick);
            canvas.style.filter = '';
        }
    };
}
