// East Room's copy on this device. Two rules:
//  - an address that carries a stamp (?v=) never changes its content: answer from the copy, fetch it only once;
//  - everything else is asked from Home first, with a short limit, and answered from the copy when Home is asleep or out of reach.
// After Home has failed to answer once, the copy is used straight away for a while, so a sleeping Home never slows the app.
// A third store, 'eastroom-local', holds books this browser read itself where there is no Home (hold.js writes it): they are answered from it and join the library's list.
const APP = 'eastroom-app', BOOKS = 'eastroom-books', OWN = 'eastroom-local', LIMIT = 1500, QUIET = 30000;
const FILES = ['./', 'read.html', 'pages.html', 'pages.css', 'pages.js', 'panels.js', 'ideas.html', 'ideas.js', 'settings.html', 'settings.js', 'settings.css', 'rooms.css', 'manifest.webmanifest', 'favicon.ico', 'icon-180.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png',
  'reader.css', 'library.css', 'reader.js', 'library.js', 'world.js', 'cover.js', 'shelf.js', 'sound.js', 'colour.js', 'state.js', 'records.js', 'hold.js', 'voice.js', 'local.js', 'carry.js',
  'fonts/Literata.woff2', 'fonts/LiterataItalic.woff2', 'fonts/ScienceGothic.woff2', 'fonts/LeagueSpartan.woff2', 'fonts/EBGaramond.woff2', 'fonts/PlayfairDisplay.woff2', 'fonts/Cinzel.woff2', 'fonts/Caveat.woff2', 'fonts/ZillaSlab.woff2', 'fonts/UnifrakturCook.woff2', 'fonts/PinyonScript.woff2', 'fonts/SpecialElite.woff2', 'fonts/PoiretOne.woff2', 'vendor/gsap.min.js', 'vendor/lenis.min.js',
  'vendor/pretext/analysis.js', 'vendor/pretext/gecko-line-breaks.js', 'vendor/pretext/generated/engine-break-data.js', 'vendor/pretext/generated/webkit-generic-families.js', 'vendor/pretext/graphemes.js', 'vendor/pretext/han-kerning.js', 'vendor/pretext/layout.js', 'vendor/pretext/line-break.js', 'vendor/pretext/line-breaks.js', 'vendor/pretext/line-text.js', 'vendor/pretext/measurement.js', 'vendor/pretext/prepare.js', 'vendor/pretext/rich-inline.js',
  'room/marble.webp', 'room/walnut.webp', 'room/post.webp', 'room/gilt.webp', 'sfx/go.wav', 'sfx/stop.wav', 'sfx/key.wav', 'sfx/tick.wav', 'sfx/part.wav', 'sfx/book.wav', 'sfx/turn.wav', 'sfx/open.wav'];
let down = 0;                                                     // when Home last failed to answer in time

self.addEventListener('install', (e) => e.waitUntil(caches.open(APP).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', (e) => e.waitUntil(caches.keys().then((all) => Promise.all(all.filter((k) => k.startsWith('devour-')).map((k) => caches.delete(k)))).then(() => self.clients.claim())));   // copies kept under the app's first name are let go: Home has it all
self.addEventListener('fetch', (e) => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  if (url.pathname.includes('/api/state') || req.headers.has('range')) return;   // records keep their own copy and time limit; a sound being streamed goes straight to Home
  e.respondWith(answer(req, url, e));
});

async function answer(req, url, e) {
  const own = /\/(api\/book|media)\//.test(url.pathname) || url.pathname.endsWith('/api/library') ? await caches.open(OWN) : null;
  const hit = own && await own.match(url.origin + url.pathname); if (hit) return hit;
  const r = await (url.searchParams.get('v') || url.pathname.includes('/pyodide/') ? kept(req) : fresh(req, e));   // the runtime that reads files has its version in its address
  const mine = own && r.ok && url.pathname.endsWith('/api/library') && await own.match(new URL('local/books', registration.scope).href);
  return mine ? new Response(JSON.stringify([...await r.clone().json(), ...await mine.json()]), { headers: { 'content-type': 'application/json' } }) : r;
}

async function kept(req) {
  const c = await caches.open(BOOKS), hit = await c.match(req.url);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.status === 200 && !/no-store/.test(r.headers.get('cache-control') || '')) c.put(req.url, r.clone());   // Home says no-store when the stamp is not the file's own any more
  return r;
}
async function fresh(req, e) {
  const c = await caches.open(APP), page = req.mode === 'navigate', hit = await c.match(req, { ignoreSearch: page });
  const net = fetch(req).then((r) => { if (r.status === 200) c.put(page ? req.url.split('?')[0] : req, r.clone()); down = 0; return r; });
  if (!hit) return net;
  e.waitUntil(net.catch(() => {}));
  if (Date.now() - down < QUIET) return hit;
  return Promise.race([net, new Promise((ok) => setTimeout(ok, LIMIT))]).then((r) => r || (down = Date.now(), hit), () => (down = Date.now(), hit));
}
