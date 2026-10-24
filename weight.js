// Weight tab: log lbs (one entry per date), pixel-art trend chart, stats, entry list.
import { db, save, today, prettyDate, parse, esc, toast } from './store.js';

const W = 120, H = 64;               // chart size in "pixels" (SVG units); scales to container
const PAD = { l: 18, r: 8, t: 6, b: 9 };

const EMPTY_ART = String.raw`    .-----------.
    |  [ 0.0 ]  |
    |___________|
   /  _       _  \
  /__(_)_____(_)__\
 step on, log it in`;

const one = n => (Math.round(n * 10) / 10).toFixed(1);
const signed = n => (n > 0 ? '+' : n < 0 ? '−' : '±') + one(Math.abs(n));
const sorted = () => [...db.weights].filter(w => w && w.date && +w.lbs > 0).sort((a, b) => a.date < b.date ? -1 : 1);

export function init(root) {
  root.addEventListener('submit', e => {
    if (!e.target.matches('.wt-form')) return;
    e.preventDefault();
    const f = e.target;
    const lbs = parseFloat(String(f.lbs.value).replace(',', '.'));
    const date = f.date.value || today();
    if (!(lbs > 40 && lbs < 1000)) { toast('Enter a weight in lbs'); f.lbs.focus(); return; }
    const existed = db.weights.some(w => w.date === date);
    db.weights = db.weights.filter(w => w.date !== date);
    db.weights.push({ date, lbs: Math.round(lbs * 10) / 10 });
    save();
    toast(existed ? `Replaced ${prettyDate(date)}` : `Logged ${one(lbs)} lbs`);
  });
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-del]');
    if (!b) return;
    const date = b.dataset.del;
    if (!confirm(`Delete weight for ${prettyDate(date)}?`)) return;
    db.weights = db.weights.filter(w => w.date !== date);
    save();
  });
}

export function render(root) {
  const ws = sorted();
  const goal = +db.settings.goal || 0;
  const last = ws.at(-1);

  root.innerHTML = `
    <form class="wt-form" autocomplete="off">
      <div class="wt-fields">
        <div class="wt-lbs">
          <label for="wt-lbs">Weight (lbs)</label>
          <input id="wt-lbs" name="lbs" type="text" inputmode="decimal" placeholder="${last ? one(last.lbs) : '000.0'}" enterkeyhint="done">
        </div>
        <div class="wt-date">
          <label for="wt-date">Date</label>
          <input id="wt-date" name="date" type="date" value="${today()}" max="${today()}">
        </div>
      </div>
      <button class="btn-primary wt-save" type="submit">+ Log weight</button>
    </form>

    ${ws.length ? `
      <div class="rule" data-label="Trend"></div>
      ${chart(ws, goal)}
      <div class="rule" data-label="Stats"></div>
      ${stats(ws, goal)}
      <div class="rule" data-label="Log"></div>
      ${list(ws)}
    ` : `
      <div class="rule" data-label="Trend"></div>
      <div class="empty"><pre aria-hidden="true">${esc(EMPTY_ART)}</pre>
        <div>No weigh-ins yet.</div>
        <div>Type today's weight above. Same time each morning keeps the trend honest.</div>
        ${goal ? `<div class="num">Goal: <span class="good-text">${one(goal)} lbs</span> ⚑</div>` : ''}
      </div>`}
  `;
}

// ---------- Pixel trend chart (SVG, crisp edges, integer coords) ----------
function chart(ws, goal) {
  const pts = ws.map(w => ({ t: parse(w.date).getTime(), v: +w.lbs, date: w.date }));
  const vals = pts.map(p => p.v).concat(goal ? [goal] : []);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  if (hi - lo < 4) { const m = (hi + lo) / 2; lo = m - 2; hi = m + 2; }
  const span = hi - lo; lo -= span * 0.08; hi += span * 0.08;
  const t0 = pts[0].t, t1 = pts.at(-1).t;
  const iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;
  const X = t => Math.round(PAD.l + (t1 === t0 ? iw / 2 : (t - t0) / (t1 - t0) * iw));
  const Y = v => Math.round(PAD.t + (hi - v) / (hi - lo) * ih);
  const rect = (x, y, w, h, cls) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" class="${cls}"/>`;

  // stepped line: horizontal to the next x, then vertical to the next y
  const stepped = (ps, cls, dotted = false) => {
    let out = '';
    for (let i = 1; i < ps.length; i++) {
      const [x1, y1] = ps[i - 1], [x2, y2] = ps[i];
      if (dotted) {
        for (let x = x1; x <= x2; x += 2) out += rect(x, y1, 1, 1, cls);
        for (let y = Math.min(y1, y2); y <= Math.max(y1, y2); y += 2) out += rect(x2, y, 1, 1, cls);
      } else {
        out += rect(x1, y1, Math.max(1, x2 - x1 + 1), 1, cls);
        out += rect(x2, Math.min(y1, y2), 1, Math.abs(y2 - y1) + 1, cls);
      }
    }
    return out;
  };

  let svg = '';
  // y-axis ticks (3 labels) + dotted grid
  [hi - (hi - lo) * 0.08, (hi + lo) / 2, lo + (hi - lo) * 0.08].forEach(v => {
    const y = Y(v);
    for (let x = PAD.l; x < W - PAD.r; x += 4) svg += rect(x, y, 1, 1, 'wt-grid');
    svg += `<text x="${PAD.l - 2}" y="${y + 2}" class="wt-axis" text-anchor="end">${Math.round(v)}</text>`;
  });
  // axes
  svg += rect(PAD.l - 1, PAD.t, 1, ih + 1, 'wt-ink') + rect(PAD.l - 1, PAD.t + ih, iw + 2, 1, 'wt-ink');
  // goal: dashed line + pixel flag at the right end
  if (goal && goal >= lo && goal <= hi) {
    const gy = Y(goal);
    for (let x = PAD.l; x < W - PAD.r - 4; x += 4) svg += rect(x, gy, 2, 1, 'wt-goal');
    const fx = W - PAD.r - 3;
    svg += rect(fx, gy - 6, 1, 7, 'wt-ink') + rect(fx + 1, gy - 6, 4, 1, 'wt-goal') + rect(fx + 1, gy - 5, 3, 1, 'wt-goal')
         + rect(fx + 1, gy - 4, 4, 1, 'wt-goal');
  }
  // 7-entry moving average (needs at least 7 entries)
  const xy = pts.map(p => [X(p.t), Y(p.v)]);
  if (pts.length >= 7) {
    const ma = pts.slice(6).map((p, i) => [X(p.t), Y(pts.slice(i, i + 7).reduce((a, q) => a + q.v, 0) / 7)]);
    svg += stepped(ma, 'wt-avg', true);
  }
  svg += stepped(xy, 'wt-ink');
  xy.forEach(([x, y], i) => { svg += rect(x - 1, y - 1, 3, 3, i === xy.length - 1 ? 'wt-pt wt-last' : 'wt-pt'); });
  // x-axis date labels (first/last)
  const lab = d => parse(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  svg += `<text x="${PAD.l}" y="${H - 1}" class="wt-axis">${lab(pts[0].date)}</text>`;
  if (pts.length > 1) svg += `<text x="${W - PAD.r}" y="${H - 1}" class="wt-axis" text-anchor="end">${lab(pts.at(-1).date)}</text>`;

  return `<svg class="wt-chart" viewBox="0 0 ${W} ${H}" shape-rendering="crispEdges" role="img"
      aria-label="Weight trend, ${pts.length} entries${goal ? `, goal ${one(goal)} lbs` : ''}">${svg}</svg>
    <div class="wt-legend num">
      <span><i class="wt-key wt-key-line"></i> weight</span>
      ${pts.length >= 7 ? '<span><i class="wt-key wt-key-avg"></i> 7-entry avg</span>' : '<span class="muted">avg after 7 entries</span>'}
      ${goal ? '<span><i class="wt-key wt-key-goal"></i> goal ⚑</span>' : ''}
    </div>`;
}

// ---------- Stats ----------
function stats(ws, goal) {
  const first = ws[0], last = ws.at(-1);
  const change = last.lbs - first.lbs;
  const toGo = goal ? last.lbs - goal : null;
  const losing = goal ? first.lbs >= goal : true;
  const total = goal ? Math.abs(first.lbs - goal) : 0;
  const done = goal && total ? Math.max(0, Math.min(1, (losing ? first.lbs - last.lbs : last.lbs - first.lbs) / total)) : 0;
  const reached = goal && (losing ? last.lbs <= goal : last.lbs >= goal);
  const N = 14, filled = Math.round(done * N);
  const track = '▓'.repeat(filled) + '░'.repeat(N - filled);
  const changeCls = change === 0 ? '' : (losing ? change < 0 : change > 0) ? 'good-text' : 'over-text';

  return `<table class="wt-stats num">
      <tr><th class="display">Latest</th><td class="wt-dots"></td><td><b>${one(last.lbs)}</b> lbs</td></tr>
      <tr><th class="display">Change</th><td class="wt-dots"></td><td><b class="${changeCls}">${signed(change)}</b> <span class="muted">since ${esc(parse(first.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))}</span></td></tr>
      ${goal ? `<tr><th class="display">To goal</th><td class="wt-dots"></td><td>${reached
        ? '<b class="good-text">reached!</b>' : `<b>${one(Math.abs(toGo))}</b> lbs to ${one(goal)}`}</td></tr>` : ''}
    </table>
    ${goal ? `<div class="wt-track num" aria-label="${Math.round(done * 100)}% of the way to goal">
      <span class="muted">${one(first.lbs)}</span>
      <span class="wt-bar">${track}</span>
      <span class="good-text">⚑${one(goal)}</span>
    </div>
    <div class="wt-track-cap num muted">${reached ? '\\o/  flag captured' : `${Math.round(done * 100)}% of the way there`}</div>` : ''}`;
}

// ---------- Entry list ----------
function list(ws) {
  const rows = [...ws].reverse().map((w, i, arr) => {
    const prev = arr[i + 1];
    const d = prev ? w.lbs - prev.lbs : null;
    return `<li>
      <span class="wt-li-date">${esc(prettyDate(w.date))}</span>
      <span class="wt-li-lbs"><b>${one(w.lbs)}</b></span>
      <span class="wt-li-diff muted">${d == null ? '' : signed(d)}</span>
      <button class="btn-ghost wt-del" data-del="${esc(w.date)}" aria-label="Delete ${esc(prettyDate(w.date))}">✕</button>
    </li>`;
  }).join('');
  return `<ul class="wt-list num">${rows}</ul>`;
}
