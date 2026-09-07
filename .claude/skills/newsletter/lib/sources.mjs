#!/usr/bin/env node
// sources.mjs — deterministic data pulls the skill folds into the payload.
//
//   weather                 Open-Meteo for Zurich + San Diego: now, hi/lo, hourly
//   arxiv [--cat cs.HC] [--max 80] [--days 1]
//                           newest cs.HC papers, full abstract + submitted date
//
// No API keys. Prints JSON to stdout. Fails soft: on a fetch error it prints
// {"error": "..."} and exits 0 so a run can proceed without the section.

const args = Object.fromEntries(
  process.argv.slice(3).map((a, i, arr) => {
    if (!a.startsWith('--')) return [`_${i}`, a];
    const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true;
    return [a.slice(2), v];
  }),
);
const cmd = process.argv[2];

const get = async (url, { text = false } = {}) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'bryans-bulletin/1.0 (personal newsletter)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return text ? res.text() : res.json();
};

// ------------------------------------------------------------------- weather

const WMO = {
  0: ['Clear', '☀'], 1: ['Mainly clear', '🌤'], 2: ['Partly cloudy', '⛅'], 3: ['Overcast', '☁'],
  45: ['Fog', '🌫'], 48: ['Rime fog', '🌫'],
  51: ['Light drizzle', '🌦'], 53: ['Drizzle', '🌦'], 55: ['Heavy drizzle', '🌧'],
  56: ['Freezing drizzle', '🌧'], 57: ['Freezing drizzle', '🌧'],
  61: ['Light rain', '🌦'], 63: ['Rain', '🌧'], 65: ['Heavy rain', '🌧'],
  66: ['Freezing rain', '🌧'], 67: ['Freezing rain', '🌧'],
  71: ['Light snow', '🌨'], 73: ['Snow', '🌨'], 75: ['Heavy snow', '❄'], 77: ['Snow grains', '🌨'],
  80: ['Rain showers', '🌦'], 81: ['Rain showers', '🌧'], 82: ['Violent showers', '⛈'],
  85: ['Snow showers', '🌨'], 86: ['Snow showers', '🌨'],
  95: ['Thunderstorm', '⛈'], 96: ['Thunderstorm + hail', '⛈'], 99: ['Thunderstorm + hail', '⛈'],
};
const wmo = (c) => WMO[c] || ['—', '·'];

async function oneCity(name, lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,is_day` +
    `&hourly=temperature_2m,weather_code,precipitation_probability` +
    `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max` +
    `&timezone=auto&forecast_days=2&temperature_unit=celsius`;
  const d = await get(u);
  const nowIso = d.current.time; // local
  const idx = d.hourly.time.findIndex((t) => t >= nowIso);
  const from = idx < 0 ? 0 : idx;
  const hourly = d.hourly.time.slice(from, from + 9).map((t, i) => ({
    time: t,
    hour: Number(t.slice(11, 13)),
    temp: Math.round(d.hourly.temperature_2m[from + i]),
    code: d.hourly.weather_code[from + i],
    label: wmo(d.hourly.weather_code[from + i])[0],
    glyph: wmo(d.hourly.weather_code[from + i])[1],
    pop: d.hourly.precipitation_probability?.[from + i] ?? null,
  }));
  const [label, glyph] = wmo(d.current.weather_code);
  return {
    city: name,
    tz: d.timezone,
    localTime: nowIso,
    now: {
      temp: Math.round(d.current.temperature_2m),
      feels: Math.round(d.current.apparent_temperature),
      code: d.current.weather_code, label, glyph,
      isDay: !!d.current.is_day,
    },
    today: {
      hi: Math.round(d.daily.temperature_2m_max[0]),
      lo: Math.round(d.daily.temperature_2m_min[0]),
      sunrise: d.daily.sunrise[0], sunset: d.daily.sunset[0],
      popMax: d.daily.precipitation_probability_max?.[0] ?? null,
    },
    hourly,
  };
}

async function weather() {
  const [zurich, sanDiego] = await Promise.all([
    oneCity('Zurich', 47.3769, 8.5417),
    oneCity('San Diego', 32.7157, -117.1611),
  ]);
  return { fetchedAt: new Date().toISOString(), zurich, sanDiego };
}

// --------------------------------------------------------------------- arxiv

const strip = (s) =>
  s.replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();

async function arxiv() {
  const cat = args.cat || 'cs.HC';
  const max = Number(args.max || 80);
  const days = Number(args.days || 1);
  const url = `http://export.arxiv.org/api/query?search_query=cat:${cat}` +
    `&sortBy=submittedDate&sortOrder=descending&start=0&max_results=${max}`;
  const xml = await get(url, { text: true });

  const entries = xml.split('<entry>').slice(1).map((chunk) => {
    const pick = (tag) => {
      const m = chunk.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
      return m ? strip(m[1]) : '';
    };
    const id = pick('id').replace(/^https?:\/\/arxiv\.org\/abs\//, '');
    const authors = [...chunk.matchAll(/<name>([\s\S]*?)<\/name>/g)].map((m) => strip(m[1]));
    const prim = chunk.match(/<arxiv:primary_category[^>]*term="([^"]+)"/);
    const cats = [...chunk.matchAll(/<category[^>]*term="([^"]+)"/g)].map((m) => m[1]);
    const pdf = chunk.match(/<link[^>]*title="pdf"[^>]*href="([^"]+)"/);
    return {
      id,
      title: pick('title'),
      abstract: pick('summary'),
      authors,
      published: pick('published'),
      updated: pick('updated'),
      primary: prim ? prim[1] : cat,
      categories: cats,
      absUrl: `https://arxiv.org/abs/${id}`,
      htmlUrl: `https://arxiv.org/html/${id}`,
      pdfUrl: pdf ? pdf[1] : `https://arxiv.org/pdf/${id}`,
    };
  });

  // "today" = the most recent submission calendar date present, plus anything
  // within `days` of it (arXiv batches announcements).
  const dayOf = (iso) => iso.slice(0, 10);
  const newest = entries.length ? dayOf(entries[0].published) : null;
  const cutoff = newest ? Date.parse(newest) - (days - 1) * 86400000 : 0;
  const today = entries.filter((e) => Date.parse(dayOf(e.published)) >= cutoff);

  return {
    category: cat,
    fetchedAt: new Date().toISOString(),
    newestDate: newest,
    countToday: today.length,
    countScanned: entries.length,
    papers: today,
  };
}

// --------------------------------------------------------------------- main

try {
  let out;
  if (cmd === 'weather') out = await weather();
  else if (cmd === 'arxiv') out = await arxiv();
  else {
    console.error('usage: sources.mjs weather | arxiv [--cat cs.HC] [--max 80] [--days 1]');
    process.exit(1);
  }
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.log(JSON.stringify({ error: String(err && err.message || err) }, null, 2));
}
