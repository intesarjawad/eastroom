// The page reader: a book of pages (a comic, a scan, a PDF whose layout is the book). One page fills the screen. With the guide on, the page is read
// panel by panel: the panel in turn is lit and brought close and the rest steps back, which is the reader's light, applied to pictures.
// Panels are found on the device by looking for the gutters between them; a page where none are found is read whole.
import './carry.js';
import * as rec from './state.js';
import { findPanels } from './panels.js';

const Q = new URLSearchParams(location.search), $ = (s) => document.querySelector(s), PAGE_WORDS = 60;   // what a page counts for in Home's index (eastroom/formats.py)
const clamp = (v, a, b) => Math.min(b, Math.max(a, v)), still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const stage = $('#stage'), sheet = $('#sheet'), imgs = [$('#left'), $('#right')], lit = $('#lit'), sayBox = $('#say');
const pref = (k, d) => { try { return JSON.parse(localStorage.getItem('eastroom:' + k)) ?? d; } catch { return d; } }, keep = (k, v) => { try { localStorage.setItem('eastroom:' + k, JSON.stringify(v)); } catch {} };
const say = (t) => { sayBox.textContent = t; sayBox.hidden = !t; };

await Promise.race([rec.sync(), new Promise((ok) => setTimeout(ok, 1500))]);
const library = await fetch('api/library').then((r) => r.json()), book = library.find((b) => b.slug === Q.get('book'));
if (!book || book.kind !== 'pages') { location.replace(book ? `read.html?book=${encodeURIComponent(book.slug)}` : './'); await new Promise(() => {}); }
const SLUG = book.slug, order = book.chapters.map((c) => c.id), counts = book.chapters.map((c) => Math.max(1, Math.round(c.words / PAGE_WORDS))), total = counts.reduce((a, n) => a + n, 0);
const firsts = counts.map(((a) => (n) => (a += n) - n)(0)), loaded = new Map();
document.title = `${book.title} · East Room`; $('#name').textContent = book.title; sheet.classList.toggle('rtl', !!book.rtl);
const chapter = (ci) => loaded.get(ci) ?? loaded.set(ci, fetch(`api/book/${SLUG}/${order[ci]}?v=${book.chapters[ci].v}`).then((r) => r.json())).get(ci);
const where = (n) => { let ci = firsts.findLastIndex((f) => f <= n); ci = clamp(ci, 0, order.length - 1); return [ci, n - firsts[ci]]; };
async function page(n) { const [ci, i] = where(n), b = (await chapter(ci)).blocks[i]; return b && { ...b, url: `media/${SLUG}/${b.src}?v=${book.chapters[ci].v}`, n }; }

const S = { n: 0, k: 0, panels: [], guide: pref('guide', true), pair: pref('pair', false), shown: [], busy: false, bars: 0 };
const V = rec.view(SLUG, order); if (V.place) { const ci = Math.max(0, order.indexOf(V.place.ch)); S.n = clamp(firsts[ci] + Math.floor((V.place.w | 0) / PAGE_WORDS), 0, total - 1); S.k = (V.place.w | 0) % PAGE_WORDS; }

// ---------- the panels of the page in view ----------
const scratch = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
function panelsOf(im, rtl) {
  const w = 360, h = Math.max(1, Math.round(w * im.naturalHeight / im.naturalWidth)); scratch.canvas.width = w; scratch.canvas.height = h; scratch.drawImage(im, 0, 0, w, h);
  let d; try { d = scratch.getImageData(0, 0, w, h).data; } catch { return []; }
  const lum = new Uint8Array(w * h); for (let i = 0; i < w * h; i++) lum[i] = (d[i * 4] * 3 + d[i * 4 + 1] * 6 + d[i * 4 + 2]) / 10;
  return findPanels(lum, w, h, rtl);
}

// ---------- showing ----------
function fit() {                                                   // the page, or the panel in turn, as large as the screen allows
  const vw = innerWidth, vh = innerHeight, ws = S.shown.map((p) => p.w / p.h), W = ws.reduce((a, r) => a + r, 0), H = Math.min(vh, vw / W), bars = S.guide && S.panels.length ? 0 : 0;
  sheet.style.height = H + 'px'; sheet.style.width = H * W + 'px';
  const p = S.guide && S.panels[S.k]; lit.hidden = !p;
  if (!p) { sheet.style.transform = `translate(${(vw - H * W) / 2 - sheet.offsetLeft}px, ${(vh - H - bars) / 2 - sheet.offsetTop}px)`; return; }
  const pw = H * ws[0], x = p[0] * pw, y = p[1] * H, w = p[2] * pw, h = p[3] * H, pad = 10, s = Math.min((vw - 24) / (w + pad * 2), (vh - 24) / (h + pad * 2), 3.2);
  Object.assign(lit.style, { left: x - 3 + 'px', top: y - 3 + 'px', width: w + 6 + 'px', height: h + 6 + 'px' });
  sheet.style.transform = `translate(${vw / 2 - (x + w / 2) * s - sheet.offsetLeft}px, ${vh / 2 - (y + h / 2) * s - sheet.offsetTop}px) scale(${s})`;
}
async function tone(im) {                                          // the room takes its colour from the page, kept dark
  scratch.canvas.width = scratch.canvas.height = 8; scratch.drawImage(im, 0, 0, 8, 8); let d; try { d = scratch.getImageData(0, 0, 8, 8).data; } catch { return; }
  let r = 0, g = 0, b = 0; for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; } const k = 0.16 / 64;
  document.documentElement.style.setProperty('--room', `rgb(${Math.round(r * k + 6)}, ${Math.round(g * k + 6)}, ${Math.round(b * k + 7)})`);
}
async function show(n, k = 0, fromEnd = false) {
  if (S.busy) return; S.busy = true; n = clamp(n, 0, total - 1);
  try {
    const a = await page(n); if (!a) throw 0;
    const two = S.pair && !S.guide && innerWidth > innerHeight * 1.15 && a.w < a.h && n + 1 < total, b = two ? await page(n + 1) : null, both = b && b.w < b.h ? [a, b] : [a];
    await Promise.all(both.map((p, i) => new Promise((ok, no) => { const im = imgs[i]; im.onload = ok; im.onerror = no; im.alt = `Page ${p.n + 1}`; if (im.src.endsWith(p.url)) ok(); else im.src = p.url; })));
    imgs[1].hidden = both.length < 2; S.shown = both; S.n = n; say('');
    S.panels = S.guide ? panelsOf(imgs[0], !!book.rtl) : []; S.k = fromEnd ? Math.max(0, S.panels.length - 1) : clamp(k, 0, Math.max(0, S.panels.length - 1));
    sheet.style.transition = still ? 'none' : ''; fit(); tone(imgs[0]); mark();
    page(n + both.length).then((p) => { if (p) new Image().src = p.url; });   // the next page is on its way before it is asked for
  } catch { say('Home did not answer, and this page is not on this device yet.'); }
  S.busy = false;
}
function mark() {                                                  // where you are: said, saved, and drawn on the ruler
  const [ci, i] = where(S.n); $('#part').textContent = book.chapters[ci].title; $('#prev').disabled = S.n === 0 && S.k === 0;
  $('#count').replaceChildren(String(S.n + 1), Object.assign(document.createElement('small'), { textContent: `of ${total}${S.panels.length ? ` · panel ${S.k + 1} of ${S.panels.length}` : ''}` }));
  rec.setPlace(SLUG, order[ci], i * PAGE_WORDS + Math.min(S.k, PAGE_WORDS - 1));
  [...$('#ruler').children].forEach((b, j) => { b.className = j < ci ? 'done' : j === ci ? 'here' : ''; if (j === ci) b.style.setProperty('--p', ((i + 1) / counts[ci]).toFixed(3)); });
  if (i === counts[ci] - 1 && (!S.panels.length || S.k === S.panels.length - 1)) rec.setDone(SLUG, order[ci]);
}
const step = (dir) => {                                            // on by a panel while the page has more, then by a page
  if (S.guide && S.panels.length && S.k + dir >= 0 && S.k + dir < S.panels.length) { S.k += dir; fit(); mark(); return; }
  const by = S.shown.length || 1, n = S.n + dir * (dir > 0 ? by : S.pair && !S.guide ? 2 : 1);
  if (n < 0) return; if (n >= total) return say('The end. Every page is read.');
  show(n, 0, dir < 0);
};

// ---------- controls ----------
book.chapters.forEach((c, ci) => { const b = document.createElement('button'); b.style.setProperty('--w', counts[ci]); b.title = c.title; b.setAttribute('aria-label', `${c.title}, ${counts[ci]} pages`); b.onclick = () => show(firsts[ci]); $('#ruler').append(b); });
const toggle = (id, key) => { const b = $(id); b.setAttribute('aria-pressed', String(S[key])); b.onclick = () => { S[key] = !S[key]; keep(key, S[key]); b.setAttribute('aria-pressed', String(S[key])); show(S.n, S.k); }; };
toggle('#guide', 'guide'); toggle('#pair', 'pair');
$('#next').onclick = () => step(1); $('#prev').onclick = () => step(-1);
const wake = () => { document.body.classList.remove('away'); clearTimeout(S.bars); S.bars = setTimeout(() => document.body.classList.add('away'), 3200); };
stage.addEventListener('click', (e) => { const x = e.clientX / innerWidth, on = book.rtl ? x < 0.35 : x > 0.65, back = book.rtl ? x > 0.65 : x < 0.35; if (on) step(1); else if (back) step(-1); else document.body.classList.contains('away') ? wake() : document.body.classList.add('away'); });
addEventListener('keydown', (e) => { if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key, fwd = book.rtl ? 'ArrowLeft' : 'ArrowRight', bwd = book.rtl ? 'ArrowRight' : 'ArrowLeft';
  if (k === fwd || k === ' ' || k === 'ArrowDown' || k === 'PageDown') { e.preventDefault(); step(1); } else if (k === bwd || k === 'ArrowUp' || k === 'PageUp') { e.preventDefault(); step(-1); }
  else if (k === 'p') $('#guide').click(); else if (k === 'Escape') location.href = './'; else if (k === 'Home') show(0); else if (k === 'End') show(total - 1); else return; wake(); });
addEventListener('pointermove', (e) => e.pointerType === 'mouse' && wake());
addEventListener('resize', () => show(S.n, S.k));
let since = Date.now(); setInterval(() => { if (!document.hidden) rec.addSeconds(SLUG, Math.min(30, Math.round((Date.now() - since) / 1000))); since = Date.now(); }, 30000);
await show(S.n, S.k); wake(); stage.focus();
