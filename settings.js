// Settings tab: targets, Gemini key/model, big days, backup/restore.
import {
  db, save, replaceAll, defaults, weekStart, today, DAYS, DEFAULT_MODEL, esc, r, toast,
} from './store.js';

let root = null;
let weekDraft = null; // null = this week follows defaults; else [dayIdx...]

export function init(el) {
  root = el;
  el.addEventListener('click', onClick);
  el.addEventListener('input', onInput);
  el.addEventListener('change', onChange);
  el.addEventListener('submit', e => { e.preventDefault(); doSave(); });
}

export function render(el = root) {
  root = el;
  const s = db.settings, ws = weekStart(today());
  weekDraft = db.weekOverrides[ws] ? [...db.weekOverrides[ws]] : null;
  const field = (id, label, val, extra = '', note = '') => `
    <div class="s-field">
      <label for="s-${id}">${label}</label>
      <input id="s-${id}" name="${id}" type="number" inputmode="numeric" value="${esc(val)}" ${extra}>
      ${note ? `<p class="s-note muted">${note}</p>` : ''}
    </div>`;

  el.innerHTML = `<form class="s-form" novalidate autocomplete="off">
    <div class="rule" data-label="GEMINI"></div>
    <div class="s-field">
      <label for="s-apiKey">API key</label>
      <div class="s-inline">
        <input id="s-apiKey" name="apiKey" type="password" value="${esc(s.apiKey)}" spellcheck="false" autocapitalize="off" placeholder="paste key">
        <button type="button" data-act="peek" aria-label="Show key">Show</button>
      </div>
      <p class="s-note muted">Stored only on this device. Get one free at
        <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener">aistudio.google.com/apikey</a></p>
    </div>
    <div class="s-field">
      <label for="s-model">Model · Gemini 3.8 Flash</label>
      <div class="s-inline">
        <input id="s-model" name="model" type="text" value="${esc(s.model)}" spellcheck="false" autocapitalize="off">
        <button type="button" data-act="reset-model">Reset</button>
      </div>
    </div>

    <div class="rule" data-label="DAILY TARGETS"></div>
    ${field('target', 'Calories / day', s.target, 'min="800" max="10000" required')}
    <div class="s-trio">
      ${field('protein', 'Protein g', s.protein, 'min="1" required')}
      ${field('carbs', 'Carbs g', s.carbs, 'min="0" placeholder="--"')}
      ${field('fat', 'Fat g', s.fat, 'min="0" placeholder="--"')}
    </div>
    <p class="s-note muted">Protein is required. Leave carbs/fat blank to skip them.</p>
    ${field('goal', 'Goal weight (lbs)', s.goal, 'min="50" max="700" step="0.1" inputmode="decimal"')}

    <div class="rule" data-label="BUDGET RULES"></div>
    <div class="s-field">
      <label for="s-pct">Exercise add-back <span class="s-pct num" id="s-pct-val">${r(s.pct)}%</span></label>
      <input id="s-pct" name="pct" type="range" min="0" max="100" step="5" value="${r(s.pct)}">
      <p class="s-note muted">Share of burned calories added back to the day. Estimates run high.</p>
    </div>
    <div class="s-duo">
      ${field('floor', 'Calorie floor', s.floor, 'min="0"', 'No day drops below this.')}
      ${field('bigExtra', 'Big day extra', s.bigExtra, 'min="0" max="3000"', 'Added on each big day.')}
    </div>

    <div class="rule" data-label="BIG DAYS"></div>
    <label>Default big days</label>
    <div class="s-chips" data-group="def">${chips(s.bigDays)}</div>
    <div class="s-week-head">
      <label>This week only <span class="muted" id="s-week-mode"></span></label>
      <button type="button" class="btn-ghost s-small" data-act="week-reset">Use defaults</button>
    </div>
    <div class="s-chips" data-group="week">${chips(weekDraft || s.bigDays)}</div>
    <div class="s-preview" aria-live="polite">
      <p class="s-note muted">This week's planned targets:</p>
      <div class="s-plan num" id="s-plan"></div>
      <p class="s-note" id="s-plan-note"></p>
    </div>

    <button type="submit" class="btn-primary s-save">Save settings</button>
  </form>

  <div class="rule" data-label="BACKUP"></div>
  <p class="s-note muted">Your data lives only on this phone. Back it up now and then.
    The backup leaves out your API key.</p>
  <div class="s-btns">
    <button type="button" data-act="export">Export file</button>
    <button type="button" data-act="copy">Copy to clipboard</button>
    <button type="button" data-act="import">Import file</button>
  </div>
  <input type="file" id="s-file" accept="application/json,.json" hidden>
  <details class="s-paste">
    <summary class="display">Restore from pasted text</summary>
    <textarea id="s-paste-text" rows="4" placeholder="paste backup JSON here" spellcheck="false"></textarea>
    <button type="button" data-act="paste-import">Restore</button>
  </details>

  <div class="rule" data-label="DANGER"></div>
  <div class="s-field">
    <label for="s-wipe">Type WIPE to erase everything</label>
    <div class="s-inline">
      <input id="s-wipe" type="text" autocapitalize="characters" spellcheck="false" placeholder="WIPE">
      <button type="button" class="btn-danger" data-act="wipe" disabled>Wipe</button>
    </div>
  </div>
  <pre class="s-sig muted" aria-hidden="true">  +-----+
  | o o |   TEO DIET
  |  -  |   data stays on this phone
  +-----+</pre>`;
  syncWeek();
}

const chips = sel => DAYS.map((d, i) =>
  `<button type="button" class="s-chip" data-day="${i}" aria-pressed="${sel.includes(i)}">${d}</button>`).join('');

const picked = group => [...root.querySelectorAll(`[data-group="${group}"] .s-chip`)]
  .filter(b => b.getAttribute('aria-pressed') === 'true').map(b => +b.dataset.day);

const val = name => root.querySelector(`[name="${name}"]`)?.value.trim() ?? '';

// Mirror week chips/labels to the draft and redraw the preview.
function syncWeek() {
  const days = weekDraft || picked('def');
  root.querySelectorAll('[data-group="week"] .s-chip').forEach(b =>
    b.setAttribute('aria-pressed', String(days.includes(+b.dataset.day))));
  root.querySelector('#s-week-mode').textContent = weekDraft ? '(custom)' : '(= defaults)';
  preview();
}

function preview() {
  const T = +val('target') || 0, extra = +val('bigExtra') || 0, floor = +val('floor') || 0;
  const big = weekDraft || picked('def'), n = big.length;
  const lower = n && n < 7 ? extra * n / (7 - n) : 0;
  const plan = DAYS.map((_, i) => big.includes(i) ? T + extra : T - lower);
  root.querySelector('#s-plan').innerHTML = DAYS.map((d, i) => {
    const v = r(plan[i]), cls = big.includes(i) ? 'big-text' : v < floor ? 'over-text' : '';
    return `<span class="${cls}"><b class="display">${d[0]}${d[1]}</b>${v}</span>`;
  }).join('');
  const low = plan.some((v, i) => !big.includes(i) && v < floor);
  const note = root.querySelector('#s-plan-note');
  note.className = 's-note ' + (low ? 'over-text' : 'muted');
  note.textContent = low
    ? `Regular days dip under your ${floor} floor. Fewer big days or a smaller extra will fix it.`
    : `Week total ${r(T * 7)} · big days +${extra}`;
}

function onInput(e) {
  const t = e.target;
  if (t.id === 's-pct') root.querySelector('#s-pct-val').textContent = t.value + '%';
  if (['target', 'bigExtra', 'floor'].includes(t.name)) preview();
  if (t.id === 's-wipe') root.querySelector('[data-act="wipe"]').disabled = t.value.trim().toUpperCase() !== 'WIPE';
  t.classList.remove('s-bad');
}

function onChange(e) {
  if (e.target.id === 's-file') {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (file) file.text().then(restore).catch(() => toast('Could not read that file'));
  }
}

function onClick(e) {
  const b = e.target.closest('button');
  if (!b || !root.contains(b)) return;
  if (b.classList.contains('s-chip')) {
    const on = b.getAttribute('aria-pressed') !== 'true';
    b.setAttribute('aria-pressed', String(on));
    const group = b.parentElement.dataset.group;
    if (group === 'week') weekDraft = picked('week');
    return syncWeek();
  }
  switch (b.dataset.act) {
    case 'peek': {
      const k = root.querySelector('#s-apiKey'), show = k.type === 'password';
      k.type = show ? 'text' : 'password';
      b.textContent = show ? 'Hide' : 'Show';
      b.setAttribute('aria-label', show ? 'Hide key' : 'Show key');
      return;
    }
    case 'reset-model': root.querySelector('#s-model').value = DEFAULT_MODEL; return toast('Model reset · save to keep');
    case 'week-reset': weekDraft = null; return syncWeek();
    case 'export': return exportFile();
    case 'copy': return copyBackup();
    case 'import': return root.querySelector('#s-file').click();
    case 'paste-import': {
      const txt = root.querySelector('#s-paste-text').value.trim();
      return txt ? restore(txt) : toast('Paste a backup first');
    }
    case 'wipe': return wipe();
  }
}

// ---------- save ----------
function doSave() {
  const errs = [];
  const need = (name, label, min, max, opt = false) => {
    const raw = val(name);
    if (opt && raw === '') return '';
    const n = +raw;
    if (raw === '' || !isFinite(n) || n < min || n > max) {
      errs.push(`${label}: ${min}–${max}`);
      root.querySelector(`[name="${name}"]`)?.classList.add('s-bad');
      return null;
    }
    return n;
  };
  const next = {
    target: need('target', 'Calories', 800, 10000),
    protein: need('protein', 'Protein', 1, 1000),
    carbs: need('carbs', 'Carbs', 0, 2000, true),
    fat: need('fat', 'Fat', 0, 1000, true),
    goal: need('goal', 'Goal weight', 50, 700),
    pct: need('pct', 'Add-back', 0, 100),
    floor: need('floor', 'Floor', 0, 10000),
    bigExtra: need('bigExtra', 'Big day extra', 0, 3000),
  };
  if (!errs.length && next.floor > next.target) {
    errs.push('Floor must be at or below the daily target');
    root.querySelector('[name="floor"]').classList.add('s-bad');
  }
  if (errs.length) { root.querySelector('.s-bad')?.focus(); return toast(errs[0], 2600); }

  for (const k of ['target', 'protein', 'pct', 'floor', 'bigExtra']) next[k] = r(next[k]);
  if (next.carbs !== '') next.carbs = r(next.carbs);
  if (next.fat !== '') next.fat = r(next.fat);
  next.goal = Math.round(next.goal * 10) / 10;

  Object.assign(db.settings, next, {
    apiKey: val('apiKey'),
    model: val('model') || DEFAULT_MODEL,
    bigDays: picked('def'),
  });
  const ws = weekStart(today());
  if (weekDraft) db.weekOverrides[ws] = [...weekDraft].sort();
  else delete db.weekOverrides[ws];
  save();
  toast('Settings saved');
}

// ---------- backup ----------
const backupText = () => {
  const data = JSON.parse(JSON.stringify(db));
  data.settings.apiKey = '';
  data.exportedAt = new Date().toISOString();
  data.app = 'teo-diet';
  return JSON.stringify(data, null, 2);
};

function exportFile() {
  const blob = new Blob([backupText()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `teo-diet-backup-${today()}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('Backup downloaded');
}

async function copyBackup() {
  const txt = backupText();
  try { await navigator.clipboard.writeText(txt); return toast('Backup copied · paste it in Notes'); } catch {}
  const ta = document.createElement('textarea');
  ta.value = txt; ta.setAttribute('readonly', ''); ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;font-size:16px';
  document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, txt.length);
  let ok = false; try { ok = document.execCommand('copy'); } catch {}
  ta.remove();
  toast(ok ? 'Backup copied · paste it in Notes' : 'Copy failed · use Export instead', 2600);
}

function restore(text) {
  let data;
  try { data = JSON.parse(text); } catch { return toast('That is not a valid backup', 2600); }
  if (!data || typeof data !== 'object' || !Array.isArray(data.entries)) return toast('That is not a Teo Diet backup', 2600);
  const n = data.entries.length, w = Array.isArray(data.weights) ? data.weights.length : 0;
  if (!confirm(`Replace ALL current data with this backup?\n\n${n} entries · ${w} weigh-ins\n\nThis cannot be undone.`)) return;
  delete data.exportedAt; delete data.app;
  data.settings = { ...(data.settings || {}) };
  if (!data.settings.apiKey) data.settings.apiKey = db.settings.apiKey; // keep this phone's key
  replaceAll(data);
  toast(`Restored ${n} entries`);
}

function wipe() {
  if (root.querySelector('#s-wipe').value.trim().toUpperCase() !== 'WIPE') return;
  if (!confirm('Erase every entry, weigh-in, favorite and setting on this phone?')) return;
  replaceAll(defaults());
  toast('Everything wiped');
}
