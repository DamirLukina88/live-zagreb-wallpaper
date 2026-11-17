// src/wallpaper/strings.js — the wallpaper's own card texts (the game's i18n.js stays untouched)

export const STRINGS = {
    hr: {
        compass: ['S', 'SI', 'I', 'JI', 'J', 'JZ', 'Z', 'SZ'],
        rain_in: 'Kiša za oko {m} min',
        snow_in: 'Snijeg za oko {m} min',
        rain_soon: 'Kiša uskoro',
        snow_soon: 'Snijeg uskoro',
        rain_until: 'Kiša do {t}',
        snow_until: 'Snijeg do {t}'
    },
    en: {
        compass: ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'],
        rain_in: 'Rain in about {m} min',
        snow_in: 'Snow in about {m} min',
        rain_soon: 'Rain soon',
        snow_soon: 'Snow soon',
        rain_until: 'Rain until {t}',
        snow_until: 'Snow until {t}'
    }
};

export const str = (lang, key) => (STRINGS[lang] || STRINGS.hr)[key];

// "JZ 25 km/h": where the wind comes from, on an 8-point compass
export function windText(dirDeg, kmh, lang) {
    if (typeof kmh !== 'number' || !Number.isFinite(kmh)) return '';
    const speed = `${Math.round(kmh)} km/h`;
    if (typeof dirDeg !== 'number' || kmh < 1) return speed;
    const i = Math.round(((dirDeg % 360) + 360) % 360 / 45) % 8;
    return `${str(lang, 'compass')[i]} ${speed}`;
}

// The next change in rain or snow within two hours, from 15-minute steps:
//   soon: [{ t: 'YYYY-MM-DDTHH:MM' city-local, rain: mm, snow: cm }, ...]
// Returns '' when nothing changes. nowMs: now; offsetSec: the city's UTC offset.
export function soonText(soon, nowMs, offsetSec, lang) {
    if (!Array.isArray(soon) || soon.length === 0 || typeof offsetSec !== 'number') return '';
    const steps = soon.map(s => ({
        start: Date.parse(s.t + ':00Z') - offsetSec * 1000,
        wet: (s.rain || 0) >= 0.1 || (s.snow || 0) >= 0.1,
        snow: (s.snow || 0) >= 0.1,
        t: s.t
    })).filter(s => Number.isFinite(s.start) && s.start + 15 * 60000 > nowMs);
    if (steps.length === 0) return '';
    const nowWet = steps[0].wet;
    const next = steps.find(s => s.wet !== nowWet);
    if (!next) return ''; // no change in the next two hours
    if (nowWet) {
        return str(lang, steps[0].snow ? 'snow_until' : 'rain_until').replace('{t}', next.t.slice(11, 16));
    }
    const min = Math.max(0, Math.round((next.start - nowMs) / 300000) * 5);
    if (min < 10) return str(lang, next.snow ? 'snow_soon' : 'rain_soon');
    return str(lang, next.snow ? 'snow_in' : 'rain_in').replace('{m}', String(min));
}
