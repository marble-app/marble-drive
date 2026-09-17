#!/usr/bin/env node
// sources.mjs — deterministic data pulls the skill folds into the payload.
//
//   weather                 Open-Meteo for Zurich + San Diego: now, hi/lo, hourly
//   arxiv [--cat cs.HC] [--max 80] [--days 1] [--since YYYY-MM-DD] [--unseen] [--rss]
//                           cs.HC papers, full abstract + submitted date; --since reads every
//                           announcement since that day, --unseen drops what an issue showed,
//                           state/tuning.json watch.{authors,comments} are queried directly
//
// No API keys. Prints JSON to stdout. Fails soft: on a fetch error it prints
// {"error": "..."} and exits 0 so a run can proceed without the section.

import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(3).map((a, i, arr) => {
    if (!a.startsWith('--')) return [`_${i}`, a];
    const v = arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : true;
    return [a.slice(2), v];
  }),
);
const cmd = process.argv[2];

const get = async (url, { text = false } = {}) => {
  const res = await fetch(url, { headers: { 'User-Agent': 'bryans-days/1.0 (personal daily brief)' } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  return text ? res.text() : res.json();
};

// ------------------------------------------------------------------- weather

const WMO = {
  0: ['Clear', '\u2600\uFE0F', 'clear'], 1: ['Mainly clear', '\uD83C\uDF24\uFE0F', 'clear'],
  2: ['Partly cloudy', '\u26C5\uFE0F', 'partly'], 3: ['Overcast', '\u2601\uFE0F', 'cloudy'],
  45: ['Fog', '\uD83C\uDF2B\uFE0F', 'fog'], 48: ['Rime fog', '\uD83C\uDF2B\uFE0F', 'fog'],
  51: ['Light drizzle', '\uD83C\uDF26\uFE0F', 'rain'], 53: ['Drizzle', '\uD83C\uDF26\uFE0F', 'rain'], 55: ['Heavy drizzle', '\uD83C\uDF27\uFE0F', 'rain'],
  56: ['Freezing drizzle', '\uD83C\uDF27\uFE0F', 'rain'], 57: ['Freezing drizzle', '\uD83C\uDF27\uFE0F', 'rain'],
  61: ['Light rain', '\uD83C\uDF26\uFE0F', 'rain'], 63: ['Rain', '\uD83C\uDF27\uFE0F', 'rain'], 65: ['Heavy rain', '\uD83C\uDF27\uFE0F', 'rain'],
  66: ['Freezing rain', '\uD83C\uDF27\uFE0F', 'rain'], 67: ['Freezing rain', '\uD83C\uDF27\uFE0F', 'rain'],
  71: ['Light snow', '\uD83C\uDF28\uFE0F', 'snow'], 73: ['Snow', '\uD83C\uDF28\uFE0F', 'snow'], 75: ['Heavy snow', '\u2744\uFE0F', 'snow'], 77: ['Snow grains', '\uD83C\uDF28\uFE0F', 'snow'],
  80: ['Rain showers', '\uD83C\uDF26\uFE0F', 'rain'], 81: ['Rain showers', '\uD83C\uDF27\uFE0F', 'rain'], 82: ['Violent showers', '\u26C8\uFE0F', 'storm'],
  85: ['Snow showers', '\uD83C\uDF28\uFE0F', 'snow'], 86: ['Snow showers', '\uD83C\uDF28\uFE0F', 'snow'],
  95: ['Thunderstorm', '\u26C8\uFE0F', 'storm'], 96: ['Thunderstorm + hail', '\u26C8\uFE0F', 'storm'], 99: ['Thunderstorm + hail', '\u26C8\uFE0F', 'storm'],
};
const wmo = (c) => WMO[c] || ['\u2014', '\u2753\uFE0F', 'cloudy'];

async function oneCity(name, lat, lon) {
  const u = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&current=temperature_2m,apparent_temperature,weather_code,is_day` +
    `&hourly=temperature_2m,apparent_temperature,weather_code,precipitation_probability` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_probability_max` +
    `&timezone=auto&forecast_days=10&temperature_unit=fahrenheit&wind_speed_unit=mph`;
  const d = await get(u);
  const nowIso = d.current.time; // local
  const idx = d.hourly.time.findIndex((t) => t >= nowIso);
  const from = idx < 0 ? 0 : idx;
  const hourly = d.hourly.time.slice(from, from + 48).map((t, i) => ({
    time: t,
    hour: Number(t.slice(11, 13)),
    temp: Math.round(d.hourly.temperature_2m[from + i]),
    feels: d.hourly.apparent_temperature ? Math.round(d.hourly.apparent_temperature[from + i]) : null,
    code: d.hourly.weather_code[from + i],
    label: wmo(d.hourly.weather_code[from + i])[0],
    glyph: wmo(d.hourly.weather_code[from + i])[1],
    sky: wmo(d.hourly.weather_code[from + i])[2],
    pop: d.hourly.precipitation_probability?.[from + i] ?? null,
    day: t.slice(0, 10),
  }));
  const [label, glyph, sky] = wmo(d.current.weather_code);
  return {
    city: name,
    tz: d.timezone,
    localTime: nowIso,
    now: {
      temp: Math.round(d.current.temperature_2m),
      feels: Math.round(d.current.apparent_temperature),
      code: d.current.weather_code, label, glyph,
      sky: sky === 'clear' && !d.current.is_day ? 'clear-night' : sky,
      isDay: !!d.current.is_day,
    },
    today: {
      hi: Math.round(d.daily.temperature_2m_max[0]),
      lo: Math.round(d.daily.temperature_2m_min[0]),
      sunrise: d.daily.sunrise[0], sunset: d.daily.sunset[0],
      popMax: d.daily.precipitation_probability_max?.[0] ?? null,
    },
    unit: 'F',
    hourly,
    // Ten days, for the expanded view. hi/lo are carried raw so the renderer can
    // scale every day's bar against one shared range — a per-row scale would make
    // a mild day and a hot one draw the same bar.
    daily: (d.daily.time || []).slice(0, 10).map((t, i) => ({
      date: t,
      hi: Math.round(d.daily.temperature_2m_max[i]),
      lo: Math.round(d.daily.temperature_2m_min[i]),
      code: d.daily.weather_code ? d.daily.weather_code[i] : null,
      label: wmo(d.daily.weather_code ? d.daily.weather_code[i] : null)[0],
      glyph: wmo(d.daily.weather_code ? d.daily.weather_code[i] : null)[1],
      sky: wmo(d.daily.weather_code ? d.daily.weather_code[i] : null)[2],
      pop: d.daily.precipitation_probability_max?.[i] ?? null,
      sunrise: d.daily.sunrise?.[i] || null,
      sunset: d.daily.sunset?.[i] || null,
    })),
  };
}

// Where Bryan is changes every few weeks, so the two cities are arguments, not
// constants. They were fixed to Zurich + San Diego, which kept reporting Zurich
// after he flew home on 13 Sep. First city is where he is; second is the one he
// is heading to or keeping an eye on.
const GAZETTEER = {
  zurich: ['Zurich', 47.3769, 8.5417],
  sandiego: ['San Diego', 32.7157, -117.1611],
  seattle: ['Seattle', 47.6062, -122.3321],
  redmond: ['Redmond', 47.674, -122.1215],
  newyork: ['New York', 40.7128, -74.006],
  detroit: ['Detroit', 42.3314, -83.0458],
  portland: ['Portland', 45.5152, -122.6784],
  sanfrancisco: ['San Francisco', 37.7749, -122.4194],
  sananselmo: ['San Anselmo', 37.97465, -122.56164],
  lyon: ['Lyon', 45.764, 4.8357],
};
const cityKey = (s) => String(s || '').toLowerCase().replace(/[^a-z]/g, '');

async function weather(argv = []) {
  const arg = (flag, dflt) => {
    const i = argv.indexOf(flag);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
  };
  // The gazetteer is a fast path, not a gate. Bryan moves — Zurich to Seattle to
  // San Anselmo inside a week, with a five-stop drive south still to come — and a
  // city that needs a code edit before the weather is right is a city that shows
  // the wrong weather. Anything unlisted is geocoded and used.
  const pick = async (name) => {
    const g = GAZETTEER[cityKey(name)];
    if (g) return g;
    const u = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=en&format=json`;
    const r = (await get(u).catch(() => null))?.results?.[0];
    if (!r) throw new Error(`unknown city "${name}" — geocoding found nothing; add it to GAZETTEER in sources.mjs`);
    return [r.name, r.latitude, r.longitude];
  };
  const [hereName, hereLat, hereLon] = await pick(arg('--here', 'sananselmo'));
  const [awayName, awayLat, awayLon] = await pick(arg('--away', 'sandiego'));
  const cities = await Promise.all([
    oneCity(hereName, hereLat, hereLon),
    oneCity(awayName, awayLat, awayLon),
  ]);
  return { fetchedAt: new Date().toISOString(), cities };
}

// --------------------------------------------------------------------- arxiv
//
// A paper Bryan should have seen gets lost three ways, and each flag answers one:
//
//   a morning with no issue never reads that day's listing   -> --since, --unseen
//   the export API rate-limits (429) on a busy morning        -> the RSS fallback
//   the paper that matters is a two-page vision, not a system -> the watch list
//
// Asked for on 14 Sep, after Michael Bernstein's "The Interface of Theseus"
// (2609.06770, UIST Visions 2026) was announced in CHI week and no issue read
// that listing: "i want to be finding papers like these!!!"

const strip = (s) =>
  s.replace(/\s+/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();

const ARXIV_API = 'https://export.arxiv.org/api/query';
const STATE = new URL('../state/', import.meta.url);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const readState = (name) => { try { return JSON.parse(fs.readFileSync(new URL(name, STATE), 'utf8')); } catch { return null; } };
const baseId = (id) => String(id).replace(/v\d+$/, '');
const rangeFrom = (day) => ` AND submittedDate:[${day.replace(/-/g, '')}0000 TO 209912312359]`;

function parseAtom(xml, cat) {
  return xml.split('<entry>').slice(1).map((chunk) => {
    const pick = (tag) => {
      const m = chunk.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
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
      // The comments field is where a paper says what it is — "UIST Visions 2026",
      // "position paper" — which is exactly what a relevance pass cannot see.
      comment: pick('arxiv:comment'),
      published: pick('published'),
      updated: pick('updated'),
      primary: prim ? prim[1] : cat,
      categories: cats,
      absUrl: `https://arxiv.org/abs/${id}`,
      htmlUrl: `https://arxiv.org/html/${id}`,
      pdfUrl: pdf ? pdf[1] : `https://arxiv.org/pdf/${id}`,
      via: 'api',
    };
  });
}

async function apiSearch(query, max, cat) {
  const out = [];
  for (let start = 0; start < max; start += 100) {
    const n = Math.min(100, max - start);
    if (start) await pause(3100);            // arXiv asks for one request every three seconds
    const url = `${ARXIV_API}?search_query=${encodeURIComponent(query)}` +
      `&sortBy=submittedDate&sortOrder=descending&start=${start}&max_results=${n}`;
    const page = parseAtom(await get(url, { text: true }), cat);
    out.push(...page);
    if (page.length < n) break;
  }
  return out;
}

// The listing as announced, from a different host than the API. It only ever
// carries the latest announcement and has no comments field, so it is a floor,
// not a replacement — `via: "rss"` in the output says which one you got.
async function rssListing(cat) {
  const xml = await get(`https://rss.arxiv.org/rss/${cat}`, { text: true });
  const tag = (s, t) => {
    const m = s.match(new RegExp(`<${t}[^>]*>([\\s\\S]*?)</${t}>`));
    return m ? strip(m[1].replace(/<!\[CDATA\[|\]\]>/g, '')) : '';
  };
  const stamp = Date.parse(tag(xml, 'pubDate') || tag(xml, 'lastBuildDate'));
  const announced = new Date(Number.isNaN(stamp) ? Date.now() : stamp).toISOString().slice(0, 10);
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]).map((it) => {
    const id = tag(it, 'link').replace(/^https?:\/\/arxiv\.org\/abs\//, '');
    const cats = [...it.matchAll(/<category>([^<]*)<\/category>/g)].map((c) => c[1]);
    return {
      id,
      title: tag(it, 'title'),
      abstract: tag(it, 'description').replace(/^arXiv:\S+\s+Announce Type:\s*\S+\s*Abstract:\s*/i, ''),
      authors: tag(it, 'dc:creator').split(/,\s+/).filter(Boolean),
      comment: '',
      published: announced,
      updated: announced,
      announceType: tag(it, 'arxiv:announce_type'),
      primary: cats[0] || cat,
      categories: cats,
      absUrl: `https://arxiv.org/abs/${id}`,
      htmlUrl: `https://arxiv.org/html/${id}`,
      pdfUrl: `https://arxiv.org/pdf/${id}`,
      via: 'rss',
    };
  }).filter((p) => p.id && !/^replace/.test(p.announceType));   // a revision is not news
}

// state/tuning.json -> watch: { authors: [...], comments: [...], topics: [...] }.
// Each is one query of its own, so a vision paper does not have to win a relevance
// pass against forty system papers to be seen.
//
// `topics` deliberately searches all of cs, not `cat`. Solaris ("Towards Interfaces
// That Are Generated, Not Coded") sat on arXiv for five weeks unseen because its
// primary category is cs.CV — the cs.HC sweep was never going to find it, and the
// papers Bryan most wants are exactly the ones filed outside his own listing.
async function watchQueries(watch, sinceDay, cat) {
  const qs = [];
  for (const phrase of watch.topics || []) {
    const p = String(phrase).toLowerCase();
    qs.push({
      why: `topic: ${phrase}`,
      q: `(ti:"${phrase}" OR abs:"${phrase}")${rangeFrom(sinceDay)}`,
      keep: (r) => `${r.title} ${r.abstract || ''}`.toLowerCase().includes(p),
    });
  }
  for (const name of watch.authors || []) {
    const parts = String(name).trim().split(/\s+/);
    const last = parts[parts.length - 1];
    const first = parts[0][0];
    qs.push({
      why: `author: ${name}`, q: `au:${last}_${first}${rangeFrom(sinceDay)}`,
      keep: (p) => p.authors.some((a) => a.includes(last) && a.startsWith(first)),
    });
  }
  for (const phrase of watch.comments || []) {
    qs.push({
      why: `comment: ${phrase}`, q: `co:"${phrase}"${rangeFrom(sinceDay)}`,
      keep: (p) => (p.comment || '').toLowerCase().includes(String(phrase).toLowerCase()),
    });
  }
  const hits = [];
  for (const w of qs) {
    await pause(3100);
    for (const p of (await apiSearch(w.q, 25, cat)).filter(w.keep)) hits.push({ ...p, watch: w.why });
  }
  return hits;
}

async function arxiv() {
  const cat = args.cat || 'cs.HC';
  const max = Number(args.max || 80);
  const days = Number(args.days || 1);
  const since = typeof args.since === 'string' ? args.since : null;
  if (since && !/^\d{4}-\d{2}-\d{2}$/.test(since)) throw new Error(`--since wants YYYY-MM-DD, got "${since}"`);
  const notes = [];
  let entries = [];
  let via = 'api';

  if (!args.rss) {
    try { entries = await apiSearch(since ? `cat:${cat}${rangeFrom(since)}` : `cat:${cat}`, max, cat); }
    catch (e) {
      via = 'rss';
      notes.push(`export API: ${e.message} — fell back to the RSS listing, which carries only the latest announcement`);
    }
  } else via = 'rss';
  if (via === 'rss') entries = await rssListing(cat);

  // Without --since, "today" = the most recent submission date present, plus
  // anything within `days` of it (arXiv batches announcements).
  const dayOf = (iso) => String(iso).slice(0, 10);
  const newest = entries.length ? dayOf(entries[0].published) : null;
  let papers = entries;
  if (via === 'api' && !since && newest) {
    const cutoff = Date.parse(newest) - (days - 1) * 86400000;
    papers = entries.filter((e) => Date.parse(dayOf(e.published)) >= cutoff);
  }

  const watch = (readState('tuning.json') || {}).watch || {};
  let watchHits = [];
  if ((watch.authors || []).length || (watch.comments || []).length || (watch.topics || []).length) {
    if (via === 'rss') notes.push('watch list skipped: the export API is refusing requests — re-run later, or search the watched authors and tracks by hand');
    else {
      const watchSince = since || new Date(Date.now() - 45 * 86400000).toISOString().slice(0, 10);
      try { watchHits = await watchQueries(watch, watchSince, cat); }
      catch (e) { notes.push(`watch list: ${e.message}`); }
    }
  }

  // Watched papers lead; a paper found both ways keeps its reason.
  const byId = new Map();
  for (const p of [...watchHits, ...papers]) {
    const k = baseId(p.id);
    const prev = byId.get(k);
    if (!prev) byId.set(k, p);
    else if (p.watch && !prev.watch) prev.watch = p.watch;
  }
  let merged = [...byId.values()];
  let droppedSeen = 0;
  if (args.unseen) {
    // seen.json keys are slugs of the id, with or without the version: 2609-11503v1
    const seen = new Set(((readState('seen.json') || {}).keys || []).map((k) => String(k).replace(/v\d+$/, '')));
    const before = merged.length;
    merged = merged.filter((p) => !seen.has(baseId(p.id).replace(/[^0-9a-z]+/gi, '-')));
    droppedSeen = before - merged.length;
  }

  return {
    category: cat,
    fetchedAt: new Date().toISOString(),
    via,
    since,
    newestDate: newest,
    countToday: merged.length,
    countScanned: entries.length,
    droppedSeen,
    watch: { authors: watch.authors || [], comments: watch.comments || [], hits: watchHits.length },
    notes,
    papers: merged,
  };
}

// ----------------------------------------------------------------------- art

// A public-domain painting for the masthead, from the Art Institute of Chicago
// (open API, no key, CC0 images). Pass --q "<mood or theme>"; a few candidates
// come back so the skill can pick one whose palette suits the day.
async function art() {
  const q = args.q || args._0 || 'landscape morning light';
  const limit = Number(args.limit || 8);
  const s = await get(
    `https://api.artic.edu/api/v1/artworks/search?q=${encodeURIComponent(q)}` +
    `&query[term][is_public_domain]=true&fields=id,title,artist_title,date_display,image_id,term_titles,colorfulness` +
    `&limit=${limit}`,
  );
  const w = Number(args.width || 1600);
  const picks = (s.data || [])
    .filter((a) => a.image_id)
    .map((a) => ({
      id: a.id,
      title: a.title,
      artist: a.artist_title || 'Unknown',
      date: a.date_display || '',
      credit: [a.title, a.artist_title, a.date_display].filter(Boolean).join(', '),
      iiifUrl: `https://www.artic.edu/iiif/2/${a.image_id}/full/${w},/0/default.jpg`,
      page: `https://www.artic.edu/artworks/${a.id}`,
    }));
  return { query: q, fetchedAt: new Date().toISOString(), count: picks.length, picks };
}

// --------------------------------------------------------------------- main

try {
  let out;
  if (cmd === 'weather') out = await weather(process.argv.slice(3));
  else if (cmd === 'arxiv') out = await arxiv();
  else if (cmd === 'art') out = await art();
  else {
    console.error('usage: sources.mjs weather [--here <city>] [--away <city>] | arxiv [--cat cs.HC] [--max 80] [--days 1] [--since YYYY-MM-DD] [--unseen] [--rss] | art --q "<theme>" [--limit 8] [--width 1600]');
    process.exit(1);
  }
  console.log(JSON.stringify(out, null, 2));
} catch (err) {
  console.log(JSON.stringify({ error: String(err && err.message || err) }, null, 2));
}
