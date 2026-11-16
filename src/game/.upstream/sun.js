// src/sun.js — sun and moon maths for the background that follows the real sky.
// Sun position and sunrise/sunset need only a moment in time (UTC inside a Date) and the place's
// coordinates, so they are right for any city without timezone handling.
// Developed in the local studio (studio/weather/sun.js); change both together.

const DAY_MS = 86400000;
const SYNODIC_DAYS = 29.530588853;
// A known new moon: 2000-01-06 18:14 UTC
const NEW_MOON_MS = Date.UTC(2000, 0, 6, 18, 14);

// phase: 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter.
// lit: fraction of the disc that is lit (0..1). waxing: the lit side is growing.
export function moonPhase(date) {
    const days = ((date || new Date()).getTime() - NEW_MOON_MS) / DAY_MS;
    const phase = ((days / SYNODIC_DAYS) % 1 + 1) % 1;
    return moonFromPhase(phase);
}

export function moonFromPhase(phase) {
    return { phase, lit: (1 - Math.cos(phase * 2 * Math.PI)) / 2, waxing: phase < 0.5 };
}

// ------------------------------------------------------------------
// Sun position and sunrise/sunset (the usual low-precision almanac formulas, good to
// about a minute of time and a tenth of a degree, which is plenty for a background)
// ------------------------------------------------------------------
const RAD = Math.PI / 180;
const J1970 = 2440588, J2000 = 2451545;
const OBLIQUITY = RAD * 23.4397;
const toDays = ms => ms / DAY_MS - 0.5 + J1970 - J2000;
const fromJulian = j => new Date((j + 0.5 - J1970) * DAY_MS);
const meanAnomaly = d => RAD * (357.5291 + 0.98560028 * d);
function eclipticLongitude(M) {
    const C = RAD * (1.9148 * Math.sin(M) + 0.02 * Math.sin(2 * M) + 0.0003 * Math.sin(3 * M));
    return M + C + RAD * 102.9372 + Math.PI;
}
const declination = L => Math.asin(Math.sin(L) * Math.sin(OBLIQUITY));

// altitude: degrees above the horizon (negative below). azimuth: degrees from north, clockwise.
export function sunPosition(date, lat, lon) {
    const d = toDays(date.getTime());
    const L = eclipticLongitude(meanAnomaly(d));
    const dec = declination(L);
    const ra = Math.atan2(Math.sin(L) * Math.cos(OBLIQUITY), Math.cos(L));
    const phi = RAD * lat;
    const H = RAD * (280.16 + 360.9856235 * d) + RAD * lon - ra;
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return { altitude: alt / RAD, azimuth: (az / RAD + 180 + 360) % 360 };
}

// Sunrise, solar noon and sunset (Date objects) for the day that `date` falls in at this
// longitude. sunrise and sunset are null in polar day or polar night.
export function sunTimes(date, lat, lon) {
    const lw = RAD * -lon, phi = RAD * lat;
    const n = Math.round(toDays(date.getTime()) - 0.0009 - lw / (2 * Math.PI));
    const ds = 0.0009 + lw / (2 * Math.PI) + n;
    const M = meanAnomaly(ds), L = eclipticLongitude(M), dec = declination(L);
    const transit = x => J2000 + x + 0.0053 * Math.sin(M) - 0.0069 * Math.sin(2 * L);
    const jNoon = transit(ds);
    const cosW = (Math.sin(RAD * -0.833) - Math.sin(phi) * Math.sin(dec)) / (Math.cos(phi) * Math.cos(dec));
    if (cosW < -1 || cosW > 1) return { sunrise: null, noon: fromJulian(jNoon), sunset: null };
    const jSet = transit(0.0009 + (Math.acos(cosW) + lw) / (2 * Math.PI) + n);
    return { sunrise: fromJulian(jNoon - (jSet - jNoon)), noon: fromJulian(jNoon), sunset: fromJulian(jSet) };
}
