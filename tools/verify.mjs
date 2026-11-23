// tools/verify.mjs — checks before a deploy: package manifests, versions, QML, the built page's
// security policy, and a render matrix in headless Chromium (no script errors, a real picture,
// the weather card, the update notice). Screenshots go to bench/shots/.
//
//   npm run verify          (after npm run build)
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { connect, serve, launch, sleep, clearOfMinute } from './cdp.mjs';
import { MIN_HOST, hostOutdated } from '../src/wallpaper/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB = path.join(ROOT, 'web');
const SHOTS = path.join(ROOT, 'bench/shots');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const json = f => JSON.parse(read(f));

let failures = 0;
// On GitHub the reason also becomes an annotation, readable on the run page without the log
const fail = msg => { failures++; console.error(`  FAIL ${msg}`); if (process.env.GITHUB_ACTIONS) console.log(`::error title=verify::${String(msg).replace(/\r?\n/g, " ")}`); };
const ok = (cond, msg) => { if (!cond) fail(msg); };

// ------------------------------------------------------------------
console.log('1/4 manifests and versions');
const version = json('package.json').version;
const meta = json('kde/skill-issue-wallpaper/metadata.json');
ok(meta.KPackageStructure === 'Plasma/Wallpaper', 'metadata.json: KPackageStructure must be Plasma/Wallpaper');
ok(meta.KPlugin?.Id === 'hr.tsrb.skillissue.wallpaper', 'metadata.json: unexpected plugin Id');
ok(meta.KPlugin?.Version === version, `metadata.json Version ${meta.KPlugin?.Version} != package.json ${version}`);
const qml = read('kde/skill-issue-wallpaper/contents/ui/main.qml');
ok(qml.includes(`hostVersion: "${version}"`), `main.qml hostVersion is not "${version}"`);
const info = json('src/wallpaper/lively/LivelyInfo.json');
ok(info.Type === 3, 'LivelyInfo.json: Type must be 3 (url)');
ok(info.FileName === `https://damirlukina88.github.io/live-zagreb-wallpaper/#host=lively-${version}`, `LivelyInfo.json FileName must end in #host=lively-${version}`);
const props = json('src/wallpaper/lively/LivelyProperties.json');
for (const k of ['city', 'lang', 'quality', 'animBattery', 'fps', 'layout', 'spanDisplays', 'sceneDisplay']) ok(props[k], `LivelyProperties.json: missing "${k}"`);
const settingsJs = read('src/wallpaper/settings.js');
for (const k of Object.keys(props)) ok(settingsJs.includes(`case '${k}':`), `settings.js does not handle the Lively property "${k}"`);
const xml = read('kde/skill-issue-wallpaper/contents/config/main.xml');
const cfg = read('kde/skill-issue-wallpaper/contents/ui/config.qml');
for (const m of xml.matchAll(/<entry name="(\w+)"/g)) ok(cfg.includes(`cfg_${m[1]}`), `config.qml has no cfg_${m[1]} for main.xml entry ${m[1]}`);
for (const h of ['kde', 'lively']) {
    const min = MIN_HOST[h];
    ok(typeof min === 'string' && min.localeCompare(version, undefined, { numeric: true }) <= 0, `version.js MIN_HOST.${h} ${min} is missing or newer than the package ${version}`);
    if (typeof min !== 'string') continue;
    // this release's own package never gets the notice; one just below the minimum does
    ok(!hostOutdated(`${h}-${version}`, true), `version.js: ${h}-${version} would be told to update`);
    const [a, b, c] = min.split('.').map(Number);
    if (c > 0) ok(hostOutdated(`${h}-${a}.${b}.${c - 1}`, true), `version.js: ${h}-${a}.${b}.${c - 1} would not be told to update`);
}

// ------------------------------------------------------------------
console.log('2/4 QML');
try {
    const lint = ['qmllint', '/usr/lib/qt6/bin/qmllint'].find(b => { try { execFileSync(b, ['--version'], { stdio: 'ignore' }); return true; } catch { return false; } });
    if (!lint) console.log('  (qmllint not installed, skipped)');
    else {
        const dir = path.join(ROOT, 'kde/skill-issue-wallpaper/contents/ui');
        for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.qml'))) {
            let out = '';
            try { out = execFileSync(lint, [path.join(dir, f)], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { out = `${e.stdout || ''}${e.stderr || ''}`; }
            // Plasma's own modules are often not importable by qmllint; only real syntax errors count
            if (/syntax error|Failed to parse/i.test(out)) fail(`${f}: ${out.trim().split('\n')[0]}`);
        }
    }
} catch (e) { fail(`qmllint: ${e.message}`); }

// ------------------------------------------------------------------
console.log('3/4 built page');
for (const f of ['index.html', 'app.js', 'panel.css', 'sw.js']) ok(fs.existsSync(path.join(WEB, f)), `web/${f} is missing: run "npm run build"`);
if (!failures) {
    const html = fs.readFileSync(path.join(WEB, 'index.html'), 'utf8');
    const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] || '';
    const script = /script-src ([^;]+)/.exec(csp)?.[1] || '';
    ok(csp.includes("default-src 'self'"), 'CSP: default-src must be self');
    ok(script.trim() === "'self'", `CSP: script-src must be 'self' only, is "${script.trim()}"`);
    ok(!/<script(?![^>]*\bsrc=)/.test(html), 'index.html has an inline script');
    const sw = fs.readFileSync(path.join(WEB, 'sw.js'), 'utf8');
    for (const m of sw.matchAll(/'\.\/([^']+)'/g)) ok(fs.existsSync(path.join(WEB, m[1])), `sw.js caches web/${m[1]}, which does not exist`);
    ok(/CACHE_NAME = 'live-zagreb-wallpaper-[0-9a-f]{12}'/.test(sw), 'sw.js cache name was not stamped by the build');
}

// ------------------------------------------------------------------
console.log('4/4 render matrix');
const SPAN = 'layout=span&view=1920,0,2259,1271&desk=4179,1271&scene=0,0,1920,1080';
const host = `host=kde-${version}`;
const SCENES = [
    { name: 'clear-day', hash: `wx=0&clock=2026-06-15T12:00:00&${host}` },
    { name: 'clear-night', hash: `wx=0&clock=2026-06-15T23:30:00&${host}` },
    { name: 'overcast-autumn', hash: `wx=3&clock=2026-10-20T15:00:00&season=autumn&${host}` },
    { name: 'fog', hash: `wx=45&clock=2026-11-10T08:00:00&${host}` },
    { name: 'rain', hash: `wx=63&clock=2026-06-15T12:00:00&${host}`, animated: true },
    { name: 'snow-winter', hash: `wx=75&clock=2026-01-15T12:00:00&season=winter&${host}`, animated: true },
    { name: 'thunder-hail', hash: `wx=99&clock=2026-07-15T18:00:00&${host}`, animated: true },
    { name: 'rain-on-battery', hash: `wx=63&clock=2026-06-15T12:00:00&power=battery&${host}` },
    { name: 'rain-low-quality', hash: `wx=63&clock=2026-06-15T12:00:00&quality=low&${host}`, animated: true },
    { name: 'span-scene', hash: `wx=2&clock=2026-06-15T12:00:00&${host}&layout=span&view=0,0,1920,1080&desk=4179,1271&scene=0,0,1920,1080` },
    { name: 'span-side-glass', hash: `wx=2&clock=2026-06-15T12:00:00&${host}&${SPAN}`, size: [2259, 1271, 1.7], noCard: true },
    { name: 'english', hash: `wx=1&clock=2026-06-15T12:00:00&lang=en&${host}` },
    { name: 'old-plugin-notice', hash: 'wx=0&clock=2026-06-15T12:00:00&sharp=1', notice: true },
    { name: 'old-version-notice', hash: 'wx=0&clock=2026-06-15T12:00:00&host=kde-1.1.0', notice: true }
];
if (!failures) {
    fs.mkdirSync(SHOTS, { recursive: true });
    const server = await serve(WEB);
    const base = `http://127.0.0.1:${server.address().port}/index.html`;
    const browser = await launch();
    try {
        for (const sc of SCENES) {
            const [w, h, dpr] = sc.size || [1920, 1080, 1];
            const t = await (await fetch(`http://127.0.0.1:${browser.port}/json/new?about:blank`, { method: 'PUT' })).json();
            const page = await connect(t.webSocketDebuggerUrl);
            try {
                for (const d of ['Runtime', 'Page', 'Network', 'Log']) await page.send(`${d}.enable`);
                await page.send('Network.setBlockedURLs', { urls: ['*open-meteo.com*'] });
                await page.send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: dpr, mobile: false });
                await page.send('Page.addScriptToEvaluateOnNewDocument', { source: 'globalThis.__WP_STATS__ = { frames: 0 };' });
                await clearOfMinute(7000); // no minute blend inside the stillness check
                await page.send('Page.navigate', { url: `${base}#city=Zagreb&fps=15&${sc.hash}` });
                await sleep(3500);
                const s = JSON.parse(await page.evaluate(`(async () => {
                    const c = document.getElementById('weather-canvas'), g = c.getContext('2d');
                    const px = (x, y) => [...g.getImageData(c.width * x | 0, c.height * y | 0, 1, 1).data];
                    const before = __WP_STATS__.frames;
                    await new Promise(r => setTimeout(r, 1500));
                    const panel = document.getElementById('weather-panel'), note = document.getElementById('wp-update');
                    return JSON.stringify({ sky: px(0.5, 0.1), ground: px(0.5, 0.9), drew: before, more: __WP_STATS__.frames - before,
                        card: getComputedStyle(panel).display !== 'none' && panel.classList.contains('loaded'), temp: document.getElementById('wp-temp').textContent,
                        title: document.getElementById('wp-title').textContent, notice: !note.hidden, canvas: c.width + 'x' + c.height });
                })()`));
                const before = failures;
                ok(page.errors.length === 0, `${sc.name}: ${page.errors[0]}`);
                ok(s.drew > 0 && s.sky[3] === 255 && s.ground[3] === 255, `${sc.name}: the canvas has no picture`);
                ok(JSON.stringify(s.sky) !== JSON.stringify(s.ground), `${sc.name}: sky and ground are the same colour (flat picture)`);
                ok(sc.animated ? s.more > 3 : s.more <= 1, `${sc.name}: ${sc.animated ? 'should animate' : 'should be still'}, drew ${s.more} frames in 1.5 s`);
                ok(sc.noCard ? !s.card : s.card, `${sc.name}: weather card ${sc.noCard ? 'should be hidden on a side display' : 'is not shown'}`);
                ok(!!sc.notice === s.notice, `${sc.name}: update notice ${s.notice ? 'shown' : 'not shown'}`);
                if (sc.name === 'english') ok(/weather|forecast/i.test(s.title), `english: card title is "${s.title}"`);
                const shot = await page.send('Page.captureScreenshot', { format: 'jpeg', quality: 70 });
                if (shot.result?.data) fs.writeFileSync(path.join(SHOTS, `${sc.name}.jpg`), Buffer.from(shot.result.data, 'base64'));
                console.log(`  ${failures === before ? 'ok  ' : 'FAIL'} ${sc.name.padEnd(20)} ${s.canvas}`);
            } finally {
                page.close();
                await fetch(`http://127.0.0.1:${browser.port}/json/close/${t.id}`).catch(() => {});
            }
        }
    } finally {
        browser.stop();
        server.close();
    }
}

console.log(failures ? `\n${failures} check(s) failed` : '\nAll checks passed');
process.exit(failures ? 1 : 0);
