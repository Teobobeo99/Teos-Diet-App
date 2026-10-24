// Dashboard tab ("This Week"): pixel bar chart, ASCII week summary, history strip.
import { db, dayTotals, weekTargets, weekStart, addDays, dayIdx, today, prettyDate, parse, DAYS, esc, r } from './store.js';

const ROWS = 18;              // pixel blocks per bar at full chart height
let ws = null;                // selected week (Monday, 'YYYY-MM-DD')
let sel = null;               // selected day index 0..6 for the detail line
let histN = 14;               // history strip length (14 or 30)

const fmt = n => r(n).toLocaleString('en-US');
const net = t => t.eaten - t.credit;
const hasData = date => db.entries.some(e => e.date === date);

const EMPTY_ART = String.raw`.---------------------.
| M  T  W  T  F  S  S |
| .  .  .  .  .  .  . |
| .  .  .  .  .  .  . |
'---------------------'
     \_( o_o )_/
     nothing yet`;

export function init(root) {
  root.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'prev') { ws = addDays(ws, -7); sel = null; }
    else if (act === 'next') { ws = addDays(ws, 7); sel = null; }
    else if (act === 'now') { ws = weekStart(today()); sel = null; }
    else if (act === 'bar') { const i = +b.dataset.i; sel = sel === i ? null : i; }
    else if (act === 'hist') histN = +b.dataset.n;
    else return;
    render(root);
  });
}

export function render(root) {
  const t = today(), tws = weekStart(t);
  if (!ws) ws = tws;
  const wt = weekTargets(ws);
  const dates = DAYS.map((_, i) => addDays(ws, i));
  const tots = dates.map(dayTotals);
  const weekHasData = dates.some(hasData);
  const isNow = ws === tws;
  const range = `${fmtShort(ws)} – ${fmtShort(addDays(ws, 6))}`;

  root.innerHTML = `
    <div class="dash-head">
      <button class="btn-ghost dash-nav" data-act="prev" aria-label="Previous week">◀</button>
      <div class="dash-range">
        <div class="display dash-range-label">${isNow ? 'This week' : ws < tws ? 'Past week' : 'Next week'}</div>
        <div class="num">${range}</div>
      </div>
      <button class="btn-ghost dash-nav" data-act="next" aria-label="Next week">▶</button>
    </div>
    ${isNow ? '' : `<div class="dash-now"><button class="btn-ghost" data-act="now">» back to this week</button></div>`}

    ${weekHasData ? chart(dates, tots, wt, t) + detail(dates, tots, wt, t)
      : `<div class="empty"><pre aria-hidden="true">${esc(EMPTY_ART)}</pre>
          <div>${ws > tws ? 'This week hasn\'t started yet.' : 'No food or exercise logged this week.'}</div>
          <div>Log a meal on the <b class="display dash-link">Log</b> tab and your bars stack up here.</div></div>`}

    <div class="rule" data-label="Week budget"></div>
    ${summary(dates, tots, wt, t)}

    <div class="rule" data-label="Day targets"></div>
    ${dayTable(dates, tots, wt, t)}

    <div class="rule" data-label="History"></div>
    ${history(t)}
  `;
  root.querySelector('.dash-link')?.addEventListener('click', () =>
    window.dispatchEvent(new CustomEvent('go-tab', { detail: 'today' })));
}

function fmtShort(s) {
  return parse(s).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// ---------- Pixel bar chart ----------
function chart(dates, tots, wt, t) {
  const nets = tots.map(net);
  const max = Math.max(...wt.adjusted, ...wt.planned, ...nets, 1) * 1.08;
  const toRows = v => Math.max(0, Math.min(ROWS, Math.round(v / max * ROWS)));

  const cols = dates.map((d, i) => {
    const future = d > t, isToday = d === t, big = wt.big.includes(i);
    const target = wt.adjusted[i], n = nets[i];
    const over = !future && hasData(d) && n > target;
    const fill = future ? 0 : toRows(n), tRow = toRows(target);
    let cells = '';
    for (let k = ROWS - 1; k >= 0; k--) {
      const cls = ['px'];
      if (k < fill) cls.push(k >= tRow ? 'px-over' : 'px-fill');
      else if (future && k < tRow) cls.push('px-ghost');
      if (k === tRow - 1) cls.push('px-target');
      cells += `<i class="${cls.join(' ')}"></i>`;
    }
    const mark = over ? '<span class="over-text">!!</span>'
      : big ? '<span class="big-text">★</span>' : '&nbsp;';
    return `<button class="dash-col${isToday ? ' is-today' : ''}${sel === i ? ' is-sel' : ''}${future ? ' is-future' : ''}${big ? ' is-big' : ''}"
        data-act="bar" data-i="${i}" aria-label="${DAYS[i]}: net ${fmt(n)} of ${fmt(target)}">
      <span class="dash-mark">${mark}</span>
      <span class="dash-bar">${cells}</span>
      <span class="dash-day display">${DAYS[i].slice(0, 2)}</span>
    </button>`;
  }).join('');

  return `<div class="dash-chart" role="group" aria-label="Net calories per day">${cols}</div>
    <div class="dash-legend num">
      <span><i class="px px-fill"></i> under</span>
      <span><i class="px px-over"></i> over</span>
      <span><i class="px px-ghost"></i> plan</span>
      <span><i class="px px-target"></i> target</span>
      <span class="big-text">★ big day</span>
    </div>`;
}

function detail(dates, tots, wt, t) {
  const i = sel ?? (dates.includes(t) ? dayIdx(t) : null);
  if (i == null) return `<div class="dash-detail muted">tap a bar for that day's numbers</div>`;
  const d = dates[i], tot = tots[i], target = wt.adjusted[i], n = net(tot);
  const diff = target - n, future = d > t;
  const verdict = future ? `<span class="muted">upcoming</span>`
    : diff >= 0 ? `<span class="good-text">${fmt(diff)} under</span>`
    : `<span class="over-text">${fmt(-diff)} over !!</span>`;
  return `<div class="dash-detail">
    <div class="display dash-detail-day">&gt; ${esc(prettyDate(d))}${wt.big.includes(i) ? ' <span class="big-text">★</span>' : ''}</div>
    <div class="dash-kv num">
      <span>ate <b>${fmt(tot.eaten)}</b></span>
      <span>burn <b>${fmt(tot.burned)}</b>${tot.burned ? ` <span class="muted">(+${fmt(tot.credit)})</span>` : ''}</span>
      <span>net <b>${fmt(n)}</b></span>
      <span>target <b>${fmt(target)}</b></span>
    </div>
    <div class="num">${verdict}</div>
  </div>`;
}

// ---------- ASCII summary ----------
function summary(dates, tots, wt, t) {
  const budget = (+db.settings.target || 0) * 7;
  const used = dates.reduce((a, d, i) => a + (d <= t ? net(tots[i]) : 0), 0);
  const left = budget - used;
  const daysLeft = dates.filter(d => d >= t).length;
  const pct = budget ? Math.min(100, used / budget * 100) : 0;
  const spread = wt.overage - wt.forgiven;   // the part that actually lowered later days
  const rows = [
    ['Budget', fmt(budget), `${fmt(db.settings.target)} × 7`],
    ['Used', fmt(used), 'net, so far'],
    [left >= 0 ? 'Left' : 'Over', `<span class="${left >= 0 ? 'good-text' : 'over-text'}">${fmt(Math.abs(left))}</span>`,
      daysLeft ? `${daysLeft} day${daysLeft > 1 ? 's' : ''} to go` : 'week done'],
    ['Rebalanced', spread ? `<span class="over-text">${fmt(spread)}</span>` : '0',
      spread ? 'spread over the rest' : 'nothing to spread'],
  ];
  if (wt.forgiven) rows.push(['Forgiven', `<span class="big-text">${fmt(wt.forgiven)}</span>`, 'hit the floor']);
  return `<table class="dash-ascii num">
      ${rows.map(([k, v, note]) => `<tr><th class="display">${k}</th><td class="dash-dots"></td><td class="dash-v">${v}</td><td class="muted dash-note">${note}</td></tr>`).join('')}
    </table>
    <div class="meter${used > budget ? ' over' : ''}" aria-label="Week budget used"><i style="width:${pct}%"></i></div>
    ${wt.forgiven ? `<p class="dash-note-line num">* ${fmt(wt.forgiven)} cal couldn't fit above the ${fmt(db.settings.floor)} floor, so it's forgiven. It won't carry into next week.</p>` : ''}`;
}

function dayTable(dates, tots, wt, t) {
  const rows = dates.map((d, i) => {
    const future = d > t, isToday = d === t;
    const n = net(tots[i]), changed = wt.adjusted[i] !== wt.planned[i];
    const netCell = future ? '<span class="muted">·</span>'
      : hasData(d) ? `<span class="${n > wt.adjusted[i] ? 'over-text' : ''}">${fmt(n)}</span>` : '<span class="muted">–</span>';
    return `<tr class="${isToday ? 'is-today' : ''}">
      <td class="display">${isToday ? '▶' : ''}${DAYS[i]}${wt.big.includes(i) ? '<span class="big-text">★</span>' : ''}</td>
      <td>${fmt(wt.planned[i])}</td>
      <td class="${changed ? 'over-text' : ''}">${fmt(wt.adjusted[i])}</td>
      <td>${netCell}</td></tr>`;
  }).join('');
  return `<table class="dash-days num">
    <thead><tr><th class="display">Day</th><th class="display">Plan</th><th class="display">Now</th><th class="display">Net</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <p class="muted dash-note-line num">plan = target with big days; now = after rebalancing.</p>`;
}

// ---------- History strip ----------
function history(t) {
  const cache = {};
  const tgt = d => { const w = weekStart(d); return (cache[w] ||= weekTargets(w)).adjusted[dayIdx(d)]; };
  const days = Array.from({ length: histN }, (_, k) => addDays(t, k - histN + 1));
  const data = days.map(d => ({ d, has: hasData(d), n: net(dayTotals(d)), target: tgt(d) }));
  const any = data.some(x => x.has);
  const toggle = `<div class="dash-toggle">${[14, 30].map(n =>
    `<button class="${n === histN ? 'is-on' : ''}" data-act="hist" data-n="${n}">${n}d</button>`).join('')}</div>`;
  if (!any) return toggle + `<div class="empty"><pre aria-hidden="true">${esc('. . . . . . . . . .\n:_:_:_:_:_:_:_:_:_:\n  the last ' + histN + ' days')}</pre><div>Nothing logged in the last ${histN} days.</div></div>`;

  const H = 10;
  const max = Math.max(...data.map(x => Math.max(x.n, x.target)), 1);
  const cols = data.map(x => {
    const fill = x.has ? Math.max(1, Math.round(x.n / max * H)) : 0;
    const tRow = Math.round(x.target / max * H);
    const over = x.has && x.n > x.target;
    let cells = '';
    for (let k = H - 1; k >= 0; k--) {
      const cls = ['px'];
      if (k < fill) cls.push(over && k >= tRow ? 'px-over' : 'px-fill');
      if (k === tRow - 1) cls.push('px-target');
      cells += `<i class="${cls.join(' ')}"></i>`;
    }
    const title = `${prettyDate(x.d)}: ${x.has ? fmt(x.n) : 'no log'} / ${fmt(x.target)}`;
    return `<span class="dash-hcol${x.d === t ? ' is-today' : ''}" title="${esc(title)}">${cells}</span>`;
  }).join('');
  const logged = data.filter(x => x.has);
  const overDays = logged.filter(x => x.n > x.target).length;
  const avg = logged.length ? logged.reduce((a, x) => a + x.n, 0) / logged.length : 0;
  return toggle + `<div class="dash-hist" style="--n:${histN}">${cols}</div>
    <div class="dash-hist-axis num muted"><span>${fmtShort(days[0])}</span><span>today</span></div>
    <div class="dash-kv num">
      <span>logged <b>${logged.length}</b>/${histN}</span>
      <span>avg net <b>${fmt(avg)}</b></span>
      <span>over <b class="${overDays ? 'over-text' : 'good-text'}">${overDays}</b></span>
    </div>`;
}
