(() => {
  'use strict';
  const T = window.TT;
  const $ = (s) => document.querySelector(s);
  const CACHE_PREFIX = 'timetable:month:v1:';
  const STALE_MS = 10 * 60 * 1000;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtCache = new Map();
  const fmtDay = (k, o) => {
    const id = JSON.stringify(o);
    let f = fmtCache.get(id);
    if (!f) fmtCache.set(id, f = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', ...o }));
    return f.format(T.keyToUTC(k));
  };
  const hmFmt = new Intl.DateTimeFormat('en-GB', { timeZone: T.TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const hm = (ms) => hmFmt.format(ms);
  const hueCache = new Map();
  const hue = (s) => {
    let h = hueCache.get(s);
    if (h === undefined) { h = 0; for (const c of s.replace(/\s*-\s*KO$|\s+ADE$/i, '')) h = (h * 31 + c.charCodeAt(0)) % 360; hueCache.set(s, h); }
    return h;
  };
  const phone = window.matchMedia('(max-width: 760px)');
  const today = () => T.dayKeyOf(Date.now());

  const state = { view: phone.matches ? 'day' : 'week', date: today(), events: [], byDay: new Map() };
  const months = new Map(); // 'YYYY-MM' -> { events, at, status: 'loading' | 'ok' | 'error', failedAt, inflight }
  const VIEWS = ['day', 'week', 'month'];

  // ---------- routing (hash: #view/YYYY-MM-DD) ----------
  function readHash() {
    const m = /^#(day|week|month)(?:\/(\d{4}-\d{2}-\d{2}))?$/.exec(location.hash);
    if (m) {
      state.view = m[1];
      if (m[2] && T.addDays(m[2], 0) === m[2]) state.date = m[2];
    }
  }
  function writeHash() { history.replaceState(null, '', `#${state.view}/${state.date}`); }

  // ---------- data: one month per request (server-side pagination) ----------
  const monthOf = (k) => k.slice(0, 7);
  const nextMonth = (m) => monthOf(T.addMonths(m + '-01', 1));
  const monthRange = (m) => ({ from: m + '-01', to: T.addDays(T.addMonths(m + '-01', 1), -1) });

  function rebuild() {
    const all = [];
    for (const e of months.values()) all.push(...e.events);
    all.sort((a, b) => a.start - b.start || a.end - b.end);
    state.events = all;
    state.byDay = T.groupByDay(all);
  }
  function hydrate(m) {
    if (months.has(m)) return;
    try {
      const c = JSON.parse(localStorage.getItem(CACHE_PREFIX + m));
      if (c && typeof c.text === 'string') {
        months.set(m, { events: T.parseICS(c.text).filter((e) => monthOf(e.day) === m), at: c.at, status: 'ok' });
        rebuild();
      }
    } catch (_) {}
  }
  function needsFetch(m, force) {
    const e = months.get(m), now = Date.now();
    if (!e) return true;
    if (e.inflight) return false;
    if (e.status === 'error') return force || now - e.failedAt > 30000;
    return force || now - e.at > STALE_MS;
  }
  function loadMonth(m, force) {
    hydrate(m);
    if (!needsFetch(m, force)) return months.get(m)?.inflight || Promise.resolve();
    const prev = months.get(m) || { events: [], at: 0 };
    const entry = Object.assign({}, prev, { status: 'loading' });
    months.set(m, entry);
    const { from, to } = monthRange(m);
    entry.inflight = (async () => {
      try {
        const r = await fetch(`/api/timetable?from=${from}&to=${to}`, { cache: 'no-store' });
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const text = await r.text();
        if (!text.includes('BEGIN:VCALENDAR')) throw new Error('Bad data');
        months.set(m, { events: T.parseICS(text).filter((e) => monthOf(e.day) === m), at: Date.now(), status: 'ok' });
        try { localStorage.setItem(CACHE_PREFIX + m, JSON.stringify({ text, at: Date.now() })); } catch (_) {}
      } catch (_) {
        months.set(m, Object.assign({}, prev, { status: 'error', failedAt: Date.now() }));
      }
      rebuild();
      render();
    })();
    render();
    return entry.inflight;
  }

  function viewMonths() {
    const d = state.date;
    if (state.view === 'day') return [monthOf(d)];
    if (state.view === 'week') { const s = T.startOfWeek(d); return [...new Set([monthOf(s), monthOf(T.addDays(s, 6))])]; }
    const first = T.startOfMonth(d), gs = T.startOfWeek(first);
    const rows = Math.ceil(((T.keyToUTC(T.addMonths(first, 1)) - T.keyToUTC(gs)) / 864e5) / 7);
    return [...new Set([monthOf(gs), monthOf(first), monthOf(T.addDays(gs, rows * 7 - 1))])];
  }
  const isReady = (m) => { const e = months.get(m); return !!(e && e.at); };
  const viewLoading = () => viewMonths().some((m) => !isReady(m) && months.get(m)?.status !== 'error');
  const viewFailed = () => viewMonths().some((m) => !isReady(m) && months.get(m)?.status === 'error');
  const anyLoading = () => [...months.values()].some((e) => e.status === 'loading');

  let chasing = false;
  async function ensureNext() { // make sure "next class" can be found even if it is months away
    if (chasing) return;
    chasing = true;
    try {
      let m = monthOf(today());
      for (let i = 0; i < 8; i++) {
        await loadMonth(m);
        const now = Date.now();
        if (state.events.some((e) => e.end > now)) break;
        m = nextMonth(m);
      }
    } finally { chasing = false; }
  }
  function ensure() {
    for (const m of viewMonths()) loadMonth(m);
    ensureNext();
    const c = monthOf(state.date);
    for (const m of [monthOf(T.addMonths(c + '-01', -1)), nextMonth(c)]) if (!months.has(m)) hydrate(m);
  }
  function refresh(force) {
    for (const m of new Set([...viewMonths(), monthOf(today())])) loadMonth(m, force);
  }
  function syncBanner() {
    const stale = [...months.values()].some((e) => e.status === 'error' && e.at);
    const b = $('#banner'); b.hidden = !stale;
    b.textContent = stale ? 'Could not refresh. Showing the last saved timetable.' : '';
  }

  // ---------- rendering ----------
  const dayEvents = (k) => state.byDay.get(k) || [];
  const HOUR = 52;
  const eEnd = (e) => (e.endMin > e.startMin ? e.endMin : 1440);

  function layoutDay(evs) {
    const items = evs.filter((e) => !e.allDay)
      .map((e) => ({ e, s: e.startMin, en: Math.max(eEnd(e), e.startMin + 25) }))
      .sort((a, b) => a.s - b.s || b.en - a.en);
    const out = []; let cluster = [], cEnd = -1;
    const flush = () => {
      const cols = [];
      for (const it of cluster) {
        let c = cols.findIndex((end) => end <= it.s);
        if (c < 0) { c = cols.length; cols.push(0); }
        cols[c] = it.en; it.col = c;
      }
      cluster.forEach((it) => { it.cols = cols.length; });
      out.push(...cluster); cluster = [];
    };
    for (const it of items) {
      if (cluster.length && it.s >= cEnd) { flush(); cEnd = -1; }
      cluster.push(it); cEnd = Math.max(cEnd, it.en);
    }
    if (cluster.length) flush();
    return out;
  }

  function evBlock(e, style, big) {
    const now = Date.now();
    const cls = 'ev' + (e.end <= now ? ' past' : '');
    const time = e.allDay ? 'All day' : `${hm(e.start)}–${hm(e.end)}`;
    return `<button class="${cls}" style="--h:${hue(e.title)};${style}" data-uid="${esc(e.uid)}" data-start="${e.start}">
      <div class="ti">${esc(e.title)}</div><div class="tm">${time}</div>${e.location ? `<div class="lo">${esc(e.location)}</div>` : ''}</button>`;
  }

  function evRow(e) {
    const past = e.end <= Date.now() ? ' past' : '';
    return `<button class="row${past}" style="--h:${hue(e.title)}" data-uid="${esc(e.uid)}" data-start="${e.start}">
      <span class="rt">${e.allDay ? 'All day' : `<b>${hm(e.start)}</b><i>${hm(e.end)}</i>`}</span>
      <span class="rb"><span class="ti">${esc(e.title)}</span>${e.location ? `<span class="lo">${esc(e.location)}</span>` : ''}</span></button>`;
  }

  const SK = [[10, 13], [14, 17.25], [9.75, 11.5]];
  function fakeBlocks(k) {
    const wd = T.weekdayIdx(k);
    if (wd > 4) return '';
    return SK.slice(0, 1 + ((wd + 1) % 2)).map(([a, b]) => `<div class="sk blk" style="top:${(a - 8) * HOUR}px;height:${(b - a) * HOUR - 2}px"></div>`).join('');
  }

  function timeGrid(keys, cls, loading) {
    const t = today(), nowMs = Date.now();
    const all = keys.flatMap(dayEvents).filter((e) => !e.allDay);
    let h0 = 8, h1 = 19;
    for (const e of all) { h0 = Math.min(h0, Math.floor(e.startMin / 60)); h1 = Math.max(h1, Math.ceil(eEnd(e) / 60)); }
    if (keys.includes(t)) { const m = T.minutesOf(nowMs); h0 = Math.min(h0, Math.floor(m / 60)); h1 = Math.max(h1, Math.ceil(m / 60) + 1); }
    h0 = Math.max(0, h0); h1 = Math.min(24, Math.max(h1, h0 + 1));
    const rows = h1 - h0;
    const hasAllDay = keys.some((k) => dayEvents(k).some((e) => e.allDay));

    let head = '<div></div>', allday = '<div></div>', cols = '';
    for (const k of keys) {
      head += `<div class="${k === t ? 'today' : ''}">${fmtDay(k, { weekday: 'short' })} <span class="dn">${+k.slice(8)}</span></div>`;
      allday += `<div>${dayEvents(k).filter((e) => e.allDay).map((e) => evBlock(e, '')).join('')}</div>`;
      const blocks = loading ? fakeBlocks(k) : layoutDay(dayEvents(k)).map(({ e, col, cols: n }) => {
        const top = (e.startMin - h0 * 60) / 60 * HOUR;
        const hgt = Math.max((Math.max(eEnd(e), e.startMin + 25) - e.startMin) / 60 * HOUR - 1, 20);
        return evBlock(e, `top:${top}px;height:${hgt}px;left:calc(${col / n * 100}% + 1px);width:calc(${100 / n}% - 3px)`);
      }).join('');
      const nm = T.minutesOf(nowMs);
      const nowLine = k === t && nm >= h0 * 60 && nm <= h1 * 60 ? `<div class="now" style="top:${(nm - h0 * 60) / 60 * HOUR}px"></div>` : '';
      cols += `<div class="dcol">${blocks}${nowLine}</div>`;
    }
    let gut = '';
    for (let h = h0; h <= h1; h++) gut += `<span style="top:${(h - h0) * HOUR}px">${String(h).padStart(2, '0')}:00</span>`;
    return `<div class="cal ${cls || ''}" style="--n:${keys.length};--rows:${rows};--hour:${HOUR}px">
      <div class="head">${head}</div>${hasAllDay ? `<div class="allday">${allday}</div>` : ''}
      <div class="body"><div class="gut">${gut}</div>${cols}</div></div>`;
  }

  function dayStrip() {
    const t = today(), start = T.startOfWeek(state.date);
    return '<div class="strip">' + Array.from({ length: 7 }, (_, i) => {
      const k = T.addDays(start, i), has = dayEvents(k).length > 0;
      return `<button class="sd${k === state.date ? ' sel' : ''}${k === t ? ' today' : ''}" data-goto="${k}" aria-pressed="${k === state.date}" aria-label="${fmtDay(k, { weekday: 'long', day: 'numeric', month: 'long' })}">
        <span class="w">${fmtDay(k, { weekday: 'short' })}</span><span class="n">${+k.slice(8)}</span><i${has ? ' class="on"' : ''}></i></button>`;
    }).join('') + '</div>';
  }

  function renderDay() {
    const k = state.date;
    const loading = viewLoading();
    return (phone.matches ? dayStrip() : '') + (loading || dayEvents(k).length ? '' : '<div class="free-note">No classes this day.</div>') + timeGrid([k], 'dayone', loading);
  }

  function renderWeek() {
    const start = T.startOfWeek(state.date), t = today();
    const keys = Array.from({ length: 7 }, (_, i) => T.addDays(start, i));
    const loading = viewLoading();
    const list = !phone.matches ? '' : keys.map((k) => {
      const evs = dayEvents(k);
      const cls = (k === t ? 'today' : k < t ? 'pastday' : '');
      const dd = `<div class="dd"><span>${fmtDay(k, { weekday: 'short' })}</span><b>${+k.slice(8)}</b></div>`;
      const sk = '<div class="row"><span class="rt"><i class="sk" style="width:34px;height:13px"></i></span><span class="rb"><i class="sk" style="width:80%;height:14px"></i><i class="sk" style="width:45%;height:12px;margin-top:6px"></i></span></div>';
      const body = loading ? (T.weekdayIdx(k) < 5 ? sk : '') : evs.length ? evs.map(evRow).join('') : '<p class="none">No classes</p>';
      return `<section class="${cls}">${dd}<div class="dl">${body}</div></section>`;
    }).join('');
    return phone.matches ? `<div class="wlist">${list}</div>` : `<div class="weekgrid">${timeGrid(keys, '', loading)}</div>`;
  }

  function renderMonth() {
    const loading = viewLoading();
    const first = T.startOfMonth(state.date), t = today();
    const gridStart = T.startOfWeek(first);
    const rows = Math.ceil(((T.keyToUTC(T.addMonths(first, 1)) - T.keyToUTC(gridStart)) / 864e5) / 7);
    let html = '<div class="mhead">' + ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => `<div>${d}</div>`).join('') + '</div><div class="month">';
    for (let i = 0; i < rows * 7; i++) {
      const k = T.addDays(gridStart, i), evs = dayEvents(k);
      const out = k.slice(0, 7) !== first.slice(0, 7);
      html += `<button class="cell${out ? ' out' : ''}${k === t ? ' today' : ''}" data-goto="${k}" aria-label="${fmtDay(k, { weekday: 'long', day: 'numeric', month: 'long' })}, ${evs.length} classes">
        <span class="d">${+k.slice(8)}</span>
        ${loading ? (T.weekdayIdx(k) < 5 && !out ? '<i class="sk chipsk"></i>' : '') : ''}
        ${evs.slice(0, 3).map((e) => `<span class="chip" style="--h:${hue(e.title)}">${e.allDay ? '' : `<time>${hm(e.start)}</time>`}<span>${esc(e.title)}</span></span>`).join('')}
        ${evs.length > 3 ? `<span class="more">${evs.length - 3} more</span>` : ''}
        <span class="dots">${evs.slice(0, 6).map((e) => `<i style="--h:${hue(e.title)}"></i>`).join('')}</span>
      </button>`;
    }
    return html + '</div>';
  }

  function label() {
    const d = state.date;
    if (state.view === 'day') return fmtDay(d, phone.matches ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    if (state.view === 'month') return fmtDay(d, { month: 'long', year: 'numeric' });
    const s = T.startOfWeek(d), e = T.addDays(s, 6);
    const sameMonth = s.slice(0, 7) === e.slice(0, 7);
    return `${fmtDay(s, sameMonth ? { day: 'numeric' } : { day: 'numeric', month: 'short' })} – ${fmtDay(e, { day: 'numeric', month: 'short', year: 'numeric' })}`;
  }

  function dur(ms) {
    const m = Math.max(1, Math.round(ms / 60000));
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h} h${m % 60 ? ' ' + String(m % 60).padStart(2, '0') : ''}`;
    return `${Math.floor(h / 24)} d`;
  }
  function renderHero() {
    const now = Date.now(), el = $('#hero');
    const live = state.events.find((e) => e.start <= now && now < e.end);
    const next = state.events.find((e) => e.start > now);
    const e = live || next;
    if (!e) {
      const m = months.get(monthOf(today()));
      const busy = anyLoading() || !(m && (m.at || m.status === 'error'));
      el.innerHTML = m && m.status === 'error' && !m.at ? '' : busy ? '<i class="sk" style="display:block;width:min(360px,80%);height:15px;margin-top:3px"></i>' : 'No upcoming classes.';
      return;
    }
    const k = T.dayKeyOf(e.start), t = today();
    const when = k === t ? '' : (k === T.addDays(t, 1) ? 'tomorrow ' : fmtDay(k, { weekday: 'long', day: 'numeric', month: 'short' }) + ' ');
    const where = e.location ? `, ${esc(e.location)}` : '';
    el.innerHTML = `<button data-uid="${esc(e.uid)}" data-start="${e.start}">` + (live
      ? `<b>Now</b><span class="t">${esc(e.title)}</span>, until ${hm(e.end)} (${dur(e.end - now)} left)${where}`
      : `<b>Next</b><span class="t">${esc(e.title)}</span>, ${when}${hm(e.start)}, in ${dur(e.start - now)}${where}`) + '</button>';
  }

  function errorBox() {
    return '<div class="errbox"><p>Could not load the timetable for this period. Check your connection.</p><button class="btn" data-retry>Try again</button></div>';
  }
  function render() {
    for (const m of [...viewMonths(), monthOf(today())]) hydrate(m); // saved months first, so no skeleton when cached
    document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === state.view)));
    $('#label').textContent = label();
    $('#view').innerHTML = viewFailed() ? errorBox() : { day: renderDay, week: renderWeek, month: renderMonth }[state.view]();
    $('#view').setAttribute('aria-busy', String(viewLoading()));
    renderHero();
    syncBanner();
    const busy = anyLoading();
    $('#bar').classList.toggle('on', busy);
    const at = viewMonths().map((m) => months.get(m)?.at || 0).filter(Boolean);
    $('#updated').textContent = busy ? 'Refreshing…' : at.length ? 'Updated ' + hm(Math.min(...at)) + '.' : '';
    writeHash();
    ensure();
  }

  // ---------- modal ----------
  function openEvent(uid, start) {
    const e = state.events.find((x) => x.uid === uid && String(x.start) === String(start));
    if (!e) return;
    const date = fmtDay(e.day, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const rows = [
      ['When', `${date}<br>${e.allDay ? 'All day' : hm(e.start) + ' – ' + hm(e.end) + ' (' + dur(e.end - e.start) + ')'}`],
      e.location && ['Where', esc(e.location)],
      ...e.details.map((d, i) => [i === 0 ? 'Group' : i === 1 ? 'Teacher' : 'Info', esc(d)]),
    ].filter(Boolean);
    $('#modalBody').innerHTML = `<h4>${esc(e.title)}</h4><dl>${rows.map(([a, b]) => `<dt>${a}</dt><dd>${b}</dd>`).join('')}</dl><button class="close" type="button">Close</button>`;
    $('#modalBody').style.setProperty('--h', hue(e.title));
    $('#modal').showModal();
  }

  // ---------- navigation ----------
  function go(dir) {
    if (state.view === 'day') state.date = T.addDays(state.date, dir);
    else if (state.view === 'week') state.date = T.addDays(state.date, 7 * dir);
    else state.date = T.addMonths(state.date, dir);
    render();
  }
  function setView(v) { if (VIEWS.includes(v)) { state.view = v; render(); } }

  // ---------- events ----------
  document.addEventListener('click', (ev) => {
    const t = ev.target;
    const seg = t.closest('.tabs button'); if (seg) return setView(seg.dataset.view);
    const card = t.closest('[data-uid]'); if (card) return openEvent(card.dataset.uid, card.dataset.start);
    if (t.closest('[data-retry]')) return refresh(true);
    const cell = t.closest('[data-goto]'); if (cell) { state.date = cell.dataset.goto; state.view = 'day'; return render(); }
    if (t.closest('.close') || t === $('#modal')) $('#modal').close();
  });
  $('#prev').onclick = () => go(-1);
  $('#next').onclick = () => go(1);
  $('#today').onclick = () => { state.date = today(); render(); };
  $('#refresh').onclick = () => refresh(true);
  window.addEventListener('hashchange', () => { readHash(); render(); });
  document.addEventListener('keydown', (e) => {
    if ($('#modal').open || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 't') { state.date = today(); render(); }
    else if (e.key === 'd') setView('day');
    else if (e.key === 'w') setView('week');
    else if (e.key === 'm') setView('month');
  });
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  setInterval(() => { if (!document.hidden) { renderHero(); render(); } }, 60000);

  phone.addEventListener('change', render);
  let sx = 0, sy = 0;
  $('#view').addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  $('#view').addEventListener('touchend', (e) => {
    const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
    if (Math.abs(dx) > 70 && Math.abs(dy) < 45 && Math.abs(dx) > 2 * Math.abs(dy)) go(dx < 0 ? 1 : -1);
  }, { passive: true });

  // ---------- boot ----------
  readHash();
  render();
})();
