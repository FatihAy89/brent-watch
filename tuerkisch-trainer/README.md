# Türkisch-Trainer Fachsprache

Karteikarten-App für das formale türkische Register (Kommunikation/PR, Wirtschaft, Politik, Business-Alltag, Alltag). Eine HTML-Datei, kein Build-Schritt, kein Server, offline lauffähig.

## Start

1. `index.html` im Browser öffnen.
2. Beim ersten Start einmal `vokabeln.json` auswählen (Browser dürfen bei `file://` keine Nachbardateien selbst lesen). Die Datei wird danach im Browser gespeichert.

Wird der Ordner über einen Webserver ausgeliefert (z. B. `python3 -m http.server`), entfällt Schritt 2.

## Bedienung

| Taste | Aktion |
|---|---|
| Leertaste / Enter | aufdecken |
| → oder 2 | gewusst |
| ← oder 1 | nicht gewusst |
| A / S | Begriff / Beispielsatz vorlesen |
| R | Abfragerichtung wechseln |
| Z | letzte Antwort rückgängig |

Leitner-System mit fünf Fächern: Wiederholung nach 1, 2, 4, 8 und 16 Tagen. Jede Abfragerichtung hat einen eigenen Lernstand. Der Lernstand liegt im `localStorage` des Browsers und lässt sich als JSON exportieren und importieren.

## Vokabeln erweitern

`vokabeln.json` bearbeiten, danach in der App „Vokabeldatei neu laden“:

```json
{"id": "pr-061", "feld": "pr", "tr": "…", "de": "…", "satz": "…"}
```

- `id` muss eindeutig sein und darf bei bestehenden Einträgen nicht geändert werden, der Lernstand hängt daran.
- `feld` verweist auf einen Schlüssel unter `felder`; neue Themenfelder dort eintragen.
- `satz` ist der Beispielsatz im Fachregister (optional).
