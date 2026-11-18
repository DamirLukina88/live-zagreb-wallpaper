// tools/bench.mjs — frame-rate and draw-cost benchmark for every weather type.
//
//   npm run bench                     default matrix (about 100 cases)
//   npm run bench -- --ci             small subset, frame-count assertions only
//   npm run bench -- --full           every code x day/night x layout x size
//   npm run bench -- --compare bench/baseline.json   fail on a >25 % draw-time regression
//   npm run bench -- --save-baseline  write bench/baseline.json
//   npm run bench -- --gpu --port 9333   real GPU load on a running Plasma desktop (see README)
//
// Drives a headless Chromium over the DevTools protocol. The page counts its own frames through
// globalThis.__WP_STATS__ (src/game/zagreb-bg.js). Weather is pinned with the #wx= test override and
// the Open-Meteo API is blocked, so every case is repeatable.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, serve, launch, sleep, clearOfMinute } from './cdp.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const OUT = path.join(ROOT, 'bench');
const args = process.argv.slice(2);
const flag = n => args.includes(`--${n}`);
const opt = (n, d) => (args.includes(`--${n}`) ? args[args.indexOf(`--${n}`) + 1] : d);

// Every WMO code the weather model knows (src/game/weather-bg.js MODEL)
const CODES = [0, 1, 2, 3, 45, 48, 51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 71, 73, 75, 77, 80, 81, 82, 85, 86, 17, 95, 96, 99];
const NAMES = {
    0: 'clear', 1: 'mainly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'rime fog',
    51: 'light drizzle', 53: 'drizzle', 55: 'dense drizzle', 56: 'freezing drizzle', 57: 'dense freezing drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
    71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains',
    80: 'light showers', 81: 'showers', 82: 'violent showers', 85: 'snow showers', 86: 'heavy snow showers',
    17: 'dry thunderstorm', 95: 'thunderstorm', 96: 'thunderstorm + hail', 99: 'thunderstorm + heavy hail'
};
const CALM = new Set([0, 1, 2, 3, 45, 48]);
const SUBSET = [0, 3, 45, 63, 75, 95, 99];
const FPS = 15;
const SETTLE_MS = Number(opt('settle', 3500));
const MEASURE_MS = Number(opt('measure', 4000));
const CLOCK = { day: '2026-06-15T12:00:00', night: '2026-06-15T23:30:00' };
const SIZES = { fhd: [1920, 1080, 1], uhd: [2259, 1271, 1.7] }; // uhd: a 4K panel at 170 % scaling
// Span geometry of a laptop (scene) beside a scaled 4K monitor, as KDE sends it
const SPAN = {
    scene: 'layout=span&view=0,0,1920,1080&desk=4179,1271&scene=0,0,1920,1080',
    side: 'layout=span&view=1920,0,2259,1271&desk=4179,1271&scene=0,0,1920,1080'
};

function cases() {
    const list = [];
    const add = (code, time, layout, size, power) => list.push({ code, time, layout, size, power });
    if (flag('glass')) { // the frosted side display only
        for (const c of SUBSET) add(c, 'day', 'side', 'uhd', 'ac');
        return list;
    }
    if (flag('ci')) {
        for (const c of [0, 3, 45, 63, 75, 95]) add(c, 'day', 'clone', 'fhd', 'ac');
        for (const c of [0, 63, 95]) add(c, 'day', 'clone', 'fhd', 'battery');
        return list;
    }
    if (flag('full')) {
        for (const c of CODES) for (const t of ['day', 'night']) for (const l of ['clone', 'scene', 'side']) {
            for (const s of ['fhd', 'uhd']) add(c, t, l, l === 'side' ? 'uhd' : s, 'ac');
        }
    } else {
        for (const c of CODES) for (const t of ['day', 'night']) add(c, t, 'clone', 'fhd', 'ac');
        for (const c of SUBSET) {
            add(c, 'day', 'scene', 'fhd', 'ac');
            add(c, 'day', 'side', 'uhd', 'ac');
            add(c, 'day', 'clone', 'uhd', 'ac');
        }
    }
    for (const c of CODES) add(c, 'day', 'clone', 'fhd', 'battery');
    const seen = new Set();
    return list.filter(k => { const id = caseId(k); if (seen.has(id)) return false; seen.add(id); return true; });
}
const caseId = k => `${k.code}/${k.time}/${k.layout}/${k.size}/${k.power}`;
function hashOf(k) {
    const layout = k.layout === 'clone' ? 'layout=clone' : SPAN[k.layout];
    return `#city=Zagreb&lang=hr&fps=${FPS}&wx=${k.code}&clock=${CLOCK[k.time]}&power=${k.power}&${layout}`;
}

async function runCase(port, base, k) {
    const [w, h, dpr] = SIZES[k.size];
    const t = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const page = await connect(t.webSocketDebuggerUrl);
    try {
        await page.send('Runtime.enable');
        await page.send('Page.enable');
        await page.send('Network.enable');
        await page.send('Performance.enable');
        await page.send('Network.setBlockedURLs', { urls: ['*open-meteo.com*'] });
        await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
        await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.__WP_STATS__ = { frames: 0, ms: 0, max: 0 };' });
        await clearOfMinute(SETTLE_MS + MEASURE_MS + 2000); // no minute blend inside the measurement
        await page.send('Page.navigate', { url: base + hashOf(k) });
        await sleep(SETTLE_MS);
        const metrics = async () => Object.fromEntries((await page.send('Performance.getMetrics')).result.metrics.map(m => [m.name, m.value]));
        const drawnBefore = await page.evaluate('__WP_STATS__.frames');
        await page.evaluate('Object.assign(__WP_STATS__, { frames: 0, ms: 0, max: 0 }); 1');
        const a = await metrics();
        await sleep(MEASURE_MS);
        const b = await metrics();
        const st = await page.evaluate('JSON.stringify(__WP_STATS__)').then(JSON.parse);
        if (flag('debug')) console.log(await page.evaluate(`new Promise(r=>{const g=[];let l=performance.now();(function f(t){g.push(Math.round(t-l));l=t;g.length<30?requestAnimationFrame(f):r('rAF gaps: '+g.join(' '))})(l)})`));
        const secs = MEASURE_MS / 1000;
        return {
            ...k, name: NAMES[k.code],
            fps: +(st.frames / secs).toFixed(2),
            drawMs: st.frames ? +(st.ms / st.frames).toFixed(2) : 0,
            maxMs: +(st.max || 0).toFixed(2),
            busy: +(((b.TaskDuration - a.TaskDuration) / secs) * 100).toFixed(1),
            canvas: st.w ? `${st.w}x${st.h}` : '-',
            drewFirst: drawnBefore > 0,
            errors: page.errors.slice(0, 3)
        };
    } finally {
        page.close();
        await fetch(`http://127.0.0.1:${port}/json/close/${t.id}`).catch(() => {});
    }
}

// What each case must do: calm weather and battery power are still, the rest animates at FPS
function check(r) {
    const problems = [];
    if (r.errors.length) problems.push(`script error: ${r.errors[0]}`);
    if (!r.drewFirst) problems.push('never drew a picture');
    const still = CALM.has(r.code) || r.power === 'battery';
    if (still && r.fps > 0.3) problems.push(`should be still, drew ${r.fps} frames/s`);
    // Headless Chromium renders in software and cannot always present FPS frames a second, so an
    // animated case must clearly animate and must never draw more than was asked for
    if (!still && (r.fps < 5 || r.fps > FPS + 1.5)) problems.push(`should animate at up to ${FPS} fps, drew ${r.fps}`);
    return problems;
}

function table(rows) {
    const head = '| Code | Weather | Time | Layout | Size | Power | Frames/s | Draw ms | Worst ms | Main thread | Canvas | Result |\n|---|---|---|---|---|---|---|---|---|---|---|---|';
    return [head, ...rows.map(r => `| ${r.code} | ${r.name} | ${r.time} | ${r.layout} | ${r.size} | ${r.power} | ${r.fps} | ${r.drawMs} | ${r.maxMs} | ${r.busy} % | ${r.canvas} | ${r.problems.length ? 'FAIL: ' + r.problems.join('; ') : 'ok'} |`)].join('\n');
}

// ------------------------------------------------------------------
// --gpu: real GPU load on a running Plasma desktop (local only)
// ------------------------------------------------------------------
// Start plasmashell with QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:<port>; every wallpaper page is then
// driven through its #wx= override while the GPU's busy percentage is sampled, with a paused
// baseline before each case (other programs use the GPU too).
async function gpuBench() {
    const port = Number(opt('port', 9333));
    const busyFile = fs.readdirSync('/sys/class/drm').map(d => `/sys/class/drm/${d}/device/gpu_busy_percent`).find(f => fs.existsSync(f));
    if (!busyFile) throw new Error('No gpu_busy_percent (AMD only)');
    const sample = async ms => { let t = 0, n = 0; for (const end = Date.now() + ms; Date.now() < end; n++) { t += Number(fs.readFileSync(busyFile, 'utf8')); await sleep(250); } return Math.round(t / n); };
    const pages = async () => (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).filter(p => p.type === 'page');
    const all = async fn => { for (const p of await pages()) { const c = await connect(p.webSocketDebuggerUrl); try { await fn(c, p); } finally { c.close(); } } };
    const codes = flag('full') ? CODES : SUBSET;
    const rows = [];
    const clean = url => url.replace(/&wx=\d+/, '').replace(/&power=\w+/, '');
    for (const code of codes) {
        // A change of the address fragment alone does not reload the page, so reload explicitly
        await all(async (c, p) => { await c.send('Page.navigate', { url: clean(p.url) + `&wx=${code}&power=ac` }); await c.send('Page.reload', { ignoreCache: true }); });
        await sleep(5000);
        await all(c => c.evaluate('wallpaperPaused(true); 1'));
        await sleep(1500);
        const base = await sample(3000);
        await all(c => c.evaluate('wallpaperPaused(false); 1'));
        await sleep(1500);
        await all(c => c.evaluate('globalThis.__WP_STATS__ = { frames: 0 }; 1'));
        const load = await sample(4000);
        const fps = [];
        await all(async c => fps.push(((await c.evaluate('__WP_STATS__.frames')) / 4).toFixed(1)));
        rows.push({ code, name: NAMES[code], base, load, fps: fps.join(' / ') });
        console.log(`${String(code).padStart(2)} ${NAMES[code].padEnd(26)} paused ${base} %  running ${load} %  (+${load - base})  frames/s per display ${fps.join(' / ')}`);
    }
    await all(async (c, p) => { await c.send('Page.navigate', { url: clean(p.url) }); await c.send('Page.reload', { ignoreCache: true }); });
    fs.mkdirSync(OUT, { recursive: true });
    fs.writeFileSync(path.join(OUT, 'gpu-latest.md'), '| Code | Weather | GPU paused | GPU running | Added | Frames/s per display |\n|---|---|---|---|---|---|\n' +
        rows.map(r => `| ${r.code} | ${r.name} | ${r.base} % | ${r.load} % | ${r.load - r.base} | ${r.fps} |`).join('\n') + '\n');
}

async function main() {
    if (flag('gpu')) return gpuBench();
    if (!fs.existsSync(path.join(WEB, 'app.js'))) throw new Error('web/app.js is missing: run "npm run build" first');
    const server = await serve(WEB);
    const base = `http://127.0.0.1:${server.address().port}/index.html`;
    const browser = await launch();
    const list = cases();
    const jobs = Number(opt('jobs', 1)); // headless Chromium animates only one page at a time
    const rows = new Array(list.length);
    let next = 0;
    try {
        await Promise.all(Array.from({ length: jobs }, async () => {
            for (let i = next++; i < list.length; i = next++) {
                const r = await runCase(browser.port, base, list[i]);
                r.problems = check(r);
                rows[i] = r;
                process.stdout.write(`${r.problems.length ? 'FAIL' : ' ok '} ${caseId(r).padEnd(28)} ${String(r.fps).padStart(5)} fps  ${String(r.drawMs).padStart(6)} ms  ${String(r.busy).padStart(5)} % busy  ${r.canvas}${r.problems.length ? '  ' + r.problems.join('; ') : ''}\n`);
            }
        }));
    } finally {
        browser.stop();
        server.close();
    }
    let failed = rows.filter(r => r.problems.length).length;

    // Draw time against the committed baseline (same machine class only: skipped in --ci)
    const cmp = opt('compare', null);
    if (cmp && !flag('ci') && fs.existsSync(cmp)) {
        const old = new Map(JSON.parse(fs.readFileSync(cmp, 'utf8')).rows.map(r => [caseId(r), r]));
        for (const r of rows) {
            const o = old.get(caseId(r));
            if (o && o.drawMs > 0 && r.drawMs > o.drawMs * 1.25 + 2) {
                r.problems.push(`draw time ${r.drawMs} ms, baseline ${o.drawMs} ms`);
                failed++;
            }
        }
    }
    fs.mkdirSync(OUT, { recursive: true });
    const meta = { date: new Date().toISOString(), fps: FPS, jobs, cases: rows.length, failed };
    if (!flag('ci') && !flag('glass')) {
        fs.writeFileSync(path.join(OUT, 'latest.json'), JSON.stringify({ meta, rows }, null, 1));
        fs.writeFileSync(path.join(OUT, 'latest.md'), `# Benchmark\n\n${meta.date} · ${rows.length} cases · ${failed} failed · headless Chromium, ${jobs} pages at a time\n\n${table(rows)}\n`);
        if (flag('save-baseline')) fs.writeFileSync(path.join(OUT, 'baseline.json'), JSON.stringify({ meta, rows }, null, 1));
    }
    console.log(`\n${rows.length} cases, ${failed} failed`);
    process.exit(failed ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
