// Place, kept lines and reading time. Each device keeps one small record per book and is its only writer, so two devices
// can never overwrite each other. What the reader sees is worked out here from every device's record.
// Records live on the device first; Home is met when it answers. Nothing waits for it.
import { combine, fromBefore } from './records.js';

const read = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };   // shortcut: localStorage holds about 5 MB; move the records to IndexedDB when kept lines outgrow it

function guess() {
  const ua = navigator.userAgent;
  return /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Macintosh/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows PC' : /Linux/.test(ua) ? 'Linux' : 'Browser';
}
export const device = read('eastroom:device') || { id: [...crypto.getRandomValues(new Uint8Array(8))].map((n) => 'abcdefghijklmnopqrstuvwxyz0123456789'[n % 36]).join(''), name: guess() };
write('eastroom:device', device);

const mine = new Map(); let others = read('eastroom:others') || {}, timer, listener, skew = read('eastroom:skew') || 0;
const now = () => Date.now() + skew;                              // Home's clock, as last heard: a device whose own clock is wrong must not stamp its way past the others
export const home = { met: read('eastroom:met') || 0, waiting: (read('eastroom:dirty') || []).length, refused: null, none: null, full: false };   // none: true on a published copy, false once a Home has answered, null until one of the two is known
export const watch = (fn) => { listener = fn; };
export function fresh() { mine.clear(); others = read('eastroom:others') || {}; }   // a page that was put aside and comes back: another page may have written since

function settle(r) {                                              // stamps made while this device's clock ran ahead come back to now
  for (const e of [r.place, ...Object.values(r.kept || {}), ...Object.values(r.done || {})]) if (e && e.t > now() + 60000) e.t = now();
  return r;
}
export function own(slug) {
  if (!mine.has(slug)) mine.set(slug, settle(read('eastroom:rec:' + slug) || { device: device.id, name: device.name, kept: {}, done: {}, days: {} }));
  return mine.get(slug);
}
function touch(slug) {
  const r = own(slug); r.rev = (r.rev || 0) + 1;                  // Home keeps the highest: two saves that cross on the way cannot undo each other
  const dirty = new Set(read('eastroom:dirty') || []); dirty.add(slug);
  const stored = write('eastroom:rec:' + slug, r) && write('eastroom:dirty', [...dirty]);
  if (stored === home.full) { home.full = !stored; listener?.(); }   // a full device must say so: the change exists only until this page closes
  home.waiting = dirty.size; clearTimeout(timer); timer = setTimeout(sync, 3000);
}
export function setPlace(slug, ch, w, exact = '') { own(slug).place = { ch, w, t: now(), exact, prefix: '', suffix: '' }; touch(slug); }
export function keepLine(slug, key, exact) { own(slug).kept[key] = { t: now(), exact, prefix: '', suffix: '' }; touch(slug); }
export function noteLine(slug, key, entry, note) { own(slug).kept[key] = { ...entry, t: now(), note }; touch(slug); }   // a note on a kept line, wherever the line was kept
export function release(slug, key) { own(slug).kept[key] = { t: now(), gone: true }; touch(slug); }
export function setDone(slug, ch, v = true) { own(slug).done[ch] = { t: now(), v }; touch(slug); }
export function prune(slugs) {                                    // a book that Home no longer has cannot be waiting for Home
  const dirty = (read('eastroom:dirty') || []).filter((s) => slugs.includes(s)); write('eastroom:dirty', dirty); home.waiting = home.none ? 0 : dirty.length;
}
// A day is the reader's own day, not Greenwich's: a streak must not break at one in the morning.
export function addSeconds(slug, s, words = 0) { const day = new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 10), r = own(slug); r.days[day] = (r.days[day] || 0) + s; if (words) (r.words ||= {})[day] = (r.words[day] || 0) + words; touch(slug); }

export function view(slug, order) {
  const rest = Object.entries(others[slug] || {}).filter(([d]) => d !== device.id).map(([d, r]) => ({ device: d, ...fromBefore(r) }));
  return combine([own(slug), ...rest], order);
}

// Meet Home: fetch every device's records, then send what this device has changed. A change counts as sent only when Home has stored it.
export async function sync(leaving = false) {
  clearTimeout(timer);
  try {
    let ok = leaving && home.none === false;                      // a closing page has time for one request: it sends and does not fetch. It sends only to a Home that has answered
    if (!leaving) {
      const r = await fetch('api/state', { signal: AbortSignal.timeout(5000), cache: 'no-store' });   // a sleeping Home must not hang the app
      if (r.status === 404) home.none = true;                     // a published copy: there is no Home, the record stays on this device
      else if (r.ok) {
        others = await r.json(); write('eastroom:others', others); home.met = Date.now(); write('eastroom:met', home.met); home.none = false;
        const at = Date.parse(r.headers.get('date') || '') - Date.now();   // the header counts whole seconds, so small differences mean nothing
        skew = Math.abs(at) > 30000 ? at : 0; write('eastroom:skew', skew);
      }
      ok = r.ok;
    }
    if (ok) for (const slug of read('eastroom:dirty') || []) {
      const sent = JSON.stringify(settle(own(slug)));
      const put = await fetch(`api/state/${slug}/${device.id}`, { method: 'PUT', body: sent, signal: AbortSignal.timeout(5000), keepalive: leaving && sent.length < 60000 });
      if (put.status === 403) { home.refused = location.origin; break; }   // Home was not told that this address may save
      if (put.status === 404) continue;                           // Home does not have this book now: the change stays waiting
      if (!put.ok) break;
      home.refused = null;
      if (JSON.stringify(own(slug)) === sent) write('eastroom:dirty', (read('eastroom:dirty') || []).filter((s) => s !== slug));   // changed again meanwhile: it stays waiting
    }
  } catch {}
  home.waiting = home.none ? 0 : (read('eastroom:dirty') || []).length; listener?.();
}
addEventListener('visibilitychange', () => { if (document.hidden) sync(true); });
addEventListener('online', () => sync());
