// src/wallpaper/build.mjs — builds every output of this repo from src/.
//
//   node src/wallpaper/build.mjs
//
// Writes (none of it is committed; GitHub Actions builds, deploys web/ and attaches dist/ to a release):
//   web/                      app.js, index.html, panel.css, sw.js (deployed to GitHub Pages; bg/ and
//                             fonts/ in web/ are source assets and are left alone)
//   kde/skill-issue-wallpaper/contents/web/   copy of web/ (offline fallback for Plasma)
//   dist/skill-issue-wallpaper-lively.zip             Lively package
//   dist/Live-Zagreb-Wallpaper-{Linux,Windows}-Setup  setup archives
import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const WEB = path.join(ROOT, 'web');
const KDE = path.join(ROOT, 'kde/skill-issue-wallpaper');
const KDE_WEB = path.join(KDE, 'contents/web');
const DIST = path.join(ROOT, 'dist');
const LIVELY_ZIP = path.join(DIST, 'skill-issue-wallpaper-lively.zip');
const RELEASES = DIST;
const ASSET_DIRS = ['bg', 'fonts'];

const rel = p => path.relative(ROOT, p);

function listFiles(dir, base = dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const p = path.join(dir, e.name);
        return e.isDirectory() ? listFiles(p, base) : [path.relative(base, p)];
    }).sort();
}

function copyDir(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    fs.cpSync(src, dst, { recursive: true });
}

// Zip/tar with fixed timestamps so an unchanged build gives unchanged archives
const STAMP = '202601010000';
function touchAll(dir) {
    execFileSync('find', [dir, '-exec', 'touch', '-h', '-t', STAMP, '{}', '+']);
}
// python3's zipfile instead of the zip tool, which many desktops do not ship
const ZIP_PY = `
import os, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(out, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as z:
    for root, dirs, files in os.walk(src):
        dirs.sort()
        for f in sorted(files):
            p = os.path.join(root, f)
            info = zipfile.ZipInfo(os.path.relpath(p, src).replace(os.sep, '/'), (2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(p, 'rb') as fh:
                z.writestr(info, fh.read(), compresslevel=9)
`;
function zipDir(dir, out) {
    fs.rmSync(out, { force: true });
    execFileSync('python3', ['-I', '-c', ZIP_PY, dir, out]);
}
function tarDir(dir, out) {
    fs.rmSync(out, { force: true });
    touchAll(dir);
    execFileSync('tar', ['--sort=name', '--owner=0', '--group=0', '--numeric-owner', '-czf', out, '-C', dir, '.'],
        { env: { ...process.env, GZIP: '-n' } });
}

// One version everywhere: package.json is the source, the host packages must say the same
function checkVersions() {
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    const meta = JSON.parse(fs.readFileSync(path.join(KDE, 'metadata.json'), 'utf8')).KPlugin.Version;
    const qml = fs.readFileSync(path.join(KDE, 'contents/ui/main.qml'), 'utf8');
    const lively = JSON.parse(fs.readFileSync(path.join(HERE, 'lively/LivelyInfo.json'), 'utf8')).FileName;
    const bad = [];
    if (meta !== version) bad.push(`kde metadata.json Version is ${meta}`);
    if (!qml.includes(`hostVersion: "${version}"`)) bad.push('kde main.qml hostVersion differs');
    if (!lively.endsWith(`#host=lively-${version}`)) bad.push('LivelyInfo.json FileName #host= differs');
    if (bad.length) throw new Error(`Version mismatch with package.json ${version}: ${bad.join('; ')}`);
}

async function main() {
    checkVersions();
    fs.mkdirSync(DIST, { recursive: true });
    // 1. app.js
    await build({
        entryPoints: [path.join(HERE, 'main.js')],
        outfile: path.join(WEB, 'app.js'),
        bundle: true,
        minify: true,
        format: 'iife',
        target: ['chrome100', 'firefox100', 'safari15'],
        legalComments: 'none',
        charset: 'utf8',
        logLevel: 'warning'
    });

    // 2. static shell
    for (const f of ['index.html', 'panel.css']) {
        fs.copyFileSync(path.join(HERE, 'static', f), path.join(WEB, f));
    }

    // 3. sw.js with a cache name derived from everything it caches, so any change refreshes clients
    const cached = ['index.html', 'app.js', 'panel.css', ...ASSET_DIRS.flatMap(d => listFiles(path.join(WEB, d)).map(f => `${d}/${f}`))];
    const h = createHash('sha256');
    for (const f of cached) {
        h.update(f);
        h.update(fs.readFileSync(path.join(WEB, f)));
    }
    const sw = fs.readFileSync(path.join(HERE, 'static/sw.js'), 'utf8')
        .replace(/const CACHE_NAME = '[^']*';/, `const CACHE_NAME = 'live-zagreb-wallpaper-${h.digest('hex').slice(0, 12)}';`);
    fs.writeFileSync(path.join(WEB, 'sw.js'), sw);

    // 4. KDE offline copy
    fs.rmSync(KDE_WEB, { recursive: true, force: true });
    copyDir(WEB, KDE_WEB);
    fs.copyFileSync(path.join(HERE, 'lively/thumbnail.jpg'), path.join(KDE, 'contents/screenshot.jpg'));

    // 5. Lively package
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lzw-build-'));
    try {
        const lively = path.join(tmp, 'lively');
        copyDir(WEB, lively);
        for (const f of ['LivelyInfo.json', 'LivelyProperties.json', 'thumbnail.jpg']) {
            fs.copyFileSync(path.join(HERE, 'lively', f), path.join(lively, f));
        }
        zipDir(lively, LIVELY_ZIP);

        // 6. release archives
        fs.mkdirSync(RELEASES, { recursive: true });
        const linux = path.join(tmp, 'linux');
        fs.mkdirSync(linux);
        fs.copyFileSync(path.join(ROOT, 'linux/install.sh'), path.join(linux, 'install.sh'));
        fs.chmodSync(path.join(linux, 'install.sh'), 0o755);
        copyDir(KDE, path.join(linux, 'skill-issue-wallpaper'));
        tarDir(linux, path.join(RELEASES, 'Live-Zagreb-Wallpaper-Linux-Setup.tar.gz'));

        const win = path.join(tmp, 'win');
        fs.mkdirSync(win);
        for (const f of ['install.ps1', 'Setup-Live-Zagreb-Wallpaper.bat']) {
            fs.copyFileSync(path.join(ROOT, 'windows', f), path.join(win, f));
        }
        fs.copyFileSync(LIVELY_ZIP, path.join(win, 'skill-issue-wallpaper-lively.zip'));
        zipDir(win, path.join(RELEASES, 'Live-Zagreb-Wallpaper-Windows-Setup.zip'));
    } finally {
        fs.rmSync(tmp, { recursive: true, force: true });
    }

    for (const p of [path.join(WEB, 'app.js'), path.join(WEB, 'sw.js'), LIVELY_ZIP,
        path.join(RELEASES, 'Live-Zagreb-Wallpaper-Linux-Setup.tar.gz'), path.join(RELEASES, 'Live-Zagreb-Wallpaper-Windows-Setup.zip')]) {
        console.log(`${rel(p).padEnd(52)} ${fs.statSync(p).size} B`);
    }
}

main().catch(err => { console.error(err); process.exit(1); });
