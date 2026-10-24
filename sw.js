// Offline cache for the app shell.
// Bump CACHE whenever any shell file changes so phones pick up the new version.
const CACHE = 'teo-diet-v4';
const SHELL = [
  './', 'index.html', 'manifest.json',
  'css/base.css', 'css/today.css', 'css/dash.css', 'css/weight.css', 'css/history.css', 'css/settings.css',
  'js/main.js', 'js/store.js', 'js/today.js', 'js/gemini.js', 'js/dash.js', 'js/weight.js', 'js/history.js', 'js/settings.js',
  'icon.svg', 'icon-180.png', 'icon-192.png', 'icon-512.png',
];

self.addEventListener('install', e => {
  // Cache files one by one so a single missing file doesn't break install.
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(SHELL.map(f => c.add(new Request(f, { cache: 'reload' })).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(ks => Promise.all(ks.filter(k => k.startsWith('teo-diet-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  // Never touch Gemini API traffic (it carries the API key and must be live).
  if (url.hostname.endsWith('googleapis.com') && url.hostname.startsWith('generativelanguage')) return;

  // Pages: network first so updates show up, cached shell when offline.
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put('index.html', copy));
      return res;
    }).catch(() => caches.match('index.html').then(r => r || caches.match('./'))));
    return;
  }

  // Same-origin shell files + Google Fonts: cache first, fill cache on miss.
  const sameOrigin = url.origin === self.location.origin;
  const fonts = url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com';
  if (!sameOrigin && !fonts) return;
  e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(res => {
    if (res.ok || res.type === 'opaque') {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  })));
});
