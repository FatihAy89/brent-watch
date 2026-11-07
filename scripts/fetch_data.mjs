// Brent Watch – Daten-Fetcher (GitHub Action, läuft alle paar Minuten)
// Läuft ohne Dependencies unter Node 20+ (global fetch).
// Holt Kurse (Yahoo → TradingView-Fallback) und News (scripts/news_core.mjs)
// und schreibt data/data.json als Snapshot/Fallback für das Dashboard.
// Die minütlichen Kurse und 5-Minuten-News holt sich die Seite selbst
// (TradingView-Scanner bzw. Vercel-Funktion /api/news).

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  fetchNews, mergeNews, buildRegions, CATEGORIES, HIGH_IMPACT, GEO_HOT, LEVEL_THRESHOLDS,
  BLUESKY_ACCOUNTS,
} from "./news_core.mjs";
import { detectAlerts, sendAlerts } from "./alerts.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "data", "data.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ---------------------------------------------------------------- Kurse

const QUOTES = [
  { id: "brent", symbol: "BZ=F", tv: ["futures", "ICEEUR:BRN1!"], name: "Brent Crude", unit: "USD/bbl" },
  { id: "wti", symbol: "CL=F", tv: ["futures", "NYMEX:CL1!"], name: "WTI Crude", unit: "USD/bbl" },
  { id: "natgas", symbol: "NG=F", tv: ["global", "NYMEX:NG1!"], name: "Henry Hub Gas", unit: "USD/MMBtu" },
  { id: "dxy", symbol: "DX-Y.NYB", tv: ["global", "TVC:DXY"], name: "US-Dollar-Index", unit: "" },
  { id: "gold", symbol: "GC=F", tv: ["global", "TVC:GOLD"], name: "Gold", unit: "USD/oz" },
  // CBOE Crude Oil Volatility Index – das „Angstbarometer“ des Ölmarkts.
  // Yahoo ist von GitHub-Runnern aus meist gesperrt, daher zuerst die CBOE selbst
  { id: "ovx", symbol: "^OVX", cboe: "OVX", tv: ["america", "CBOE:OVX"], name: "Öl-Volatilität (OVX)", unit: "Index" },
];

// Kursverlauf für den Chart „Kurs & Ereignisse“ (15-Min-Kerzen, 5 Tage)
const HISTORY = { id: "brent", symbol: "BZ=F", range: "5d", interval: "15m" };
const HISTORY_MAX_AGE_MS = 5 * 24 * 3600 * 1000;

function round(v, d = 2) {
  return v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWithTimeout(url, ms = 20000, init = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*", ...(init.headers ?? {}) },
      ...init,
    });
  } finally {
    clearTimeout(t);
  }
}

// Yahoo drosselt gern (429) – zwei Hosts, zwei Versuche mit Backoff
async function fetchYahooChart(symbol, range = "2d", interval = "1h") {
  const hosts = ["query1", "query2"];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const host of hosts) {
      const url =
        `https://${host}.finance.yahoo.com/v8/finance/chart/` +
        encodeURIComponent(symbol) +
        `?range=${range}&interval=${interval}&includePrePost=false`;
      try {
        const res = await fetchWithTimeout(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
      } catch (err) {
        lastErr = err;
        await sleep(1000);
      }
    }
    await sleep(4000);
  }
  throw new Error(`Yahoo ${symbol}: ${lastErr?.message}`);
}

async function fetchQuote({ id, symbol, name, unit }) {
  const json = await fetchYahooChart(symbol);
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo ${symbol}: leere Antwort`);

  const meta = result.meta ?? {};
  const closes = (result.indicators?.quote?.[0]?.close ?? []).filter((v) => v != null);
  const price = meta.regularMarketPrice ?? closes.at(-1) ?? null;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const changePct =
    price != null && prevClose ? ((price - prevClose) / prevClose) * 100 : null;

  return {
    id,
    symbol,
    name,
    unit,
    price: round(price),
    prevClose: round(prevClose),
    changePct: round(changePct, 2),
  };
}

// CBOE-Indizes (keyless): aktueller Kurs aus den verzögerten Kursen (JSON),
// Vortagesschluss aus den Tagesschlusskursen (CSV). Das JSON setzt nach
// Handelsschluss prev_day_close auf den aktuellen Kurs – die Tagesänderung
// stünde dann bis zur nächsten Sitzung fälschlich auf 0 %.
async function cboeQuote(cboe) {
  const res = await fetchWithTimeout(`https://cdn.cboe.com/api/global/delayed_quotes/quotes/_${cboe}.json`);
  if (!res.ok) throw new Error(`JSON HTTP ${res.status}`);
  const d = (await res.json())?.data ?? {};
  const price = d.current_price ?? d.last ?? d.close;
  if (!Number.isFinite(price)) throw new Error("kein Kurs im JSON");
  return { price, prevClose: d.prev_day_close ?? null };
}

// Die letzten beiden Tagesschlusskurse [vorletzter, letzter] (DATE,OPEN,HIGH,LOW,CLOSE)
async function cboeCloses(cboe) {
  const res = await fetchWithTimeout(`https://cdn.cboe.com/api/global/us_indices/daily_prices/${cboe}_History.csv`);
  if (!res.ok) throw new Error(`CSV HTTP ${res.status}`);
  const closes = (await res.text()).trim().split(/\r?\n/).slice(-2).map((l) => Number(l.split(",").at(-1)));
  if (closes.length < 2 || !closes.every(Number.isFinite)) throw new Error("CSV ohne Kurse");
  return closes;
}

async function fetchCboe({ id, symbol, name, unit, cboe }) {
  const [q, c] = await Promise.allSettled([cboeQuote(cboe), cboeCloses(cboe)]);
  const closes = c.status === "fulfilled" ? c.value : null;
  let price, prevClose, source;
  if (q.status === "fulfilled") {
    price = q.value.price;
    source = "cboe";
    if (closes) {
      // Steht der heutige Schluss schon in der CSV, ist er gleich dem Kurs –
      // dann ist der vorletzte Eintrag der Vortag
      prevClose = Math.abs(price - closes[1]) < 0.005 ? closes[0] : closes[1];
    } else {
      const p = q.value.prevClose;
      prevClose = Number.isFinite(p) && Math.abs(price - p) >= 0.005 ? p : null;
    }
  } else if (closes) {
    [prevClose, price] = closes;
    source = "cboe-close";
  } else {
    throw new Error(`CBOE ${cboe}: ${q.reason?.message}; ${c.reason?.message}`);
  }
  const changePct = prevClose ? ((price - prevClose) / prevClose) * 100 : null;
  return { id, symbol, name, unit, price: round(price), prevClose: round(prevClose), changePct: round(changePct), source };
}

// Kerzen als [Unix-Sekunden, Schlusskurs]
async function fetchHistory({ symbol, range, interval }) {
  const json = await fetchYahooChart(symbol, range, interval);
  const result = json?.chart?.result?.[0];
  const ts = result?.timestamp ?? [];
  const closes = result?.indicators?.quote?.[0]?.close ?? [];
  const points = ts
    .map((t, i) => [t, closes[i]])
    .filter(([t, c]) => Number.isFinite(t) && Number.isFinite(c))
    .map(([t, c]) => [t, round(c)]);
  if (points.length < 10) throw new Error(`Yahoo ${symbol}: zu wenige Kerzen (${points.length})`);
  return points;
}

// Fallback: TradingView-Scanner (keyless). Liefert Preis + %-Änderung.
async function scanTradingView(scope, tickers) {
  const res = await fetchWithTimeout(
    `https://scanner.tradingview.com/${scope}/scan`,
    20000,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols: { tickers, query: { types: [] } },
        columns: ["close", "change"],
      }),
    }
  );
  if (!res.ok) throw new Error(`TradingView ${scope}: HTTP ${res.status}`);
  const json = await res.json();
  const map = {};
  for (const row of json.data ?? []) {
    map[row.s] = { price: row.d[0], changePct: row.d[1] };
  }
  return map;
}

// ---------------------------------------------------------------- Main

function loadPrevious() {
  try {
    return JSON.parse(readFileSync(OUT_FILE, "utf8"));
  } catch {
    return null;
  }
}

const previous = loadPrevious();

// TradingView-Fallback einmal für alle Symbole abfragen – pro Scope einzeln,
// damit ein fehlschlagender Scope die anderen nicht mitreißt
let tvQuotes = {};
const scopes = [...new Set(QUOTES.map((q) => q.tv[0]))];
const tvResults = await Promise.allSettled(
  scopes.map((scope) =>
    scanTradingView(scope, QUOTES.filter((q) => q.tv[0] === scope).map((q) => q.tv[1]))
  )
);
tvResults.forEach((r, i) => {
  if (r.status === "fulfilled") Object.assign(tvQuotes, r.value);
  else console.error(`TradingView-Fallback (${scopes[i]}) nicht verfügbar: ${r.reason?.message}`);
});

const quotes = [];
for (const q of QUOTES) {
  const old = previous?.quotes?.find((p) => p.id === q.id);
  try {
    quotes.push(await fetchQuote(q));
    console.log(`Kurs ok (Yahoo): ${q.name}`);
  } catch (err) {
    if (q.cboe) {
      try {
        quotes.push(await fetchCboe(q));
        console.log(`Kurs ok (CBOE): ${q.name} – Yahoo: ${err.message}`);
        continue;
      } catch (cboeErr) {
        console.error(`CBOE fehlgeschlagen (${q.name}): ${cboeErr.message}`);
      }
    }
    const tv = tvQuotes[q.tv[1]];
    if (tv?.price != null) {
      quotes.push({
        id: q.id,
        symbol: q.symbol,
        name: q.name,
        unit: q.unit,
        price: round(tv.price),
        prevClose: round(tv.price / (1 + tv.changePct / 100)),
        changePct: round(tv.changePct, 2),
        source: "tradingview",
      });
      console.log(`Kurs ok (TradingView-Fallback): ${q.name} – Yahoo: ${err.message}`);
    } else if (old) {
      quotes.push({ ...old, stale: true });
      console.error(`Kurs veraltet übernommen (${q.name}): ${err.message}`);
    } else {
      console.error(`Kurs fehlgeschlagen (${q.name}): ${err.message}`);
    }
  }
}

// Kursverlauf: Yahoo-Kerzen; fällt Yahoo aus, wird der letzte Verlauf um
// den aktuellen Kurs ergänzt (ein Punkt pro Lauf), damit der Chart weiterläuft
const history = { ...(previous?.history ?? {}) };
try {
  history[HISTORY.id] = {
    interval: HISTORY.interval,
    source: "yahoo",
    points: await fetchHistory(HISTORY),
  };
  console.log(`Kursverlauf ok (Yahoo): ${history[HISTORY.id].points.length} Kerzen`);
} catch (err) {
  const q = quotes.find((x) => x.id === HISTORY.id);
  const minT = (Date.now() - HISTORY_MAX_AGE_MS) / 1000;
  const points = (history[HISTORY.id]?.points ?? []).filter(([t]) => t >= minT);
  // Nur bei Kursänderung: in Handelspausen (Nacht, Wochenende) entsteht so
  // keine flache Linie, der Chart schiebt die Pause zusammen
  if (q?.price != null && !q.stale && q.price !== points.at(-1)?.[1]) {
    points.push([Math.floor(Date.now() / 1000), q.price]);
  }
  history[HISTORY.id] = { interval: HISTORY.interval, source: "snapshot", points };
  console.error(`Kursverlauf aus Snapshots fortgeschrieben (${points.length} Punkte): ${err.message}`);
}

const { news: freshNews, sources } = await fetchNews();
// Meldungen des letzten Snapshots behalten (max. 72 h): fällt eine Quelle
// kurz aus, verschwinden ihre Posts nicht sofort aus dem Ticker
const news = mergeNews([...freshNews, ...(previous?.news ?? [])]);
console.log(`News: ${freshNews.length} neu abgerufen, ${news.length} im Ticker`);

const regions = buildRegions(news);

// Alarme (Region kritisch, Kurssprung, OVX, Schlüsselereignisse) erkennen,
// per ntfy pushen und im Verlauf ablegen – der Verlauf dient zugleich als
// Gedächtnis für die Sperrzeiten der einzelnen Alarme
const fresh = detectAlerts({ previous, quotes, history, news, regions });
await sendAlerts(fresh);
const alerts = [...fresh, ...(previous?.alerts ?? [])]
  .filter((a) => Date.now() - Date.parse(a.at) < 72 * 3600 * 1000)
  .slice(0, 30);

const data = {
  updatedAt: new Date().toISOString(),
  quotes,
  history,
  alerts,
  news,
  regions,
  sources,
  // Accounts, die das Dashboard zusätzlich live im Browser abfragt
  social: { bluesky: BLUESKY_ACCOUNTS },
  // Konfiguration für die client-seitige Klassifikation der Live-News
  classifier: {
    categories: CATEGORIES,
    highImpact: HIGH_IMPACT,
    geoHot: GEO_HOT,
    thresholds: LEVEL_THRESHOLDS,
  },
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(data, null, 1));
console.log(`Geschrieben: ${OUT_FILE}`);
