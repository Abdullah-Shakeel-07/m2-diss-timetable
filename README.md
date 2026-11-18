# Timetable

Lightweight day / week / month view of a university ADE calendar (ICS). No framework, no build step.

- `public/` – static UI (`ics.js` parser + Paris-timezone helpers, `app.js`, `style.css`)
- `api/timetable.js` – paginated proxy for the ICS feed (the source has no CORS headers): `GET /api/timetable?from=YYYY-MM-DD&to=YYYY-MM-DD` (inclusive, max 62 days, validated), cached 10 min at the CDN. The app requests one month at a time and keeps each month in localStorage
- `dev.js` – local server: `node dev.js` → http://localhost:3000 (`DELAY=3000 node dev.js` simulates a slow API to see the loaders)

Change the calendar with the `ADE_RESOURCE` env var (default `36405`).
Shortcuts: ← / → navigate, `t` today, `d` / `w` / `m` switch view.
