// Brent Watch – stündlicher Daten-Fetcher
// Läuft ohne Dependencies unter Node 20+ (global fetch).
// Holt Kurse von Yahoo Finance und News aus RSS-Feeds,
// bewertet sie nach Region + Schweregrad und schreibt data/data.json.

import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT_FILE = join(ROOT, "data", "data.json");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

// ---------------------------------------------------------------- Kurse

const QUOTES = [
  { id: "brent", symbol: "BZ=F", tv: ["futures", "ICEEUR:BRN1!"], fred: "DCOILBRENTEU", name: "Brent Crude", unit: "USD/bbl" },
  { id: "wti", symbol: "CL=F", tv: ["futures", "NYMEX:CL1!"], fred: "DCOILWTICO", name: "WTI Crude", unit: "USD/bbl" },
  { id: "natgas", symbol: "NG=F", tv: ["global", "NYMEX:NG1!"], fred: "DHHNGSP", name: "Henry Hub Gas", unit: "USD/MMBtu" },
  { id: "dxy", symbol: "DX-Y.NYB", tv: ["global", "TVC:DXY"], name: "US-Dollar-Index", unit: "" },
  { id: "gold", symbol: "GC=F", tv: ["global", "TVC:GOLD"], name: "Gold", unit: "USD/oz" },
];

async function fetchWithTimeout(url, ms = 20000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "*/*" },
    });
  } finally {
    clearTimeout(t);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Yahoo drosselt gern (429) – zwei Hosts, zwei Versuche mit Backoff
async function fetchYahooChart(symbol) {
  const hosts = ["query1", "query2"];
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    for (const host of hosts) {
      const url =
        `https://${host}.finance.yahoo.com/v8/finance/chart/` +
        encodeURIComponent(symbol) +
        "?range=10d&interval=1h&includePrePost=false";
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
  const closes = (result.indicators?.quote?.[0]?.close ?? []).map((v, i) => ({
    t: result.timestamp?.[i] ?? null,
    v,
  }));
  const points = closes.filter((p) => p.v != null && p.t != null);
  const spark = points.map((p) => ({ t: p.t, v: round(p.v) }));

  const price = meta.regularMarketPrice ?? points.at(-1)?.v ?? null;
  const prevClose = meta.previousClose ?? meta.chartPreviousClose ?? null;
  const changePct =
    price != null && prevClose ? ((price - prevClose) / prevClose) * 100 : null;

  // Veränderung über ~24 Handelsstunden für die Wochen-Perspektive
  const dayAgo = points.at(-1)
    ? points.filter((p) => p.t <= points.at(-1).t - 86400).at(-1)
    : null;
  const change24hPct =
    price != null && dayAgo ? ((price - dayAgo.v) / dayAgo.v) * 100 : null;

  return {
    id,
    symbol,
    name,
    unit,
    price: round(price),
    prevClose: round(prevClose),
    changePct: round(changePct, 2),
    change24hPct: round(change24hPct, 2),
    spark,
    sparkKind: "intraday",
  };
}

function round(v, d = 2) {
  return v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
}

// Sparkline-Fallback: FRED-Tagesdaten (keyless, 1–3 Tage Verzögerung).
// Reicht als 30-Tage-Trend, wenn Yahoo keine Stunden-Historie liefert.
async function fetchFredSpark(seriesId) {
  const start = new Date(Date.now() - 40 * 86400000).toISOString().slice(0, 10);
  // FRED tarpittet den vollen Chrome-UA aus Nicht-Browsern – schlanker UA nötig
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  let res;
  try {
    res = await fetch(
      `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${seriesId}&cosd=${start}`,
      { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0" } }
    );
  } finally {
    clearTimeout(t);
  }
  if (!res.ok) throw new Error(`FRED ${seriesId}: HTTP ${res.status}`);
  const rows = (await res.text()).trim().split("\n").slice(1);
  return rows
    .map((row) => {
      const [date, value] = row.split(",");
      // FRED markiert Feiertage/Lücken mit "." oder leerem Feld
      return { t: Math.floor(Date.parse(date) / 1000), v: round(Number(value)) };
    })
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.v) && p.v > 0)
    .slice(-30);
}

// Fallback: TradingView-Scanner (keyless). Liefert Preis + %-Änderung,
// aber keine Historie – die Sparkline wird dann aus dem letzten Stand übernommen.
async function scanTradingView(scope, tickers) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    const res = await fetch(`https://scanner.tradingview.com/${scope}/scan`, {
      method: "POST",
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Content-Type": "application/json" },
      body: JSON.stringify({
        symbols: { tickers, query: { types: [] } },
        columns: ["close", "change"],
      }),
    });
    if (!res.ok) throw new Error(`TradingView ${scope}: HTTP ${res.status}`);
    const json = await res.json();
    const map = {};
    for (const row of json.data ?? []) {
      map[row.s] = { price: row.d[0], changePct: row.d[1] };
    }
    return map;
  } finally {
    clearTimeout(t);
  }
}

// ---------------------------------------------------------------- News

const FEEDS = [
  { url: "https://oilprice.com/rss/main", source: "OilPrice.com" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  {
    url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    source: "BBC",
  },
  { url: "https://www.theguardian.com/world/rss", source: "The Guardian" },
];

const GOOGLE_NEWS_QUERIES = [
  'Brent OR "oil price" OR OPEC when:2d',
  '"Strait of Hormuz" OR "tanker attack" OR Houthi when:2d',
  "Iran Israel (strike OR attack OR conflict OR nuclear) when:2d",
  'Russia (oil OR refinery OR sanctions) OR "price cap" when:2d',
];

const CATEGORIES = [
  {
    id: "iran_israel",
    label: "Iran – Israel",
    keywords: [
      "iran", "iranian", "israel", "israeli", "tehran", "irgc", "hezbollah",
      "hisbollah", "netanyahu", "khamenei", "idf", "natanz", "fordow", "gaza",
      "lebanon",
    ],
  },
  {
    id: "hormuz_redsea",
    label: "Hormus & Rotes Meer",
    keywords: [
      "hormuz", "houthi", "huthi", "red sea", "yemen", "bab el-mandeb",
      "bab al-mandab", "tanker", "suez", "shipping lane", "vessel attack",
    ],
  },
  {
    id: "russia_ukraine",
    label: "Russland – Ukraine",
    keywords: [
      "russia", "russian", "ukraine", "ukrainian", "moscow", "kyiv", "kremlin",
      "urals", "druzhba", "novorossiysk", "primorsk",
    ],
  },
  {
    id: "opec",
    label: "OPEC+",
    keywords: [
      "opec", "saudi", "riyadh", "aramco", "production cut", "output cut",
      "output hike", "quota", "kuwait", "united arab emirates", "uae oil",
    ],
  },
  {
    id: "usa_policy",
    label: "USA & Sanktionen",
    keywords: [
      "sanction", "tariff", "embargo", "price cap", "export ban",
      "strategic petroleum", "spr release", "white house oil",
    ],
  },
  {
    id: "supply_other",
    label: "Weitere Förderländer",
    keywords: [
      "libya", "libyan", "nigeria", "venezuela", "kazakhstan", "iraq", "iraqi",
      "force majeure", "pipeline", "oilfield", "oil field", "guyana", "kirkuk",
    ],
  },
  {
    id: "market",
    label: "Markt & Nachfrage",
    keywords: [
      "oil price", "crude", "brent", "wti", "barrel", "oil demand",
      "inventories", "inventory", "stockpile", "eia", "iea", "futures",
      "refining margin", "diesel", "gasoline",
    ],
  },
];

const HIGH_IMPACT = [
  "strike", "strikes", "struck", "attack", "explosion", "missile", "drone",
  "war", "closure", "blockade", "blocked", "seize", "seized", "escalat",
  "invasion", "killed", "nuclear", "retaliat", "airstrike", "shot down",
];

// Geopolitische Kategorien, deren Eskalation direkt auf Brent durchschlägt
const GEO_HOT = new Set(["iran_israel", "hormuz_redsea", "russia_ukraine"]);

function decodeEntities(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function tag(xml, name) {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return m ? decodeEntities(m[1]) : "";
}

function parseRss(xml, fallbackSource) {
  const items = xml.match(/<item[\s\S]*?<\/item>/gi) ?? [];
  return items.map((item) => {
    let title = tag(item, "title");
    let source = tag(item, "source") || fallbackSource;
    // Google News hängt die Quelle an den Titel: "Headline - Quelle"
    const sep = title.lastIndexOf(" - ");
    if (fallbackSource === "Google News" && sep > 20) {
      source = title.slice(sep + 3).trim() || source;
      title = title.slice(0, sep).trim();
    }
    const pub = Date.parse(tag(item, "pubDate") || tag(item, "dc:date"));
    return {
      title,
      link: tag(item, "link"),
      source,
      pubDate: Number.isFinite(pub) ? new Date(pub).toISOString() : null,
      description: tag(item, "description").slice(0, 300),
    };
  });
}

function classify(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const cats = CATEGORIES.filter((c) =>
    c.keywords.some((k) => text.includes(k))
  ).map((c) => c.id);
  if (cats.length === 0) return null;

  const hot = cats.some((c) => GEO_HOT.has(c));
  const impact = HIGH_IMPACT.some((k) => text.includes(k));
  const severity =
    text.includes("hormuz") || (hot && impact)
      ? "high"
      : hot || impact || cats.includes("opec")
        ? "medium"
        : "low";

  return { ...item, categories: cats, severity };
}

async function fetchFeed(url, source) {
  try {
    const res = await fetchWithTimeout(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRss(await res.text(), source);
  } catch (err) {
    console.error(`Feed übersprungen (${source}): ${err.message}`);
    return [];
  }
}

async function fetchNews() {
  const jobs = [
    ...FEEDS.map((f) => fetchFeed(f.url, f.source)),
    ...GOOGLE_NEWS_QUERIES.map((q) =>
      fetchFeed(
        "https://news.google.com/rss/search?q=" +
          encodeURIComponent(q) +
          "&hl=en-US&gl=US&ceid=US:en",
        "Google News"
      )
    ),
  ];
  const all = (await Promise.all(jobs)).flat();

  const cutoff = Date.now() - 72 * 3600 * 1000;
  const seen = new Set();
  const news = [];
  for (const raw of all) {
    if (!raw.title || !raw.pubDate || Date.parse(raw.pubDate) < cutoff) continue;
    const key = raw.title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
    if (!key || seen.has(key)) continue;
    const item = classify(raw);
    if (!item) continue;
    seen.add(key);
    news.push(item);
  }
  news.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  return news.slice(0, 120);
}

// Lagebewertung pro Region aus den News der letzten 24 h
function buildRegions(news) {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  return CATEGORIES.filter((c) => c.id !== "market").map((c) => {
    const recent = news.filter(
      (n) => n.categories.includes(c.id) && Date.parse(n.pubDate) >= dayAgo
    );
    const high = recent.filter((n) => n.severity === "high").length;
    const medium = recent.filter((n) => n.severity === "medium").length;
    const score = 2 * high + medium;
    const level =
      score === 0 ? "ruhig" : score <= 8 ? "erhöht" : score <= 40 ? "angespannt" : "kritisch";
    return { id: c.id, label: c.label, count24h: recent.length, high24h: high, level };
  });
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

// TradingView-Fallback einmal für alle Symbole abfragen
let tvQuotes = {};
try {
  const scopes = [...new Set(QUOTES.map((q) => q.tv[0]))];
  const results = await Promise.all(
    scopes.map((scope) =>
      scanTradingView(scope, QUOTES.filter((q) => q.tv[0] === scope).map((q) => q.tv[1]))
    )
  );
  tvQuotes = Object.assign({}, ...results);
} catch (err) {
  console.error(`TradingView-Fallback nicht verfügbar: ${err.message}`);
}

const quotes = [];
for (const q of QUOTES) {
  const old = previous?.quotes?.find((p) => p.id === q.id);
  try {
    quotes.push(await fetchQuote(q));
    console.log(`Kurs ok (Yahoo): ${q.name}`);
  } catch (err) {
    const tv = tvQuotes[q.tv[1]];
    if (tv?.price != null) {
      // Sparkline: letzter bekannter Stand, sonst FRED-Tagestrend
      let spark = old?.spark?.length >= 2 ? old.spark : [];
      let sparkKind = old?.sparkKind ?? "intraday";
      if (spark.length < 2 && q.fred) {
        try {
          spark = await fetchFredSpark(q.fred);
          sparkKind = "daily";
        } catch (err) {
          console.error(`FRED-Fallback fehlgeschlagen (${q.name}): ${err.message}`);
        }
      }
      quotes.push({
        id: q.id,
        symbol: q.symbol,
        name: q.name,
        unit: q.unit,
        price: round(tv.price),
        prevClose: round(tv.price / (1 + tv.changePct / 100)),
        changePct: round(tv.changePct, 2),
        change24hPct: null,
        spark,
        sparkKind,
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

const news = await fetchNews();
console.log(`News: ${news.length} relevante Meldungen`);

const data = {
  updatedAt: new Date().toISOString(),
  quotes,
  news,
  regions: buildRegions(news),
};

mkdirSync(dirname(OUT_FILE), { recursive: true });
writeFileSync(OUT_FILE, JSON.stringify(data, null, 1));
console.log(`Geschrieben: ${OUT_FILE}`);
