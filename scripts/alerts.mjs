// Brent Watch – Alarme per ntfy (https://ntfy.sh, keyless Push aufs Handy).
// Wird von scripts/fetch_data.mjs nach jedem Abruf aufgerufen. Ohne die
// Umgebungsvariable NTFY_TOPIC werden Alarme nur erkannt und in data.json
// protokolliert (Dashboard „Letzte Alarme“), aber nicht verschickt.
//
// Test-Push: NTFY_TOPIC=dein-thema node scripts/alerts.mjs --test

import { pathToFileURL } from "node:url";
import { newsKey } from "./news_core.mjs";

const NTFY_SERVER = (process.env.NTFY_SERVER || "https://ntfy.sh").replace(/\/+$/, "");
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const NTFY_TOKEN = process.env.NTFY_TOKEN || "";

export const ALERT_RULES = {
  brentMovePct: 2,      // Brent-Bewegung binnen ~1 Std in %
  ovxJumpPct: 10,       // OVX-Anstieg zum Vortag in %
  confirmSources: 2,    // Schlüsselereignis: so viele verschiedene Quellen …
  confirmWindowH: 3,    // … innerhalb dieser Stunden
};

// Sperrzeit pro Alarmtyp in Stunden: derselbe Alarm kommt frühestens danach wieder
const COOLDOWN_H = { region: 6, brent: 3, ovx: 12, event: 6 };

// Ereignisse mit direkter Wirkung auf das Ölangebot. Gemeldet wird erst, wenn
// mehrere unabhängige Quellen berichten – eine einzelne Schlagzeile (Clickbait,
// Gerücht, Finte) löst nichts aus.
export const KEY_EVENTS = [
  {
    id: "hormuz-closure",
    label: "Hormus: Sperrung oder Blockade gemeldet",
    priority: 5,
    re: /hormuz[^.]{0,60}\b(?:closed?|closes|closing|closure|shut\w*|block\w*)\b|\b(?:closed?|closes|closing|closure|shut\w*|block\w*)\b[^.]{0,60}hormuz/i,
    // Drohungen, Befürchtungen und Konjunktive sind (noch) keine Sperrung
    exclude: /\b(?:threat\w*|warn\w*|vow\w*|fears?|could|may|might|would|consider\w*|reopen\w*|remains? open)\b/i,
  },
  { id: "kharg", label: "Kharg (Irans Ölexport-Terminal) in den Meldungen", priority: 4, re: /\bkharg\b/i },
  { id: "saudi-infra", label: "Saudische Ölanlagen (Abqaiq / Ras Tanura) betroffen", priority: 4, re: /\babqaiq\b|\bras tanura\b/i },
  {
    id: "tanker-seized",
    label: "Tanker beschlagnahmt",
    priority: 4,
    re: /\b(?:seiz|hijack)\w*[^.]{0,40}\btankers?\b|\btankers?\b[^.]{0,40}\b(?:seiz|hijack)/i,
  },
];

const fmt = (v, d = 2) =>
  v.toLocaleString("de-DE", { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + fmt(Math.abs(v), 1);

// Neue Alarme gegenüber dem letzten Snapshot. Der Alarm-Verlauf im Snapshot
// ist zugleich das Gedächtnis für die Sperrzeiten.
export function detectAlerts({ previous, quotes, history, news, regions, now = Date.now() }) {
  if (!previous) return [];   // erster Lauf: nichts vergleichbar, kein Alarm-Schwall
  const out = [];
  const log = previous.alerts ?? [];
  const push = (alert) => {
    const blocked = [...out, ...log].some(
      (a) => a.key === alert.key && now - Date.parse(a.at) < COOLDOWN_H[alert.kind] * 3600e3
    );
    if (!blocked) out.push({ ...alert, at: new Date(now).toISOString() });
  };

  // 1) Region springt auf „kritisch“
  const prevLevel = Object.fromEntries((previous.regions ?? []).map((r) => [r.id, r.level]));
  for (const r of regions) {
    if (r.level !== "kritisch" || !prevLevel[r.id] || prevLevel[r.id] === "kritisch") continue;
    push({
      kind: "region", key: `region:${r.id}`, priority: 4, tags: ["rotating_light"],
      title: `Lage kritisch: ${r.label}`,
      body: `${r.count24h} Meldungen in 24 Std, davon ${r.high24h} wichtig.`,
    });
  }

  // 2) Brent bewegt sich binnen ~1 Std um mehr als ±brentMovePct
  const brent = quotes.find((q) => q.id === "brent");
  const points = history?.brent?.points ?? [];
  if (brent?.price != null && !brent.stale && points.length) {
    const target = now / 1000 - 3600;
    const ref = points
      .filter(([t]) => t <= now / 1000 - 45 * 60 && t >= now / 1000 - 90 * 60)
      .sort((a, b) => Math.abs(a[0] - target) - Math.abs(b[0] - target))[0];
    const pct = ref ? ((brent.price - ref[1]) / ref[1]) * 100 : 0;
    if (Math.abs(pct) >= ALERT_RULES.brentMovePct) {
      push({
        kind: "brent", key: `brent:${pct > 0 ? "up" : "down"}`, priority: 4,
        tags: [pct > 0 ? "chart_with_upwards_trend" : "chart_with_downwards_trend"],
        title: `Brent ${signed(pct)} % in 1 Std`,
        body: `Jetzt ${fmt(brent.price)} USD/bbl, vor einer Stunde ${fmt(ref[1])}.`,
      });
    }
  }

  // 3) OVX steigt deutlich – der Markt sichert sich stärker ab
  const ovx = quotes.find((q) => q.id === "ovx");
  if (ovx?.changePct != null && !ovx.stale && ovx.changePct >= ALERT_RULES.ovxJumpPct) {
    push({
      kind: "ovx", key: "ovx:up", priority: 3, tags: ["warning"],
      title: `Marktangst steigt: OVX ${signed(ovx.changePct)} %`,
      body: `OVX bei ${fmt(ovx.price, 1)} (Vortag ${fmt(ovx.prevClose, 1)}). Händler rechnen mit deutlich größeren Ölpreis-Ausschlägen.`,
    });
  }

  // 4) Schlüsselereignisse, bestätigt durch mehrere Quellen
  const prevKeys = new Set((previous.news ?? []).map((n) => newsKey(n.title)));
  const since = now - ALERT_RULES.confirmWindowH * 3600e3;
  for (const ev of KEY_EVENTS) {
    const hits = news.filter((n) => {
      if (Date.parse(n.pubDate) < since || !ev.re.test(n.title)) return false;
      return !ev.exclude?.test(n.title);
    });
    const sources = [...new Set(hits.map((n) => n.source))];
    if (sources.length < ALERT_RULES.confirmSources) continue;
    if (!hits.some((n) => !prevKeys.has(newsKey(n.title)))) continue;   // nichts Neues dazu
    push({
      kind: "event", key: `event:${ev.id}`, priority: ev.priority, tags: ["oil_drum"],
      title: ev.label,
      body: `„${hits[0].title}“ – ${sources.length} Quellen: ${sources.slice(0, 4).join(", ")}${sources.length > 4 ? " …" : ""}`,
      link: hits[0].link,
    });
  }
  return out;
}

function dashboardUrl() {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL;
  const [owner, repo] = (process.env.GITHUB_REPOSITORY ?? "").split("/");
  return owner && repo ? `https://${owner}.github.io/${repo}/` : undefined;
}

// JSON-Publish: UTF-8 in Titel und Text ohne Header-Kodierung
async function publish({ title, body, priority = 3, tags = [], link }) {
  const res = await fetch(NTFY_SERVER, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(NTFY_TOKEN ? { Authorization: `Bearer ${NTFY_TOKEN}` } : {}),
    },
    body: JSON.stringify({
      topic: NTFY_TOPIC, title, message: body, priority, tags, click: link ?? dashboardUrl(),
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}

export async function sendAlerts(alerts) {
  if (!alerts.length) return;
  if (!NTFY_TOPIC) {
    console.log(`${alerts.length} Alarm(e) erkannt – NTFY_TOPIC nicht gesetzt, kein Push`);
    return;
  }
  for (const a of alerts) {
    try {
      await publish(a);
      console.log(`Alarm gesendet: ${a.title}`);
    } catch (err) {
      console.error(`Alarm nicht gesendet (${a.title}): ${err.message}`);
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href && process.argv.includes("--test")) {
  if (!NTFY_TOPIC) {
    console.error("NTFY_TOPIC fehlt – Aufruf: NTFY_TOPIC=dein-thema node scripts/alerts.mjs --test");
    process.exit(1);
  }
  await publish({
    title: "Brent Watch: Test-Alarm",
    body: "Push funktioniert. Echte Alarme kommen bei kritischer Lage, Kurssprüngen und bestätigten Schlüsselereignissen.",
    tags: ["white_check_mark"],
  });
  console.log(`Test-Alarm an ${NTFY_SERVER}/${NTFY_TOPIC} gesendet`);
}
