// src/wallpaper/panel.js — the read-only weather card (top-right corner).
import { I18N } from '../game/i18n.js';

const isDrizzle = c => c >= 51 && c <= 57;
const isRain = c => (c >= 61 && c <= 67) || (c >= 80 && c <= 82);
const isSnow = c => (c >= 71 && c <= 77) || c === 85 || c === 86;
const isFog = c => c === 45 || c === 48;
const isThunder = c => c >= 95 || c === 17;

function formatTemp(v, lang = 'hr') {
    const n = Number(v);
    if (v == null || !Number.isFinite(n)) return '--°C';
    const c = Math.round(n) + '°C';
    return lang === 'en' ? `${c}/${Math.round(n * 1.8 + 32)}°F` : c;
}

function condKey(c) {
    if (c === 1 || c === 2) return 'weather_cond_partly_cloudy';
    if (c === 3) return 'weather_cond_overcast';
    if (isFog(c)) return 'weather_cond_fog';
    if (isDrizzle(c)) return 'weather_cond_drizzle';
    if (c >= 80 && c <= 82) return 'weather_cond_showers';
    if (isRain(c)) return 'weather_cond_rain';
    if (isSnow(c)) return 'weather_cond_snow';
    if (c === 17) return 'weather_cond_dry_thunder';
    if (isThunder(c)) return 'weather_cond_thunder';
    return 'weather_cond_clear';
}

function icon(c, isDay = true) {
    if (c === 1 || c === 2) return isDay ? '🌤️' : '☁️';
    if (c === 3) return '☁️';
    if (isFog(c)) return '🌁';
    if (isDrizzle(c)) return '🌦️';
    if (isRain(c)) return '🌧️';
    if (isSnow(c)) return '❄️';
    if (c === 17) return '🌩️';
    if (isThunder(c)) return '⚡';
    return isDay ? '☀️' : '🌙';
}

export function tr(key, lang = 'hr') {
    return (I18N[lang] || I18N.hr)[key] || I18N.hr[key] || key;
}

const $ = id => document.getElementById(id);
function span(cls, text) {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    return el;
}

// One line under the forecast when the installed plugin/package is older than this page needs
const UPDATE_TEXT = {
    hr: 'Nova verzija dodatka: ponovno pokreni instalaciju',
    en: 'Plugin update available: run the installer again'
};
export function renderUpdateNotice(show, lang = 'hr') {
    const el = $('wp-update');
    if (!el) return;
    el.hidden = !show;
    el.textContent = show ? (UPDATE_TEXT[lang] || UPDATE_TEXT.hr) : '';
}

export function renderPanel(w, lang = 'hr') {
    const panel = $('weather-panel');
    if (!panel) return;
    if (!w) {
        panel.classList.remove('loaded');
        return;
    }
    const title = $('wp-title'), city = $('wp-city'), cond = $('wp-cond'), ic = $('wp-icon'), temp = $('wp-temp');
    const sunRow = $('wp-sun-row'), riseLabel = $('wp-sunrise-label'), setLabel = $('wp-sunset-label');
    const rise = $('wp-sunrise'), set = $('wp-sunset'), list = $('wp-forecast-list');

    if (title) title.textContent = tr('weather_title', lang);
    if (city) city.textContent = w.city || 'Zagreb';
    if (cond) cond.textContent = tr(condKey(w.weathercode), lang);
    if (ic) ic.textContent = icon(w.weathercode, !!w.is_day);
    if (temp) temp.textContent = formatTemp(w.temperature, lang);

    if (sunRow) {
        const hhmm = s => (typeof s === 'string' && s.length >= 16 ? s.slice(11, 16) : '');
        const r = hhmm((w.daily?.sunrise || [])[0]);
        const s = hhmm((w.daily?.sunset || [])[0]);
        if (r && s) {
            sunRow.hidden = false;
            if (riseLabel) riseLabel.textContent = tr('weather_sunrise', lang);
            if (setLabel) setLabel.textContent = tr('weather_sunset', lang);
            if (rise) rise.textContent = r;
            if (set) set.textContent = s;
        } else {
            sunRow.hidden = true;
        }
    }

    if (list) {
        list.innerHTML = '';
        const days = ['weather_day_today', 'weather_day_tomorrow', 'weather_day_after'];
        const codes = w.daily?.weathercode || [];
        const hi = w.daily?.temperature_2m_max || [];
        const lo = w.daily?.temperature_2m_min || [];
        for (let i = 0; i < 3; i++) {
            const label = tr(days[i], lang);
            const code = codes[i] !== undefined ? codes[i] : w.weathercode;
            const base = Number.isFinite(Number(w.temperature)) ? Number(w.temperature) : 18;
            const max = hi[i] !== undefined ? hi[i] : base + 2;
            const min = lo[i] !== undefined ? lo[i] : base - 2;
            const li = document.createElement('li');
            li.className = 'wm-forecast-item';
            const temps = span('wm-forecast-temps', '');
            temps.append(span('wm-forecast-hi', formatTemp(max, lang)), span('wm-forecast-lo', formatTemp(min, lang)));
            li.append(span('wm-forecast-day', label), span('wm-forecast-icon', icon(code, true)), temps);
            list.appendChild(li);
        }
    }
    panel.classList.add('loaded');
}
