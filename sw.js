/* Flip 7 Score Keeper service worker: offline app shell + font caching.
 * App files are fetched network-first, so normal deploys need no version bump.
 * Bump VERSION only when this worker or the ASSETS list changes. */
const VERSION = 'v2.0.0';
const SHELL = `flip7-shell-${VERSION}`;
const RUNTIME = 'flip7-runtime';
const ASSETS = [
  './',
  'index.html',
  'styles.css',
  'app.js',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/favicon-32.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS)));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('flip7-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => { if (e.data === 'skip-waiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: serve from cache, refresh in the background.
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com'){
    e.respondWith(staleWhileRevalidate(req, RUNTIME));
    return;
  }
  if (url.origin !== location.origin) return;

  // App files: network first so updates land right away; fall back to cache when offline.
  e.respondWith(networkFirst(req));
});

async function networkFirst(req){
  const cache = await caches.open(SHELL);
  try{
    const res = await withTimeout(fetch(req), 4000);
    if (res && res.ok) cache.put(req.mode === 'navigate' ? 'index.html' : req, res.clone());
    return res;
  }catch{
    const hit = await cache.match(req.mode === 'navigate' ? 'index.html' : req, {ignoreSearch:true});
    return hit || (req.mode === 'navigate' ? cache.match('./') : Response.error());
  }
}

function withTimeout(p, ms){
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    p.then(r => { clearTimeout(t); resolve(r); }, err => { clearTimeout(t); reject(err); });
  });
}

async function staleWhileRevalidate(req, cacheName){
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  const network = fetch(req).then(res => {
    if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
    return res;
  }).catch(() => cached);
  return cached || network;
}
