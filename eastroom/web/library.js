// East Room's library, made for hundreds of books. One set of books in two arrangements of the same objects (shelves of books, an index of titles; a wall of covers where shelves cannot be drawn),
// found by typing, ordered four ways, with the book you are in on top. Details open in place; a book being added shows its stages on the book itself.
import './carry.js';
import { sound } from './sound.js';
import { makeCover } from './cover.js';
import { makeShelf } from './shelf.js';
import { worldsFor } from './colour.js';
import * as rec from './state.js';
import { holdText, holdVoice, heldParts, keeping, ownBooks, keepBook } from './hold.js';

const Q = new URLSearchParams(location.search), $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const json = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status + ' ' + u))));
const still = matchMedia('(prefers-reduced-motion: reduce)').matches, root = document.documentElement, field = $('#field'), q = $('#q');
const store = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const save = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
const rnd = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

// ---------- the books: Home's library, with each book's place worked out from every device's record ----------
function progress(b) {
  const v = b.v = rec.view(b.slug, b.order), all = b.ch.every((c) => v.done[c.id]?.v);
  b.pi = v.place ? Math.max(0, b.order.indexOf(v.place.ch)) : 0;
  b.read = all ? b.total : v.place ? b.ch.slice(0, b.pi).reduce((a, c) => a + c.words, 0) + clamp(v.place.w | 0, 0, b.ch[b.pi].words) : 0;
  b.last = v.place?.t || 0;
}
function make(book) {
  const ch = book.chapters, dir = `media/${book.slug}/`;
  const b = { slug: book.slug, title: book.title, author: book.author || '', cover: book.cover && dir + book.cover, depth: book.depth ? dir + book.cover.replace(/\.\w+$/, '.depth.preview.png') : null, ch, order: ch.map((c) => c.id),
    total: Math.max(1, ch.reduce((a, c) => a + c.words, 0)), voiced: ch.filter((c) => c.voices).length, added: book.added || 0, href: `${book.kind === 'pages' ? 'pages' : 'read'}.html?book=${encodeURIComponent(book.slug)}`, pages: book.kind === 'pages', book };
  progress(b); return b;
}
const world4 = (b) => b.wp ??= worldsFor(b.book).then((ws) => {      // a book's own colours, worked out when they are first needed
  b.ws = ws; b.w = ws[b.pi] || ws[0]; b.g = b.w.ground; b.a = b.w.accent; if (b.el) tint(b); if (HB.b === b && HB.vol) { HB.vol.style.setProperty('--g', b.g); HB.vol.style.setProperty('--a', b.a); } }).catch(() => {});
const met = rec.sync();                                           // Home is asked where the other devices are; the page gives the answer a moment and never more
let books = await json('api/library'); for (const b of await ownBooks().catch(() => [])) if (!books.some((k) => k.slug === b.slug)) books.push(b);   // a book this browser read itself is on the shelf even on a visit the service worker did not answer
books = books.map(make); rec.prune(books.map((b) => b.slug));
await Promise.all(['800 80px "Science Gothic"', '600 20px Literata'].map((f) => document.fonts.load(f)));

const state = (b) => (b.read >= b.total * 0.99 ? 'done' : b.read > 0 ? 'reading' : 'new');
const hours = (words, long) => { const m = Math.max(1, Math.ceil(words / 250)); return m >= 90 ? [Math.round(m / 60), long ? 'hours' : 'h'] : [m, 'min']; };
const key = (t) => t.replace(/^(the|an?) /i, '').toLowerCase(), sur = (b) => (b.author.trim().split(' ').pop() || '~').toLowerCase();
const ORDER = {
  recent: ['Recent', (a, b) => b.last - a.last || b.added - a.added, () => ''],
  title: ['Title', (a, b) => key(a.title).localeCompare(key(b.title)), (b) => key(b.title)[0].toUpperCase()],
  author: ['Author', (a, b) => sur(a).localeCompare(sur(b)) || key(a.title).localeCompare(key(b.title)), (b) => sur(b)[0].toUpperCase()],
  short: ['Shortest', (a, b) => (state(a) === 'done') - (state(b) === 'done') || (a.total - a.read) - (b.total - b.read),
    (b) => { const h = (b.total - b.read) / 15000; return state(b) === 'done' ? 'Finished' : h < 2 ? 'Under 2 hours' : h < 5 ? '2 to 5 hours' : h < 10 ? '5 to 10 hours' : 'Over 10 hours'; }],
};
const TABS = { all: 'All', reading: 'Reading', new: 'New', done: 'Finished' }, SIZES = [[132, 14, 0], [204, 24, 86], [288, 32, 90]];   // cover height, least gap, caption height
const shelf = makeShelf();
const room = Promise.race([Promise.all([shelf?.ready, ...['marble', 'walnut', 'post', 'gilt'].map((n) => Object.assign(new Image(), { src: `room/${n}.webp` }).decode().catch(() => {}))]), wait(2500)]);   // the stone and the wood of the case
let kept = {}; try { kept = JSON.parse(store('eastroom:shelf')) || {}; } catch {}
const S = { q: '', tab: TABS[kept.tab] ? kept.tab : 'all', order: ORDER[kept.order] ? kept.order : 'recent', view: !shelf ? (Q.get('view') === 'index' || kept.view === 'index' ? 'index' : 'wall') : Q.get('view') || (kept.view === 'index' ? 'index' : 'shelf'), size: clamp(kept.size ?? 1, 0, 2) | 0,
  sel: null, at: null, list: [], hover: null, ptr: [innerWidth / 2, innerHeight * 0.3], tx: 0, ty: 0, lines: [], W: 0, mouse: false };

// ---------- one book on the field ----------
const px = Object.assign(document.createElement('canvas'), { width: 4, height: 6 }).getContext('2d', { willReadFrequently: true }), of = new Map();
const calm = window.requestIdleCallback ? (f) => requestIdleCallback(f) : (f) => setTimeout(f, 60);   // reading a cover's colours means unpacking the whole picture: it waits until nothing else is asking for the page
function tint(b, im) {                                            // a book with no colours of its own takes them from its cover
  if (!b.g) { try { px.drawImage(im, 0, 0, 4, 6); const d = px.getImageData(0, 0, 4, 6).data; let c = [0, 0, 0]; for (let i = 0; i < d.length; i += 4) for (let k = 0; k < 3; k++) c[k] += d[i + k] / 24;
    const hex = (m) => '#' + c.map((v) => Math.round(clamp(v * m, 0, 255)).toString(16).padStart(2, '0')).join(''); b.g = hex(0.55); b.a = hex(1.3); } catch { return; } }
  b.el.style.setProperty('--g', b.g); b.el.style.setProperty('--a', b.a);
}
function picture(b) { const cv = $('.cv', b.el); cv.querySelector('img, .made')?.remove();
  if (b.cover) { const im = el('img'); im.alt = ''; im.draggable = false; im.onload = () => calm(() => tint(b, im)); im.src = b.cover; cv.prepend(im); } else cv.prepend(el('span', 'made', b.title)); }
function slot(b) {
  const s = el('div', 'slot'), a = el(b.href ? 'a' : 'div', 'bk'), cv = el('span', 'cv'), cap = el('span', 'cap'), more = el('button', 'more');
  s.setAttribute('role', 'listitem'); a.tabIndex = -1; if (b.href) { a.href = b.href; a.draggable = false; } else a.setAttribute('role', 'button');
  cv.append(el('i', 'edge')); cap.append(el('strong'), el('em'), el('span', 'st'), el('span', 't'), el('i', 'bar'));
  more.setAttribute('aria-label', `Details for ${b.title}`); more.tabIndex = -1; a.append(cv, cap); s.append(a, more); b.el = s; b.x = b.y = 0; of.set(s, b);
  if (b.g) tint(b); picture(b); paint(b); field.append(s);
  s.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'mouse' || b.job || S.view === 'shelf') return; S.hover = b; if (glass && b.cover && !still) { cv.append(glass.el); glass.show(b.cover, b.depth); } });
  s.addEventListener('pointermove', (e) => { if (S.hover !== b || S.view === 'shelf') return; const r = cv.getBoundingClientRect(); S.tx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1); S.ty = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
    s.style.setProperty('--tx', S.tx.toFixed(3)); s.style.setProperty('--ty', S.ty.toFixed(3)); });
  s.addEventListener('pointerleave', () => { if (S.hover !== b || S.view === 'shelf') return; S.hover = null; glass?.el.remove(); s.style.removeProperty('--tx'); s.style.removeProperty('--ty'); });
}
function paint(b) {                                               // everything on a book that depends on where you are in it
  const st = state(b), [n, u] = hours(b.total - b.read), s = b.el, a = s.firstChild;
  for (const k of ['new', 'reading', 'done']) s.classList.toggle(k, k === st && !b.job); s.classList.toggle('busy', !!b.job);
  s.style.setProperty('--p', (b.read / Math.max(1, b.total)).toFixed(3)); b.p = st === 'done' ? 1 : b.read / Math.max(1, b.total); b.fresh = st === 'new' && !b.job;
  $('strong', s).textContent = b.title; $('em', s).textContent = b.author;
  $('.st', s).textContent = b.job || (st === 'reading' ? `Part ${b.pi + 1} of ${b.ch.length}` : st === 'new' ? 'New' : 'Finished');
  const t = b.job ? '' : st === 'done' ? 'Read' : `${n} ${u}${st === 'reading' ? ' left' : ''}`; $('.t', s).textContent = t;
  a.setAttribute('aria-label', `${b.title}, ${b.author || 'unknown author'}. ${b.job || (st === 'new' ? `New, ${t}` : st === 'done' ? 'Finished' : t)}.`);
}

// ---------- arranging: filter, order, place; every book travels from where it is to where it belongs ----------
const detail = el('section'); detail.id = 'detail'; detail.hidden = true; detail.setAttribute('aria-label', 'Book details'); field.append(detail);
let first = true;
// a book on a shelf: thicker the longer it is (a 30,000-word book about 16% of its height, a 460,000-word one 36%; never too thin for its name), and no two quite the same height
const thick = (b, H) => Math.round(clamp(H * (0.1 + 0.26 * Math.min(1, b.total / 400000) ** 0.6), 22, H * 0.36)), tall = (b, H) => Math.round(H * (0.85 + 0.15 * rnd(b.total % 977 + b.title.length)));
function arrange(arrive) {                                        // arrive: a wholly new arrangement, which steps forward together (see turn)
  const find = S.q.trim().toLowerCase(), [, by, group] = ORDER[S.order], wall = S.view === 'wall', on = S.view === 'shelf', phone = innerWidth < 700;
  const list = S.list = books.filter((b) => (S.tab === 'all' || state(b) === S.tab || b.job) && (!find || (b.title + ' ' + b.author).toLowerCase().includes(find))).sort((a, b) => !!b.job - !!a.job || by(a, b));
  if (S.sel && !list.includes(S.sel)) S.sel = null;
  const top = field.getBoundingClientRect().top, was = new Map();
  const vh = innerHeight, near = (yy) => top + yy > -vh && top + yy < vh * 2;                // only what is near the window is measured and moved; the rest is simply there
  if (!on) for (const b of books) if (!b.el.classList.contains('out')) { const m = near(b.y) && b.el.firstChild.getAnimations().length ? new DOMMatrix(getComputedStyle(b.el.firstChild).transform) : null; was.set(b, m ? [b.x + m.m41, b.y + m.m42] : [b.x, b.y]); }
  const W = field.clientWidth; let [H, gap, capH] = phone && wall ? [[96, 10, 0], [150, 12, 80], [230, 16, 84]][S.size] : SIZES[S.size], face = false;
  if (on) {                                                       // books that all fit standing face out do so, larger when there is room for it; otherwise they stand spine out, as many to a shelf as it holds
    H = (phone ? [120, 160, 206] : [170, 220, 278])[S.size]; const span = (m) => list.reduce((a, b) => a + H * m * 0.66 + thick(b, H * m) * 0.3 + 44, 0);
    if (list.length && !phone && span(1.3) <= W) { face = true; H = Math.round(H * 1.3); } else face = list.length > 0 && span(1) <= W * 3; }
  shelf?.fit(books.length);                                       // in a list too: the books on the slab's sill are the shelves' own
  const w = Math.round(H * 2 / 3), cols = wall ? Math.max(1, Math.floor((W + gap) / (w + gap))) : 1, pitch = cols > 1 ? (W - cols * w) / (cols - 1) : 0;
  const rowH = on ? H + (face ? 132 : 96) : wall ? H + capH + Math.min(gap + 10, 40) : 60, DH = phone ? 700 : 440;
  let x = 0, y = 0, c = 0, g = null, row = []; const heads = [], lines = [];
  if (arrive) { field.classList.add('cut'); requestAnimationFrame(() => requestAnimationFrame(() => field.classList.remove('cut'))); }   // the words of one view do not fade across the other
  field.dataset.view = S.view; field.dataset.size = S.size; field.toggleAttribute('data-face', face); field.style.setProperty('--h', H + 'px'); field.style.setProperty('--w', w + 'px'); field.style.setProperty('--dh', DH + 'px');
  for (const b of list) {
    const gk = b.job ? 'Arriving' : find ? '' : group(b);            // a search is one flat list of results
    if (on) {                                                       // along the shelf: a marker where a group begins, then its books
      if (gk !== g) { g = gk; if (gk) { if (x && x + 150 > W) { x = 0; y += rowH; } heads.push([gk, y, 0, x]); x += 40; } }
      if (heads.length) heads.at(-1)[2]++;
      if (b === S.sel) { if (x) { x = 0; y += rowH; } detail.style.top = y + 'px'; b.nx = 0; b.ny = y + 44; y += DH; continue; }   // the open book leaves the shelf; the shelf goes on under its details
      const t = thick(b, H), sw = face ? Math.round(H * 0.66 + t * 0.3) : t;
      if (x && x + sw > W) { x = 0; y += rowH; }
      if (lines.at(-1)?.y !== y + H) lines.push({ y: y + H, of: [], h: rowH });   // h: how high the back of the case stands behind this shelf
      Object.assign(b, { nx: x, ny: y, t, bh: tall(b, H), sw, face }); lines.at(-1).of.push(b); x += sw + (face ? 44 : 1); continue;
    }
    if (gk !== g) { g = gk; if (c) { c = 0; y += rowH; row = []; } if (gk) { heads.push([gk, y, 0]); y += 70; } }
    if (b === S.sel) { if (heads.length) heads.at(-1)[2]++; for (const k of row) k.ny += DH; detail.style.top = y + 'px'; b.nx = 0; b.ny = y + 44; y += DH; continue; }   // the open book leaves the row; the row moves down under its details
    if (heads.length) heads.at(-1)[2]++;
    b.nx = wall ? c * (w + pitch) : 0; b.ny = y; row.push(b);
    if (++c >= cols) { c = 0; y += rowH; row = []; }
  }
  if (on ? x : c) y += rowH;
  if (face && lines.length === 1 && !heads.length) { const free = (W - lines[0].of.reduce((a, b) => a + b.sw, 0)) / (lines[0].of.length + 1); let at = 0; for (const b of lines[0].of) { at += free; b.nx = Math.round(at); at += b.sw; } }   // one shelf of a few books: they stand evenly along it
  if (on && lines.length) {                                       // a case shows all its shelves: under the last row of books they go on, empty, to the foot of the window and a little past the foot of the page
    y = Math.max(y, innerHeight - field.offsetTop - 140);
    for (let at = lines.at(-1).y + rowH; at - rowH < y + 140; at += rowH) lines.push({ y: at, of: [], h: rowH });
  }
  field.style.height = y + 'px'; detail.hidden = !S.sel; S.lines = lines; S.W = W;
  const shown = new Set(list);
  for (const b of books) {
    const vis = shown.has(b), k = b.el.firstChild; b.el.classList.toggle('out', !vis); b.el.classList.toggle('sel', b === S.sel); b.vis = on && vis && b !== S.sel; if (!vis) continue;
    b.el.style.left = b.nx + 'px'; b.el.style.top = b.ny + 'px'; k.getAnimations().forEach((a) => a.id === 'flip' && a.cancel());
    if (b.vis) {                                                    // on a shelf the book itself moves, and only as far as the eye can follow
      const px = b.nx + (face ? Math.round(b.t * 0.3) : b.t), py = b.ny + H; b.el.style.setProperty('--sw', b.sw + 'px'); b.el.style.setProperty('--cx', (face ? Math.round(b.t * 0.3) : 0) + 'px'); gsap.killTweensOf(b); b.go = null; b.lf = 1;
      const fresh = b.gx == null, seen = near(py) || (!fresh && near(b.gy)); let how = null;
      if (arrive || fresh) { b.gx = px; b.gy = py; if (!still && (fresh || near(py))) { how = 'arrive'; b.seen = 0; b.wait = fresh ? Math.min(1.3, 0.1 + (b.nx / W) * 0.45 + (b.ny / rowH) * 0.14) : Math.min(0.26, Math.max(0, (top + py - H) / rowH) * 0.05 + (b.nx / W) * 0.08); } }
      else if (b.seen > 0.5 && !first && !still && seen && (b.gx !== px || b.gy !== py)) {
        if (b.gx === px || b.gy === py) { how = 'slide'; gsap.to(b, { gx: px, gy: py, duration: 0.5, ease: 'power3.out' }); }   // along its shelf, or down with its shelf: it slides
        else { how = 'go'; b.go = [px, py]; } }                                                                                // to another shelf: it steps back here and forward there
      else { b.gx = px; b.gy = py; }
      if (!face) how = null;                                        // only books standing face out have words under them to bring along
      if (how === 'slide' && b.x != null) k.animate([{ transform: `translate(${b.x - b.nx}px,${b.y - b.ny}px)` }, { transform: 'none' }], { duration: 500, easing: 'cubic-bezier(.25,1,.5,1)', id: 'flip' });   // the words under a book keep with it
      else if (how && !fresh) k.animate([{ opacity: 0 }, { opacity: 0, offset: how === 'go' ? 0.45 : 0 }, { opacity: 1 }], { duration: how === 'go' ? 440 : 300, delay: how === 'arrive' ? b.wait * 1000 + 60 : 0, fill: 'backwards', id: 'flip' });
    }
    const o = was.get(b);
    if (!on && !still && !first && near(b.ny)) {
      if (arrive) k.animate([{ opacity: 0, transform: 'translateY(10px)' }, { opacity: 1, transform: 'none' }], { duration: 320, easing: 'cubic-bezier(.25,1,.5,1)', delay: Math.min(220, Math.max(0, (top + b.ny) / rowH) * 16), fill: 'backwards', id: 'flip' });   // a new list arrives a row after a row
      else if (o && (o[0] !== b.nx || o[1] !== b.ny)) k.animate([{ transform: `translate(${o[0] - b.nx}px,${clamp(o[1] - b.ny, -vh, vh)}px)` }, { transform: 'none' }], { duration: 420, easing: 'cubic-bezier(.25,1,.5,1)', id: 'flip' });
    }
    b.x = b.nx; b.y = b.ny;
  }
  if (S.hover && !S.hover.vis) hold(null);
  seat();
  field.querySelectorAll('.head').forEach((h) => h.remove());
  for (const [t, hy, n, hx] of heads) { const h = el('h2', 'head', t); h.style.top = hy + 'px'; if (on) { h.style.left = hx + 'px'; h.classList.toggle('long', t.length > 1); } h.append(el('i', '', n)); field.append(h); }
  const rail = $('#rail'); rail.replaceChildren(...(S.order === 'title' || S.order === 'author' ? heads.filter(([t]) => t.length === 1) : []).map(([t, hy]) => { const b = el('button', '', t); b.setAttribute('aria-label', 'Jump to ' + t);
    b.onclick = () => scrollTo({ top: field.offsetTop + hy - 96, behavior: still ? 'auto' : 'smooth' }); return b; }));
  const count = list.length; $('#n').textContent = count; $('#of').textContent = count === books.length ? (count === 1 ? 'book' : 'books') : `of ${books.length} books`;
  $('#none').hidden = !!list.length || !books.length; $('#none').textContent = find ? `Nothing called “${S.q.trim()}” in ${S.tab === 'all' ? 'your' : 'these'} ${books.length} books. Esc clears the search.` : books.length ? 'No books here.' : '';
  document.body.classList.toggle('finding', !!find || S.tab !== 'all');
  marks();
  save('eastroom:shelf', JSON.stringify({ tab: S.tab, order: S.order, view: S.view, size: S.size })); first = false;
}

function marks() {                                               // which controls are pressed: shown at once, whatever the books are doing
  for (const [k, b] of Object.entries(tabs)) { b.setAttribute('aria-pressed', k === S.tab); b.lastChild.textContent = k === 'all' ? books.length : books.filter((x) => state(x) === k).length; }
  for (const [k, b] of Object.entries(orders)) b.setAttribute('aria-pressed', k === S.order);
  document.querySelectorAll('#view button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.v === S.view)); $('#size').hidden = S.view === 'index';
}
// A new order, size or view is not a journey for each book: what stands there steps back, then the new arrangement steps forward together.
let turning;
function turn() {
  marks(); if (still || first) return arrange();
  S.turn = true; field.classList.add('turn'); clearTimeout(turning);
  turning = setTimeout(() => { arrange(true); S.turn = false; field.classList.remove('turn'); }, 150);
}

// ---------- details, in place ----------
function select(b) {
  S.sel = b && b !== S.sel ? b : null; if (S.sel) fill(S.sel); arrange(); sound('turn');
  if (S.sel) requestAnimationFrame(() => scrollTo({ top: field.offsetTop + parseFloat(detail.style.top) - 110, behavior: still ? 'auto' : 'smooth' }));
}
function fill(b) {
  const st = state(b), [n, u] = hours(b.total - b.read, true), x = el('button', 'x'), facts = el('dl', 'facts'), parts = el('div', 'parts'), acts = el('div', 'acts');
  const before = b.ch.slice(0, b.pi).reduce((a, c) => a + c.words, 0), fact = (k, v) => { const d = el('div'); d.append(el('dt', '', k), el('dd', '', v)); facts.append(d); };
  detail.style.setProperty('--g', b.g || '#333'); x.setAttribute('aria-label', 'Close details (Esc)'); x.onclick = () => select(null);
  fact(st === 'reading' ? 'Left' : 'Length', st === 'done' ? `${hours(b.total, true).join(' ')}, read` : `${n} ${u}`);
  fact('Where', st === 'reading' ? `Part ${b.pi + 1} of ${b.ch.length}` : st === 'new' ? `${b.ch.length} parts, not opened` : 'Finished');
  if (b.pages) fact('Pages', Math.round(b.total / 60).toLocaleString('en'));
  else { fact('Voice', b.voiced >= b.ch.length ? 'ready' : b.voiced ? `${b.voiced} of ${b.ch.length} parts` : 'not made yet'); fact('Words', b.total.toLocaleString('en')); }
  if (b.v.seconds >= 60) fact('Read for', hours(b.v.seconds / 60 * 250, true).join(' '));
  if (b.voiced) fact('On this device', keeping(b.slug) ? `text, voice for ${heldParts(b.slug)} of ${b.voiced} parts` : 'text, voice near your place');
  b.ch.forEach((c, i) => { const s = el('i', (i < b.pi || st === 'done' ? 'done' : i === b.pi && st === 'reading' ? 'here' : '') + (c.voices ? ' voiced' : '')); s.title = c.title; s.style.setProperty('--w', c.words);
    if (i === b.pi) s.style.setProperty('--p', clamp((b.read - before) / c.words).toFixed(3)); parts.append(s); });
  const act = (label, fn) => { const k = el('button', '', label); k.onclick = () => { fn(k); progress(b); paint(b); fill(b); arrange(); hero(); }; acts.append(k); };
  const all = (v) => { for (const c of b.ch) if (!!b.v.done[c.id]?.v !== v) rec.setDone(b.slug, c.id, v); };
  const r = el('a', 'read', st === 'reading' ? 'Continue' : st === 'done' ? 'Read again' : 'Read'); r.href = b.href; r.append(el('kbd', '', '↵')); r.onclick = (e) => open(e, b, $('.cv', b.el)); acts.append(r);
  if (b.read > 0) act('Start over', () => { b.undo = { place: b.v.place, done: b.ch.filter((c) => b.v.done[c.id]?.v).map((c) => c.id) }; rec.setPlace(b.slug, b.order[0], 0); all(false); });
  else if (b.undo) act('Undo start over', () => { const u = b.undo; b.undo = null; if (u.place) rec.setPlace(b.slug, u.place.ch, u.place.w, u.place.exact); for (const c of u.done) rec.setDone(b.slug, c, true); });
  if (st !== 'done') act('Mark finished', () => all(true)); else act('Mark unread', () => all(false));
  if (b.voiced) act(keeping(b.slug) ? 'Stop keeping the voice here' : 'Keep on this device', () => {   // the whole book's narration, for reading far from Home
    keeping(b.slug, !keeping(b.slug)); if (keeping(b.slug)) holdVoice(b.book, 0, b.ch.length, () => S.sel === b && fill(b)); });
  // what Home can make for this book, and taking the book out: asked here, done in the workshop
  const ask = (label, path, body, done) => { const k = el('button', '', label); k.onclick = async () => { k.disabled = true;
    try { const r = await fetch(path, { method: 'POST', body: JSON.stringify(body) }), out = await r.json().catch(() => ({})); if (!r.ok) throw new Error(r.status === 403 ? `Home was not told that this address may change things. Start it with --origin ${location.origin}` : out.error || `Home answered ${r.status}.`); done(k, out); }
    catch (err) { k.disabled = false; acts.append(el('small', 'warn', err.message || 'Home did not answer.')); } }; acts.append(k); };
  if (!b.pages && b.voiced < b.ch.length) ask('Narrate this book', 'api/work', { book: b.slug, step: 'voice', arg: 'plain' }, (k) => { k.textContent = 'Narration is in the queue'; });
  ask('Remove', 'api/remove', { book: b.slug, what: 'book' }, () => { books.splice(books.indexOf(b), 1); b.el.remove(); S.sel = null; arrange(); hero(); const n = el('p'), a = el('a', '', 'Settings, Storage'); n.id = 'toast'; a.href = 'settings.html#storage'; n.append(`${b.title} is removed. Your place and kept lines stay. Bring it back within 7 days in `, a, '.'); $('#toast')?.remove(); document.body.append(n); setTimeout(() => n.remove(), 12000); });
  const more = el('a', 'more-link', 'Everything for this book'); more.href = `settings.html?find=${encodeURIComponent(b.title)}#workshop`; acts.append(more);   // the Workshop opens on this book
  const kept = Object.keys(b.v.kept).length; if (kept) { const k = el('a', 'more-link', `${kept} ${kept === 1 ? 'line' : 'lines'} kept`); k.href = 'ideas.html#' + b.slug; acts.append(k); }
  detail.replaceChildren(x, el('h2', '', b.title), el('p', 'by', b.author), facts, parts, acts);
}

// ---------- the book you are in: its name let into the slab at the top of the case, the other open books standing beside it ----------
const HB = { b: null, vol: null, also: [], spines: new Map() };
function invite(box) {                                              // no book yet: the place the first one will take stands open, with the one thing to do
  const pick = () => $('#files').click(), vol = el('button', 'vol none'), face = el('span', 'face'), say = el('div', 'say'), go = el('div', 'go'), disc = el('button', 'disc plus'), txt = el('div');
  for (const k of [vol, disc]) { k.type = 'button'; k.onclick = pick; } vol.setAttribute('aria-label', 'Choose a book file'); disc.setAttribute('aria-label', 'Choose a book file'); face.append(el('i')); vol.append(face); disc.append(el('i'));
  txt.append(el('span', 'k', 'Choose a file'), el('span', 't', 'EPUB, PDF, comic archive, text or Markdown')); go.append(disc, txt);
  say.append(el('h2', 'name', 'Add a book'), el('p', 'by how', `${matchMedia('(hover: none)').matches ? 'Choose a book file from this device.' : 'Drop a book file anywhere on this page, or choose one.'} A few seconds later it stands here, cut into short parts where its author cut it. It goes to your own computer and nowhere else.`), go);
  HB.b = null; HB.also = []; box.hidden = false; box.replaceChildren(vol, say); seat();
}
function hero() {
  const none = !books.some((x) => !x.job); document.body.classList.toggle('first', none); if (none) return invite($('#hero'));
  const box = $('#hero'), going = books.filter((b) => state(b) !== 'done' && !b.job).sort(ORDER.recent[1]), b = HB.b = going[0]; box.hidden = !b; if (!b) { HB.also = []; return seat(); }
  const st = state(b), vol = HB.vol = el(b.href ? 'a' : 'button', 'vol'), face = el('span', 'face'), say = el('div', 'say'), name = el('h2', 'name', b.title), go = el('div', 'go'), txt = el('div'), disc = el(b.href ? 'a' : 'button', 'disc'), im = el('img');
  const part = b.ch[b.pi], inPart = part.words - (b.read - b.ch.slice(0, b.pi).reduce((a, c) => a + c.words, 0)), [n, u] = hours(st === 'reading' ? inPart : b.total, true), [bn, bu] = hours(b.total - b.read, true);
  const enter = (e) => { if (!b.href) { e.preventDefault(); return select(b); } open(e, b, face); };
  for (const k of [vol, disc]) { if (b.href) k.href = b.href; k.onclick = enter; } vol.setAttribute('aria-label', `${b.title}, ${b.author}`); disc.setAttribute('aria-label', `${st === 'reading' ? 'Continue' : 'Start'} ${b.title}`);
  vol.style.cssText = `--g:${b.g || '#333'};--a:${b.a || '#fff'}`; im.alt = ''; im.onload = () => vol.style.setProperty('--ar', (im.naturalWidth / im.naturalHeight).toFixed(4)); if (b.cover) { im.src = b.cover; face.append(im); } else face.append(el('span', 'made', b.title));
  if (glassH && !still) { face.append(glassH.el); glassH.show(b.cover, b.depth); }
  vol.append(el('span', 'spine'), el('span', 'pages'), face); disc.append(el('i'));
  name.classList.toggle('long', b.title.length > 26); name.classList.toggle('longer', b.title.length > 52);   // a long name is set smaller, never cut
  txt.append(el('span', 'k', st === 'reading' ? 'Continue' : 'Start here'), el('span', 't', `${n} ${u} ${st === 'reading' ? 'left in this part' : 'to read'}`)); go.append(disc, txt);
  const where = el('p', 'where'), line = el('div', 'rl'); where.append(el('span', '', st === 'reading' ? `Part ${b.pi + 1} of ${b.ch.length}` : `${b.ch.length} parts`), el('span', '', st === 'reading' ? `${bn} ${bu} left in the book` : ''));
  rule(b, line); line.onclick = (e) => { const s = e.target.closest('.seg'); if (s) open(e, b, face, +s.dataset.i); };
  say.append(name, el('p', 'by', b.author), go, where, line);
  // the other open books stand spine out on the same sill, at the size of the book beside them: the shelves' own books, drawn by the shelves' own hand
  const also = el('div', 'also'), others = going.slice(1).filter((x) => state(x) === 'reading').slice(0, 3); HB.also = [];
  if (others.length) also.append(el('span', 'k', 'Also open'));
  for (const o of others) { const a = el(o.href ? 'a' : 'button'), cv = el('span', 'cv'), [on, ou] = hours(o.total - o.read); if (o.href) a.href = o.href;
    a.title = o.title; a.setAttribute('aria-label', `${o.title}, ${on} ${ou} left`); a.append(cv, el('span', '', `${on} ${ou} left`)); also.append(a);
    if (!shelf) { if (o.cover) cv.append(Object.assign(el('img'), { src: o.cover, alt: '' })); a.onclick = (e) => (o.href ? open(e, o, cv) : select(o)); continue; }   // where shelves cannot be drawn: a strip of its cover
    let c = HB.spines.get(o.slug); if (!c) HB.spines.set(o.slug, c = Object.assign(Object.create(o), { face: false, near: 1.06, lf: 1, nx: null, gx: null, gy: 0, seen: 0, wait: 0.5, go: null, o: 0, ov: 0, sp: null, spk: null, cs: 0, cv: null, hand: null, pose: null, zin: 0 }));
    c.el = a; c.box = cv; HB.also.push(c); a.onclick = (e) => (o.href ? open(e, c, null) : select(o));
    a.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse' && !S.leave) { S.tx = 0; hold(c); } }); a.addEventListener('pointerleave', () => { if (S.hover === c && !S.leave) hold(null); }); }
  box.replaceChildren(vol, say, also);
  for (const c of HB.also) { c.t = thick(c, vol.offsetHeight); c.bh = tall(c, vol.offsetHeight); c.box.style.width = c.t + 'px'; c.box.style.height = c.bh + 'px'; }
  seat();
  world4(b).then(() => HB.b === b && b.w && save('eastroom:w', JSON.stringify({ ground: b.w.ground, deep: b.w.deep, ink: b.w.ink, accent: b.w.accent })));   // the reader, and the rooms off the library, open in this book's colours
}
function seat() {                                                   // where the slab's own shelf and the books on it stand, in the field's px. Measured from the layout, so nothing in motion is caught half way
  const box = $('#hero'), on = !!HB.b && box.offsetHeight > 0, x = box.offsetLeft + box.clientLeft - field.offsetLeft, y = box.offsetTop + box.clientTop - field.offsetTop;
  S.sill = on ? box.offsetTop + box.offsetHeight - field.offsetTop : null; S.pad = Math.max(0, field.offsetLeft - (parseFloat(getComputedStyle(document.body).getPropertyValue('--gap')) || 0));   // how far in the standards of the case reach
  if (S.lines[0]) S.lines[0].h = S.lines[0].y - (on ? S.sill + 11 : -300);   // behind the first shelf the back runs up to the shelf the slab lies on, or to the top of the case
  for (const c of HB.also) { c.vis = on && c.box.offsetWidth > 0; if (!c.vis) continue; let ox = 0, oy = 0; for (let e = c.box; e && e !== box; e = e.offsetParent) { ox += e.offsetLeft; oy += e.offsetTop; }   // a part that is being moved into place counts as the parent of what stands in it
    c.gx = x + ox + c.box.offsetWidth; c.gy = y + oy + c.box.offsetHeight; }
}

// ---------- adding books: the file goes to Home, which reads it; the stages shown are the request's own ----------
const jobs = [];
function bench() {
  const box = $('#bench'); box.hidden = !jobs.length; if (!jobs.length) return;
  const going = jobs.filter((b) => b.job && !b.bad).length;
  box.replaceChildren(el('h3', '', going ? `Adding ${going}` : jobs.some((b) => b.bad) ? 'Not added' : 'Added'), ...jobs.map((b) => { const r = el('div', 'job' + (b.bad ? ' bad' : b.job ? '' : ' ok')), k = el('button', '', b.bad ? 'Remove' : b.job ? 'Cancel' : 'Done');
    r.append(el('b', '', b.title), k, el('span', '', b.note || b.job), el('i')); r.lastChild.style.setProperty('--p', b.job ? Math.min(1, b.step / 2) : 1);
    k.onclick = () => { b.stop?.(); jobs.splice(jobs.indexOf(b), 1); if (b.job || b.bad) { books.splice(books.indexOf(b), 1); b.el.remove(); arrange(); } bench(); }; return r; }));
}
async function add(file) {
  const b = { slug: 'new~' + Math.random(), title: file.name.replace(/\.\w+$/, '').replace(/[_-]+/g, ' '), author: '', ch: [{ id: '', title: '', words: 1 }], order: [''], pi: 0, total: 1, read: 0, last: 0, added: Date.now() / 1000, voiced: 0, job: 'Sending', step: 0 };
  books.push(b); slot(b); jobs.push(b); arrange(); bench(); requestAnimationFrame(() => b.el.scrollIntoView({ block: 'center', behavior: still ? 'auto' : 'smooth' }));
  const say = (t, step) => { if (b.gone) return; b.job = t; b.step = step; paint(b); bench(); }, fail = (note) => { b.bad = true; b.note = note; say('Not added', 0); };
  const land = (out, fresh) => {                                  // the stand-in gives its place to the book
    if (b.gone) return; books.splice(books.indexOf(b), 1); b.el.remove(); jobs.splice(jobs.indexOf(b), 1);
    let nb = books.find((k) => k.slug === out.slug); if (!nb && fresh) { nb = make(fresh); books.push(nb); slot(nb); }
    if (nb) { nb.note = out.known ? 'Already in your library.' : out.note || 'Ready to read.'; if (!jobs.includes(nb)) jobs.push(nb); setTimeout(() => { if (jobs.includes(nb)) { jobs.splice(jobs.indexOf(nb), 1); nb.note = null; bench(); } }, 7000); }
    arrange(); hero(); bench(); sound('key'); if (nb) focus(nb);
  };
  b.stop = () => { b.gone = true; }; await met; if (b.gone) return;   // whether there is a Home is known once it was asked
  const alone = rec.home.none ?? await fetch('py/eastroom.zip').then((r) => r.ok, () => false);   // a published copy has no Home behind it. When the question got no clear answer: such a copy carries the code that reads files, and a Home never does
  if (alone) return (reading = reading.then(() => b.gone || here(file, say, land, () => b.gone).catch((err) => b.gone || fail(err.message))));
  if (rec.home.none !== false) return fail('Home did not answer. The file is still where it was; add it again when Home is awake.');   // a file is sent only to a Home that has answered
  const x = new XMLHttpRequest(); b.stop = () => x.abort();
  x.open('POST', 'api/import?name=' + encodeURIComponent(file.name));
  x.upload.onprogress = (e) => { if (e.lengthComputable) e.loaded < e.total ? say(`Sending ${Math.round(e.loaded / e.total * 100)}%`, e.loaded / e.total) : say('Reading the file', 1.5); };
  x.onerror = x.ontimeout = () => fail('Home did not answer. The file is still where it was; add it again when Home is awake.');
  x.onload = async () => {
    let out = {}; try { out = JSON.parse(x.responseText); } catch {}
    if (x.status !== 200) return fail(x.status === 403 ? `Home was not told that this address may save. Start it with --origin ${location.origin}` : out.error || `Home answered ${x.status}.`);
    land(out, (await json('api/library').catch(() => [])).find((k) => k.slug === out.slug));
  };
  x.send(file);
}
// Without a Home this browser reads the file itself (local.js) and keeps the book in its own storage. One file at a time: each must know the names already taken.
const INSTALL = 'East Room on your own computer reads it: github.com/intesarjawad/eastroom';
let reading = Promise.resolve(), reader;
async function here(file, say, land, gone) {
  if (/\.pdf$/i.test(file.name)) throw new Error(`In the browser East Room reads EPUB, comics (CBZ) and text files, not PDF. ${INSTALL}`);
  const CANNOT = `This window cannot keep books (a private window does that). Open the page in a normal window. ${INSTALL}`;
  if (!('serviceWorker' in navigator) || !self.caches || !crypto.subtle) throw new Error(CANNOT);
  if (file.size > 3e8) throw new Error(`This file is too large to read in a browser. ${INSTALL}`);
  say('Reading the file', 0.2);
  const mark = [...new Uint8Array(await crypto.subtle.digest('SHA-256', await file.arrayBuffer()))].map((n) => n.toString(16).padStart(2, '0')).join(''), known = books.find((k) => k.book?.source === mark);
  if (known) return land({ slug: known.slug, known: true });
  const ready = Promise.race([wait(20000), navigator.serviceWorker.ready.then(async (reg) => { await reg.update().catch(() => {});   // the book will be answered by the service worker: a newer one takes over first
    if (reg.installing || reg.waiting) await Promise.race([new Promise((ok) => navigator.serviceWorker.addEventListener('controllerchange', ok, { once: true })), wait(10000)]); return true; })]);
  const out = await new Promise((ok, no) => {
    reader ??= new Worker('local.js', { type: 'module' });
    reader.onmessage = ({ data }) => (data.text ? say(data.text, data.step) : data.error ? no(new Error(data.error)) : ok(data));
    reader.onerror = () => { reader = null; no(new Error(`This browser cannot read files itself. ${INSTALL}`)); };
    reader.postMessage({ file, taken: books.map((k) => k.slug) });
  });
  if (gone()) return; say('Keeping it in this browser', 1.8); if (!await ready) throw new Error(CANNOT);
  await keepBook(out.book, out.files).catch((err) => { throw new Error(err.name === 'QuotaExceededError' ? 'This browser has no room left for the book. Remove one in Settings, Devices.' : 'This browser would not keep the book.'); });
  land({ slug: out.book.slug, note: 'Ready to read. Kept in this browser only.' }, out.book);
}
function homeLine() {                                             // the network is named only when something is at stake: changes not yet with Home, or a device that cannot save
  const h = rec.home, e = $('#home'), m = Math.round((Date.now() - h.met) / 60000), ago = m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  e.hidden = !(h.full || h.refused || h.waiting > 0); e.classList.toggle('warn', !e.hidden);
  e.textContent = h.full ? 'This device is out of storage. Your last change is not saved here yet: free some space.' : h.refused ? `Home was not told that this address may save. Start it with --origin ${h.refused}` : `Changes in ${h.waiting} ${h.waiting === 1 ? 'book' : 'books'} waiting for Home` + (h.met ? ` · last reached ${ago}` : '');
}
$('#add').onclick = () => $('#files').click(); $('#files').onchange = (e) => { for (const f of e.target.files) add(f); e.target.value = ''; };
let over = 0; const drop = $('#drop');
met.then(() => { $('#star').hidden = !rec.home.none; if (rec.home.none) drop.lastChild.textContent = 'EPUB, comics (CBZ) and text files. This browser reads them itself and keeps them: nothing is sent anywhere.'; });
addEventListener('dragenter', (e) => { if (![...(e.dataTransfer?.types || [])].includes('Files')) return; over++; drop.hidden = false; });
addEventListener('dragleave', () => { if (--over <= 0) { over = 0; drop.hidden = true; } });
addEventListener('dragover', (e) => e.preventDefault());
addEventListener('drop', (e) => { e.preventDefault(); over = 0; drop.hidden = true; for (const f of e.dataTransfer.files) add(f); });

// ---------- controls ----------
const tabs = {}, orders = {}, shut = () => { try { $('#arr').hidePopover(); } catch {} };   // on a phone order and form are a menu, which a choice closes
for (const [k, t] of Object.entries(TABS)) { const b = tabs[k] = el('button', '', t); b.append(el('sup')); b.onclick = () => { S.tab = k; S.sel = null; arrange(); sound('tick'); scrollTo(0, 0); }; $('#tabs').append(b); }
for (const [k, [t]] of Object.entries(ORDER)) { const b = orders[k] = el('button', '', t); b.onclick = () => { shut(); if (S.order === k) return; S.order = k; turn(); sound('tick'); }; $('#order').append(b); }
document.querySelectorAll('#view button').forEach((b) => { b.onclick = () => { shut(); if (S.view === b.dataset.v) return; S.view = b.dataset.v; turn(); sound('book'); }; });
document.querySelectorAll('#size button').forEach((b) => { b.onclick = () => { const n = clamp(S.size + +b.dataset.d, 0, 2); if (n !== S.size) { S.size = n; turn(); sound('tick'); } }; });
q.addEventListener('input', () => { S.q = q.value; S.sel = null; arrange(); scrollTo(0, 0); });
// ---------- the book in your hand: on a shelf, the one under the pointer comes out and turns its cover to you ----------
let sharpT;
function hold(b) {
  if (S.hover === b) return; S.hover?.el.classList.remove('on'); S.hover = b; b?.el.classList.add('on'); clearTimeout(sharpT); if (b) sharpT = setTimeout(() => shelf.sharp(b), 110);
}
const inHand = (e) => {                                            // a cover turned out lies over its neighbours: while the pointer is on it, it is still that book
  const b = S.hover; if (S.view !== 'shelf' || !b?.vis || !b.hand) return false; const r = field.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  return x > b.hand[0] && x < b.hand[1] && y > b.hand[2] && y < b.gy + 6; };
field.addEventListener('pointermove', (e) => { if (S.view !== 'shelf' || e.pointerType !== 'mouse' || S.leave) return;
  const s = e.target.closest('.slot'), b = inHand(e) ? S.hover : s && of.get(s), ok = b && b.vis && !b.job ? b : null; hold(ok);
  if (ok) S.tx = ok.hand ? clamp((e.clientX - field.getBoundingClientRect().left - ok.hand[0]) / (ok.hand[1] - ok.hand[0]) * 2 - 1, -1, 1) : 0; });
field.addEventListener('pointerleave', (e) => { if (S.view === 'shelf' && e.pointerType === 'mouse' && !S.leave) hold(null); });
addEventListener('click', (e) => { if (S.view === 'shelf' && !e.target.closest('#field') && !S.leave) hold(null); });
field.addEventListener('click', (e) => { const s = e.target.closest('.slot'), b = inHand(e) ? S.hover : s && of.get(s); if (!b || b.job) return;
  if (e.target.closest('.more') || !b.href || b === S.sel) { e.preventDefault(); if (b !== S.sel) select(b); return; }
  if (S.view !== 'shelf') return open(e, b, $('.cv', s));
  if (S.hover !== b) { e.preventDefault(); return hold(b); }       // by touch: the first press takes the book in the hand, the second opens it
  open(e, b, null); });

// ---------- a book's parts as one line: the same instrument as the reader's ruler ----------
function rule(b, host) {
  const st = state(b), before = b.ch.slice(0, b.pi).reduce((a, c) => a + c.words, 0);
  host.classList.toggle('many', b.ch.length > 120);
  host.replaceChildren(...b.ch.map((c, i) => { const s = el('button', 'seg' + (st === 'done' || i < b.pi ? ' done' : i === b.pi && b.read > 0 ? ' at' : '')), w = b.ws?.[i];
    s.tabIndex = -1; s.dataset.n = String(i + 1).padStart(2, '0'); s.dataset.t = c.title; s.dataset.i = i; s.setAttribute('aria-label', `Open at part ${i + 1}: ${c.title}`);
    s.style.cssText = `--w:${c.words}` + (w ? `;--g:${w.ground};--a:${w.accent}` : '') + (i === b.pi ? `;--p:${clamp((b.read - before) / c.words).toFixed(3)}` : ''); return s; }));
}

// ---------- into a book: its cover comes forward, the library gives way to the book's own colour, and the reader opens on that same frame ----------
async function open(e, b, from, part) {
  if (e.metaKey || e.ctrlKey || e.shiftKey || !b.href) return;      // a new tab is the browser's business
  e.preventDefault(); if (S.leave) return; S.leave = { b, from, e: 0 }; sound('open');
  await Promise.race([world4(b), wait(150)]);
  const w = b.w, href = b.href + (part == null ? '' : `&part=${part + 1}`), im = from?.querySelector('img');
  try { sessionStorage.setItem('eastroom:open', JSON.stringify({ slug: b.slug, cover: b.cover, t: Date.now(), w: w && { ground: w.ground, deep: w.deep, ink: w.ink, accent: w.accent } })); } catch {}
  if (still || !w) return void (location.href = href);
  document.body.style.setProperty('--to', w.ground); document.body.classList.add('leaving'); S.leave.t = gsap.ticker.time;
  if (!from) { shelf.sharp(b); await gsap.to(S.leave, { e: 1, duration: 0.66, ease: 'power3.inOut' }); await wait(40); return void (location.href = href); }   // from a shelf the book itself comes forward
  const r = from.getBoundingClientRect(), H = Math.min(innerHeight * 0.56, 520), Wd = H * (im?.naturalWidth ? im.naturalWidth / im.naturalHeight : r.width / r.height), fly = el('div'); fly.id = 'fly';
  fly.append(im ? Object.assign(el('img'), { src: im.src, alt: '' }) : el('span', 'made', b.title)); fly.style.cssText = `left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;--g:${b.g || w.ground}`;
  document.body.append(fly); from.style.visibility = 'hidden';
  await fly.animate([{}, { left: (innerWidth - Wd) / 2 + 'px', top: (innerHeight - H) / 2 + 'px', width: Wd + 'px', height: H + 'px' }], { duration: 620, easing: 'cubic-bezier(.3,.85,.2,1)', fill: 'forwards' }).finished;
  location.href = href;
}
addEventListener('pageshow', (e) => {                              // back from the reader without a reload: the page is put right again and shows the new place
  if (!e.persisted) return; if (S.leave) { if (S.leave.from) S.leave.from.style.visibility = ''; S.leave = null; } hold(null); $('#fly')?.remove(); document.body.classList.remove('leaving');
  rec.fresh(); for (const b of books) if (!b.job) { progress(b); paint(b); } arrange(); hero(); rec.sync();
});

function focus(b) { if (!b) return; if (S.view === 'shelf') hold(b); if (S.at) { S.at.el.firstChild.tabIndex = -1; S.at.el.classList.remove('at'); } S.at = b; const a = b.el.firstChild; a.tabIndex = 0; b.el.classList.add('at'); a.focus({ preventScroll: true });
  b.el.scrollIntoView({ block: 'nearest', behavior: still ? 'auto' : 'smooth' }); }
function step(dx, dy) {
  const cur = S.list.includes(S.at) ? S.at : null; if (!cur) return focus(S.list[0]);
  if (dx) return focus(S.list[clamp(S.list.indexOf(cur) + dx, 0, S.list.length - 1)]);
  const far = S.list.filter((b) => (dy > 0 ? b.y > cur.y + 4 : b.y < cur.y - 4)); if (!far.length) return;
  const ry = dy > 0 ? Math.min(...far.map((b) => b.y)) : Math.max(...far.map((b) => b.y)); focus(far.filter((b) => b.y === ry).reduce((a, b) => (Math.abs(b.x - cur.x) < Math.abs(a.x - cur.x) ? b : a)));
}
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return; const k = e.key, typing = e.target === q;
  if (k === 'Escape') { if (S.sel) select(null); else if (S.q) { q.value = S.q = ''; arrange(); } if (typing) q.blur(); return; }
  if (typing) { if (k === 'ArrowDown' || k === 'Enter') { e.preventDefault(); focus(S.list[0]); } return; }
  if (k === '/' || (k.length === 1 && /[\p{L}\p{N}]/u.test(k) && !e.target.closest('button, a.read, a.disc, a.vol'))) { if (k === '/') e.preventDefault(); q.focus(); return; }   // just start typing: it goes to the search
  if (k === 'ArrowRight') step(1, 0); else if (k === 'ArrowLeft') step(-1, 0); else if (k === 'ArrowDown') step(0, 1); else if (k === 'ArrowUp') step(0, -1);
  else if (k === ' ' && S.at && e.target === S.at.el.firstChild) select(S.at);
  else if (k === 'Enter' && S.at && e.target === S.at.el.firstChild && !S.at.href) select(S.at);
  else if (k === '-' || k === '=' || k === '+') $(`#size [data-d="${k === '-' ? -1 : 1}"]`).click(); else return;
  e.preventDefault();
});
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { first = true; hero(); arrange(); }, 120); });
addEventListener('pointermove', (e) => { S.ptr = [e.clientX, e.clientY]; S.mouse = e.pointerType === 'mouse'; });

// ---------- light ----------
const glass = makeCover(), glassH = makeCover(), css = getComputedStyle(root), TONE = Object.fromEntries(['accent', 'ink', 'deep'].map((k) => [k, css.getPropertyValue('--' + k).trim()])); let hx = 0, hy = 0, lit = false;   // lit: the case has been shown, so its books may be set on it
if (shelf) field.prepend(shelf.el);
function frame(time, dms) {
  const dt = Math.min(0.05, dms / 1000), k = 1 - Math.exp(-dt * 5), r = HB.vol?.getBoundingClientRect(), near = r && r.bottom > 0;
  if (near && !still) {                                           // the book you are in leans toward the pointer; left alone its light keeps moving a little
    const want = S.hover ? [0, 0] : [clamp((S.ptr[0] - (r.left + r.width / 2)) / (innerWidth * 0.4), -1, 1), clamp((S.ptr[1] - (r.top + r.height / 2)) / (innerHeight * 0.5), -1, 1)];
    hx += (want[0] + Math.sin(time * 0.5) * 0.12 - hx) * k; hy += (want[1] - hy) * k;
    HB.vol.style.transform = `rotateY(${(-16 + hx * 12).toFixed(2)}deg) rotateX(${(-hy * 6).toFixed(2)}deg)`; glassH?.draw([hx * 1.5, hy * 1.5], [hx, hy]);
  }
  if (S.hover && S.view !== 'shelf') glass?.draw([S.tx * 1.4, S.ty * 1.4], [S.tx, S.ty]);
  const out = S.leave?.t ? clamp((time - S.leave.t) / 0.6) : 0;
  if (shelf) { const f = field.getBoundingClientRect(), on = field.dataset.view === 'shelf';   // the view that is on the page, which a turn changes a moment after the press. In a list the shelves draw only the slab's own shelf
    if (S.hover?.hand && !S.hover.face && S.hover.nx != null) { const cx = Math.round(clamp(S.hover.hand[0], 0, Math.max(0, S.W - 300)) - S.hover.nx); if (cx !== S.hover.cx) S.hover.el.style.setProperty('--cx', (S.hover.cx = cx) + 'px'); }   // the words under a held book start where its cover starts
    if (f.bottom > -300 && f.top < innerHeight + 700) shelf.draw(!lit ? [] : HB.also.length ? books.concat(HB.also) : books, { time, dt, still, top: -f.top, left: f.left, fieldH: f.height, W: S.W, pad: S.pad, lines: (S.sill == null ? [] : [{ y: S.sill, d: 14 }]).concat(on ? S.lines : []), out: S.turn, hover: S.hover, tx: S.tx, ptr: S.ptr, mouse: S.mouse,
      leave: S.leave ? (S.leave.from ? { b: null, e: clamp(out * 2) } : S.leave) : null, accent: TONE.accent, ink: TONE.ink, deep: TONE.deep }); }
}

const state0 = (b) => state(b) === 'reading';
[...books.filter(state0).slice(0, 6), ...books.slice(0, 1)].forEach(world4);   // colours for the books most likely to be on top; the case does not wait for them
await Promise.race([met, wait(150)]); for (const b of books) progress(b);   // with the other devices' places in hand the slab is built once, for the right book
for (const b of books) slot(b);
hero(); arrange(); gsap.ticker.add(frame);
await room; await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); root.classList.remove('wait'); lit = true;   // the whole case is drawn before any of it is shown; lettering its spines would only hold that back
if (!still) { S.list.slice(0, 40).forEach((b, i) => b.el.firstChild.style.setProperty('--i', i)); document.body.classList.add('intro'); setTimeout(() => document.body.classList.remove('intro', 'back'), 1600);
  let back = null; try { back = JSON.parse(sessionStorage.getItem('eastroom:back')); sessionStorage.removeItem('eastroom:back'); } catch {}
  if (back && Date.now() - back.t < 9000 && HB.b?.slug === back.slug) document.body.classList.add('back'); }   // the book you were just in is set down first
rec.watch(() => {                                                // Home was met: other devices' places may have arrived
  const was = books.map((b) => b.read + ':' + b.last).join(); for (const b of books) if (!b.job) { progress(b); paint(b); }
  if (was !== books.map((b) => b.read + ':' + b.last).join()) { arrange(); hero(); } homeLine();
});
addEventListener('visibilitychange', () => { if (!document.hidden) rec.sync(); });
setInterval(homeLine, 30000); homeLine();
{ const was = books.map((b) => b.read + ':' + b.last).join(); for (const b of books) if (!b.job) { progress(b); paint(b); } if (was !== books.map((b) => b.read + ':' + b.last).join()) { arrange(); hero(); } }   // Home may have answered while the page was being built
holdText([...books].filter((b) => state(b) !== 'done').sort(ORDER.recent[1]).map((b) => b.book), books.map((b) => b.book));   // the text of every unfinished book stays on this device, the one you are in first
if (Q.has('q')) { q.value = S.q = Q.get('q'); arrange(); }
window.library = { S, books, arrange, select, add, focus };
