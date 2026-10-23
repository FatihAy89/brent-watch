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

// Social: öffentliche Telegram-Kanäle (Web-Vorschau t.me/s/…, keyless) und
// Bluesky-Accounts (offene AppView-API, keyless + CORS – das Dashboard fragt
// sie zusätzlich direkt im Browser ab). Kanäle ohne Treffer werden im Log und
// in data.json → sources gemeldet, damit tote Quellen auffallen.
export const TELEGRAM_CHANNELS = [
  { id: "IranIntl_En", name: "Iran International" },
  { id: "FaytuksNews", name: "Faytuks News" },
  { id: "AuroraIntel", name: "Aurora Intel" },
  { id: "bnonews", name: "BNO News" },
  { id: "QudsNen", name: "Quds News Network" },
  { id: "warmonitors", name: "War Monitor" },
  { id: "spectatorindex", name: "The Spectator Index" },
  { id: "insiderpaper", name: "Insider Paper" },
];

export const BLUESKY_ACCOUNTS = [
  { handle: "reuters.com", name: "Reuters" },
  { handle: "apnews.com", name: "AP" },
  { handle: "aljazeera.com", name: "Al Jazeera" },
  { handle: "bnonews.com", name: "BNO News" },
  { handle: "theguardian.com", name: "The Guardian" },
  { handle: "osinttechnical.bsky.social", name: "OSINTtechnical" },
  { handle: "javierblas.bsky.social", name: "Javier Blas" },
  { handle: "liveuamap.bsky.social", name: "Liveuamap" },
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

// Social-Posts haben keine Überschrift: erster Satz/Zeile als Titel,
// der Rest wandert in die Beschreibung (für die Klassifikation).
export function socialTitle(text, max = 220) {
  const clean = text.replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(" "));
  return cut.slice(0, stop > 80 ? stop : max).trim() + " …";
}

export function parseTelegram(html, channel) {
  const posts = [];
  for (const chunk of html.split('data-post="').slice(1)) {
    const postId = chunk.slice(0, chunk.indexOf('"'));
    const body = chunk.match(
      /class="tgme_widget_message_text js-message_text"[^>]*>([\s\S]*?)<\/div>/
    );
    const time = [...chunk.matchAll(/<time[^>]*datetime="([^"]+)"/g)].at(-1);
    if (!body || !time || !/^[\w]+\/\d+$/.test(postId)) continue;
    const text = decodeEntities(body[1].replace(/<br\s*\/?>/gi, " "));
    const pub = Date.parse(time[1]);
    if (!text || !Number.isFinite(pub)) continue;
    posts.push({
      title: socialTitle(text),
      link: `https://t.me/${postId}`,
      source: channel.name,
      pubDate: new Date(pub).toISOString(),
      description: text.slice(0, 600),
      social: "telegram",
    });
  }
  return posts;
}

async function fetchTelegram(channel, timeoutMs, log) {
  try {
    const res = await fetchWithTimeout(`https://t.me/s/${channel.id}`, timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const posts = parseTelegram(await res.text(), channel);
    if (!posts.length) throw new Error("keine Posts gefunden");
    return posts;
  } catch (err) {
    log?.(`Telegram übersprungen (${channel.id}): ${err.message}`);
    return [];
  }
}

export function blueskyFeedUrl(handle, limit = 40) {
  return (
    "https://public.api.bsky.app/xrpc/app.bsky.feed.getAuthorFeed?actor=" +
    encodeURIComponent(handle) +
    `&limit=${limit}&filter=posts_no_replies`
  );
}

// Eigene Posts eines Accounts (Reposts übersprungen) → News-Items
export function mapBlueskyFeed(json, account) {
  const out = [];
  for (const entry of json?.feed ?? []) {
    if (entry.reason) continue;
    const post = entry.post;
    const rec = post?.record;
    const rkey = post?.uri?.split("/").pop();
    const pub = Date.parse(rec?.createdAt ?? post?.indexedAt);
    if (!rec?.text || !rkey || !Number.isFinite(pub)) continue;
    // Link-Karten (Schlagzeile des verlinkten Artikels) helfen der Klassifikation
    const ext = post.embed?.external ?? rec.embed?.external;
    const extra = ext ? ` ${ext.title ?? ""} ${ext.description ?? ""}` : "";
    out.push({
      title: socialTitle(rec.text),
      link: `https://bsky.app/profile/${post.author?.handle ?? account.handle}/post/${rkey}`,
      source: account.name,
      pubDate: new Date(pub).toISOString(),
      description: (rec.text + extra).slice(0, 600),
      social: "bluesky",
    });
  }
  return out;
}

async function fetchBluesky(account, timeoutMs, log) {
  try {
    const res = await fetchWithTimeout(blueskyFeedUrl(account.handle), timeoutMs);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return mapBlueskyFeed(await res.json(), account);
  } catch (err) {
    log?.(`Bluesky übersprungen (${account.handle}): ${err.message}`);
    return [];
  }
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

// Sammelt alle Quellen; jede Quelle meldet ihre Trefferzahl in `sources`
export async function fetchNews({ timeoutMs = 20000, log = console.error } = {}) {
  const sources = [];
  const track = (name, kind, promise) =>
    promise.then((items) => {
      sources.push({ name, kind, items: items.length });
      return items;
    });

  const jobs = [
    ...FEEDS.map((f) => track(f.source, "rss", fetchFeed(f.url, f.source, timeoutMs, log))),
    ...GOOGLE_NEWS_QUERIES.map((q, i) =>
      track(
        `Google News #${i + 1}`,
        "rss",
        fetchFeed(
          "https://news.google.com/rss/search?q=" +
            encodeURIComponent(q) +
            "&hl=en-US&gl=US&ceid=US:en",
          "Google News",
          timeoutMs,
          log
        )
      )
    ),
    track("GDELT", "api", fetchGdelt(timeoutMs, log)),
    ...TELEGRAM_CHANNELS.map((c) =>
      track(`t.me/${c.id}`, "telegram", fetchTelegram(c, timeoutMs, log))
    ),
    ...BLUESKY_ACCOUNTS.map((a) =>
      track(`@${a.handle}`, "bluesky", fetchBluesky(a, timeoutMs, log))
    ),
  ];
  const all = (await Promise.all(jobs)).flat();
  const news = mergeNews(all);
  for (const s of sources) {
    log?.(`Quelle ${s.kind.padEnd(8)} ${s.name}: ${s.items}`);
  }
  return { news, sources };
}

export function newsKey(title) {
  return title.toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 60);
}

// Filtern (72 h), deduplizieren, klassifizieren, sortieren
export function mergeNews(all, limit = 200) {
  const cutoff = Date.now() - 72 * 3600 * 1000;
  const seen = new Set();
  const news = [];
  for (const raw of all) {
    if (!raw.title || !raw.pubDate || Date.parse(raw.pubDate) < cutoff) continue;
    const key = newsKey(raw.title);
    if (!key || seen.has(key)) continue;
    const item = classify(raw);
    if (!item) continue;
    seen.add(key);
    news.push(item);
  }
  news.sort((a, b) => Date.parse(b.pubDate) - Date.parse(a.pubDate));
  return news.slice(0, limit);
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
