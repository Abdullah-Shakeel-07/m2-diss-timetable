// ICS parsing + Europe/Paris date helpers. Works in browser (window.TT) and Node (module.exports).
(function (root) {
  const TZ = 'Europe/Paris';
  const partsFmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const pad = (n) => String(n).padStart(2, '0');

  function parisParts(ms) {
    const o = {};
    for (const p of partsFmt.formatToParts(new Date(ms))) o[p.type] = p.value;
    return { y: +o.year, mo: +o.month, d: +o.day, h: +o.hour % 24, mi: +o.minute };
  }
  function parisOffset(ms) {
    const p = parisParts(ms);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - Math.floor(ms / 6e4) * 6e4;
  }
  function parisToEpoch(y, mo, d, h, mi) {
    const guess = Date.UTC(y, mo - 1, d, h, mi);
    let t = guess - parisOffset(guess);
    t = guess - parisOffset(t);
    return t;
  }

  // ---- day keys: 'YYYY-MM-DD' in Paris time ----
  function dayKeyOf(ms) {
    const p = parisParts(ms);
    return `${p.y}-${pad(p.mo)}-${pad(p.d)}`;
  }
  const keyToUTC = (k) => { const [y, m, d] = k.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const utcToKey = (ms) => new Date(ms).toISOString().slice(0, 10);
  const addDays = (k, n) => utcToKey(keyToUTC(k) + n * 864e5);
  const weekdayIdx = (k) => (new Date(keyToUTC(k)).getUTCDay() + 6) % 7; // Mon=0
  const startOfWeek = (k) => addDays(k, -weekdayIdx(k));
  const startOfMonth = (k) => k.slice(0, 8) + '01';
  function addMonths(k, n) {
    const [y, m] = k.split('-').map(Number);
    const t = y * 12 + (m - 1) + n;
    return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}-01`;
  }
  const minutesOf = (ms) => { const p = parisParts(ms); return p.h * 60 + p.mi; };

  // ---- ICS ----
  function unescapeText(s) {
    return s.replace(/\\[nN]/g, '\n').replace(/\\([,;\\])/g, '$1');
  }
  function parseDate(value, params) {
    const m = /^(\d{4})(\d\d)(\d\d)(?:T(\d\d)(\d\d)(\d\d)?(Z)?)?$/.exec(value.trim());
    if (!m) return null;
    const [, y, mo, d, h, mi, , z] = m;
    if (h === undefined) return { ms: parisToEpoch(+y, +mo, +d, 0, 0), allDay: true };
    if (z) return { ms: Date.UTC(+y, +mo - 1, +d, +h, +mi), allDay: false };
    return { ms: parisToEpoch(+y, +mo, +d, +h, +mi), allDay: false }; // floating / TZID -> assume Paris
  }

  function parseICS(text) {
    const lines = text.replace(/\r\n?/g, '\n').replace(/\n[ \t]/g, '').split('\n');
    const events = [];
    let cur = null;
    for (const line of lines) {
      if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
      if (line === 'END:VEVENT') {
        if (cur && cur.start && cur.end == null) cur.end = cur.start.allDay ? cur.start.ms + 864e5 : cur.start.ms;
        const e = cur && cur.start ? finalize(cur) : null;
        if (e) events.push(e);
        cur = null; continue;
      }
      if (!cur) continue;
      const i = line.indexOf(':');
      if (i < 0) continue;
      const [name, ...pr] = line.slice(0, i).split(';');
      const val = line.slice(i + 1);
      switch (name.toUpperCase()) {
        case 'SUMMARY': cur.title = unescapeText(val); break;
        case 'LOCATION': cur.location = unescapeText(val); break;
        case 'DESCRIPTION': cur.desc = unescapeText(val); break;
        case 'UID': cur.uid = val; break;
        case 'DTSTART': cur.start = parseDate(val, pr); break;
        case 'DTEND': { const d = parseDate(val, pr); if (d) cur.end = d.ms; break; }
      }
    }
    const seen = new Set();
    return events
      .filter((e) => { const k = `${e.uid}|${e.start}`; if (seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.start - b.start || a.end - b.end);
  }

  function finalize(c) {
    const details = (c.desc || '').split('\n').map((s) => s.trim())
      .filter((s) => s && !/^\d{8,}$/.test(s) && !/^\(Export/i.test(s));
    const allDay = c.start.allDay;
    const start = c.start.ms;
    const end = Math.max(c.end ?? start, start);
    return {
      uid: c.uid || `${start}-${c.title}`,
      title: (c.title || 'Untitled').trim(),
      location: (c.location || '').trim(),
      details, allDay, start, end,
      day: dayKeyOf(start),
      startMin: allDay ? 0 : minutesOf(start),
      endMin: allDay ? 24 * 60 : minutesOf(end),
    };
  }

  // group events by day key (an event appears on its start day only)
  function groupByDay(events) {
    const map = new Map();
    for (const e of events) {
      if (!map.has(e.day)) map.set(e.day, []);
      map.get(e.day).push(e);
    }
    return map;
  }

  const api = {
    TZ, parseICS, groupByDay, dayKeyOf, addDays, addMonths, weekdayIdx, startOfWeek, startOfMonth,
    keyToUTC, parisParts, parisToEpoch, minutesOf, pad,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TT = api;
})(typeof window !== 'undefined' ? window : globalThis);
