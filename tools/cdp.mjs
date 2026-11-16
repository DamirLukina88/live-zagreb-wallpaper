// tools/cdp.mjs — shared by bench.mjs and verify.mjs: a static server for web/, a headless
// Chromium, and the DevTools protocol over a plain WebSocket (no dependencies).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ------------------------------------------------------------------
// DevTools protocol over a plain WebSocket
// ------------------------------------------------------------------
export async function connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = () => no(new Error('DevTools socket failed')); });
    let id = 0;
    const pending = new Map();
    const errors = [];
    ws.onmessage = e => {
        const m = JSON.parse(e.data);
        if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
        if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
        // console.error and CSP violations count as errors too
        if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console.error: ' + m.params.args.map(a => a.value ?? a.description).join(' '));
        if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error' && !/open-meteo|ERR_BLOCKED_BY_CLIENT/.test(m.params.entry.text + (m.params.entry.url || ''))) errors.push('log: ' + m.params.entry.text);
    };
    const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const evaluate = async expression => {
        const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
        return r.result?.result?.value;
    };
    return { send, evaluate, errors, close: () => ws.close() };
}

export function serve(dir) {
    const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
    const server = http.createServer((req, res) => {
        const rel = decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/^\/+/, '') || 'index.html';
        const file = path.join(dir, rel);
        if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404).end(); return; }
        res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

function findBrowser() {
    const names = [process.env.CHROME_BIN, 'chromium', 'chromium-browser', 'google-chrome-stable', 'google-chrome', 'brave'];
    for (const n of names.filter(Boolean)) {
        try { return execFileSync('which', [n], { encoding: 'utf8' }).trim(); } catch {}
    }
    throw new Error('No Chromium found (set CHROME_BIN)');
}

export async function launch() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lzw-bench-'));
    const proc = spawn(findBrowser(), ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
        '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--mute-audio', '--hide-scrollbars',
        '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
        ...(process.env.CI ? ['--no-sandbox'] : []), 'about:blank'], { stdio: 'ignore' });
    const portFile = path.join(profile, 'DevToolsActivePort');
    // A cold start on a CI runner can take well over ten seconds
    for (let i = 0; i < 900 && !fs.existsSync(portFile); i++) await sleep(100);
    if (!fs.existsSync(portFile)) { proc.kill(); throw new Error('Chromium did not start within 90 s'); }
    const port = Number(fs.readFileSync(portFile, 'utf8').split('\n')[0]);
    return { port, stop() { proc.kill(); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} } };
}

