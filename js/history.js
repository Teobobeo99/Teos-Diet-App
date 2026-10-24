// History tab: browse any past day, edit/delete entries inline, back-fill manual entries.
import {
  db, entriesFor, deleteEntry, updateEntry, addEntries, dayTotals, targetFor,
  today, addDays, prettyDate, esc, r, toast,
} from './store.js';

let root = null;
let sel = today();       // selected 'YYYY-MM-DD'
let editing = null;      // entry id being edited inline
let armed = null;        // entry id whose delete is armed ("SURE?")
let armTimer = 0;
let adding = false;      // manual-entry form open
let addType = 'food';

const RECEIPT = String.raw` _________________
 |  ~ RECEIPT ~  |
 |  ...........  |
 |  ...........  |
 |   NOTHING     |
 |   LOGGED      |
 |  ...........  |
 |/\/\/\/\/\/\/\/|`;

export function init(el) {
  root = el;
  el.addEventListener('click', onClick);
  el.addEventListener('change', onChange);
  el.addEventListener('submit', onSubmit);
}

export function render(el = root) {
  root = el;
  const t = today();
  if (sel > t) sel = t;
  const es = entriesFor(sel).slice().sort((a, b) => (a.time || '').localeCompare(b.time || ''));
  el.innerHTML = `
    ${picker(t)}
    ${summary()}
    <div class="rule" data-label="ENTRIES"></div>
    ${es.length ? `<ul class="h-list">${es.map(row).join('')}</ul>` : empty(t)}
    ${addForm()}
    <div class="rule" data-label="LAST 14 DAYS"></div>
    ${recent(t)}`;
  if (editing) el.querySelector('.h-edit input')?.focus({ preventScroll: true });
}

// ---------- pieces ----------
function picker(t) {
  return `<div class="h-pick">
    <button type="button" class="h-nav" data-act="prev" aria-label="Previous day">‹</button>
    <div class="h-date">
      <span class="display">${sel === t ? 'TODAY' : esc(prettyDate(sel))}</span>
      <input type="date" class="h-date-input" value="${sel}" max="${t}" aria-label="Pick a date">
    </div>
    <button type="button" class="h-nav" data-act="next" aria-label="Next day" ${sel >= t ? 'disabled' : ''}>›</button>
  </div>`;
}

const line = (label, val, cls = '') =>
  `<div class="h-line ${cls}"><span>${label}</span><i aria-hidden="true"></i><b class="num">${val}</b></div>`;

function summary() {
  const tot = dayTotals(sel), target = targetFor(sel);
  const net = r(tot.eaten - tot.credit), diff = net - target;
  const has = entriesFor(sel).length > 0;
  return `<div class="h-receipt" aria-label="Day summary">
    ${line('TARGET', target)}
    ${line('EATEN', r(tot.eaten))}
    ${line('BURNED', tot.burned ? `${r(tot.burned)} <small>(+${r(tot.credit)})</small>` : 0)}
    <div class="h-tear" aria-hidden="true"></div>
    ${line('NET', net)}
    ${has
      ? line(diff > 0 ? 'OVER' : 'UNDER', Math.abs(diff), diff > 0 ? 'over-text' : 'good-text')
      : line('STATUS', 'NO LOG', 'muted')}
    <div class="h-macros muted num">P ${r(tot.p)}g · C ${r(tot.c)}g · F ${r(tot.f)}g</div>
  </div>`;
}

function row(e) {
  const burn = e.type === 'burn';
  if (editing === e.id) {
    return `<li class="h-item h-edit" data-id="${esc(e.id)}">
      <form class="h-form" data-form="edit">
        <label>Name<input name="name" value="${esc(e.name)}" required autocomplete="off"></label>
        <div class="h-grid ${burn ? 'h-grid-1' : ''}">
          <label>Kcal<input name="cal" type="number" inputmode="numeric" min="0" value="${r(e.cal)}" required></label>
          ${burn ? '' : `
          <label>P<input name="p" type="number" inputmode="numeric" min="0" value="${r(e.p)}"></label>
          <label>C<input name="c" type="number" inputmode="numeric" min="0" value="${r(e.c)}"></label>
          <label>F<input name="f" type="number" inputmode="numeric" min="0" value="${r(e.f)}"></label>`}
        </div>
        <div class="row">
          <button class="btn-primary" type="submit">Save</button>
          <button type="button" class="btn-ghost" data-act="cancel">Cancel</button>
        </div>
      </form>
    </li>`;
  }
  const sure = armed === e.id;
  return `<li class="h-item ${burn ? 'is-burn' : ''}" data-id="${esc(e.id)}">
    <button type="button" class="h-main" data-act="edit" aria-label="Edit ${esc(e.name)}">
      <span class="h-name">${burn ? '<em class="good-text">BURN</em> ' : ''}${esc(e.name)}</span>
      <span class="h-meta muted num">${esc(e.time || '')}${burn ? '' : ` · P${r(e.p)} C${r(e.c)} F${r(e.f)}`}</span>
    </button>
    <span class="h-kcal num ${burn ? 'good-text' : ''}">${burn ? '−' : ''}${r(e.cal)}</span>
    <button type="button" class="h-del ${sure ? 'btn-danger is-armed' : 'btn-ghost'}" data-act="del"
      aria-label="${sure ? 'Confirm delete' : 'Delete'} ${esc(e.name)}">${sure ? 'SURE?' : '✕'}</button>
  </li>`;
}

function empty(t) {
  const hint = sel === t
    ? 'Nothing logged today yet. Use the LOG tab, or add one by hand below.'
    : `Nothing logged on ${esc(prettyDate(sel))}. Back-fill it below if you remember.`;
  return `<div class="empty"><pre aria-hidden="true">${esc(RECEIPT)}</pre><p>${hint}</p></div>`;
}

function addForm() {
  if (!adding) {
    return `<button type="button" class="h-add-toggle" data-act="add-open">+ add manual entry</button>`;
  }
  const burn = addType === 'burn';
  return `<form class="h-form h-add px-box" data-form="add">
    <div class="h-type" role="group" aria-label="Entry type">
      <button type="button" data-act="type" data-type="food" aria-pressed="${!burn}">Food</button>
      <button type="button" data-act="type" data-type="burn" aria-pressed="${burn}">Exercise</button>
    </div>
    <label>${burn ? 'What did you do' : 'What did you eat'}
      <input name="name" required autocomplete="off" placeholder="${burn ? 'run 3 miles' : 'turkey sandwich'}"></label>
    <div class="h-grid ${burn ? 'h-grid-1' : ''}">
      <label>${burn ? 'Kcal burned' : 'Kcal'}<input name="cal" type="number" inputmode="numeric" min="0" required></label>
      ${burn ? '' : `
      <label>P<input name="p" type="number" inputmode="numeric" min="0" placeholder="0"></label>
      <label>C<input name="c" type="number" inputmode="numeric" min="0" placeholder="0"></label>
      <label>F<input name="f" type="number" inputmode="numeric" min="0" placeholder="0"></label>`}
    </div>
    <p class="muted h-note">Adds to ${esc(prettyDate(sel))}.</p>
    <div class="row">
      <button class="btn-primary" type="submit">Add</button>
      <button type="button" class="btn-ghost" data-act="add-close">Cancel</button>
    </div>
  </form>`;
}

function recent(t) {
  const rows = [];
  for (let i = 0; i < 14; i++) {
    const d = addDays(t, -i), has = entriesFor(d).length > 0;
    const tot = dayTotals(d), target = targetFor(d), net = r(tot.eaten - tot.credit);
    const ok = net <= target;
    const glyph = !has ? '·' : ok ? '✓' : '✗';
    const cls = !has ? 'muted' : ok ? 'good-text' : 'over-text';
    rows.push(`<li><button type="button" class="h-day ${d === sel ? 'is-sel' : ''}" data-act="pick" data-date="${d}">
      <span class="h-d">${d === t ? 'Today' : esc(prettyDate(d))}</span>
      <span class="num h-nt">${has ? net : '--'}<span class="muted">/${target}</span></span>
      <span class="h-g ${cls}" aria-label="${!has ? 'no log' : ok ? 'on target' : 'over'}">${glyph}</span>
    </button></li>`);
  }
  return `<ul class="h-days">${rows.join('')}</ul>`;
}

// ---------- events ----------
function setSel(d) {
  const t = today();
  sel = d > t ? t : d;
  editing = null; armed = null;
  render();
}

function onClick(ev) {
  const b = ev.target.closest('[data-act]');
  if (!b || !root.contains(b)) return;
  const id = b.closest('[data-id]')?.dataset.id;
  switch (b.dataset.act) {
    case 'prev': return setSel(addDays(sel, -1));
    case 'next': return setSel(addDays(sel, 1));
    case 'pick': setSel(b.dataset.date); return root.querySelector('.h-pick')?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    case 'edit': editing = id; armed = null; return render();
    case 'cancel': editing = null; return render();
    case 'del':
      clearTimeout(armTimer);
      if (armed === id) { armed = null; editing = null; deleteEntry(id); toast('Entry deleted'); return; }
      armed = id; render();
      armTimer = setTimeout(() => { if (armed === id) { armed = null; render(); } }, 3500);
      return;
    case 'add-open': adding = true; editing = null; render(); return root.querySelector('.h-add input[name=name]')?.focus();
    case 'add-close': adding = false; return render();
    case 'type': {
      // keep whatever was typed while switching type
      const form = b.closest('form'), name = fv(form, 'name'), cal = fv(form, 'cal');
      addType = b.dataset.type; render();
      const f2 = root.querySelector('.h-add');
      if (f2) { fe(f2, 'name').value = name; fe(f2, 'cal').value = cal; }
      return;
    }
  }
}

function onChange(ev) {
  if (ev.target.classList.contains('h-date-input') && ev.target.value) setSel(ev.target.value);
}

const num = v => Math.max(0, r(v));
const fe = (f, n) => f?.elements.namedItem(n);
const fv = (f, n) => fe(f, n)?.value ?? '';

function onSubmit(ev) {
  ev.preventDefault();
  const f = ev.target, kind = f.dataset.form;
  const name = fv(f, 'name').trim(), cal = fv(f, 'cal');
  if (!name) return toast('Needs a name');
  if (cal === '' || !isFinite(+cal)) return toast('Needs calories');
  const vals = { name, cal: num(cal) };
  if (fe(f, 'p')) Object.assign(vals, { p: num(fv(f, 'p')), c: num(fv(f, 'c')), f: num(fv(f, 'f')) });
  if (kind === 'edit') {
    const id = f.closest('[data-id]').dataset.id;
    editing = null;
    updateEntry(id, vals);
    toast('Saved');
  } else if (kind === 'add') {
    adding = false;
    addEntries([{ ...vals, type: addType }], sel);
    toast(`Added to ${prettyDate(sel)}`);
  }
}
