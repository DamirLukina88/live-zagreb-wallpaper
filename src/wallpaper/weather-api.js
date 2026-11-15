// src/wallpaper/weather-api.js — Open-Meteo geocoding and forecast, with a localStorage cache.

const GEO_TTL = 7 * 24 * 3600 * 1000;

async function geocode(city) {
    const name = (city || 'Zagreb').trim().substring(0, 50).replace(/[^\p{L}\p{N}\s\-]/gu, '').trim() || 'Zagreb';
    const key = `wp_geo_${name.toLowerCase()}`;
    try {
        const s = localStorage.getItem(key);
        if (s) {
            const hit = JSON.parse(s);
            if (Date.now() - hit.ts < GEO_TTL) return hit.data;
        }
    } catch {}
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name.toLowerCase())}&count=1&format=json`;
    const res = await fetch(url);
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
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current_weather=true&hourly=precipitation&daily=weathercode,temperature_2m_max,temperature_2m_min,sunrise,sunset&timezone=auto`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Forecast failed: HTTP ${res.status}`);
    const json = await res.json();
    const cur = json.current_weather || {};
    const daily = json.daily || {};
    const hourly = json.hourly || {};

    // precipitation in the current hour, to tell a real thunderstorm from a dry one
    let precip = 0;
    if (hourly.time && Array.isArray(hourly.precipitation)) {
        const hour = (cur.time || '').substring(0, 13);
        const i = hourly.time.findIndex(t => t.startsWith(hour));
        if (i !== -1 && typeof hourly.precipitation[i] === 'number') precip = hourly.precipitation[i];
    }
    let code = cur.weathercode ?? 0;
    if (code === 95 && precip === 0) code = 17; // dry thunderstorm

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
        utc_offset_seconds: json.utc_offset_seconds ?? 0,
        daily: {
            time: (daily.time || []).slice(0, 3),
            weathercode: (daily.weathercode || []).slice(0, 3),
            temperature_2m_max: (daily.temperature_2m_max || []).slice(0, 3),
            temperature_2m_min: (daily.temperature_2m_min || []).slice(0, 3),
            sunrise: (daily.sunrise || []).slice(0, 3),
            sunset: (daily.sunset || []).slice(0, 3)
        },
        fetchedAt: Date.now()
    };
    try { localStorage.setItem('wp_last_weather', JSON.stringify(data)); } catch {}
    return data;
}

export function cachedWeather() {
    try {
        const s = localStorage.getItem('wp_last_weather');
        if (s) return JSON.parse(s);
    } catch {}
    return null;
}
