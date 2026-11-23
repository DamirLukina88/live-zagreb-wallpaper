// tools/push-game.mjs — send the wallpaper's background changes to the game. The wallpaper is the
// source of truth for the shared background (the user's decision, 2026-11-23); the game receives.
//
//   npm run push-game -- /path/to/TEGOBA-VJESTINE-TEST-SERVER            send the changes
//   npm run push-game -- /path/to/TEGOBA-VJESTINE-TEST-SERVER --dry-run  only report what would change
//   npm run push-game -- /path/to/TEGOBA-VJESTINE-TEST-SERVER --mark zagreb-bg.js
//       after a conflict was resolved by hand in the game: record that the game now has this
//       file's wallpaper changes
//
// What goes where: src/game/<file> -> <game>/src/<file>, web/bg/* -> <game>/public/bg/*.
// src/game/.pushed/<file> keeps each file as the wallpaper had it at the last push. Per file a
// three-way merge: ours = the game's file, base = .pushed/<file>, theirs = the wallpaper's file
// today. So only what the wallpaper changed since the last push reaches the game, and the game's
// own adaptations (no span, idle-time cloud shapes for phones, its minute timer...) stay.
//
// Rules, because the game's test checkout is shared with other agents and deploys to a website:
//   - only the test repo (branch "test"), never the live one; promoting to live is the game's own step
//   - nothing is written if the game's target files have uncommitted changes
//   - a conflict leaves the game's file untouched: the merged file with conflict markers goes to
//     bench/push-game/<file>, to be resolved by hand, copied over and then --mark'ed
//   - merged code must parse before it is written
//   - nothing is committed or deployed: the game's own workflow does that
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GAME_DIR = path.join(ROOT, "src/game");
const BASE_DIR = path.join(GAME_DIR, ".pushed");
const ART_DIR = path.join(ROOT, "web/bg");
const OUT_DIR = path.join(ROOT, "bench/push-game");
const FILES = ["zagreb-bg.js", "sun.js", "moon.js", "zagreb-lights.js", "weather-bg.js", "i18n.js"];

const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const markAt = args.indexOf("--mark");
const mark = markAt >= 0 ? args[markAt + 1] : null;
const game = args.find((a, i) => !a.startsWith("--") && (markAt < 0 || i !== markAt + 1));
const usage = "Usage: npm run push-game -- /path/to/TEGOBA-VJESTINE-TEST-SERVER [--dry-run | --mark <file>]";
if (!game || !fs.existsSync(path.join(game, "src/zagreb-bg.js"))) {
    console.error(usage + "\n(the folder that has src/zagreb-bg.js)");
    process.exit(2);
}
const git = (...a) => execFileSync("git", ["-C", game, ...a], { encoding: "utf8" }).trim();

// The test repo only
const branch = git("symbolic-ref", "--short", "-q", "HEAD"); // (not rev-parse --abbrev-ref: it says "heads/test" when a tag is also called test)
const remote = git("remote", "get-url", "origin");
if (branch !== "test" || !/TEST-SERVER/i.test(remote)) {
    console.error(`Refusing: ${game} is on branch "${branch}" of ${remote}.\nChanges go to the game's TEST repo (branch "test") only; live is promoted from there.`);
    process.exit(2);
}

if (mark) {
    if (!FILES.includes(mark)) { console.error(`--mark: unknown file "${mark}" (one of ${FILES.join(", ")})`); process.exit(2); }
    fs.copyFileSync(path.join(GAME_DIR, mark), path.join(BASE_DIR, mark));
    fs.rmSync(path.join(OUT_DIR, mark), { force: true });
    console.log(`${mark}: recorded as sent (src/game/.pushed/${mark} now matches the wallpaper). Commit it with the wallpaper.`);
    process.exit(0);
}

const dirty = git("status", "--porcelain", "--", ...FILES.map(f => `src/${f}`), "public/bg");
if (dirty) {
    console.error(`The game has uncommitted changes in the files this would write; another agent may be working there.\nCommit or wait, then run again:\n${dirty}`);
    process.exit(2);
}

const parses = code => {
    try { transformSync(code, { loader: "js", format: "esm" }); return null; } catch (e) { return e.message.split("\n")[0]; }
};

// Names the merge's new lines use that the game's file never defines, such as a wallpaper-only
// helper (wallpaper(), WORLD): the merged file would parse and then fail when that line runs.
// Calls and CONSTANTS only; methods (.name) and the browser's own globals are fine.
const KEYWORDS = new Set(["if", "for", "while", "switch", "catch", "function", "return", "typeof", "new", "await", "super", "import", "export", "do", "else", "in", "of"]);
const BROWSER = new Set(["requestAnimationFrame", "cancelAnimationFrame", "requestIdleCallback", "getComputedStyle", "matchMedia", "Image", "ImageData", "OffscreenCanvas", "Path2D", "DOMMatrix", "MutationObserver", "ResizeObserver", "IntersectionObserver", "NaN", "Infinity"]);
const esc = n => n.replace(/\$/g, "\\$");
function undefinedNames(before, merged) {
    const old = new Set(before.split("\n"));
    const added = merged.split("\n").filter(l => !old.has(l)).join("\n")
        .replace(/\/\/.*$/gm, "").replace(/(['"`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
    const used = new Set([
        ...[...added.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)].map(m => m[1]),
        ...[...added.matchAll(/(?<![.\w$])([A-Z][A-Z0-9_]{2,})\b/g)].map(m => m[1])
    ]);
    return [...used].filter(n => !KEYWORDS.has(n) && !BROWSER.has(n) && typeof globalThis[n] === "undefined"
        && !new RegExp(`(?:function\\*?|const|let|var|class)\\s+${esc(n)}\\b|[,{(]\\s*${esc(n)}\\s*[,)=}]|(?<![.\\w$])${esc(n)}\\s*\\([^)]*\\)\\s*\\{|import\\s*\\{[^}]*\\b${esc(n)}\\b|import\\s*\\*\\s*as\\s+${esc(n)}\\b`).test(merged));
}

let conflicts = 0, changed = 0;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "push-game-"));
try {
    for (const f of FILES) {
        const wall = path.join(GAME_DIR, f), base = path.join(BASE_DIR, f), target = path.join(game, "src", f);
        const label = f.padEnd(18);
        if (!fs.existsSync(base)) { console.log(`${label} no record of a last push: skipped (see README)`); continue; }
        const W = fs.readFileSync(wall, "utf8"), B = fs.readFileSync(base, "utf8");
        if (W === B) { console.log(`${label} unchanged in the wallpaper`); continue; }
        if (!fs.existsSync(target)) {
            // A file new to the game: it arrives whole
            if (!dry) { fs.copyFileSync(wall, target); fs.copyFileSync(wall, base); }
            console.log(`${label} ${dry ? "would be added" : "added"} to the game`);
            changed++;
            continue;
        }
        // git merge-file writes into its first file: merge on a copy of the game's file
        const work = path.join(tmp, f);
        fs.copyFileSync(target, work);
        const r = spawnSync("git", ["merge-file", "-L", "game", "-L", "last push", "-L", "wallpaper", work, base, wall]);
        if (r.status > 0 && r.status < 128) {
            conflicts += r.status;
            fs.mkdirSync(OUT_DIR, { recursive: true });
            fs.copyFileSync(work, path.join(OUT_DIR, f));
            console.log(`${label} ${r.status} CONFLICT(S): the game's file is untouched. Resolve bench/push-game/${f},\n${" ".repeat(19)}copy it to the game's src/${f}, then run with --mark ${f}`);
            continue;
        }
        if (r.status !== 0) throw new Error(`git merge-file failed for ${f}: ${r.stderr}`);
        const merged = fs.readFileSync(work, "utf8");
        const err = parses(merged);
        if (err) {
            conflicts++;
            fs.mkdirSync(OUT_DIR, { recursive: true });
            fs.copyFileSync(work, path.join(OUT_DIR, f));
            console.log(`${label} merged but does not parse (${err}): the game's file is untouched; see bench/push-game/${f}`);
            continue;
        }
        const missing = undefinedNames(fs.readFileSync(target, "utf8"), merged);
        if (missing.length) {
            conflicts++;
            fs.mkdirSync(OUT_DIR, { recursive: true });
            fs.copyFileSync(work, path.join(OUT_DIR, f));
            console.log(`${label} merged, but uses ${missing.join(", ")}, which the game does not define (wallpaper-only?):\n${" ".repeat(19)}the game's file is untouched. Adapt bench/push-game/${f} for the game (or keep the game's\n${" ".repeat(19)}file if the change does not apply there), copy it over, then run with --mark ${f}`);
            continue;
        }
        if (merged === fs.readFileSync(target, "utf8")) {
            if (!dry) fs.copyFileSync(wall, base);
            console.log(`${label} the game already has these changes`);
            continue;
        }
        if (!dry) { fs.writeFileSync(target, merged); fs.copyFileSync(wall, base); }
        console.log(`${label} ${dry ? "would be merged" : "merged"}`);
        changed++;
    }

    // Artwork: copied whole when it differs (never deleted from the game)
    const gameArt = path.join(game, "public/bg");
    for (const f of fs.readdirSync(ART_DIR).sort()) {
        const src = path.join(ART_DIR, f), dst = path.join(gameArt, f);
        if (fs.existsSync(dst) && fs.readFileSync(src).equals(fs.readFileSync(dst))) continue;
        if (!dry) { fs.mkdirSync(gameArt, { recursive: true }); fs.copyFileSync(src, dst); }
        console.log(`bg/${f.padEnd(15)} ${dry ? "would be copied" : "copied"}${fs.existsSync(dst) ? "" : " (new)"}`);
        changed++;
    }
} finally {
    fs.rmSync(tmp, { recursive: true, force: true });
}

if (conflicts) console.log(`\n${conflicts} conflict(s) to resolve; the rest ${dry ? "would be" : "was"} sent.`);
else if (!changed) console.log("\nThe game is up to date.");
else if (dry) console.log("\nDry run: nothing was written.");
else console.log("\nSent. Commit src/game/.pushed/ here; in the game, test and deploy to test with its own workflow (ask the user first).");
process.exit(conflicts ? 1 : 0);
