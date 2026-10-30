# Brent Watch 🛢️

Laufend aktualisiertes Öl-Lagebild als statisches Dashboard: Brent-Kurs samt Marktindikatoren
(WTI, Spread, Gas, Dollar-Index, Gold, OVX) plus ein Konflikt-Monitor für die Regionen
und Themen, die den Brent-Preis bewegen (Iran–Israel, Hormus/Rotes Meer,
Russland–Ukraine, OPEC+, Sanktionen …). Jeder Indikator hat ein Info-Popup
(„i“), das erklärt, was er misst, wie man ihn liest und was der aktuelle Wert
bedeutet. Optional kommen Alarme per Push aufs Handy (ntfy).

## Wie es funktioniert

```
GitHub Action (Dauerlauf: Abruf alle 6 Min, startet sich alle ~6 h neu)
   └─ scripts/fetch_data.mjs
        ├─ Kurse:  Yahoo Finance → Fallback TradingView-Scanner (inkl. OVX)
        ├─ Verlauf: Brent in 15-Min-Kerzen (5 Tage) für „Kurs & Ereignisse“
        ├─ News:   OilPrice, Al Jazeera, BBC, The Guardian, Google News (RSS), GDELT
        ├─ Social: Telegram-Kanäle (t.me/s/…), Bluesky-Accounts (offene API)
        │          → Werbung/Kurzlinks entfernt, Keyword-Klassifikation nach Region + Schweregrad
        ├─ Alarme: scripts/alerts.mjs → ntfy-Push (optional) + Verlauf in data.json
        └─ schreibt data/data.json  → Commit → GitHub Pages liefert es aus

index.html (GitHub Pages)
   ├─ liest data/data.json (und lädt sie alle 2 Min nach)
   ├─ live im Browser: Kurse minütlich, Bluesky alle 2 Min, GDELT alle 5 Min
   ├─ Chart-Bereich mit zwei Ansichten:
   │    · Live-Chart: TradingView-Widget (Echtzeit, client-seitig)
   │    · Kurs & Ereignisse: Brent-Verlauf mit Markern für Meldungen,
   │      über die mindestens 3 Quellen berichten, samt Kursreaktion danach
   ├─ Termine (EIA-/API-Lagerberichte) und letzte Alarme
   └─ Konflikt-Monitor mit Lagebild, Filter, Themen-Bündelung gleicher
      Meldungen und „NEU“-Markierung seit letztem Besuch
```

## Alarme aufs Handy (optional, ~2 Minuten)

Die Action prüft bei jedem Abruf (alle ~6 Min):

| Alarm | Auslöser | Sperrzeit |
|---|---|---|
| Lage kritisch | eine Region springt auf „kritisch“ | 6 Std je Region |
| Kurssprung | Brent bewegt sich binnen ~1 Std um ±2 % | 3 Std je Richtung |
| Marktangst | OVX steigt um ≥ 10 % zum Vortag | 12 Std |
| Schlüsselereignis | Hormus-Sperrung, Kharg, Abqaiq/Ras Tanura, Tanker-Beschlagnahme – nur wenn **mindestens 2 verschiedene Quellen** binnen 3 Std berichten; Drohungen („threatens to close …“) zählen nicht | 6 Std je Ereignis |

Einrichtung:

1. App **ntfy** installieren (iOS/Android, kostenlos) und dort ein Thema
   abonnieren. Der Name ist das einzige „Passwort“ – wer ihn kennt, liest mit.
   Also etwas Zufälliges wählen, z. B. `brent-k7x2m9q4`.
2. Repo → *Settings → Secrets and variables → Actions* → **New repository
   secret**: Name `NTFY_TOPIC`, Wert = dein Thema.
3. Testen (lokal): `NTFY_TOPIC=dein-thema node scripts/alerts.mjs --test`

Ohne Secret werden Alarme nur erkannt und im Dashboard unter „Letzte Alarme“
gelistet. Optional: eigener ntfy-Server über die Repo-Variable `NTFY_SERVER`
(plus Secret `NTFY_TOKEN`), anderer Link in der Benachrichtigung über die
Variable `DASHBOARD_URL`. Schwellwerte und Ereignisse: `ALERT_RULES` und
`KEY_EVENTS` in [scripts/alerts.mjs](scripts/alerts.mjs).

## Einrichtung (einmalig, ~3 Minuten)

1. **Repo anlegen und pushen** (Name frei wählbar, z. B. `brent-watch`):

   ```bash
   git init
   git add -A
   git commit -m "Brent Watch"
   git branch -M main
   git remote add origin https://github.com/DEIN-USER/brent-watch.git
   git push -u origin main
   ```

2. **Workflow-Schreibrechte aktivieren:**
   Repo → *Settings → Actions → General → Workflow permissions* →
   **„Read and write permissions“** auswählen und speichern.
   (Nötig, damit die Action die aktualisierte `data.json` committen darf.)

3. **GitHub Pages aktivieren:**
   Repo → *Settings → Pages* → Source: **„Deploy from a branch“** →
   Branch **`main`**, Ordner **`/ (root)`** → Save.

4. **Ersten Datenlauf starten:**
   Repo → *Actions* → „Daten-Update (Dauerlauf)“ → **Run workflow**.
   Danach läuft er dauerhaft: alle 6 Min ein Abruf, nach ~6 h startet der
   Lauf seinen Nachfolger selbst; ein stündlicher Cron startet die Kette neu,
   falls sie abreißt.

Das Dashboard liegt dann unter
`https://DEIN-USER.github.io/brent-watch/`.

## Lokal testen

```bash
node scripts/fetch_data.mjs
python3 -m http.server 8787
# → http://localhost:8787
```

## Anpassen

- **Regionen/Keywords/Schwellwerte:** `CATEGORIES`, `HIGH_IMPACT` und
  `buildRegions()` in [scripts/fetch_data.mjs](scripts/fetch_data.mjs)
- **Feeds:** `FEEDS` und `GOOGLE_NEWS_QUERIES` in
  [scripts/news_core.mjs](scripts/news_core.mjs)
- **Social-Quellen:** `TELEGRAM_CHANNELS` und `BLUESKY_ACCOUNTS` ebenda.
  Welche Quellen beim letzten Abruf leer waren, zeigt der Tooltip über
  „x/y Quellen aktiv“ im Ticker (bzw. `sources` in `data.json`).
- **Kacheln/Symbole:** `QUOTES` in [scripts/fetch_data.mjs](scripts/fetch_data.mjs),
  Darstellung und Info-Texte (`INFO`) in [index.html](index.html)
- **Termine:** EIA- und API-Lagerberichte werden automatisch berechnet
  (US-Feiertage verschieben sie gelegentlich um einen Tag); eigene Termine
  wie OPEC+-Treffen in `CUSTOM_EVENTS` in [index.html](index.html) eintragen
- **Update-Takt:** `TAKT_MIN` (Standard 6 Min) in
  [.github/workflows/update.yml](.github/workflows/update.yml)

## Hinweise

- Kein API-Key nötig; alle Quellen sind öffentlich. Kurse können ~10 Min
  verzögert sein (TradingView-Fallback), der Live-Chart streamt in Echtzeit.
- Der regelmäßige Commit der `data.json` ist beabsichtigt: die Git-History wird
  dadurch nebenbei zum Zeitarchiv des Lagebilds – mit einem Stand pro Stunde.
  Innerhalb einer Stunde ersetzt der Bot seinen letzten Daten-Commit, statt
  alle 6 Min einen neuen anzuhängen (hält das Repo klein). Wer lokal
  mitarbeitet, holt Änderungen deshalb mit `git pull --rebase`.
- Keine Anlageberatung – reines Informations-Dashboard.
