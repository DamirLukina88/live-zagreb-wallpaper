// src/weather-bg.js — "Film photo" weather background with the Vibrant camera look.
// Ported from the local style studio (studio/weather/, not deployed), where the user chose it.
// A faded 70s photo of rolling hills: warm cast, a slow light leak, grain and a vignette.
// Calm rules: muted veil, dim + quarter speed while playing, a soft glow instead of lightning
// flashes (none while playing), one still frame under prefers-reduced-motion, 30 fps cap.

const FRAME_MS = 1000 / 30;
const SCALE = 0.5; // rendered at half resolution and scaled up, which also softens it
const POOL = { rain: 160, snow: 140, hail: 60 };

// Vibrant look: punchier colour and contrast, applied as a CSS filter plus a light vignette
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

// ------------------------------------------------------------------
// Weather model: every WMO code Open-Meteo returns
// ------------------------------------------------------------------
// Code terminal columns (Hard-tier easter egg)
const GLYPHS = '0123456789ABCDEF+=<>';
function termColumns(W, H, r) {
    const cols = [];
    for (let x = 0; x < W; x += 14) {
        cols.push({ x, y: r() * H, v: 8 + r() * 14, n: 5 + Math.floor(r() * 9), on: r(),
            chars: Array.from({ length: 14 }, () => GLYPHS[Math.floor(r() * GLYPHS.length)]) });
    }
    return cols;
}

const MODEL = {
    0: { cloud: 0 }, 1: { cloud: 0.25 }, 2: { cloud: 0.55 }, 3: { cloud: 1 },
    45: { cloud: 0.8, fog: 0.85 }, 48: { cloud: 0.8, fog: 0.85, rime: true },
    51: { rain: 0.3, drizzle: true }, 53: { rain: 0.5, drizzle: true }, 55: { rain: 0.75, drizzle: true },
    56: { rain: 0.35, drizzle: true, freezing: true }, 57: { rain: 0.7, drizzle: true, freezing: true },
    61: { rain: 0.35 }, 63: { rain: 0.6 }, 65: { rain: 1 },
    66: { rain: 0.45, freezing: true }, 67: { rain: 0.85, freezing: true },
    71: { snow: 0.3 }, 73: { snow: 0.6 }, 75: { snow: 1 }, 77: { snow: 0.5, grains: true },
    80: { rain: 0.4, showers: true }, 81: { rain: 0.7, showers: true }, 82: { rain: 1, showers: true },
    85: { snow: 0.45, showers: true }, 86: { snow: 0.9, showers: true },
    17: { rain: 0, thunder: true, dark: 0.6, cloud: 0.85 },
    95: { rain: 0.75, thunder: true }, 96: { rain: 0.6, hail: 0.35, thunder: true },
    99: { rain: 0.7, hail: 0.8, thunder: true }
};

// windKmh: Open-Meteo windspeed; 50 km/h and above counts as strong
// (shared with zagreb-bg.js, so both backgrounds read the weather the same way)
export function codeToWx(code, isDay, windKmh) {
    const wx = Object.assign({
        code, night: !isDay, wind: clamp((windKmh || 0) / 50), cloud: 0, rain: 0, snow: 0, hail: 0, fog: 0,
        drizzle: false, grains: false, freezing: false, showers: false, thunder: false, rime: false
    }, MODEL[code] || MODEL[0]);
    if (wx.rain || wx.snow) wx.cloud = Math.max(wx.cloud, wx.showers ? 0.7 : 0.95);
    if (wx.thunder) wx.cloud = 1;
    wx.dark = wx.thunder ? 1 : clamp(
        (wx.rain ? 0.25 + wx.rain * 0.75 : 0) * (wx.drizzle ? 0.7 : 1) +
        wx.snow * 0.35 + (wx.cloud > 0.9 ? 0.15 : 0));
    // How white the ground is: lying snow, rime frost, or a glaze of ice
    wx.snowCover = wx.snow ? clamp(0.4 + wx.snow * 0.6) : wx.rime ? 0.6 : wx.freezing ? 0.3 : 0;
    return wx;
}

// ------------------------------------------------------------------
// Film photo palette, blended for the weather
// ------------------------------------------------------------------
const FILM = {
    // sky top, sky bottom, far hills, near hills, trees, sun, cloud
    day: ['#7aa3b8', '#e6d3b0', '#93a58a', '#6f8462', '#4c5c43', '#f6e2b0', '#f1ebe0'],
    night: ['#1c2433', '#3d3a44', '#2c3236', '#22282a', '#171c1c', '#e8e0c8', '#4a4a52'],
    overcast: ['#9aa3a6', '#cfc8ba', '#8e968a', '#727b6d', '#555d50', '#e6dcc4', '#d6d2ca'],
    storm: ['#4f5559', '#76736c', '#5b6058', '#474c44', '#343830', '#b8b0a0', '#8a8781']
};
function tone(wx) {
    const base = wx.night ? FILM.night : FILM.day;
    const grey = wx.night ? FILM.night.map(c => mix(c, '#15181d', 0.45)) : FILM.overcast;
    const k = clamp((wx.cloud - 0.35) / 0.65) * 0.9;
    let out = base.map((c, i) => mix(c, grey[i], k));
    if (wx.dark > 0.45) {
        const storm = wx.night ? FILM.storm.map(c => mix(c, '#0b0d10', 0.5)) : FILM.storm;
        out = out.map((c, i) => mix(c, storm[i], (wx.dark - 0.45) * 1.8));
    }
    if (wx.fog > 0) out = out.map(c => mix(c, grey[1], wx.fog * 0.45));
    return out;
}

const PAL = {
    rain: 'rgba(220,215,200,0.35)', ice: 'rgba(228,242,255,0.6)', snow: 'rgba(250,246,238,0.75)',
    hail: 'rgba(232,240,250,0.85)', fog: '#d8d2c6', glow: '#f0e6d0', veil: '#23272d'
};

// Ridge line: deterministic sum of sines, one y per `step` pixels
function ridge(r, W, base, amp, step, roughness = 1) {
    const a = [r() * 6.28, r() * 6.28, r() * 6.28];
    const fq = [(1.5 + r()) / W, (4 + r() * 2) / W * roughness, (11 + r() * 5) / W * roughness];
    const ys = [];
    for (let x = 0; x <= W + step; x += step) {
        ys.push(base - (Math.sin(x * fq[0] * 6.28 + a[0]) * 0.55 +
            Math.sin(x * fq[1] * 6.28 + a[1]) * 0.3 +
            Math.sin(x * fq[2] * 6.28 + a[2]) * 0.15) * amp);
    }
    return ys;
}
function fillRidge(ctx, ys, step, H) {
    ctx.beginPath();
    ctx.moveTo(0, H);
    ys.forEach((y, i) => ctx.lineTo(i * step, y));
    ctx.lineTo((ys.length - 1) * step, H);
    ctx.closePath();
    ctx.fill();
}
function glowAt(ctx, x, y, r, stops) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    stops.forEach(([at, col]) => g.addColorStop(at, col));
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ------------------------------------------------------------------
// Background engine
// ------------------------------------------------------------------
// opts.style 'terminal': the Code terminal look (sparse green hex code), used by the Hard-tier
// easter egg (src/hard-reveal.js). It shares the weather model, precipitation and calm rules.
export function createWeatherBackground(canvas, overlay, opts = {}) {
    const TERM = opts.style === 'terminal';
    const ctx = canvas.getContext('2d');
    const octx = overlay.getContext('2d');
    const mq = typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
    const S = {
        wx: codeToWx(0, true, 0), enabled: true, t: 0, last: 0, anim: null, W: 1, H: 1,
        scene: null, clouds: [], pools: { rain: [], snow: [], hail: [] }, L: { a: 0, x: 0.5, next: 3 },
        drawn: false, shown: false, prev: null, fade: 0
    };
    canvas.style.filter = TERM ? '' : LOOK_CSS;

    function resize() {
        S.W = Math.max(1, Math.round(window.innerWidth * SCALE));
        S.H = Math.max(1, Math.round(window.innerHeight * SCALE));
        canvas.width = S.W;
        canvas.height = S.H;
        canvas.style.imageRendering = 'auto';
        S.prev = null; // a snapshot of the old size cannot be blended
        S.fade = 0;
        const r = rng(1234);
        const trees = [];
        for (let i = 0; i < 9; i++) trees.push({ x: r() * S.W, r: S.H * (0.03 + r() * 0.03) });
        S.scene = { far: ridge(r, S.W, S.H * 0.66, S.H * 0.05, 8), near: ridge(r, S.W, S.H * 0.78, S.H * 0.04, 8, 1.3), trees };
        if (TERM) S.cols = termColumns(S.W, S.H, rng(1234));
        drawOverlay();
        const p = rng(42);
        for (const k of Object.keys(POOL)) {
            S.pools[k] = [];
            for (let i = 0; i < POOL[k]; i++) S.pools[k].push({ x: p() * S.W * 1.3, y: p() * S.H, z: 0.4 + p() * 0.6, s: p(), dx: 0, dy: 0, r: 1 });
        }
    }

    // Grain and vignette, drawn once per resize at full resolution
    function drawOverlay() {
        const W = overlay.width = window.innerWidth;
        const H = overlay.height = window.innerHeight;
        octx.clearRect(0, 0, W, H);
        if (TERM) {
            // CRT scanlines and a dark vignette
            octx.fillStyle = 'rgba(0,0,0,0.18)';
            for (let y = 0; y < H; y += 3) octx.fillRect(0, y, W, 1);
            const v = octx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
            v.addColorStop(0, 'rgba(0,0,0,0)');
            v.addColorStop(1, 'rgba(0,0,0,0.45)');
            octx.fillStyle = v;
            octx.fillRect(0, 0, W, H);
            return;
        }
        const tile = document.createElement('canvas');
        tile.width = tile.height = 192;
        const tg = tile.getContext('2d');
        const img = tg.createImageData(192, 192);
        const r = rng(5);
        for (let i = 0; i < img.data.length; i += 4) {
            img.data[i] = img.data[i + 1] = img.data[i + 2] = r() * 255;
            img.data[i + 3] = 255 * 0.06;
        }
        tg.putImageData(img, 0, 0);
        octx.fillStyle = octx.createPattern(tile, 'repeat');
        octx.fillRect(0, 0, W, H);
        const g = octx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
        g.addColorStop(0, 'rgba(42,26,16,0)');
        g.addColorStop(1, 'rgba(42,26,16,0.4)');
        octx.fillStyle = g;
        octx.fillRect(0, 0, W, H);
    }

    function seedClouds() {
        const r = rng(7);
        const n = S.wx.cloud < 0.05 ? 0 : Math.round(3 + S.wx.cloud * 9);
        S.clouds = [];
        for (let i = 0; i < n; i++) S.clouds.push({ x: r() * 1.5 - 0.25, y: 0.05 + r() * 0.33, s: 0.7 + r() * 0.7, d: 0.45 + r() * 0.55 });
        S.clouds.sort((a, b) => a.d - b.d);
    }

    function stepPrecip(dt, t) {
        const { W, H, wx } = S;
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
            const slant = 0.06 + wx.wind * 0.4;
            p.x -= vy * slant * dt;
            p.y += vy * dt;
            wrap(p);
            const len = H * (wx.drizzle ? 0.012 : 0.03) * p.z;
            p.dx = -len * slant;
            p.dy = len;
            out.rain.push(p);
        }
        n = Math.round(POOL.snow * wx.snow * mod);
        for (let i = 0; i < n; i++) {
            const p = S.pools.snow[i];
            p.x += (-H * 0.012 * (1 + wx.wind * 5) + Math.sin(t * 0.9 + p.s * 20) * H * 0.01) * dt;
            p.y += H * (wx.grains ? 0.2 : 0.065) * (0.5 + 0.5 * p.z) * dt;
            wrap(p);
            p.r = (wx.grains ? 0.5 : 1) * (0.7 + p.z * 1.3) * unit;
            out.snow.push(p);
        }
        n = Math.round(POOL.hail * wx.hail);
        for (let i = 0; i < n; i++) {
            const p = S.pools.hail[i];
            const vy = H * 1.25 * (0.7 + 0.3 * p.z);
            p.x -= vy * (0.04 + wx.wind * 0.3) * dt;
            p.y += vy * dt;
            wrap(p);
            p.r = (0.7 + p.z * 0.8) * unit;
            out.hail.push(p);
        }
        return out;
    }

    function dots(list, color) {
        if (!list.length) return;
        ctx.fillStyle = color;
        ctx.beginPath();
        for (const p of list) {
            ctx.moveTo(p.x + p.r, p.y);
            ctx.arc(p.x, p.y, p.r, 0, 6.2832);
        }
        ctx.fill();
    }

    function frame(dtReal, playing) {
        if (TERM) { frameTerminal(dtReal, playing); finish(dtReal); return; }
        const { W, H, wx, scene } = S;
        const dt = dtReal * (playing ? 0.25 : 1);
        S.t += dt;
        const t = S.t;
        const c = tone(wx);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;

        // Sky
        const sky = ctx.createLinearGradient(0, 0, 0, H * 0.75);
        sky.addColorStop(0, c[0]);
        sky.addColorStop(1, c[1]);
        ctx.fillStyle = sky;
        ctx.fillRect(0, 0, W, H);

        // Sun or moon (left of the top-right corner, where the HUD sits), fading behind cloud and fog
        const vis = (1 - clamp((wx.cloud - 0.4) / 0.5)) * (1 - wx.fog * 0.6);
        if (vis > 0.02) {
            const x = W * 0.68, y = H * 0.24, r = Math.min(W, H) * 0.055;
            ctx.globalAlpha = vis;
            if (wx.night) glowAt(ctx, x, y, r * 2.5, [[0, 'rgba(240,232,210,0.8)'], [0.3, 'rgba(240,232,210,0.2)'], [1, 'rgba(240,232,210,0)']]);
            else glowAt(ctx, x, y, r * 4, [[0, 'rgba(255,240,205,0.85)'], [0.25, 'rgba(255,228,180,0.35)'], [1, 'rgba(255,228,180,0)']]);
            ctx.globalAlpha = 1;
        }

        // Soft cloud puffs drifting with the wind
        const base = Math.min(W * 0.16, H * 0.3);
        ctx.fillStyle = rgba(c[6], 0.35);
        ctx.beginPath();
        for (const cl of S.clouds) {
            cl.x += dt * (0.006 + wx.wind * 0.03) * cl.d;
            if (cl.x > 1.3) cl.x = -0.3;
            const px = cl.x * W, py = cl.y * H, size = cl.s * base * (0.6 + 0.4 * cl.d);
            for (const [dx, dy, rr] of [[-0.3, 0.05, 0.22], [0, -0.06, 0.3], [0.3, 0.04, 0.2], [0.1, 0.1, 0.25]]) {
                ctx.moveTo(px + dx * size + rr * size, py + dy * size);
                ctx.arc(px + dx * size, py + dy * size, rr * size, 0, 6.2832);
            }
        }
        ctx.fill();

        // Hills, with tree clumps on the far ridge whose bases the near hill hides
        const snow = col => mix(col, '#e9e6df', wx.snowCover * 0.75);
        ctx.fillStyle = snow(c[2]);
        fillRidge(ctx, scene.far, 8, H);
        ctx.fillStyle = mix(c[4], c[2], 0.25);
        ctx.beginPath();
        for (const tr of scene.trees) {
            const y = scene.far[Math.min(scene.far.length - 1, Math.round(tr.x / 8))];
            for (const [dx, dy, k] of [[-0.8, 0.3, 0.7], [0, 0, 1], [0.8, 0.35, 0.65]]) {
                const x = tr.x + dx * tr.r, cy = y - tr.r * 0.5 + dy * tr.r, r = tr.r * k;
                ctx.moveTo(x + r, cy);
                ctx.arc(x, cy, r, 0, 6.2832);
            }
        }
        ctx.fill();
        ctx.fillStyle = snow(c[3]);
        fillRidge(ctx, scene.near, 8, H);

        // Rain, snow and hail
        const pr = stepPrecip(dt, t);
        if (pr.rain.length) {
            ctx.strokeStyle = wx.freezing ? PAL.ice : PAL.rain;
            ctx.lineWidth = wx.drizzle ? 0.8 : 1;
            ctx.beginPath();
            for (const p of pr.rain) {
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x + p.dx, p.y + p.dy);
            }
            ctx.stroke();
        }
        dots(pr.snow, PAL.snow);
        dots(pr.hail, PAL.hail);

        // Fog bands
        if (wx.fog > 0) {
            ctx.fillStyle = rgba(PAL.fog, wx.fog * 0.16);
            ctx.fillRect(0, 0, W, H);
            for (let i = 0; i < 3; i++) {
                const y = H * (0.42 + i * 0.17) + Math.sin(t * 0.05 + i * 2) * H * 0.02;
                const g = ctx.createLinearGradient(0, y - H * 0.16, 0, y + H * 0.16);
                g.addColorStop(0, rgba(PAL.fog, 0));
                g.addColorStop(0.5, rgba(PAL.fog, wx.fog * 0.3));
                g.addColorStop(1, rgba(PAL.fog, 0));
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
            if (L.a > 0.004) glowAt(ctx, L.x * W, H * 0.16, Math.max(W, H) * 0.5, [[0, rgba(PAL.glow, L.a)], [1, rgba(PAL.glow, 0)]]);
        }

        // Film: warm cast and a slow light leak in one corner
        ctx.fillStyle = 'rgba(255,190,140,0.07)';
        ctx.fillRect(0, 0, W, H);
        const leak = 0.16 + Math.sin(t * 0.15) * 0.03;
        const lg = ctx.createRadialGradient(0, 0, 0, 0, 0, Math.max(W, H) * 0.6);
        lg.addColorStop(0, `rgba(240,120,60,${leak})`);
        lg.addColorStop(1, 'rgba(240,120,60,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, W, H);

        // Vibrant look vignette
        const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.hypot(W, H) * 0.55);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(1, `rgba(0,0,0,${LOOK_VIGNETTE})`);
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, W, H);

        // Calm veil: mute the scene, more while the snake is moving
        ctx.fillStyle = rgba(PAL.veil, playing ? 0.42 : 0.1);
        ctx.fillRect(0, 0, W, H);

        finish(dtReal);
    }

    // Shared end of every frame: the cross-fade from the last weather, then fade the canvas in
    function finish(dtReal) {
        // A weather change cross-fades from the last picture instead of cutting
        if (S.prev && S.fade > 0) {
            ctx.globalAlpha = S.fade;
            ctx.drawImage(S.prev, 0, 0);
            ctx.globalAlpha = 1;
            S.fade -= dtReal / 1.2;
            if (S.fade <= 0) S.prev = null;
        }
        S.drawn = true;
        if (S.shown) show();
    }

    // The Code terminal look: sparse, slow columns of dim hex code; weather arrives as characters
    function frameTerminal(dtReal, playing) {
        const { W, H, wx } = S;
        const dt = dtReal * (playing ? 0.25 : 1);
        S.t += dt;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.fillStyle = wx.night ? '#030604' : '#06100a';
        ctx.fillRect(0, 0, W, H);
        // more columns under heavier cloud, dimmer at night
        const share = 0.25 + wx.cloud * 0.4, base = wx.night ? 0.16 : 0.22;
        ctx.font = '11px monospace';
        for (const c of S.cols) {
            if (c.on > share) continue;
            c.y += c.v * dt;
            if (c.y - c.n * 13 > H) c.y = -10;
            if (Math.random() < 0.01) c.chars[Math.floor(Math.random() * c.chars.length)] = GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
            for (let i = 0; i < c.n; i++) {
                const y = c.y - i * 13;
                if (y < 0 || y > H + 12) continue;
                ctx.fillStyle = `rgba(95, 211, 138, ${i === 0 ? base * 1.8 : base * (1 - i / c.n)})`;
                ctx.fillText(c.chars[i], c.x, y);
            }
        }
        const vis = (1 - clamp((wx.cloud - 0.4) / 0.5)) * (1 - wx.fog * 0.6);
        if (vis > 0.02) {
            const x = W * 0.68, y = H * 0.24, r = Math.min(W, H) * 0.055;
            ctx.globalAlpha = vis;
            ctx.font = '10px monospace';
            ctx.fillStyle = 'rgba(95,211,138,0.4)';
            if (wx.night) ctx.fillText('( MOON', x - 18, y + 4);
            else {
                ctx.strokeStyle = 'rgba(95,211,138,0.35)';
                ctx.strokeRect(x - r, y - r, r * 2, r * 2);
                ctx.fillText('SUN', x - 9, y + 4);
            }
            ctx.globalAlpha = 1;
        }
        const pr = stepPrecip(dt, S.t);
        ctx.font = '10px monospace';
        ctx.fillStyle = wx.freezing ? 'rgba(170,230,210,0.45)' : 'rgba(95,211,138,0.4)';
        for (const p of pr.rain) ctx.fillText(wx.drizzle ? '.' : '|', p.x, p.y);
        ctx.fillStyle = 'rgba(190,240,205,0.55)';
        for (const p of pr.snow) ctx.fillText(wx.grains ? '.' : '*', p.x, p.y);
        ctx.fillStyle = 'rgba(190,240,205,0.6)';
        for (const p of pr.hail) ctx.fillText('o', p.x, p.y);
        if (wx.fog > 0) {
            ctx.fillStyle = `rgba(6, 16, 10, ${wx.fog * 0.45})`;
            ctx.fillRect(0, 0, W, H);
        }
        // a soft green glow for thunder, never a flash, none while playing
        if (wx.thunder) {
            const L = S.L;
            if (playing) L.a = 0;
            else {
                L.next -= dtReal;
                if (L.next <= 0) { L.a = 0.22; L.x = 0.2 + Math.random() * 0.6; L.next = 7 + Math.random() * 8; }
                L.a *= Math.pow(0.03, dtReal);
            }
            if (L.a > 0.004) glowAt(ctx, L.x * W, H * 0.16, Math.max(W, H) * 0.5, [[0, `rgba(95,211,138,${L.a})`], [1, 'rgba(95,211,138,0)']]);
        }
        ctx.fillStyle = `rgba(0,0,0,${playing ? 0.35 : 0})`;
        ctx.fillRect(0, 0, W, H);
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

    function loop(now) {
        S.anim = null;
        if (!S.enabled || document.hidden) return;
        if (reduced()) {
            frame(0, false); // one still picture
            return;
        }
        S.anim = requestAnimationFrame(loop);
        const elapsed = now - S.last;
        if (elapsed < FRAME_MS - 1) return;
        S.last = now;
        frame(Math.min(elapsed, 100) / 1000, isPlaying());
    }

    function kick() {
        if (S.anim) cancelAnimationFrame(S.anim);
        S.anim = null;
        const now = performance.now();
        S.last = now - FRAME_MS;
        loop(now);
    }

    resize();
    seedClouds();
    window.addEventListener('resize', () => { resize(); kick(); });
    document.addEventListener('visibilitychange', kick);
    if (mq && mq.addEventListener) mq.addEventListener('change', kick);

    return {
        setWeather(code, isDay, windKmh) {
            // Keep the current picture to fade from, unless nothing has been shown yet
            if (S.drawn && canvas.classList.contains('wx-ready') && !reduced()) {
                const snap = document.createElement('canvas');
                snap.width = S.W; snap.height = S.H;
                snap.getContext('2d').drawImage(canvas, 0, 0);
                S.prev = snap;
                S.fade = 1;
            }
            S.wx = codeToWx(code, isDay, windKmh);
            seedClouds();
            kick();
        },
        setEnabled(v) {
            S.enabled = v;
            canvas.style.display = overlay.style.display = v ? 'block' : 'none';
            kick();
        },
        start: kick,
        // Fade the background in (call once the first weather is known, or after a timeout)
        show() { show(); kick(); }
    };
}
