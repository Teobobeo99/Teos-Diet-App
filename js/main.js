// App shell: tab routing and re-rendering. Each tab module exports { init(root), render(root) }.
import * as todayTab from './today.js';
import * as dashTab from './dash.js';
import * as weightTab from './weight.js';
import * as historyTab from './history.js';
import * as settingsTab from './settings.js';
import { initSync } from './sync.js';

const TABS = {
  today: { mod: todayTab, title: 'Today' },
  dash: { mod: dashTab, title: 'This Week' },
  weight: { mod: weightTab, title: 'Weight' },
  history: { mod: historyTab, title: 'History' },
  settings: { mod: settingsTab, title: 'Setup' },
};
let current = 'today';
const rootOf = name => document.getElementById('tab-' + name);

for (const [name, { mod }] of Object.entries(TABS)) mod.init(rootOf(name));

export function go(name) {
  current = name;
  document.querySelectorAll('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(s => s.classList.toggle('active', s.id === 'tab-' + name));
  document.getElementById('title').textContent = TABS[name].title;
  TABS[name].mod.render(rootOf(name));
  window.scrollTo(0, 0);
}
window.addEventListener('go-tab', e => go(e.detail));

document.querySelector('.tabbar').addEventListener('click', e => {
  const tab = e.target.closest('button')?.dataset.tab;
  if (tab) go(tab);
});
window.addEventListener('db-change', () => TABS[current].mod.render(rootOf(current)));

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
document.getElementById('sync-dot').addEventListener('click', () => go('settings'));
go('today');
initSync();
