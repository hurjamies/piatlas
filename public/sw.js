/* PI ATLAS – service worker (vain GitHub Pages -julkaisu).
   Sivu: verkko ensin, ilman verkkoa välimuisti. Muut tiedostot (JS, CSS, numerotiedosto, fontit):
   välimuisti ensin. Vite-tiedostojen nimissä on sisältötiiviste, joten vanha versio ei jää voimaan. */
const CACHE = 'pi-atlas-v0.3.0';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './icon-192.png', './icon-512.png', './data/pi_digits_1m.txt'];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((k) => (k.startsWith('pi-atlas-') && k !== CACHE ? caches.delete(k) : null))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const same = url.origin === self.location.origin;
  if (!same && !FONT_HOSTS.includes(url.hostname)) return;
  if (same && !url.pathname.startsWith(new URL('./', self.location).pathname)) return;
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req, { cache: 'no-cache' })
        .then((res) => {
          const copy = res.clone();
          if (res.ok) e.waitUntil(caches.open(CACHE).then((c) => c.put('./index.html', copy)));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }
  e.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) {
            const copy = res.clone();
            e.waitUntil(caches.open(CACHE).then((c) => c.put(req, copy)));
          }
          return res;
        }),
    ),
  );
});
