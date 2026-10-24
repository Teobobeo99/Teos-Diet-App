// Shared data layer: state, persistence, dates and budget math.
// Every tab module imports from here. Data lives in localStorage; js/sync.js mirrors it to the cloud when signed in.
const KEY = 'teoDiet';
export const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const DEFAULT_MODEL = 'gemini-3.8-flash';

export const defaults = () => ({
  settings: { apiKey: '', keyOk: false, models: [], model: DEFAULT_MODEL, target: 2200, protein: 160, carbs: '', fat: '', goal: 175,
              pct: 50, floor: 1500, bigExtra: 400, bigDays: [5, 6] },
  entries: [],      // { id, date, time, name, cal, p, c, f, type: 'food' | 'burn' }
  weights: [],      // { date, lbs }
  favorites: [],    // { id, name, items: [{ name, cal, p, c, f, type }] }
  weekOverrides: {} // { 'YYYY-MM-DD' (Monday): [dayIdx, ...] }
});

export let db = load();

function load() {
  const base = defaults();
  try {
    const saved = JSON.parse(localStorage.getItem(KEY)) || {};
    return { ...base, ...saved, settings: { ...base.settings, ...(saved.settings || {}) } };
  } catch { return base; }
}

let syncHook = null;
export const setSyncHook = fn => { syncHook = fn; };

// Persist and tell the app to re-render. Call after every change to db.
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
  syncHook?.();
  window.dispatchEvent(new CustomEvent('db-change'));
}

// Data that arrived from the cloud: store it without pushing it straight back.
export function applyRemote(data) {
  const base = defaults();
  db = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  try { localStorage.setItem(KEY, JSON.stringify(db)); } catch {}
  window.dispatchEvent(new CustomEvent('db-change'));
}

export function replaceAll(data) {
  const base = defaults();
  db = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) } };
  save();
}

// ---------- Helpers ----------
export const $ = (sel, root = document) => root.querySelector(sel);
export const r = n => Math.round(+n || 0);
export const uid = () => crypto.randomUUID?.() || String(Date.now() + Math.random());
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function toast(msg, ms = 1800) {
  const el = document.createElement('div');
  el.className = 'toast px-box display';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

// ---------- Dates (local, 'YYYY-MM-DD') ----------
export const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const parse = s => new Date(s + 'T12:00:00');
export const today = () => iso(new Date());
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const dayIdx = s => (parse(s).getDay() + 6) % 7; // Monday = 0
export const weekStart = s => addDays(s, -dayIdx(s));
export const prettyDate = s => parse(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

// ---------- Entries ----------
export function addEntries(items, date = today()) {
  const time = new Date().toTimeString().slice(0, 5);
  items.forEach(it => db.entries.push({
    id: uid(), date, time, name: it.name, type: it.type === 'burn' ? 'burn' : 'food',
    cal: r(it.cal), p: r(it.p), c: r(it.c), f: r(it.f),
  }));
  save();
}
export function deleteEntry(id) { db.entries = db.entries.filter(e => e.id !== id); save(); }
export function updateEntry(id, patch) { Object.assign(db.entries.find(e => e.id === id) || {}, patch); save(); }
export const entriesFor = date => db.entries.filter(e => e.date === date);

// ---------- Budget math ----------
// credit = burned calories that count, after the add-back percentage.
export function dayTotals(date) {
  const es = entriesFor(date), food = es.filter(e => e.type === 'food');
  const sum = k => food.reduce((a, e) => a + (+e[k] || 0), 0);
  const burned = es.filter(e => e.type === 'burn').reduce((a, e) => a + (+e.cal || 0), 0);
  return { eaten: sum('cal'), p: sum('p'), c: sum('c'), f: sum('f'), burned, credit: burned * db.settings.pct / 100 };
}

export const bigDaysFor = ws => db.weekOverrides[ws] || db.settings.bigDays;

// Planned targets (big days get +bigExtra, other days lowered to keep the weekly total),
// then overage from days before today is spread across today..Sunday, never below the floor.
// Overage that doesn't fit is forgiven.
export function weekTargets(ws) {
  const s = db.settings, T = +s.target, big = bigDaysFor(ws), floor = +s.floor || 0;
  const nBig = big.length, extra = +s.bigExtra || 0;
  const lower = nBig && nBig < 7 ? extra * nBig / (7 - nBig) : 0;
  const planned = DAYS.map((_, i) => big.includes(i) ? T + extra : T - lower);
  const adjusted = [...planned];
  const t = today(), tws = weekStart(t);
  // Past weeks are shown as they stood on their Sunday (the last day anything could be spread to).
  const tIdx = ws === tws ? dayIdx(t) : ws < tws ? 6 : 0;

  let overage = 0;
  for (let i = 0; i < tIdx; i++) {
    const tot = dayTotals(addDays(ws, i));
    overage += Math.max(0, tot.eaten - tot.credit - adjusted[i]);
  }
  let left = overage;
  let open = [];
  for (let i = tIdx; i < 7; i++) if (adjusted[i] > floor) open.push(i);
  while (left > 0.5 && open.length) {
    const share = left / open.length;
    open = open.filter(i => {
      const take = Math.min(share, adjusted[i] - floor);
      adjusted[i] -= take; left -= take;
      return adjusted[i] > floor + 0.5;
    });
  }
  return { planned: planned.map(r), adjusted: adjusted.map(r), overage: r(overage), forgiven: r(Math.max(0, left)), big };
}

export const targetFor = date => weekTargets(weekStart(date)).adjusted[dayIdx(date)];
