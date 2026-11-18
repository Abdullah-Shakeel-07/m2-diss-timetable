// Paginated proxy for the university ICS feed (the source has no CORS headers).
//   GET /api/timetable?from=YYYY-MM-DD&to=YYYY-MM-DD   (inclusive, max 62 days)
// Without params it returns the current month. Each window is cached at the CDN.
const RESOURCE = process.env.ADE_RESOURCE || '36405';
const BASE = 'https://adelb.univ-lyon1.fr/jsp/custom/modules/plannings/anonymous_cal.jsp';
const MAX_DAYS = 62;
const DAY = 864e5;

const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
function parseDay(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || '')) return NaN;
  const ms = Date.parse(s + 'T00:00:00Z');
  return Number.isNaN(ms) || iso(ms) !== s ? NaN : ms;
}
function send(res, code, type, body, cache) {
  res.statusCode = code;
  res.setHeader('Content-Type', type);
  res.setHeader('Cache-Control', cache);
  res.end(body);
}
const fail = (res, code, msg) => send(res, code, 'application/json', JSON.stringify({ error: msg }), 'no-store');

module.exports = async function handler(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const n = new Date();
  let from = q.has('from') ? parseDay(q.get('from')) : Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), 1);
  let to = q.has('to') ? parseDay(q.get('to')) : Date.UTC(n.getUTCFullYear(), n.getUTCMonth() + 1, 0);
  if (Number.isNaN(from) || Number.isNaN(to)) return fail(res, 400, 'from and to must be valid YYYY-MM-DD dates');
  if (to < from) return fail(res, 400, 'to must not be before from');
  if ((to - from) / DAY + 1 > MAX_DAYS) return fail(res, 400, `range is limited to ${MAX_DAYS} days`);

  const url = `${BASE}?resources=${RESOURCE}&projectId=1&calType=ical&firstDate=${iso(from)}&lastDate=${iso(to)}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    const text = await r.text();
    if (!text.includes('BEGIN:VCALENDAR')) throw new Error('upstream returned no calendar');
    send(res, 200, 'text/calendar; charset=utf-8', text, 'public, s-maxage=600, stale-while-revalidate=86400');
  } catch (e) {
    fail(res, 502, String((e && e.message) || e));
  }
};
