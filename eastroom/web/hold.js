// What this device holds so that reading does not need Home: the text of the books, and narration around the reading point.
// Everything held has a stamped address, so the copy is right for as long as it exists; Home remains the lasting copy.
const BOOKS = 'eastroom-books', can = 'caches' in self, VOICES = ['storyteller', 'recorded', 'plain'];   // best first
const get = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
async function ensure(c, url) {
  if (await c.match(url)) return true;
  try { const r = await fetch(url, { signal: AbortSignal.timeout(60000) }); if (r.status !== 200) return false; await c.put(url, r); return true; } catch { return false; }
}
export const voiceOf = (ch) => VOICES.find((n) => ch.voices?.[n]);
export const textUrl = (slug, ch) => `api/book/${slug}/${ch.id}?v=${ch.v}`;
export const recordUrl = (slug, ch) => `api/voice/${slug}/${voiceOf(ch)}/${ch.id}?v=${ch.voices[voiceOf(ch)]}`;
export const soundUrl = (slug, ch, src) => `media/${slug}/${src}?v=${ch.voices[voiceOf(ch)]}`;

// Text of every book given, most wanted first; text that Home has since replaced is let go.
export async function holdText(books, all = books) {
  if (!can) return; const c = await caches.open(BOOKS), valid = new Set(all.flatMap((b) => b.chapters.map((ch) => new URL(textUrl(b.slug, ch), location).href)));
  for (const req of await c.keys()) if (req.url.includes('/api/book/') && !valid.has(req.url)) c.delete(req);
  for (const b of books) for (const ch of b.chapters) if (!await ensure(c, textUrl(b.slug, ch))) return;   // Home stopped answering: carry on next time
}

// Narration for part `pi` and the `span` parts after it. Older parts are let go, unless the owner keeps the whole book on this device.
export async function holdVoice(book, pi, span = 2, step) {
  if (!can) return; const c = await caches.open(BOOKS), slug = book.slug, key = 'eastroom:held:' + slug, index = get(key) || {}, want = book.chapters.slice(pi, pi + 1 + span);
  try {
    for (const ch of want) {
      if (!voiceOf(ch)) continue;
      const rec = await fetch(recordUrl(slug, ch)).then((r) => r.json()), list = rec.audio.map((a) => soundUrl(slug, ch, a.src));
      for (const old of index[ch.id] || []) if (!list.includes(old)) c.delete(old);
      for (const u of list) if (!await ensure(c, u)) throw 0;
      index[ch.id] = list; set(key, index); step?.(ch);
    }
  } catch { return; }
  if (get('eastroom:keep:' + slug)) return;
  const near = new Set([book.chapters[pi - 1]?.id, ...want.map((ch) => ch.id)]);
  for (const id of Object.keys(index)) if (!near.has(id)) { for (const u of index[id]) c.delete(u); delete index[id]; }
  set(key, index);
}
export const heldParts = (slug) => Object.keys(get('eastroom:held:' + slug) || {}).length;
export const keeping = (slug, on) => (on === undefined ? !!get('eastroom:keep:' + slug) : set('eastroom:keep:' + slug, on));

// A held sound as a local object: the audio player is given this, never a stream through the service worker.
export async function local(url) {
  const r = can && await (await caches.open(BOOKS)).match(url);
  return r ? URL.createObjectURL(await r.blob()) : null;
}

// ---------- books this browser read itself, where there is no Home: their files under the addresses the app asks for, and their entries for the library ----------
// The service worker answers from here (sw.js names the same two places).
const OWN = 'eastroom-local', LIST = new URL('local/books', location).href, PICTURES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', avif: 'image/avif', svg: 'image/svg+xml' };
const list = (c, books) => c.put(LIST, new Response(JSON.stringify(books), { headers: { 'content-type': 'application/json' } }));
export async function ownBooks() { const r = can && await (await caches.open(OWN)).match(LIST); return r ? r.json() : []; }
export async function keepBook(book, files) {                     // `files` are [address, bytes]; the book is listed only once all of it is kept
  const c = await caches.open(OWN);
  try {
    for (const [path, bytes] of files) await c.put(new URL(path, location).href, new Response(bytes, { headers: { 'content-type': path.startsWith('api/') ? 'application/json' : PICTURES[path.split('.').pop().toLowerCase()] || 'application/octet-stream', 'content-security-policy': 'sandbox', 'x-content-type-options': 'nosniff' } }));   // a file from a book is never run as a page
    await list(c, [...(await ownBooks()).filter((b) => b.slug !== book.slug), book]);
  } catch (err) { await dropBook(book.slug).catch(() => {}); throw err; }
}
export async function dropBook(slug) {
  const c = await caches.open(OWN), its = [`/api/book/${slug}/`, `/media/${slug}/`];
  await list(c, (await ownBooks()).filter((b) => b.slug !== slug));
  for (const req of await c.keys()) if (its.some((p) => new URL(req.url).pathname.includes(p))) await c.delete(req);
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
navigator.storage?.persist?.();                                   // ask the browser to keep this copy; Home stays the lasting one either way
