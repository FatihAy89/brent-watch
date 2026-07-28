# Brent Watch 🛢️

Stündliches Öl-Lagebild als statisches Dashboard: Brent-Kurs samt Marktindikatoren
(WTI, Spread, Gas, Dollar-Index, Gold) plus ein Konflikt-Monitor für die Regionen
und Themen, die den Brent-Preis bewegen (Iran–Israel, Hormus/Rotes Meer,
Russland–Ukraine, OPEC+, Sanktionen …).

## Wie es funktioniert

```
GitHub Action (stündlich, cron)
   └─ scripts/fetch_data.mjs
        ├─ Kurse:  Yahoo Finance → Fallback TradingView-Scanner
        ├─ News:   OilPrice, Al Jazeera, BBC, The Guardian, Google News (RSS)
        │          → Keyword-Klassifikation nach Region + Schweregrad
        └─ schreibt data/data.json  → Commit → GitHub Pages liefert es aus

index.html (GitHub Pages)
   ├─ liest data/data.json (und lädt sie alle 5 Min nach)
   ├─ TradingView-Widget für den Brent-Live-Chart (Echtzeit, client-seitig)
   └─ Konflikt-Monitor mit Lagebild, Filter und „NEU“-Markierung seit letztem Besuch
```

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
   Repo → *Actions* → „Stündliches Daten-Update“ → **Run workflow**.
   Danach läuft er automatisch jede Stunde.

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
- **Feeds:** `FEEDS` und `GOOGLE_NEWS_QUERIES` ebenda
- **Kacheln/Symbole:** `QUOTES` ebenda, Darstellung in
  [index.html](index.html)
- **Update-Takt:** Cron-Ausdruck in
  [.github/workflows/update.yml](.github/workflows/update.yml)

## Hinweise

- Kein API-Key nötig; alle Quellen sind öffentlich. Kurse können ~10 Min
  verzögert sein (TradingView-Fallback), der Live-Chart streamt in Echtzeit.
- Der stündliche Commit der `data.json` ist beabsichtigt: die Git-History wird
  dadurch nebenbei zum Zeitarchiv des Lagebilds.
- Keine Anlageberatung – reines Informations-Dashboard.
