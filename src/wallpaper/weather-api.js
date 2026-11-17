// src/wallpaper/weather-api.js — Open-Meteo geocoding and forecast, with a localStorage cache.

const GEO_TTL = 7 * 24 * 3600 * 1000;
const TIMEOUT_MS = 15000;

// A request that hangs (captive portal, sleeping network) must fail so the retry timer can run
function fetchJson(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    return fetch(url, { signal: ctl.signal }).finally(() => clearTimeout(timer));
}

// The name to search for: "Zagreb, HR", "Split, Croatia" or "Zürich (CH)" searches for the place
// alone (the search takes a plain name), without characters it cannot use
export function cityName(city) {
    return String(city || 'Zagreb').split(',')[0].replace(/\([^)]*\)/g, ' ').trim().substring(0, 50)
        .replace(/[^\p{L}\p{N}\s\-]/gu, '').replace(/\s+/g, ' ').trim() || 'Zagreb';
}

async function geocode(city) {
    const name = cityName(city);
    const key = `wp_geo_${name.toLowerCase()}`;
    try {
        const s = localStorage.getItem(key);
        if (s) {
            const hit = JSON.parse(s);
            if (Date.now() - hit.ts < GEO_TTL) return hit.data;
        }
    } catch {}
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name.toLowerCase())}&count=1&format=json`;
    const res = await fetchJson(url);
    if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);
    const json = await res.json();
    if (json.results && json.results.length > 0) {
        const r = json.results[0];
        const data = {
            name: r.name || name,
            lat: Math.round(r.latitude * 10) / 10,
            lon: Math.round(r.longitude * 10) / 10,
            country: r.country_code || ''
        };
        try { localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data })); } catch {}
        return data;
    }
    throw new Error('City not found');
}

export async function fetchWeather(city = 'Zagreb') {
    const geo = await geocode(city);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current_weather=true&hourly=precipitation,cloud_cover,snow_depth&minutely_15=precipitation,snowfall&forecast_minutely_15=8&past_days=2&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto`;
    const res = await fetchJson(url);
    if (!res.ok) throw new Error(`Forecast failed: HTTP ${res.status}`);
    const json = await res.json();
    const cur = json.current_weather || {};
    const daily = json.daily || {};
    const hourly = json.hourly || {};

    // precipitation in the current hour, to tell a real thunderstorm from a dry one
    let precip = 0;
    const hour = (cur.time || '').substring(0, 13);
    const hi = hourly.time ? hourly.time.findIndex(t => t.startsWith(hour)) : -1;
    const at = (list, i) => (Array.isArray(list) && i >= 0 && typeof list[i] === 'number' ? list[i] : null);
    if (at(hourly.precipitation, hi) !== null) precip = hourly.precipitation[hi];
    let code = cur.weathercode ?? 0;
    if (code === 95 && precip === 0) code = 17; // dry thunderstorm

    // The request asks for two past days (for the terrace's dryness), so today is not the first day
    const today = (cur.time || '').substring(0, 10);
    const d0 = Math.max(0, (daily.time || []).indexOf(today));
    const days = list => (list || []).slice(d0, d0 + 3);

    // How dry the terrace is: 0 just rained .. 1 no rain for about two days (faster when warm)
    let dryness = null;
    if (hi >= 0 && Array.isArray(hourly.precipitation)) {
        let since = 48; // hours since the last hour with measurable rain
        for (let k = 0; k <= 48 && hi - k >= 0; k++) {
            if ((hourly.precipitation[hi - k] || 0) >= 0.1) { since = k; break; }
        }
        const warm = Math.max(0.6, Math.min(1.6, ((cur.temperature ?? 12) + 8) / 20));
        dryness = Math.max(0, Math.min(1, since * warm / 48));
    }

    // Precipitation in the next two hours, in 15-minute steps (for the card's "rain soon" line)
    const m15 = json.minutely_15 || {};
    const soon = (m15.time || []).slice(0, 8).map((t, i) => ({
        t, rain: (m15.precipitation || [])[i] || 0, snow: (m15.snowfall || [])[i] || 0
    }));

    const data = {
        city: geo.name,
        country: geo.country,
        latitude: geo.lat,
        longitude: geo.lon,
        temperature: cur.temperature ?? 18,
        weathercode: code,
        precipitation: precip,
        is_day: cur.is_day ?? 1,
        windspeed: cur.windspeed ?? 10,
        // null = not known (an old cached answer): the scene then behaves as before
        windDir: typeof cur.winddirection === 'number' ? cur.winddirection : null,
        cloudPct: at(hourly.cloud_cover, hi),
        snowDepthCm: at(hourly.snow_depth, hi) === null ? null : Math.round(hourly.snow_depth[hi] * 1000) / 10,
        dryness,
        soon,
        utc_offset_seconds: json.utc_offset_seconds ?? 0,
        daily: {
            time: days(daily.time),
            weathercode: days(daily.weathercode),
            temperature_2m_max: days(daily.temperature_2m_max),
            temperature_2m_min: days(daily.temperature_2m_min),
            sunrise: days(daily.sunrise),
            sunset: days(daily.sunset)
        },
        fetchedAt: Date.now(),
        query: cityName(city).toLowerCase() // which setting this answer belongs to (see cachedWeather)
    };
    try { localStorage.setItem('wp_last_weather', JSON.stringify(data)); } catch {}
    return data;
}

// The last answer, if it is for this city. Every page of the site shares one store, so another
// display (or a city set before) may have left another place's weather there.
export function cachedWeather(city) {
    try {
        const s = localStorage.getItem('wp_last_weather');
        if (!s) return null;
        const w = JSON.parse(s);
        const want = cityName(city).toLowerCase();
        // answers saved before the query was recorded carry only the place's own name
        return (w.query || String(w.city || '').toLowerCase()) === want ? w : null;
    } catch {}
    return null;
}
