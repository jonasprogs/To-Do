# Taskflow (MVP, Vanilla JS + PWA)

Eine extrem schlanke, mobile-first Aufgaben-App mit zwei Bereichen (Privat/Arbeit), Inbox, Heute, Geplant, (Arbeit) Projekte inkl. Timeline/Gantt, Subtasks, Zeit-Summen und PWA-Offline.

## Features
- Zero-Friction Capture: Quick-Add unten, Enter/„+“ legt sofort an (nur Titel).
- Bereiche: Segmented Control (Privat/Arbeit), getrennte Datenräume per Filter.
- Tabs: Inbox, Heute (Totals), Geplant (gruppiert), Projekte (nur Arbeit), Suche/Alle.
- Bearbeiten im halbhohen Bottom-Sheet: Titel, Dauer, Datum/Uhrzeit, Priorität, Tags, Notizen.
- Arbeit: Projekt-Zuordnung, Unteraufgaben (mit Dauer), Projektliste (Fortschritt & Summen).
- Timeline/Gantt je Projekt (SVG, mobil scroll/zoom-freundlich).
- Gesten: Swipe links=Erledigen, rechts=Snooze +1; Long-press=Mehrfachauswahl (Batch).
- Summen: Geplante/Erledigte/Offene Zeit heute; Summen je Projekt.
- UX: Dark/Light (Auto + Toggle), große Touch-Targets, WCAG-freundliche Kontraste.
- PWA: Manifest, Service Worker (App-Shell Caching), offline nutzbar & installierbar.
- Local-first: IndexedDB (Fallback LocalStorage).
- Undo: Soft-Delete mit „Rückgängig“ in Toast.
- Export/Import: JSON.
- i18n-ready: Strings minimal zentral gehalten (Deutsch).

## Dateien
- `index.html` — App-Shell & Layout
- `styles.css` — Minimal-Design (hell/dunkel), mobile-first
- `app.js` — State, IndexedDB, UI, Gesten, Gantt, Export/Import
- `sw.js` — Service Worker (App-Shell Cache)
- `manifest.webmanifest` — PWA Manifest
- `icons/` — PWA Icons (192/512)

## Setup
Lokal starten (empfohlen via einfachem Server, damit PWA/Service-Worker laufen):
```bash
# Python
python3 -m http.server -d . 5500

# oder Node
npx http-server -p 5500
```
Dann im Browser öffnen: `http://localhost:5500`

> Hinweis: Service Worker funktioniert nur über `http://localhost` oder `https://`.

## Datenmodell
```ts
Workspace { id: 'private' | 'work', type: 'private' | 'work' }
Project   { id, workspaceId, name, description?, createdAt }
Task      { id, workspaceId, title, notes?, dueDate?, dueTime?, estimateMinutes?, priority?, tags?: string[], projectId?, createdAt, completedAt?, _deleted? }
Subtask   { id, taskId, title, estimateMinutes?, completedAt? }
```
Abgeleitet: `projectProgress`, `taskEstimateTotal`, `subtaskTotal` u. a.

## Tests (manuell, MVP)
- [x] Quick-Add erstellt Aufgabe in der aktiven Inbox (Privat/Arbeit).
- [x] Sheet „Speichern“ ordnet Datum/Dauer/Projekt korrekt zu.
- [x] Summen in „Heute“ und pro Projekt korrekt (mit Seed-Daten).
- [x] Gantt zeigt Balken für Start/Ende (Task: startDate optional; ohne: end=dueDate/start=today).
- [x] Dark/Light: System + Toggle.
- [x] Offline: Seite neu laden im Offline-Modus → App funktioniert.
- [x] Installierbar: Manifest + Icons vorhanden.

## Nice-to-have (Ansätze in Code)
- Kapazität pro Tag (Voreinstellung 4h privat/6h arbeit in `capacity`).
- Lokale Benachrichtigungen via Web Notifications (einfach ergänzbar).
- Mini-Kalender ließe sich im Sheet oberhalb des Datumsinputs ergänzen.

## Hinweise
- Gantt ist bewusst leichtgewichtig (SVG). Start-/Ende-Felder können bei Bedarf erweitert werden.
- Für Cloud-Sync ist ein späterer API-Layer einplanbar (Stub noch nicht enthalten).
