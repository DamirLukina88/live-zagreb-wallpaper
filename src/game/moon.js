// src/game/moon.js — where the moon really is (wallpaper only; the game keeps its moon).
// The usual low-precision almanac formulas (as in sun.js), good to a degree or so and a few
// minutes of rise and set time, which is plenty for a background.

const DAY_MS = 86400000;
const RAD = Math.PI / 180;
const J1970 = 2440588, J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const toDays = ms => ms / DAY_MS - 0.5 + J1970 - J2000;

// altitude: degrees above the horizon (corrected for parallax and refraction), azimuth from north
export function moonPosition(date, lat, lon) {
    const d = toDays(date.getTime());
    const L = RAD * (218.316 + 13.176396 * d); // mean longitude
    const M = RAD * (134.963 + 13.064993 * d); // mean anomaly
    const F = RAD * (93.272 + 13.229350 * d);  // mean distance from the ascending node
    const l = L + RAD * 6.289 * Math.sin(M);   // ecliptic longitude
    const b = RAD * 5.128 * Math.sin(F);       // ecliptic latitude
    const dist = 385001 - 20905 * Math.cos(M); // km
    const ra = Math.atan2(Math.sin(l) * Math.cos(OBLIQUITY) - Math.tan(b) * Math.sin(OBLIQUITY), Math.cos(l));
    const dec = Math.asin(Math.sin(b) * Math.cos(OBLIQUITY) + Math.cos(b) * Math.sin(OBLIQUITY) * Math.sin(l));
    const phi = RAD * lat;
    const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra;
    let h = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    // Parallax: the moon is close, so seen from the ground it sits a little lower
    h -= Math.asin(6378.14 / dist) * Math.cos(h);
    // Refraction lifts it near the horizon
    const hd = h / RAD;
    const refr = hd > -0.575 ? 0.0002967 / Math.tan(h + 0.00312536 / (h + 0.08901179)) : 0;
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return { altitude: (h + refr) / RAD, azimuth: (az / RAD + 180 + 360) % 360 };
}

// The moon's current pass across the sky: when it last rose and when it will set next (Dates),
// found by stepping ten minutes at a time. rise is null if it has not risen within 30 hours
// (then it is below the horizon now); set is null if it does not set within 30 hours.
export function moonPass(date, lat, lon) {
    const STEP = 10 * 60000, SPAN = 30 * 3600000;
    const t0 = date.getTime();
    const alt = ms => moonPosition(new Date(ms), lat, lon).altitude;
    const up = alt(t0) > 0;
    // The crossing between two samples, refined by linear interpolation
    const cross = (a, b, ha, hb) => a + (b - a) * (ha / (ha - hb));
    let rise = null, set = null;
    if (up) {
        let a = t0, ha = alt(a);
        for (let b = t0 - STEP; b >= t0 - SPAN; b -= STEP) {
            const hb = alt(b);
            if (hb <= 0) { rise = cross(a, b, ha, hb); break; }
            a = b; ha = hb;
        }
    }
    let a = t0, ha = alt(a);
    for (let b = t0 + STEP; b <= t0 + SPAN; b += STEP) {
        const hb = alt(b);
        if (up && hb <= 0) { set = cross(a, b, ha, hb); break; }
        if (!up && hb > 0) break; // it rises later; for now it is below the horizon
        a = b; ha = hb;
    }
    return { up, rise: rise === null ? null : new Date(rise), set: set === null ? null : new Date(set) };
}
