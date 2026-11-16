// tools/sync-game.mjs — bring the game's background code into this repo.
//
//   npm run sync-game -- /path/to/the/game/repo
//
// src/game/ holds the game's files; zagreb-bg.js also carries the wallpaper's own changes (span,
// pause, still mode, adaptive quality, the benchmark hook). src/game/.upstream/ keeps each file
// exactly as the game had it at the last sync. A sync is a three-way merge per file:
//   ours = src/game/<file>, base = .upstream/<file>, theirs = the game's file today
// so game fixes arrive and the wallpaper's changes stay. A conflict stops the sync for that file
// and leaves the usual <<<<<<< markers to resolve by hand. The game is only read, never written.
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const GAME_DIR = path.join(ROOT, "src/game");
const BASE_DIR = path.join(GAME_DIR, ".upstream");
const FILES = ["zagreb-bg.js", "sun.js", "zagreb-lights.js", "weather-bg.js", "i18n.js"];

const game = process.argv[2];
if (!game || !fs.existsSync(path.join(game, "src/zagreb-bg.js"))) {
    console.error("Usage: npm run sync-game -- /path/to/the/game/repo   (the folder that has src/zagreb-bg.js)");
    process.exit(2);
}
const dirty = execFileSync("git", ["status", "--porcelain", "--", "src/game"], { cwd: ROOT, encoding: "utf8" }).trim();
if (dirty) {
    console.error("src/game has uncommitted changes; commit or stash them first:\n" + dirty);
    process.exit(2);
}

let conflicts = 0;
for (const f of FILES) {
    const ours = path.join(GAME_DIR, f), base = path.join(BASE_DIR, f), theirs = path.join(game, "src", f);
    if (fs.readFileSync(base, "utf8") === fs.readFileSync(theirs, "utf8")) {
        console.log(`${f.padEnd(18)} unchanged in the game`);
        continue;
    }
    // git merge-file writes the result into "ours"; exit status = number of conflicts
    const r = spawnSync("git", ["merge-file", "-L", "wallpaper", "-L", "last sync", "-L", "game", ours, base, theirs], { cwd: ROOT });
    if (r.status === 0) {
        fs.copyFileSync(theirs, base);
        console.log(`${f.padEnd(18)} merged`);
    } else if (r.status > 0 && r.status < 128) {
        conflicts += r.status;
        console.log(`${f.padEnd(18)} ${r.status} CONFLICT(S): fix the markers in src/game/${f}, then copy the game's file to src/game/.upstream/${f}`);
    } else {
        throw new Error(`git merge-file failed for ${f}: ${r.stderr}`);
    }
}
console.log(conflicts ? `\n${conflicts} conflict(s) to resolve.` : "\nDone. Now: npm run build && npm run verify && npm run bench");
process.exit(conflicts ? 1 : 0);
