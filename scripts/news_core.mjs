// Brent Watch – gemeinsame News-Logik.
// Wird vom stündlichen GitHub-Action-Fetcher (scripts/fetch_data.mjs)
// UND von der Vercel-Funktion (api/news.mjs) importiert, damit
// Feeds, Klassifikation und Lagebewertung überall identisch sind.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";

export const FEEDS = [
  { url: "https://oilprice.com/rss/main", source: "OilPrice.com" },
  { url: "https://www.aljazeera.com/xml/rss/all.xml", source: "Al Jazeera" },
  {
    url: "https://feeds.bbci.co.uk/news/world/middle_east/rss.xml",
    source: "BBC",
  },
  { url: "https://www.theguardian.com/world/rss", source: "The Guardian" },
];

export const GOOGLE_NEWS_QUERIES = [
  '"Brent crude" OR "oil price" OR OPEC when:2d',
  '"Strait of Hormuz" OR "tanker attack" OR Houthi when:2d',
  "Iran Israel (strike OR attack OR conflict OR nuclear) when:2d",
  'Russia (oil OR refinery OR sanctions) OR "price cap" when:2d',
];

export const CATEGORIES = [
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
      // "brent" allein matcht Personennamen – immer mit Öl-Kontext
      "oil price", "crude", "brent crude", "brent price", "brent oil",
      "wti", "barrel", "oil demand",
      "inventories", "inventory", "stockpile", "eia", "iea", "futures",
      "refining margin", "diesel", "gasoline",
    ],
  },
];

export const HIGH_IMPACT = [
  "strike", "strikes", "struck", "attack", "explosion", "missile", "drone",
  "war", "closure", "blockade", "blocked", "seize", "seized", "escalat",
  "invasion", "killed", "nuclear", "retaliat", "airstrike", "shot down",
];

// Geopolitische Kategorien, deren Eskalation direkt auf Brent durchschlägt
export const GEO_HOT = ["iran_israel", "hormuz_redsea", "russia_ukraine"];
const GEO_HOT_SET = new Set(GEO_HOT);

// Schwellwerte der Lagebewertung (score = 2*high + medium, letzte 24 h)
export const LEVEL_THRESHOLDS = { erhoeht: 8, angespannt: 40 };

// GDELT indexiert Weltnachrichten alle 15 Min, ist keyless und CORS-offen –
// dieselbe Abfrage nutzt auch das Dashboard client-seitig für Live-News.
export const GDELT_QUERY =
  '(iran OR israel OR hormuz OR houthi OR "red sea" OR opec OR "brent crude" OR ' +
  '"oil price" OR "crude oil" OR tanker OR "oil sanctions" OR ' +
  '(russia AND oil) OR (ukraine AND refinery)) sourcelang:english';

export function gdeltUrl(maxrecords = 100, timespan = "8h") {
  return (
    "https://api.gdeltproject.org/api/v2/doc/doc?query=" +
    encodeURIComponent(GDELT_QUERY) +
    `&mode=artlist&format=json&maxrecords=${maxrecords}&timespan=${timespan}`
  );
}

// "20261022T120000Z" → ISO-String
export function parseGdeltDate(s) {
  if (!/^\d{8}T\d{6}Z$/.test(s ?? "")) return null;
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T${s.slice(9, 11)}:${s.slice(11, 13)}:${s.slice(13, 15)}Z`;
}

export function mapGdeltArticle(a) {
  const pubDate = parseGdeltDate(a?.seendate);
  if (!a?.title || !a?.url || !pubDate) return null;
  return {
    title: a.title.trim(),
    link: a.url,
    source: a.domain || "GDELT",
    pubDate,
    description: "",
  };
}

async function fetchGdelt(timeoutMs, log) {
  try {
    const res = await fetchWithTimeout(gdeltUrl(), timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    // Rate-Limit-Antworten sind Klartext – JSON.parse wirft dann
    const json = JSON.parse(await res.text());
    return (json.articles ?? []).map(mapGdeltArticle).filter(Boolean);
  } catch (err) {
    log?.(`GDELT übersprungen: ${err.message}`);
    return [];
  }
}

async function fetchWithTimeout(url, ms) {
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

export function classify(item) {
  const text = `${item.title} ${item.description}`.toLowerCase();
  const cats = CATEGORIES.filter((c) =>
    c.keywords.some((k) => text.includes(k))
  ).map((c) => c.id);
  if (cats.length === 0) return null;

  const hot = cats.some((c) => GEO_HOT_SET.has(c));
  const impact = HIGH_IMPACT.some((k) => text.includes(k));
  const severity =
    text.includes("hormuz") || (hot && impact)
      ? "high"
      : hot || impact || cats.includes("opec")
        ? "medium"
        : "low";

  return { ...item, categories: cats, severity };
}

async function fetchFeed(url, source, timeoutMs, log) {
  try {
    const res = await fetchWithTimeout(url, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseRss(await res.text(), source);
  } catch (err) {
    log?.(`Feed übersprungen (${source}): ${err.message}`);
    return [];
  }
}

export async function fetchNews({ timeoutMs = 20000, log = console.error } = {}) {
  const jobs = [
    ...FEEDS.map((f) => fetchFeed(f.url, f.source, timeoutMs, log)),
    ...GOOGLE_NEWS_QUERIES.map((q) =>
      fetchFeed(
        "https://news.google.com/rss/search?q=" +
          encodeURIComponent(q) +
          "&hl=en-US&gl=US&ceid=US:en",
        "Google News",
        timeoutMs,
        log
      )
    ),
    fetchGdelt(timeoutMs, log).then((items) => {
      log?.(`GDELT: ${items.length} Artikel`);
      return items;
    }),
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
export function buildRegions(news) {
  const dayAgo = Date.now() - 24 * 3600 * 1000;
  return CATEGORIES.filter((c) => c.id !== "market").map((c) => {
    const recent = news.filter(
      (n) => n.categories.includes(c.id) && Date.parse(n.pubDate) >= dayAgo
    );
    const high = recent.filter((n) => n.severity === "high").length;
    const medium = recent.filter((n) => n.severity === "medium").length;
    const score = 2 * high + medium;
    const level =
      score === 0 ? "ruhig"
        : score <= LEVEL_THRESHOLDS.erhoeht ? "erhöht"
          : score <= LEVEL_THRESHOLDS.angespannt ? "angespannt"
            : "kritisch";
    return { id: c.id, label: c.label, count24h: recent.length, high24h: high, level };
  });
}
