// 3-day forecast from Open-Meteo (free, no API key).

import { h, imperial, fmtTime } from './util.js';

const WMO = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly clear'], 2: ['⛅', 'Partly cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Icy fog'],
  51: ['🌦️', 'Light drizzle'], 53: ['🌦️', 'Drizzle'], 55: ['🌧️', 'Heavy drizzle'],
  56: ['🌧️', 'Freezing drizzle'], 57: ['🌧️', 'Freezing drizzle'],
  61: ['🌦️', 'Light rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy rain'],
  66: ['🌧️', 'Freezing rain'], 67: ['🌧️', 'Freezing rain'],
  71: ['🌨️', 'Light snow'], 73: ['🌨️', 'Snow'], 75: ['❄️', 'Heavy snow'], 77: ['🌨️', 'Snow grains'],
  80: ['🌦️', 'Showers'], 81: ['🌧️', 'Showers'], 82: ['⛈️', 'Violent showers'],
  85: ['🌨️', 'Snow showers'], 86: ['🌨️', 'Snow showers'],
  95: ['⛈️', 'Thunderstorms'], 96: ['⛈️', 'Storms & hail'], 99: ['⛈️', 'Storms & hail'],
};

const cache = new Map();

export function getForecast(lat, lon) {
  const units = imperial() ? '&temperature_unit=fahrenheit&wind_speed_unit=mph' : '';
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}${units}`;
  if (!cache.has(key)) {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + `?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}`
      + '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset'
      + `&timezone=auto&timeformat=unixtime&forecast_days=3${units}`;
    const p = fetch(url)
      .then(r => { if (!r.ok) throw new Error(`Weather ${r.status}`); return r.json(); })
      .then(j => j.daily.time.map((t, i) => ({
        // Shift by the place's UTC offset so the weekday is the place's local day.
        label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow'
          : new Date((t + j.utc_offset_seconds) * 1000).toLocaleDateString(undefined, { weekday: 'short', timeZone: 'UTC' }),
        code: j.daily.weather_code[i],
        hi: Math.round(j.daily.temperature_2m_max[i]),
        lo: Math.round(j.daily.temperature_2m_min[i]),
        rain: j.daily.precipitation_probability_max[i],
        wind: Math.round(j.daily.wind_speed_10m_max[i]),
        sunrise: j.daily.sunrise[i] * 1000,
        sunset: j.daily.sunset[i] * 1000,
      })));
    cache.set(key, p);
    p.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

const describe = code => WMO[code] ?? ['🌡️', 'Unknown'];
const windUnit = () => (imperial() ? 'mph' : 'km/h');

export function forecastCards(days) {
  return h('div', { class: 'forecast' }, days.map(d => {
    const [icon, text] = describe(d.code);
    return h('div', { class: 'day' },
      h('div', { class: 'sub' }, d.label),
      h('div', { class: 'icon', title: text }, icon),
      h('div', { class: 'temps' }, `${d.hi}° / ${d.lo}°`),
      h('div', { class: 'sub' }, `💧 ${d.rain ?? 0}% · 💨 ${d.wind} ${windUnit()}`),
      h('div', { class: 'sub' }, `🌅 ${fmtTime(d.sunset)}`));
  }));
}

export function weatherLine(today) {
  const [icon, text] = describe(today.code);
  return h('div', { class: 'weather-line' },
    h('span', {}, `${icon} `, h('strong', {}, `${today.hi}° / ${today.lo}°`), ` ${text}`),
    h('span', {}, `💧 ${today.rain ?? 0}%`),
    h('span', {}, `🌅 Sunset ${fmtTime(today.sunset)}`));
}
