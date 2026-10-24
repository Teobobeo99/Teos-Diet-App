// Today tab: the quick-log loop (type/dictate -> Gemini -> confirm -> saved),
// plus today's summary, favorites and log list.
// Rendering is idempotent: all in-progress UI state lives in module variables below.
import { db, save, addEntries, deleteEntry, entriesFor, dayTotals, weekTargets, weekStart, dayIdx,
         targetFor, today, esc, uid, toast, r, DEFAULT_MODEL } from './store.js';
import { parseLog, provider, hasKey } from './ai.js';

// ---------- Module state ----------
let root = null;
let draft = '';          // textarea text
let busy = false;        // waiting on Gemini
let error = '';          // last Gemini error (friendly text)
let pending = null;      // { items: [...], source, editId, editDate, editTime } while confirming
let favEdit = false;     // favorites delete mode
let armed = null;        // id of a delete button waiting for its confirming 2nd tap
let armTimer = 0, spinTimer = 0, spinFrame = 0;

const SPIN = ['|', '/', '-', '\\'];
const MOUTH = ['O', 'o', '-', 'o'];

// ---------- Public API ----------
export function init(el) {
  root = el;
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('keydown', onKey);
}

export function render(el = root) {
  root = el;
  // remember focus + caret so a re-render mid-typing doesn't kick the user out
  const act = document.activeElement;
  const fk = act && el.contains(act) ? act.dataset.fk : null;
  const sel = fk && 'selectionStart' in act ? [act.selectionStart, act.selectionEnd] : null;

  el.innerHTML = logBox() + confirmPanel() + summary() + favorites() + logList();

  if (fk) {
    const again = el.querySelector(`[data-fk="${fk}"]`);
    if (again) {
      again.focus({ preventScroll: true });
      try { if (sel) again.setSelectionRange(sel[0], sel[1]); } catch {}
    }
  }
}

// ---------- Sections ----------
function logBox() {
  const keyed = hasKey();
  return `
  <div class="t-log block">
    <label for="t-input">What did you eat or do?</label>
    <textarea id="t-input" data-fk="draft" rows="3" enterkeyhint="send" autocomplete="off"
      placeholder="${esc(placeholder())}" ${busy ? 'disabled' : ''}>${esc(draft)}</textarea>
    <div class="t-log-actions">
      <button class="btn btn-primary t-go" data-act="log" ${busy || !keyed ? 'disabled' : ''}>Log it</button>
      <button class="btn t-hand" data-act="hand" ${busy ? 'disabled' : ''}>+ By hand</button>
    </div>
    ${busy ? `<pre class="t-spin ascii" aria-live="polite">${spinText()}</pre>` : ''}
    ${!keyed ? `
      <div class="t-nokey">
        <pre class="ascii" aria-hidden="true"> o--,-,
  key?</pre>
        <p>${provider().label} needs an API key before it can count calories for you. Favorites and "By hand" still work.</p>
        <button class="btn" data-act="settings">Go to Setup &gt;</button>
      </div>` : ''}
    ${error && !busy ? `
      <div class="t-error" role="alert">
        <span class="display">! </span>${esc(error)}
        <div class="row">
          ${keyed && draft.trim() ? '<button class="btn" data-act="log">Retry</button>' : ''}
          <button class="btn btn-ghost" data-act="dismiss">Dismiss</button>
        </div>
      </div>` : ''}
  </div>`;
}

function confirmPanel() {
  if (!pending) return '';
  const { items, editId, source } = pending;
  const canRetry = !editId && source && hasKey();
  const rows = items.map((it, i) => {
    const burn = it.type === 'burn';
    return `
    <li class="t-item ${burn ? 'is-burn' : ''}">
      <div class="t-item-top">
        <button class="t-type" data-act="type" data-i="${i}" aria-label="Switch food or exercise">${burn ? 'Burn' : 'Eat'}</button>
        <input class="t-name" data-i="${i}" data-k="name" data-fk="${i}-name" value="${esc(it.name)}" aria-label="Item name" autocomplete="off">
        <button class="t-x" data-act="rm" data-i="${i}" aria-label="Remove item">X</button>
      </div>
      <div class="t-item-nums ${burn ? 'one' : ''}">
        ${numField(i, 'cal', burn ? 'Burned kcal' : 'Kcal', it.cal)}
        ${burn ? '' : numField(i, 'p', 'P g', it.p) + numField(i, 'c', 'C g', it.c) + numField(i, 'f', 'F g', it.f)}
      </div>
    </li>`;
  }).join('');

  return `
  <div class="t-confirm px-box block" id="t-confirm">
    <h2>${editId ? 'Edit entry' : 'Look right?'}</h2>
    ${source && !editId ? `<p class="t-source muted">"${esc(source)}"</p>` : ''}
    ${items.length ? `<ul class="t-items">${rows}</ul>` : `
      <div class="empty"><pre aria-hidden="true">  _____
 |     |
 |_____|  </pre><div>${editId ? 'Nothing left. SAVE will delete this entry.' : 'All items removed. Add one or cancel.'}</div></div>`}
    <div class="t-total num" id="t-total">${confirmTotal()}</div>
    <div class="t-confirm-actions">
      <button class="btn btn-primary" data-act="save" ${!items.length && !editId ? 'disabled' : ''}>Save</button>
      ${editId ? '' : `<button class="btn" data-act="savefav" ${items.length ? '' : 'disabled'}>Save + &#9733; Fav</button>`}
    </div>
    <div class="t-confirm-actions minor">
      <button class="btn btn-ghost" data-act="add">+ Item</button>
      ${canRetry ? '<button class="btn btn-ghost" data-act="retry">Retry</button>' : ''}
      <button class="btn btn-ghost" data-act="cancel">Cancel</button>
    </div>
  </div>`;
}

const numField = (i, k, label, v) => `
  <label class="t-num"><span>${label}</span>
    <input data-i="${i}" data-k="${k}" data-fk="${i}-${k}" value="${esc(v)}" inputmode="decimal" autocomplete="off">
  </label>`;

function confirmTotal() {
  const food = pending.items.filter(i => i.type !== 'burn'), burn = pending.items.filter(i => i.type === 'burn');
  const sum = (arr, k) => arr.reduce((a, i) => a + r(i[k]), 0);
  const parts = [];
  if (food.length) parts.push(`= ${sum(food, 'cal')} kcal &middot; P${sum(food, 'p')} C${sum(food, 'c')} F${sum(food, 'f')}`);
  if (burn.length) parts.push(`<span class="good-text">&minus;${sum(burn, 'cal')} burned</span>`);
  return parts.join(' &middot; ') || '= 0 kcal';
}

function summary() {
  const d = today(), s = db.settings;
  const tot = dayTotals(d), target = targetFor(d);
  const wk = weekTargets(weekStart(d));
  const isBig = wk.big.includes(dayIdx(d));
  const budget = target + tot.credit;
  const left = r(budget - tot.eaten);
  const over = left < 0;
  const ratio = budget > 0 ? tot.eaten / budget : 0;
  const counted = r(tot.credit);

  const macros = [['p', 'Protein', s.protein], ['c', 'Carbs', s.carbs], ['f', 'Fat', s.fat]]
    .filter(([, , t]) => +t > 0)
    .map(([k, label, t]) => {
      const v = r(tot[k]), pct = Math.min(100, v / t * 100);
      const isOver = k !== 'p' && v > +t;
      return `
      <div class="t-macro">
        <div class="t-macro-head"><span class="display">${label}</span><span class="num ${isOver ? 'over-text' : v >= t ? 'good-text' : ''}">${v}/${r(t)}g</span></div>
        <div class="meter ${isOver ? 'over' : ''}"><i style="width:${pct.toFixed(1)}%"></i></div>
      </div>`;
    }).join('');

  return `
  <div class="rule" data-label="Today${isBig ? ' * big day' : ''}"></div>
  <div class="t-sum block ${over ? 'is-over' : ''}">
    <div class="t-sum-top">
      <div class="t-left">
        <div class="t-big num ${over ? 'over-text' : ''}">${over ? '+' + Math.abs(left) : left}</div>
        <div class="t-big-label display ${over ? 'over-text' : ''}">${over ? 'kcal over' : 'kcal left'}</div>
      </div>
      ${critter(ratio, tot.eaten, over)}
    </div>
    ${gauge(ratio, over)}
    <div class="t-stats num">
      <span>target <b>${r(target)}</b>${isBig ? ' <span class="big-text">big</span>' : ''}</span>
      <span>eaten <b>${r(tot.eaten)}</b></span>
      <span>burned <b class="good-text">${r(tot.burned)}</b>${tot.burned && s.pct < 100 ? ` <span class="muted">(${counted} counted)</span>` : ''}</span>
    </div>
    ${macros ? `<div class="t-macros">${macros}</div>` : ''}
    ${wk.forgiven > 0 ? `<p class="t-note muted">* ${wk.forgiven} kcal of this week's overage was forgiven (days can't go below the ${r(s.floor)} floor).</p>` : ''}
  </div>`;
}

// ASCII fuel gauge: 20 pixel cells, E..F
function gauge(ratio, over) {
  const N = 20, filled = Math.max(0, Math.min(N, Math.round(ratio * N)));
  const cells = '█'.repeat(filled) + '░'.repeat(N - filled);
  return `<div class="t-gauge num ${over ? 'over-text' : ''}" aria-hidden="true"><span class="muted">E</span>[<span class="t-cells">${cells}</span>]<span class="muted">F</span></div>`;
}

// Little ASCII critter whose mood follows the day
function critter(ratio, eaten, over) {
  let face, mouth, say, cls = '';
  if (over) { face = 'x.x'; mouth = '~~~'; say = 'oof. tomorrow!'; cls = 'over-text'; }
  else if (!eaten) { face = 'o.o'; mouth = ' O '; say = 'feed me?'; }
  else if (ratio < 0.6) { face = '^.^'; mouth = '\\_/'; say = 'cruising'; cls = 'good-text'; }
  else if (ratio < 0.9) { face = '-.-'; mouth = ' u '; say = 'nice pace'; cls = 'good-text'; }
  else { face = 'o.O'; mouth = ' = '; say = 'almost full'; cls = 'big-text'; }
  const art = ` /\\_/\\\n( ${face} )\n ( ${mouth}) \n  " "`;
  return `<div class="t-critter ${cls}" aria-hidden="true"><pre class="ascii">${esc(art)}</pre><div class="t-say">${say}</div></div>`;
}

function favorites() {
  const favs = db.favorites || [];
  const chips = favs.map(f => {
    const kcal = (f.items || []).reduce((a, i) => a + (i.type === 'burn' ? -r(i.cal) : r(i.cal)), 0);
    const isArmed = armed === 'fav:' + f.id;
    return `<button class="t-chip ${favEdit ? 'editing' : ''} ${isArmed ? 'armed' : ''}" data-act="${favEdit ? 'favdel' : 'fav'}" data-id="${esc(f.id)}">
      ${favEdit ? `<span class="t-chip-x">${isArmed ? 'Sure?' : 'X'}</span>` : '<span class="t-star">&#9733;</span>'}
      <span class="t-chip-name">${esc(f.name)}</span><span class="t-chip-cal num">${kcal}</span>
    </button>`;
  }).join('');

  return `
  <div class="rule" data-label="Favorites"></div>
  <div class="t-favs block">
    ${favs.length ? `
      <div class="t-chips">${chips}</div>
      <div class="t-fav-tools"><button class="btn btn-ghost" data-act="favedit">${favEdit ? 'Done' : 'Edit favs'}</button></div>` : `
      <div class="empty"><pre aria-hidden="true">    .
 __/ \\__
 \\     /
 /_. ._\\
   ' '</pre><div>No favorites yet. After logging, hit "SAVE + &#9733; FAV" to keep it here for one-tap re-logging.</div></div>`}
  </div>`;
}

function logList() {
  const es = entriesFor(today()).slice().sort((a, b) => (b.time || '').localeCompare(a.time || ''));
  const rows = es.map(e => {
    const burn = e.type === 'burn', isArmed = armed === 'entry:' + e.id;
    return `
    <li class="t-entry ${burn ? 'is-burn' : ''}">
      <span class="t-time num muted">${esc(e.time || '')}</span>
      <span class="t-ename">${esc(e.name)}</span>
      <span class="t-kcal num ${burn ? 'good-text' : ''}">${burn ? '&minus;' : ''}${r(e.cal)}</span>
      <span class="t-macs num muted">${burn ? 'burned' : `P${r(e.p)} C${r(e.c)} F${r(e.f)}`}</span>
      <span class="t-eacts">
        <button class="t-mini" data-act="edit" data-id="${esc(e.id)}" aria-label="Edit">Edit</button>
        <button class="t-mini danger ${isArmed ? 'armed' : ''}" data-act="del" data-id="${esc(e.id)}" aria-label="Delete">${isArmed ? 'Sure?' : 'Del'}</button>
      </span>
    </li>`;
  }).join('');

  return `
  <div class="rule" data-label="Log"></div>
  <div class="t-list block">
    ${es.length ? `<ul class="t-entries">${rows}</ul>` : `
      <div class="empty"><pre aria-hidden="true">     .-'''''-.
    /  .---.  \\
   |  (     )  |
    \\  '---'  /
     '-.....-'</pre><div>Nothing logged yet. Try "${esc(placeholder(true))}".</div></div>`}
  </div>`;
}

// ---------- Helpers ----------
function placeholder(short) {
  const h = new Date().getHours();
  const ideas = h < 11 ? ['oatmeal with banana', 'oatmeal with banana and coffee with milk']
    : h < 16 ? ['turkey sandwich and an apple', 'turkey sandwich, apple, walked 20 min']
    : ['chicken, rice and broccoli', 'chicken, rice and broccoli, ran 3 miles'];
  return short ? ideas[0] : 'e.g. ' + ideas[1];
}

const spinText = () => `[${SPIN[spinFrame % 4]}] ( o.o )>${MOUTH[spinFrame % 4]}  chewing on it...`;

function latestWeight() {
  const w = (db.weights || []).slice().sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop();
  return w && +w.lbs > 0 ? r(w.lbs) : null;
}

function setBusy(on) {
  busy = on;
  clearInterval(spinTimer);
  if (on) {
    spinFrame = 0;
    spinTimer = setInterval(() => {
      spinFrame++;
      const el = root?.querySelector('.t-spin');
      if (el) el.textContent = spinText();
    }, 140);
  }
}

function arm(key) {
  armed = key;
  clearTimeout(armTimer);
  armTimer = setTimeout(() => { armed = null; render(); }, 3000);
  render();
}

const blank = () => ({ name: '', cal: '', p: '', c: '', f: '', type: 'food' });

function scrollToConfirm() {
  requestAnimationFrame(() => root?.querySelector('#t-confirm')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// ---------- Actions ----------
async function submit(text = draft) {
  text = String(text || '').trim();
  if (busy || !text) return;
  if (!hasKey()) { error = `No ${provider().label} API key yet. Add one in Setup.`; render(); return; }
  error = '';
  setBusy(true);
  document.activeElement?.blur?.();   // drop the iOS keyboard so the result is visible
  render();
  try {
    const items = await parseLog(text, { weightLbs: latestWeight() });
    if (!items.length) throw Object.assign(new Error('Didn\'t catch any food or exercise in that. Try being a bit more specific.'), { friendly: true });
    pending = { items, source: text, editId: null };
  } catch (e) {
    error = e.friendly ? e.message : `Something went wrong talking to ${provider().label}. Try again.`;
    if (!e.friendly) console.error(e);
  } finally {
    setBusy(false);
    render();
    if (pending && !error) scrollToConfirm();
  }
}

function clean(it) {
  const burn = it.type === 'burn';
  return { name: String(it.name || '').trim() || (burn ? 'Exercise' : 'Food'), type: burn ? 'burn' : 'food',
           cal: Math.max(0, r(it.cal)), p: burn ? 0 : Math.max(0, r(it.p)), c: burn ? 0 : Math.max(0, r(it.c)), f: burn ? 0 : Math.max(0, r(it.f)) };
}

function savePending(asFav) {
  if (!pending) return;
  const items = pending.items.map(clean);
  const { editId, source } = pending;

  if (asFav && items.length) {
    const name = favName(source, items);
    db.favorites = (db.favorites || []).filter(f => f.name.toLowerCase() !== name.toLowerCase());
    db.favorites.push({ id: uid(), name, items });
  }

  pending = null;
  if (editId) {
    // replace the original entry in place (keep its date/time); extra items go right after it
    const idx = db.entries.findIndex(e => e.id === editId);
    if (idx < 0) { addEntries(items); toast('Saved'); return; }
    const orig = db.entries[idx];
    const repl = items.map((it, i) => ({ ...it, id: i === 0 ? orig.id : uid(), date: orig.date, time: orig.time }));
    db.entries.splice(idx, 1, ...repl);
    save();
    toast(items.length ? 'Entry updated' : 'Entry deleted');
  } else {
    draft = '';
    error = '';
    addEntries(items);  // save() -> db-change -> render
    toast(asFav ? 'Logged + saved as favorite' : `Logged ${items.length} item${items.length === 1 ? '' : 's'}`);
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function favName(source, items) {
  const s = String(source || '').trim().replace(/\s+/g, ' ');
  const base = s || items.map(i => i.name).join(', ');
  return base.length > 36 ? base.slice(0, 35).trim() + '…' : base;
}

function onClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn || !root.contains(btn)) return;
  const act = btn.dataset.act, i = +btn.dataset.i, id = btn.dataset.id;

  switch (act) {
    case 'log': submit(); break;
    case 'retry': if (pending?.source) { const src = pending.source; pending = null; submit(src); } break;
    case 'settings': window.dispatchEvent(new CustomEvent('go-tab', { detail: 'settings' })); break;
    case 'dismiss': error = ''; render(); break;
    case 'hand':
      pending = { items: [{ ...blank(), name: draft.trim().slice(0, 80) }], source: '', editId: null };
      render(); scrollToConfirm(); break;
    case 'add': pending.items.push(blank()); render(); break;
    case 'rm': pending.items.splice(i, 1); render(); break;
    case 'type': {
      const it = pending.items[i];
      it.type = it.type === 'burn' ? 'food' : 'burn';
      render(); break;
    }
    case 'cancel': pending = null; render(); break;
    case 'save': savePending(false); break;
    case 'savefav': savePending(true); break;
    case 'fav': {
      const f = db.favorites.find(x => x.id === id);
      if (!f) break;
      addEntries(f.items.map(clean));
      toast(`+ ${f.name}`);
      break;
    }
    case 'favedit': favEdit = !favEdit; armed = null; render(); break;
    case 'favdel':
      if (armed !== 'fav:' + id) { arm('fav:' + id); break; }
      armed = null;
      db.favorites = db.favorites.filter(x => x.id !== id);
      if (!db.favorites.length) favEdit = false;
      save(); toast('Favorite removed');
      break;
    case 'edit': {
      const en = db.entries.find(x => x.id === id);
      if (!en) break;
      pending = { items: [{ name: en.name, cal: en.cal, p: en.p, c: en.c, f: en.f, type: en.type }], source: en.name, editId: en.id };
      render(); scrollToConfirm(); break;
    }
    case 'del':
      if (armed !== 'entry:' + id) { arm('entry:' + id); break; }
      armed = null;
      if (pending?.editId === id) pending = null;
      deleteEntry(id); toast('Deleted');
      break;
  }
}

function onInput(e) {
  const t = e.target;
  if (t.id === 't-input') { draft = t.value; return; }
  if (pending && t.dataset.k) {
    const it = pending.items[+t.dataset.i];
    if (!it) return;
    it[t.dataset.k] = t.value;
    const tot = root.querySelector('#t-total');
    if (tot) tot.innerHTML = confirmTotal();
  }
}

function onKey(e) {
  if (e.key !== 'Enter' || e.isComposing) return;
  if (e.target.id === 't-input' && !e.shiftKey) { e.preventDefault(); submit(); }
  else if (pending && e.target.dataset.k) { e.preventDefault(); e.target.blur(); }  // "Go"/return on a field just closes the keyboard
}
