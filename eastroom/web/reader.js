// East Room's reader: any book of the library as one continuous text. Reading is light.
// Nothing here knows a particular book: pictures, narration, key lines and headings are all optional.
import './carry.js';
import { prepareWithSegments, layoutNextLine } from './vendor/pretext/layout.js';
import { makeWorld, endpaper, titleRows } from './world.js';
import { sound } from './sound.js';
import { worldsFor } from './colour.js';
import * as rec from './state.js';
import { holdText, holdVoice, local, voiceOf, textUrl, recordUrl, soundUrl } from './hold.js';
import { canSpeak, RATE, ready, wake, hush, speak } from './voice.js';

const Q = new URLSearchParams(location.search), FOCUS = 0.35;
const $ = (s, at = document) => at.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const json = (u) => fetch(u).then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.status + ' ' + u))));
const image = (src) => new Promise((ok) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
const pref = (k, d) => { try { return JSON.parse(localStorage.getItem('eastroom:' + k)) ?? d; } catch { return d; } };   // what this device chose in Settings
const BARE = pref('bare', false), RECAP = !pref('norecap', false), SCALE = clamp(+pref('size', 1) || 1, 0.8, 1.4);
const root = document.documentElement, stage = $('#stage'), flow = $('#flow'), ruler = $('#ruler'), sheet = $('#book'), voice = $('#narrator'), ptr = el('i'), ghost = el('i'); ptr.id = 'ptr'; ghost.id = 'ptr2';

await Promise.race([rec.sync(), new Promise((ok) => setTimeout(ok, 1500))]);   // ask Home where the other devices are, but never wait long for it
let last = null; try { last = localStorage.getItem('eastroom:last'); } catch {}
const library = await json('api/library'), book = library.find((b) => b.slug === Q.get('book')) ?? library.find((b) => b.slug === last) ?? library[0];
if (!book) { location.replace('./'); await new Promise(() => {}); }
if (book.kind === 'pages') { location.replace(`pages.html?book=${encodeURIComponent(book.slug)}`); await new Promise(() => {}); }   // a book of pages has its own reader
const SLUG = book.slug, MEDIA = `media/${SLUG}/`, order = book.chapters.map((c) => c.id), worlds = await worldsFor(book);
let V = rec.view(SLUG, order);                                    // place, kept lines and finished parts, from every device's record
await Promise.all(['400 26px Literata', 'italic 400 22px Literata', '800 80px "Science Gothic"'].map((f) => document.fonts.load(f)));
document.title = `${book.title} · East Room`;
const total = book.chapters.reduce((a, c) => a + c.words, 0), chapters = new Map();
const held = new Map();                                            // narration this device holds, as local objects for the player
const holdNear = () => { for (const p of parts) for (const a of p.ch.audio) if (!held.has(a.src)) local(a.src).then((u) => u && held.set(a.src, u)); };
async function load(pi) {                                          // a part's text, and the best narration it has (storyteller, then recorded, then plain)
  const c = book.chapters[pi], ch = await json(textUrl(SLUG, c)), name = voiceOf(c);
  ch.audio = name ? await json(recordUrl(SLUG, c)).then((r) => r.audio.map((a) => ({ ...a, src: soundUrl(SLUG, c, a.src) })), () => []) : [];
  ch.voice = ch.audio.length ? name : null;
  await Promise.all(ch.audio.map(async (x) => { const u = !held.has(x.src) && await local(x.src); if (u) held.set(x.src, u); }));   // known before the first word is spoken, so a held sound is never asked from Home
  return ch;
}
const chapter = (pi) => chapters.get(pi) ?? chapters.set(pi, load(pi).catch((e) => { setTimeout(() => chapters.delete(pi), 3000); throw e; })).get(pi);   // a failed load may be tried again

// ---------- what a part looks like: its pictures, or an endpaper made for it when it has none ----------
const looks = new Map();
function look(src) {
  if (looks.has(src)) return looks.get(src);
  const pic = MEDIA + src, depth = pic.replace(/\.\w+$/, '.depth.preview.png'), l = { pic, depth, near: 0.4 }; looks.set(src, l);
  image(depth).then((dep) => {                                    // where the picture's far wall ends: halfway between it and the split that best separates the depths
    if (!dep) return; const c = new OffscreenCanvas(64, 64).getContext('2d'), hist = new Array(64).fill(0);
    c.drawImage(dep, 0, 0, 64, 64); const d = c.getImageData(0, 0, 64, 64).data; for (let i = 0; i < d.length; i += 4) hist[d[i] >> 2]++;
    let best = 0, sumB = 0, wB = 0; const sum = hist.reduce((a, n, i) => a + n * i, 0);
    hist.forEach((n, i) => { wB += n; sumB += n * i; const wF = 4096 - wB; if (!wB || !wF) return; const v = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2; if (v > best) { best = v; l.near = ((i + 1) + sumB / wB) / 128; } });
  });
  return l;
}
// ---------- measures ----------
const M = {};
function metrics() {
  const wide = innerWidth >= 900;
  Object.assign(M, { wide, fs: Math.round((wide ? 26 : 20) * SCALE), lh: Math.round((wide ? 43 : 33) * SCALE), qfs: Math.round((wide ? 22 : 18) * SCALE), qlh: Math.round((wide ? 36 : 30) * SCALE), col: Math.min(700, innerWidth - 40), focus: innerHeight * FOCUS });
  M.left = (innerWidth - M.col) / 2; M.spill = wide ? clamp(M.left - 40, 0, 230) : 0;
  for (const [k, v] of [['fs', M.fs], ['lh', M.lh], ['qfs', M.qfs], ['qlh', M.qlh], ['col', M.col], ['spill', M.spill]]) root.style.setProperty('--' + k, v + 'px');
}

// ---------- line breaking: full lines that end where the sense ends ----------
const LEAN = /\s(?:a|an|the|of|to|in|on|and|or|but|for|with|by|at|as|that|his|her|their|its|is|was|he|she|who|which)$/i;
const LEANS = /\s(?:for|of|to|in|on|with|by|at|as|and|or|but|that|who|which|when|a|an|the|his|her|their)(?=\s)/gi;
function sense(prep, ln, tail) {
  const t = ln.text.trimEnd(); let cut = -1;
  for (const m of t.matchAll(/[,;:.!?][”’"')\]]*\s|—/g)) { const e = m.index + m[0].length; if (e >= t.length * 0.62 && e < t.length - 1) cut = e; }
  if (cut < 0) { const m = LEAN.exec(t); if (m && m.index > t.length * 0.5) cut = m.index + 1; }   // never end a line on a word that leans forward
  if (cut < 0 && /^[^.!?]{0,14}[.!?]/.test(tail)) {             // the sentence would end a word or two into the next line: carry its last phrase down whole
    let run = -1, end = -1; for (const m of t.matchAll(LEANS)) { if (m.index !== end) run = m.index; end = m.index + m[0].length; if (run >= t.length * 0.45) cut = run + 1; }
  }
  if (cut < 0 || ln.start.graphemeIndex) return ln;
  let w = 0, n = 0; for (let i = ln.start.segmentIndex; n < cut && i < prep.segments.length; i++) { n += prep.segments[i].length; w += prep.widths[i]; }
  const alt = layoutNextLine(prep, w + 0.5, ln.start);
  return alt && alt.text.trimEnd() === t.slice(0, cut).trimEnd() ? alt : ln;
}
function setLines(text, font, w, host) {
  const prep = prepareWithSegments(text, font), out = []; let cur, pos = 0;
  for (;;) {
    let ln = layoutNextLine(prep, w, cur); if (!ln) break;
    if (layoutNextLine(prep, w, ln.end)) { const a = text.indexOf(ln.text.trim(), pos); ln = sense(prep, ln, text.slice(a + ln.text.trim().length).trimStart()); }
    const t = ln.text.trim(), at = Math.max(pos, text.indexOf(t, pos)), e = el('div', 'ln', t);
    host.append(e); out.push({ el: e, c0: at, c1: at + t.length }); pos = at + t.length; cur = ln.end;
  }
  return out;
}

// ---------- the page: parts are added as the reader reaches them ----------
const W = [], LN = [], parts = [], beats = [], panels = [], scenes = [];
const weight = (s) => 0.6 + Math.min(s.length, 12) / 10 + (/[.,;:!?—]["”’]?$/.test(s) ? 0.9 : 0);
function stack(text, words) {                                      // [first char, last char, words] of each row: rows of about the same length, none longer than the column holds at a heading's smallest size
  const most = clamp(Math.floor((M.col + M.spill * 0.5) / 22), 10, 38), n = Math.ceil(text.length / most), per = text.length / n, rows = []; let row = [];
  for (const w of words) { if (row.length && rows.length < n - 1 && w[1] + w[0].length - row[0][1] > per + 3) { rows.push(row); row = []; } row.push(w); }
  if (row.length) rows.push(row);
  return rows.map((r) => [r[0][1], r.at(-1)[1] + r.at(-1)[0].length, r]);
}
function addPart(pi, ch) {
  const w = worlds[pi], sec = el('section', 'part'), opener = el('header', 'opener'), col = el('div', 'col');
  for (const k of ['ground', 'deep', 'ink', 'accent']) sec.style.setProperty('--' + k, w[k]);
  sec.append(opener, col); flow.append(sec);
  const part = { pi, ch, w, sec, g0: W.length, keys: [], heads: [], order: [] }, firstOf = new Map(); parts.push(part);
  const title = el('h1', 'sr', ch.title); opener.append(title);
  let panel = null, bid = null;
  const line = (e, kind, words, c0 = 0) => {                      // register one line and the words that start in it
    const l = { el: e, i: LN.length, kind, quote: !!e.closest('.quote'), part, g0: W.length, top: 0, h: 0, left: 0, xs: null }; e._l = l; LN.push(l);
    for (const [s, a] of words) W.push({ s, ln: l, a: a - c0, b: a - c0 + s.length, part, bid, wt: weight(s) * (kind === 'h' ? 2 : 1), time: null });
    l.g1 = W.length; return l;
  };
  ch.blocks.forEach((b, bi) => { bid = b.id;
    const hard = b.t.split('\n').map((x) => x.replace(/\s+/g, ' ').trim());                         // lines the author broke: verse, letters; an empty one is a stanza break
    const text = hard.filter(Boolean).join(' '), words = [...text.matchAll(/\S+/g)].map((m) => [m[0], m.index]);
    if (b.k === 'f' || b.k === 't') {                                // the book's own pictures and tables stand where the author put them; a caption is read like any line
      if (BARE) return; panel = null; const fig = el('figure', b.k === 'f' ? 'fig' : 'fig tbl');
      if (b.k === 'f') { const im = el('img'), see = el('button', 'see'); Object.assign(im, { width: b.w, height: b.h, alt: b.alt || text, loading: 'lazy', decoding: 'async', src: `${MEDIA}${b.src}?v=${book.chapters[pi].v}` });
        see.setAttribute('aria-label', 'Show this picture larger'); see.style.setProperty('--ar', (b.w / b.h).toFixed(4)); see.append(im); see.onclick = () => zoom(im.src, im.alt); fig.append(see); }
      else { const t = el('table'), wrap = el('div', 'scroll'); for (const r of b.rows) { const tr = el('tr'); for (const c of r) tr.append(el(r === b.rows[0] ? 'th' : 'td', '', c)); t.append(tr); } wrap.tabIndex = 0; wrap.append(t); fig.append(wrap); }
      col.append(fig);
      if (words.length) { firstOf.set(b.id, W.length); const c = el('figcaption', 'ln', text); fig.append(c); line(c, 'a', words); }
      return;
    }
    if (!words.length) return;
    firstOf.set(b.id, W.length);
    if (bi === 0 && b.k === 'h' && text.toLowerCase() === ch.title.replace(/\s+/g, ' ').trim().toLowerCase()) { title.textContent = text; title.classList.add('ln'); line(title, 'h', words); return; }   // the part's own title line is the poster; any other first heading stays on the page
    if (b.k === 'h') { panel = null; const rows = stack(text, words), h = el('h2', rows.length > 1 ? 'stack' : 'beat ln', rows.length > 1 ? null : text); col.append(h);   // a long heading stands in rows, each reaching across the column
      const ls = rows.length > 1 ? rows.map(([c0, c1, mine]) => line(h.appendChild(el('span', 'beat ln', text.slice(c0, c1))), 'h', mine, c0)) : [line(h, 'h', words)];
      beats.push(...ls); part.heads.push(...ls); part.order.push({ el: h, g0: ls[0].g0, head: true }); return; }
    if (b.k === 'a') { const c = el('cite', 'ln', text); (panel || col).append(c); line(c, 'a', words); panel = null; return; }
    const quote = b.k === 'q', host = el('div', quote ? 'blk quote' : 'blk'); host.setAttribute('role', quote ? 'blockquote' : 'paragraph'); col.append(host); panel = quote ? host : null;
    if (quote) panels.push({ el: host, top: 0 }); else part.order.push({ el: host, g0: W.length, head: false });
    const width = quote ? Math.min(M.col * 0.86 + M.spill, innerWidth - 40) - (M.wide ? 100 : 48) : M.col;
    const lines = []; let k = 0, off = 0, gap = false;
    for (const piece of hard) { if (!piece) { gap = lines.length > 0; continue; }
      for (const ln of setLines(piece, quote ? `italic 400 ${M.qfs}px Literata` : `400 ${M.fs}px Literata`, width, host)) { ln.c0 += off; ln.c1 += off; if (gap) { ln.el.classList.add('gap'); gap = false; } lines.push(ln); }
      off += piece.length + 1; }
    for (const ln of lines) { const mine = []; while (k < words.length && (words[k][1] < ln.c1 || ln === lines.at(-1))) mine.push(words[k++]); line(ln.el, b.k, mine, ln.c0); }
    for (const tk of ch.takeaways || []) if (tk.block === b.id) {                // the author's own key lines, where the book has them
      const q = tk.quote.replace(/\s+/g, ' ').trim(), at = text.indexOf(q); if (at < 0) continue;
      const g0 = firstOf.get(b.id) + words.findIndex((x) => x[1] >= at), g1 = firstOf.get(b.id) + words.filter((x) => x[1] < at + q.length).length;
      part.keys.push({ g0, g1, kept: false, tick: null });
    }
    if (b.n && !BARE) for (const t of b.n) { const d = el('details', 'note'); d.append(el('summary', '', 'Note'), el('p', '', t)); d.addEventListener('toggle', () => measure()); (quote ? host : col).append(d); }   // the author's note, beside the sentence that points to it
  });
  if (W.length === part.g0) { title.textContent = ch.title.trim() || '·'; title.classList.add('ln'); line(title, 'h', [...title.textContent.matchAll(/\S+/g)].map((m) => [m[0], m.index])); }   // a part with no text still gives the reading point a place
  part.g1 = W.length; recap(part);
  for (const key in V.kept) { const [c, w0, n] = key.split(':'); if (c === ch.id) mark(key, part.g0 + +w0, +n); }   // the lines you kept, from any device
  // narration, where the book has it: each recorded sentence lays its word times over the next words of its block
  const used = new Map(); let spoken = 0, secs = 0;
  for (const seg of ch.audio || []) for (const s of seg.sentences) {
    const first = firstOf.get(s.b); if (first === undefined) continue;
    const u = used.get(s.b) || 0, cnt = s.t.trim().split(/\s+/).length, src = seg.src;
    for (let k = 0; k < cnt && W[first + u + k]; k++) W[first + u + k].time = { src, at: s.w?.[k] ?? s.s + ((s.e - s.s) * k) / cnt, end: s.e };
    used.set(s.b, u + cnt); spoken += cnt; secs += s.e - s.s;
  }
  part.narr = secs > 30 ? (spoken / secs) * 60 : 170;
  const mean = W.slice(part.g0).reduce((a, x) => a + x.wt, 0) / Math.max(1, W.length - part.g0); for (let g = part.g0; g < W.length; g++) W[g].wt /= mean;
  // where the room changes picture: at headings, and between paragraphs in long stretches that have none
  const gal = ch.gallery?.length ? ch.gallery : ch.art ? [ch.art] : []; part.looks = gal.length ? gal.map((a) => look(a.src)) : [endpaper(pi + 1)];
  const due = gal.filter((a) => a.credit);                        // whose pictures these are, once, where the part ends
  if (due.length && !BARE) { const c = el('p', 'credit', due.length > 1 ? 'Pictures: ' : 'Picture: '); due.forEach((a, i) => { const t = a.credit.replace(/\.$/, ''); c.append(i ? ' · ' : '', String(a.page).startsWith('https://commons.wikimedia.org/') ? Object.assign(el('a', '', t), { href: a.page, target: '_blank', rel: 'noopener' }) : t); }); col.append(c); }
  part.stops = []; let last = part.g0;
  part.order.forEach((b, i) => {
    if (b.head) { part.stops.push(b); last = b.g0; return; }
    if (part.looks.length < 2 || b.g0 - last < 900 || part.g1 - b.g0 <= 300) return;
    const head = part.order.slice(i + 1).find((x) => x.head); if (!head || head.g0 - b.g0 > 300) { part.stops.push(b); last = b.g0; }
  });
  // headings: one size each, so that at full weight they reach across the column
  const fits = (b) => { b.el.style.fontVariationSettings = "'wght' 900"; b.el.style.fontSize = '100px'; return 100 * (M.col + M.spill * 0.5) / b.el.offsetWidth; };
  for (const b of part.heads) { const rows = b.el.parentNode.className === 'stack' ? part.heads.filter((x) => x.el.parentNode === b.el.parentNode) : null;
    if (!rows) b.el.style.fontSize = clamp(fits(b), 30, 170).toFixed(1) + 'px';
    else if (rows[0] === b) { const px = clamp(Math.min(...rows.map(fits)), 14, 64).toFixed(1) + 'px'; for (const r of rows) r.el.style.fontSize = px; } }   // the rows of a long heading share the size its longest row can have
  measure(); buildRuler();
  return part;
}
const place = (e) => { let x = 0, y = 0; for (; e && e !== flow; e = e.offsetParent) { x += e.offsetLeft; y += e.offsetTop; } return [x, y]; };   // from the layout itself: the page is drawn a little small while it arrives, and a rectangle measured then would be wrong for good
function measure() {
  const top = (e) => place(e)[1];
  for (const l of LN) { [l.left, l.top] = place(l.el); l.h = l.el.offsetHeight; l.xs = null; }
  for (const p of panels) { p.top = top(p.el); p.h = p.el.offsetHeight; }
  scenes.length = 0;
  for (const p of parts) { p.top = top(p.sec);
    scenes.push({ part: p, w: p.w, poster: true, top: p.top, look: p.looks[0] });
    p.stops.forEach((s, i) => scenes.push({ part: p, w: p.w, poster: false, top: top(s.el) - M.lh * (s.head ? 1.6 : 0.62), look: p.looks[(i + 1) % p.looks.length] })); }
  scenes.forEach((s, i) => { s.end = scenes[i + 1]?.top ?? flow.offsetHeight; });
}
function xs(l) {                                                  // where each word of a line starts and ends
  if (l.xs) return l.xs; const node = l.el.firstChild, r = document.createRange(), box = l.el.getBoundingClientRect(), x0 = box.left, k = box.width > 2 ? l.el.offsetWidth / box.width : 1; l.xs = [];   // k undoes any scale the page is drawn at
  for (let g = l.g0; g < l.g1; g++) { r.setStart(node, Math.min(W[g].a, node.length)); r.setEnd(node, Math.min(W[g].b, node.length)); const b = r.getBoundingClientRect(); l.xs.push((b.left - x0) * k, (b.right - x0) * k); }
  if (!l.xs.length) l.xs.push(0, 0);
  return l.xs;
}
function lineAt(y) { let a = 0, b = LN.length - 1; while (a < b) { const m = (a + b + 1) >> 1; if (LN[m].top <= y) a = m; else b = m - 1; } return LN[a]; }
async function openAt(pi, w = 0, play = false) {                  // start the page again at a part
  const gen = S.gen = (S.gen || 0) + 1, ch = await chapter(pi).catch(() => null);
  if (!ch || gen !== S.gen) return;                               // a failed load keeps the page you have; a newer request wins
  setFlow(false); flow.replaceChildren(ptr, ghost); W.length = LN.length = parts.length = beats.length = panels.length = scenes.length = 0; kept.clear(); mine.clear(); marks.clear(); V = rec.view(SLUG, order);
  S.now = S.part = S.titled = S.pl = null;
  const p = addPart(pi, ch); S.g = clamp(p.g0 + w, p.g0, p.g1 - 1); S.f = 0; stage.scrollTop = w > 0 ? W[S.g].ln.top - M.focus : p.top; lenis.resize();
  if (play) setFlow(true);
}
function extend() {                                               // the next part is put on the page while the reader is still in this one
  const next = parts.at(-1).pi + 1; if (S.adding || next >= book.chapters.length) return;
  S.adding = chapter(next).then((ch) => { if (parts.at(-1)?.pi === next - 1) { addPart(next, ch); lenis.resize(); } }).catch(() => {}).then(() => { S.adding = null; });
}
function jump(pi, w = 0) { const p = parts.find((x) => x.pi === pi); return p ? go(p.g0 + w) : openAt(pi, w); }

// ---------- instruments ----------
const kept = new Highlight(), mine = new Highlight(), marks = new Map(); CSS.highlights.set('kept', kept); CSS.highlights.set('mine', mine);
function ranges(a, b) {                                           // the text from word a to word b, one range per line
  const out = []; for (let i = a.ln.i; i <= b.ln.i; i++) { const l = LN[i], node = l.el.firstChild, r = new Range();
    r.setStart(node, l === a.ln ? a.a : 0); r.setEnd(node, l === b.ln ? Math.min(b.b, node.length) : node.length); out.push(r); }
  return out;
}
function mark(key, g0, n) { const a = W[g0], b = W[g0 + n - 1]; if (!a || !b || a.part !== b.part || marks.has(key)) return; const rs = ranges(a, b); for (const r of rs) mine.add(r); marks.set(key, rs); }
const ENDS = /[.!?]["”’)\]]*$/; let said;
function sentence(g) {                                            // first and last word of the sentence a word is in, never leaving its paragraph
  let a = g, b = g; const p = W[g].part;
  while (a > p.g0 && W[a - 1].bid === W[a].bid && !ENDS.test(W[a - 1].s)) a--;
  while (b < p.g1 - 1 && W[b + 1].bid === W[b].bid && !ENDS.test(W[b].s)) b++;
  return [a, b];
}
function keepLine() {                                             // keep, or release, the sentence the reading point is in
  if (!W.length || document.body.classList.contains('map')) return; const p = W[S.g].part, [a, b] = sentence(S.g);
  const key = `${p.ch.id}:${a - p.g0}:${b - a + 1}`, had = marks.get(key), btn = $('#keep');
  if (had) { for (const r of had) mine.delete(r); marks.delete(key); rec.release(SLUG, key); } else { mark(key, a, b - a + 1); rec.keepLine(SLUG, key, W.slice(a, b + 1).map((x) => x.s).join(' ')); sound('key'); }
  recap(p); measure(); btn.textContent = had ? 'Released' : 'Kept'; clearTimeout(said); said = setTimeout(() => { btn.textContent = 'Keep'; }, 1400);
}
// what a part leaves you with: the author's key lines and the lines you kept, where the part ends
function recap(part) {
  if (!RECAP) return; V = rec.view(SLUG, order);
  const keys = (part.ch.takeaways || []).map((t) => t.quote.replace(/\s+/g, ' ').trim()), yours = Object.entries(V.kept).filter(([k]) => k.startsWith(part.ch.id + ':')).sort((a, b) => a[0].split(':')[1] - b[0].split(':')[1]).map(([, e]) => e.exact).filter(Boolean);
  const box = part.carry ??= part.sec.appendChild(el('aside', 'carry')), list = (items, cls) => { const ul = el('ul', cls); for (const t of items) ul.append(el('li', '', t)); return ul; };
  box.hidden = !keys.length && !yours.length; box.replaceChildren();
  if (keys.length) box.append(el('h3', '', 'This part said'), list(keys, 'said'));
  if (yours.length) { const a = el('a', '', 'All your kept lines'); a.href = 'ideas.html#' + SLUG; box.append(el('h3', '', 'You kept'), list(yours, 'yours'), a); }
}
const lens = el('dialog'); lens.id = 'lens'; lens.onclick = () => lens.close(); document.body.append(lens);
function zoom(src, alt) { const im = el('img'); im.src = src; im.alt = alt; lens.replaceChildren(im); lens.showModal(); }
function buildRuler() {
  ruler.replaceChildren(); ruler.classList.toggle('many', book.chapters.length > 120);
  book.chapters.forEach((c, i) => {
    const s = el('button', 'seg'), w = worlds[i], part = parts.find((p) => p.pi === i); s.tabIndex = -1; s.setAttribute('aria-label', `Part ${i + 1}: ${c.title}`);
    s.style.cssText = `--w:${c.words};--g:${w.ground};--a:${w.accent};--open:${Math.round(total * 0.75)}`; s.dataset.t = c.title; s.dataset.n = String(i + 1).padStart(2, '0');
    if (part) {
      part.seg = s; s.append(el('span', 'fill'));
      const at = (g) => ((g - part.g0) / (part.g1 - part.g0)).toFixed(4);
      for (const h of part.heads) { const t = el('i', 'tk'); t.style.setProperty('--at', at(h.g0)); s.append(t); }
      for (const k of part.keys) { k.tick = el('i', 'tk key' + (k.kept ? ' on' : '')); k.tick.style.setProperty('--at', at(k.g1)); s.append(k.tick); }
      s.append(el('i', 'needle'));
    }
    s.onclick = (e) => { if (!part || S.part !== part) return jump(i);
      const r = s.getBoundingClientRect(); go(part.g0 + Math.round(clamp((e.clientX - r.left) / r.width) * (part.g1 - part.g0 - 1))); };
    s.classList.toggle('done', S.part ? i < S.part.pi : false); ruler.append(s);
  });
  S.part?.seg.classList.add('here');
}
function enter(part) {                                            // the reading point crossed into another part
  const first = !S.part, prev = S.part; prev?.seg?.classList.remove('here'); S.part = part; part.seg.classList.add('here');
  if (prev && part.pi === prev.pi + 1) done(prev);                // read through into the next part: the one behind is finished
  for (const k of ['ground', 'deep', 'ink', 'accent']) root.style.setProperty('--' + k, part.w[k]);
  try { localStorage.setItem('eastroom:w', JSON.stringify({ ground: part.w.ground, deep: part.w.deep, ink: part.w.ink, accent: part.w.accent })); } catch {}   // the next page opens in these colours before anything has loaded
  [...ruler.children].forEach((s, i) => s.classList.toggle('done', i < part.pi));
  const n = $('#count b'); n.textContent = String(part.pi + 1).padStart(2, '0'); $('#count i').textContent = '/ ' + book.chapters.length; $('#count span').textContent = part.ch.title;
  const layer = part.ch.audio.length && !part.lost ? part.ch.voice : canSpeak ? 'device' : null, vb = $('#voice');
  vb.hidden = !layer; vb.classList.toggle('over', tooFast(part)); vb.title = layer ? `Voice: ${LAYERS[layer]}` : '';
  if (layer && S.voice && layer !== S.layer && (S.layer || layer === 'device')) note(layer === 'device' && /iPhone/.test(navigator.userAgent) ? 'Using the phone’s own voice. If you hear nothing, turn off silent mode.' : `Voice: ${LAYERS[layer]}`);
  S.layer = layer; holdVoice(book, part.pi).then(holdNear);
  if (!first && !still) { gsap.fromTo(n, { yPercent: 70, scaleY: 1.5 }, { yPercent: 0, scaleY: 1, duration: 0.9, ease: 'elastic.out(1, 0.55)' }); sound('part'); }
  tally();
}
function keep(k, show) {                                          // a key line has been read: mark it and pay it into the ruler
  k.kept = true; for (const r of ranges(W[k.g0], W[k.g1 - 1])) kept.add(r);
  const pop = () => { k.tick?.classList.add('on'); if (show && !still && k.tick) gsap.fromTo(k.tick, { scale: 5 }, { scale: 1, duration: 0.9, ease: 'elastic.out(1, 0.4)' }); if (show) sound('key'); tally(); };
  if (!show || still || !k.tick) return pop();
  const to = k.tick.getBoundingClientRect(), dot = el('i', 'spark'); document.body.append(dot);
  gsap.fromTo(dot, { x: S.lx, y: S.ly, scale: 0.4 }, { x: to.left + 2, y: to.top + 2, scale: 1, duration: 0.7, ease: 'power2.in', onComplete() { dot.remove(); pop(); } });
}
const LAYERS = { storyteller: 'the storyteller', recorded: 'the narrator', plain: 'the plain voice', device: 'this device’s own voice' };
const tooFast = (p) => S.wpm > (p.ch.audio.length && !p.lost ? p.narr * 3 : RATE * 2);   // past this the voice steps aside and the light leads alone
rec.watch(() => { if (rec.home.full) note('This device is out of storage. Your last change is not saved yet.'); });
function note(text) { let n = $('#note'); if (!n) { n = el('div'); n.id = 'note'; n.setAttribute('role', 'status'); document.body.append(n); } n.textContent = text; n.classList.add('on'); clearTimeout(n.t); n.t = setTimeout(() => n.classList.remove('on'), 6000); }
function done(p) { if (V.done[p.ch.id]?.v) return; V.done[p.ch.id] = { v: true }; rec.setDone(SLUG, p.ch.id); }
function tally() { const p = S.part; if (p) $('#clock em').textContent = p.keys.length ? `${p.keys.filter((k) => k.kept).length} of ${p.keys.length} key lines` : ''; }
function clock() {
  const p = S.part, map = document.body.classList.contains('map');
  const left = map ? book.chapters.slice(p.pi + 1).reduce((a, c) => a + c.words, p.g1 - S.g) : p.g1 - S.g, mins = Math.ceil(left / S.wpm);
  const big = map && mins >= 90 ? Math.round(mins / 60) : mins, label = (map && mins >= 90 ? 'hours' : 'min') + ' left<br>in ' + (map ? 'the book' : 'this part');
  if (big + label !== S.clock) { S.clock = big + label; $('#clock b').textContent = big; $('#clock span').innerHTML = label; }
}

// ---------- the book: every part as its own small poster, on one sheet ----------
const pictured = worlds.some((w) => w.thumb);
const cards = book.chapters.map((c, i) => {
  const w = worlds[i], b = el('button', w.thumb ? 'card pic' : 'card'); b.style.cssText = `--g:${w.ground};--a:${w.accent};--i:${w.ink};--d:${w.deep}`;
  if (w.thumb) { const im = el('img'); im.loading = 'lazy'; im.alt = ''; im.src = `${MEDIA}thumbs/${c.id}.jpg`; b.append(im); }
  b.append(el('b', '', String(i + 1).padStart(2, '0')), el('i', '', Math.max(1, Math.round(c.words / 250)) + ' min'), el('span', '', c.title)); if (!w.thumb) b.append(el('p'));
  b.onclick = () => { showBook(false); jump(i); }; sheet.append(b); return b;
});
let began = false;
async function beginnings() {                                     // a part without a picture shows how it begins, in the author's own words
  if (began || cards.length > 150) return; began = true;
  const from = S.part?.pi || 0, near = cards.map((_, i) => i).sort((a, b) => Math.abs(a - from) - Math.abs(b - from));
  for (const i of near) { if (worlds[i].thumb) continue;
    const ch = await json(textUrl(SLUG, book.chapters[i])).catch(() => null), t = ch?.blocks.find((b) => b.k !== 'h' && b.t.trim())?.t.replace(/\s+/g, ' ').trim() || '';
    $('p', cards[i]).textContent = t.slice(0, 260); }
}
function showBook(on) {
  if (on === document.body.classList.contains('map')) return;
  if (on) setFlow(false);
  document.body.classList.toggle('map', on); $('#map').setAttribute('aria-pressed', on); stage.inert = on; sound('book');
  if (!on) return void $('#map').focus({ preventScroll: true });
  // the largest cards that still show the whole book on one screen; a book too long for that (or a phone) scrolls instead
  const wd = sheet.clientWidth - 12, ht = sheet.clientHeight - 12, n = cards.length, gap = 8, wide = (c) => (wd - gap * (c - 1)) / c; let cols = 0, size = 0;
  const shape = pictured ? 1.22 : 1.72, least = pictured ? 128 : 236, most = pictured ? 1e4 : 420;   // a card of words is wider than a card with a picture, and never stretched
  for (let c = 1; c <= n; c++) { const w = wide(c), rows = Math.ceil(n / c); if (w <= most && rows * (w / shape) + gap * (rows - 1) <= ht && w > size) { size = w; cols = c; } }
  if (!cols) cols = Math.ceil(wd / most);
  if (size && size < least || !size && wide(cols) < least) cols = pictured ? Math.max(2, Math.floor(wd / 160)) : Math.max(1, Math.floor(wd / 290));
  sheet.toggleAttribute('data-list', cols === 1 && !pictured); sheet.style.setProperty('--cols', cols); sheet.style.setProperty('--row', cols === 1 && !pictured ? 'max-content' : (wide(cols) / shape).toFixed(1) + 'px'); beginnings();   // one column of words: each card as tall as what it says
  cards.forEach((c, i) => { c.classList.toggle('done', i < S.part.pi); c.classList.toggle('here', i === S.part.pi); });
  cards[S.part.pi].style.setProperty('--p', ((S.g - S.part.g0) / (S.part.g1 - S.part.g0)).toFixed(3));
  cards[S.part.pi].scrollIntoView({ block: 'center' });
  if (!still) { const segs = [...ruler.children];                 // each stripe of the ruler flies up and opens into its poster
    cards.forEach((c, i) => { const a = segs[i].getBoundingClientRect(), b = c.getBoundingClientRect();
      gsap.fromTo(c, { x: a.left - b.left, y: a.top - b.top, scaleX: a.width / b.width, scaleY: a.height / b.height, opacity: 0.3, transformOrigin: '0 0' },
        { x: 0, y: 0, scaleX: 1, scaleY: 1, opacity: 1, duration: 0.8, ease: 'expo.out', delay: Math.abs(i - S.part.pi) * 0.011, clearProps: 'transform,opacity' }); }); }
  cards[S.part.pi].focus({ preventScroll: true });
}

// ---------- state, flow and voice ----------
const S = { g: 0, f: 0, flowing: false, voice: true, wpm: 250, now: null, part: null, sy: 0, lx: innerWidth / 2, ly: innerHeight * FOCUS, power: 1, ptr: null, ptrAt: -1e9, titled: null, src: '', px: 0, pr: 0, pl: null, secs: 0, active: -1e9, sy0: -1 };
const lenis = new Lenis({ wrapper: stage, content: flow, lerp: 0.12, autoRaf: false });
const dur = (w) => (60000 / S.wpm) * w.wt;
function hear() {                                                 // the narrator's loudness moves the small meter on the Voice control, nothing else
  if (S.an || !window.AudioContext) return;
  const ac = new AudioContext(), an = ac.createAnalyser(); an.fftSize = 256; ac.createMediaElementSource(voice).connect(an); an.connect(ac.destination);
  S.an = an; S.buf = new Uint8Array(an.fftSize);
}
const lastPart = () => parts.at(-1).pi === book.chapters.length - 1;   // otherwise the next part is still on its way: wait, do not stop
function advance(dt) {
  const w = W[S.g];
  if (S.voice && !S.blocked && w.time && S.wpm <= w.part.narr * 3) {          // past three times her speed the narrator steps aside
    const t = w.time;
    if (S.src !== t.src || !S.playing) {                          // start or resume the recording at this word
      if (S.src !== t.src) { voice.src = held.get(t.src) || t.src; S.src = t.src; }
      voice.currentTime = t.at; voice.playbackRate = clamp(S.wpm / w.part.narr, 0.5, 3); hear(); S.playing = true; voice.play().catch(() => { S.blocked = true; }); S.f = 0;   // no sound allowed yet: keep pace silently
    } else {
      if (voice.paused && !voice.ended) voice.play().catch(() => {});
      const at = voice.currentTime;
      while (W[S.g + 1]?.time?.src === t.src && W[S.g + 1].time.at <= at) S.g++;
      const c = W[S.g].time, nx = W[S.g + 1]?.time?.src === c.src ? W[S.g + 1].time.at : c.end;
      S.f = clamp((at - c.at) / Math.max(0.05, nx - c.at));
      if ((voice.ended || at >= c.end) && W[S.g + 1]?.time?.src !== c.src) { if (W[S.g + 1]) { S.g++; S.f = 0; } else if (lastPart()) { setFlow(false); done(parts.at(-1)); } }
    }
  } else if (S.voice && canSpeak && !S.mute && !w.time && (!w.part.ch.audio.length || w.part.lost) && !tooFast(w.part)) {
    if (!voice.paused) voice.pause(); S.playing = false;
    const sp = S.say;
    if (!sp || S.g < sp.a || S.g > sp.b) {                        // speak from the reading point to the end of its sentence
      if (!ready()) return; const a = S.g, b = sentence(a)[1], me = S.say = { a, b, started: 0, words: false, over: false }; S.f = 0;
      speak(W.slice(a, b + 1).map((x) => x.s), S.wpm, { start() { me.started = performance.now(); }, word(i) { if (S.say === me) { me.words = true; S.g = Math.min(b, a + i); S.f = 0; } },
        end() { me.over = true; }, fail() { if (S.say === me) { S.say = null; S.mute = true; } } });   // not allowed to speak yet: the light leads alone until the next touch
    } else if (sp.over) { if (sp.b < W.length - 1) { S.g = sp.b + 1; S.f = 0; S.say = null; } else if (lastPart()) { S.say = null; setFlow(false); done(parts.at(-1)); } else S.f = 1; }
    else if (!sp.started) S.f = 0;                                // the voice has not begun: the light waits for it
    else if (sp.words) S.f = Math.min(1, S.f + (dt * 1000) / dur(w));   // between two reported words the light glides
    else if (performance.now() - sp.started > 350) { S.f += (dt * 1000) / dur(w); if (S.f >= 1) { if (S.g < sp.b) { S.g++; S.f = 0; } else S.f = 1; } }   // this device reports no words: move by pace and wait for the sentence to end
  } else {
    if (!voice.paused) voice.pause(); S.playing = false; if (S.say) quiet();
    S.f += (dt * 1000) / dur(w);
    if (S.f >= 1) { if (S.g < W.length - 1) { S.g++; S.f = 0; } else if (lastPart()) { setFlow(false); done(parts.at(-1)); } else S.f = 1; }
  }
}
function quiet() { hush(); S.say = null; }
function setFlow(on) {
  if (on === S.flowing) return;
  S.flowing = on; document.body.classList.toggle('flow', on); $('#play').setAttribute('aria-pressed', on); sound(on ? 'go' : 'stop');
  if (on) { S.sy = stage.scrollTop; lenis.stop(); } else { voice.pause(); S.playing = false; quiet(); lenis.start(); }
  awake();
}
function awake() {                                                // the screen stays on while the light leads
  if (S.flowing && !document.hidden) navigator.wakeLock?.request('screen').then((l) => { S.lock?.release(); S.lock = l; if (!S.flowing) l.release(); }, () => {});
  else { S.lock?.release(); S.lock = null; }
}
addEventListener('visibilitychange', awake);
function go(g, play = S.flowing) {                                // move the reading point to a word
  S.g = clamp(g, 0, W.length - 1); S.f = 0; voice.pause(); S.playing = false; quiet();
  if (play) setFlow(true); else lenis.scrollTo(S.g === W[S.g].part.g0 ? W[S.g].part.top : W[S.g].ln.top - M.focus, { duration: still ? 0 : 1.1 });
}
function setNow(l) {
  const prev = S.now; if (prev === l) return; S.now = l;
  const lo = prev ? Math.min(prev.i, l.i) : 0, hi = prev ? Math.max(prev.i, l.i) : LN.length - 1;
  for (let i = lo; i <= hi; i++) { LN[i].el.classList.toggle('read', i < l.i); LN[i].el.classList.toggle('now', i === l.i); }
  prev?.el.parentElement.classList.remove('cur'); l.el.parentElement.classList.add('cur');
}
// pace: a tape under a fixed needle. Drag it and it follows the hand; flick it and it carries on; it settles on a ten.
const pace = $('#pace'), strip = $('#strip'), PT = { v: 250 }, PX = 0.8; let pd = null, wheelEnd;
function setPace(v, raw = v) {
  v = clamp(Math.round(v / 10) * 10, 100, 1000);
  if (v !== S.wpm && ((v / 50) | 0) !== ((S.wpm / 50) | 0)) sound('tick');   // one detent of the wheel every fifty
  S.wpm = v; $('#wpm').textContent = v; pace.setAttribute('aria-valuenow', v); strip.style.transform = `translateX(${((100 - clamp(raw, 100, 1000)) * PX).toFixed(1)}px)`;
  if (S.part) { $('#voice').classList.toggle('over', tooFast(S.part)); if (!voice.paused) voice.playbackRate = clamp(v / S.part.narr, 0.5, 3); }
  try { localStorage.setItem('eastroom:wpm', v); } catch {}
}
function nudge(to) { gsap.killTweensOf(PT); PT.v = clamp(to, 100, 1000); setPace(PT.v); }
pace.addEventListener('pointerdown', (e) => { if (e.button) return; pace.setPointerCapture(e.pointerId); gsap.killTweensOf(PT); pd = { x: e.clientX, v0: PT.v, last: e.clientX, at: e.timeStamp, vel: 0 }; });
pace.addEventListener('pointermove', (e) => { if (!pd) return; pd.vel = (e.clientX - pd.last) / Math.max(1, e.timeStamp - pd.at); pd.last = e.clientX; pd.at = e.timeStamp;
  PT.v = clamp(pd.v0 - (e.clientX - pd.x) / PX, 100, 1000); setPace(PT.v, PT.v); });
const drop = (e) => { if (!pd) return; const vel = e.timeStamp - pd.at > 80 ? 0 : pd.vel; pd = null;   // px per ms; a hand that stopped first throws nothing
  settle(PT.v - vel * 499 / PX); };
const settle = (to) => gsap.to(PT, { v: clamp(Math.round(to / 10) * 10, 100, 1000), duration: still ? 0 : 0.6, ease: 'power3.out', onUpdate: () => setPace(PT.v, PT.v) });
pace.addEventListener('pointerup', drop); pace.addEventListener('pointercancel', drop);
pace.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); gsap.killTweensOf(PT);
  PT.v = clamp(PT.v + (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) / 2, 100, 1000); setPace(PT.v, PT.v); clearTimeout(wheelEnd); wheelEnd = setTimeout(() => nudge(S.wpm), 160); }, { passive: false });
pace.addEventListener('keydown', (e) => { const k = e.key, d = { ArrowUp: 10, ArrowRight: 10, ArrowDown: -10, ArrowLeft: -10, PageUp: 50, PageDown: -50 }[k];
  if (d === undefined && k !== 'Home' && k !== 'End') return; e.preventDefault(); e.stopPropagation(); nudge(k === 'Home' ? 100 : k === 'End' ? 1000 : S.wpm + d * (e.shiftKey ? 5 : 1)); });

// ---------- the poster title, drawn for the shader so the picture's figures can stand in front of it ----------
const tcv = document.createElement('canvas'), tx = tcv.getContext('2d');
function drawTitle(part) {
  S.titled = part; tcv.width = Math.min(2048, innerWidth * world.dpr); tcv.height = Math.round(tcv.width * innerHeight / innerWidth);
  const font = (px) => { tx.font = `800 ${px}px "Science Gothic"`; tx.fontStretch = 'ultra-condensed'; };
  font(100); const best = titleRows(part.ch.title.toUpperCase(), (r) => tx.measureText(r).width, tcv.width * 0.93, tcv.height * 0.7);
  font(best.px); tx.textAlign = 'center'; tx.textBaseline = 'middle'; tx.fillStyle = '#fff';
  best.rows.forEach((r, i) => tx.fillText(r, tcv.width / 2, tcv.height * 0.44 + (i - (best.rows.length - 1) / 2) * best.px * 0.8));
  world.title(tcv);
}

// ---------- every frame ----------
const world = makeWorld($('#world'));
function frame(time, dms) {
  if (!parts.length) return;
  const dt = Math.min(0.05, dms / 1000), vh = innerHeight;
  lenis.raf(time * 1000);
  if (S.flowing) {
    advance(dt);
    const l = W[S.g].ln, nx = LN[l.i + 1], part = (S.g - l.g0 + S.f) / Math.max(1, l.g1 - l.g0);
    const target = l.top + Math.min((nx ? nx.top : l.top + l.h) - l.top, M.lh * 2.6) * part - M.focus;   // the page drifts so the lit line stays put, never further than a paragraph gap
    S.sy += (target - S.sy) * (1 - Math.exp(-dt * 4.2)); stage.scrollTop = S.sy;
  }
  const sy = stage.scrollTop; if (sy !== S.sy0) { S.sy0 = sy; S.active = time; } if (time - S.active < 30 && !document.hidden) S.secs += dt;   // seconds of actual reading
  const part = S.flowing ? W[S.g].part : parts.findLast((p) => p.top <= sy + M.focus) ?? parts[0];
  let l = S.flowing ? W[S.g].ln : lineAt(sy + M.focus);
  if (!S.flowing) { if (l.part !== part) l = W[part.g0].ln; S.g = Math.min(l.g0, W.length - 1); S.f = 0; }   // on a poster the reading point waits at the part's first word
  if (part !== S.part) enter(part);
  if (part === parts.at(-1)) extend();
  setNow(l);
  // the lantern: a plate of the part's light under the word being read. It rests on the word, leaves in time to land on the next one as that word begins,
  // stretches as it travels, and trails the light it has just shed over the words behind it
  let tgt = [innerWidth / 2, M.focus];
  if (S.flowing) {
    const X = xs(l), i = (S.g - l.g0) * 2, hid = l.el.classList.contains('sr'), t = i + 2 < X.length ? smooth(0.52, 1, S.f) : 0;
    const a = X[i] - 5 + (X[i + 2] - X[i] || 0) * t, b = X[i + 1] + 5 + (X[i + 3] - X[i + 1] || 0) * t;
    if (l !== S.pl) {                                              // a new line: the plate on the old one closes toward its end while this one opens from the first word
      if (S.pl && l.i === S.pl.i + 1 && !still) { ghost.style.cssText = ptr.style.cssText; ghost.animate([{ clipPath: 'inset(0 0 0 0 round 8px)', opacity: 1 }, { clipPath: 'inset(0 0 0 100% round 8px)', opacity: 0 }], { duration: 190, easing: 'cubic-bezier(.5,0,.9,.4)' }); }
      S.pl = l; S.px = S.pr = X[i] - 5; ptr.style.setProperty('--pc', l.quote ? part.w.ground : part.w.accent); ptr.style.height = (hid ? 0 : l.h * (l.kind === 'h' ? 0.94 : 0.8)) + 'px'; }
    const fwd = a >= S.px, lead = still ? 1 : 1 - Math.exp(-dt * 38), trail = still ? 1 : 1 - Math.exp(-dt * 19);   // the edge in front arrives first, the edge behind follows
    S.px += (a - S.px) * (fwd ? trail : lead); S.pr += (b - S.pr) * (fwd ? lead : trail); if (S.pr < S.px) S.pr = S.px;
    l.el.style.setProperty('--x0', S.px.toFixed(1) + 'px'); l.el.style.setProperty('--x1', S.pr.toFixed(1) + 'px');
    ptr.style.transform = `translate(${(l.left + S.px).toFixed(1)}px,${(l.top + l.h * (l.kind === 'h' ? 0.02 : 0.1)).toFixed(1)}px)`; ptr.style.width = (S.pr - S.px).toFixed(1) + 'px';
    ptr.style.setProperty('--wk', clamp(S.px + 5, 0, clamp(S.wpm * 0.55, 110, 330)).toFixed(0) + 'px');   // the faster you read, the longer the trail
    tgt = [l.left + (S.px + S.pr) / 2, l.top - sy + l.h / 2];
  } else if (time - S.ptrAt < 2.5 && S.ptr) tgt = S.ptr;
  const kl = 1 - Math.exp(-dt * 9); S.lx += (tgt[0] - S.lx) * kl; S.ly += (tgt[1] - S.ly) * kl;
  let loud = 1;
  if (S.an && !voice.paused) { S.an.getByteTimeDomainData(S.buf); let e = 0; for (const v of S.buf) e += (v - 128) ** 2; loud = 0.72 + Math.min(1.1, Math.sqrt(e / S.buf.length) / 26); }
  const lv = S.an && !voice.paused ? Math.round(clamp((loud - 0.74) / 0.7) * 8) / 8 : 0; if (lv !== S.lv) $('#voice').style.setProperty('--lv', S.lv = lv);   // the Voice control is its own level meter
  // key lines the reading point has passed
  for (const k of part.keys) if (!k.kept && k.g1 <= S.g) { const y = W[k.g1 - 1].ln.top - sy; keep(k, y > 0 && y < vh); }
  // which rooms are on screen
  let ci = 0; while (scenes[ci + 1] && scenes[ci + 1].top - sy <= 0) ci++;
  const cur = scenes[ci], nxt = scenes[ci + 1], split = nxt ? nxt.top - sy : 1e6, rising = split < vh + 60, poster = rising && nxt.poster;
  const titled = poster ? nxt.part : cur.part; if (world && titled !== S.titled) drawTitle(titled);
  const open = (s) => (s.poster ? clamp((sy - s.top) / (vh * 1.25)) : 1);
  const idle = S.flowing && time - S.ptrAt > 2.5; if (idle !== S.idle) document.body.classList.toggle('idle', S.idle = idle);
  const reading = open(cur) > 0.6; if (reading !== S.reading) document.body.classList.toggle('reading', S.reading = reading);
  world?.draw({ a: cur, b: rising ? nxt : null, openA: open(cur), openB: rising ? open(nxt) : 0, travel: clamp((sy - cur.top) / (cur.end - cur.top)), split: rising ? split : 1e6,
    light: [S.lx, S.ly], col: [M.left, M.left + M.col], power: 1, time, still, titleSide: poster ? 1 : 0 });   // a steady light: it moves with the reading point and never pulses
  // a heading is swept in by light once it comes into view, inside the lit window while the light leads (CSS runs it on its own clock); quotes open
  for (const b of beats) { const on = still || b.top - sy < vh * (S.flowing ? 0.68 : 0.84); if (on !== b.on) b.el.classList.toggle('in', b.on = on); }
  for (const p of panels) { const y = p.top - sy; if (y > vh + 50 || y + p.h < -50) continue;
    const c = still ? 1 : smooth(0, 0.42, (vh - y) / vh); p.el.style.clipPath = c >= 1 ? '' : `inset(${(1 - c) * 9}% ${(1 - c) * 30}% ${(1 - c) * 9}% ${(1 - c) * 6}% round ${30 + (1 - c) * 220}px)`; }
  part.seg.style.setProperty('--p', ((S.g + S.f - part.g0) / (part.g1 - part.g0)).toFixed(4)); clock();
}

// ---------- controls: the reader's hand always wins ----------
addEventListener('wheel', () => { S.touched = true; S.flowing && setFlow(false); }, { passive: true });
addEventListener('touchmove', (e) => { S.touched = true; S.flowing && !e.target.closest?.('#deck') && setFlow(false); }, { passive: true });
addEventListener('pointermove', (e) => { S.ptr = [e.clientX, e.clientY]; S.ptrAt = gsap.ticker.time; });
addEventListener('pointerdown', () => { S.touched = true; S.blocked = S.mute = false; wake(); });
voice.addEventListener('error', () => {                            // a recording that cannot be fetched (Home asleep, not held here): this part falls back to the device's voice
  const p = W[S.g]?.part; if (!p || !S.src) return; p.lost = true; for (let g = p.g0; g < p.g1; g++) W[g].time = null; S.playing = false; S.src = ''; if (p === S.part) { S.part = null; }
});
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  S.touched = true; S.blocked = S.mute = false; wake(); const k = e.key, map = document.body.classList.contains('map');
  if (k === 'Escape' && map) showBook(false);
  else if (k === 'm') showBook(!map);
  else if (map) return;
  else if (k === ' ') { if (e.target.closest?.('button')) return; e.preventDefault(); setFlow(!S.flowing); }
  else if (S.flowing && (k === 'ArrowUp' || k === 'ArrowDown')) { e.preventDefault(); nudge(S.wpm + (k === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 50 : 10)); }
  else if (S.flowing && ['PageDown', 'PageUp', 'Home', 'End'].includes(k)) setFlow(false);
  else if (k === 'v') $('#voice').click();
  else if (k === 'l') $('#lib').click();
  else if (k === 'k') keepLine();
});
flow.addEventListener('click', (e) => {                            // click a word: the light goes there and leads on
  const l = e.target.closest('.ln')?._l; if (!l || String(getSelection())) return;
  const X = xs(l), x = e.clientX - l.el.getBoundingClientRect().left; let k = 0; while (k < l.g1 - l.g0 - 1 && X[k * 2 + 1] < x) k++;
  go(l.g0 + k, true);
});
$('#play').onclick = () => setFlow(!S.flowing);
$('#voice').onclick = (e) => { S.voice = !S.voice; e.currentTarget.setAttribute('aria-pressed', S.voice); if (!S.voice) { voice.pause(); quiet(); } };
$('#map').onclick = () => showBook(!document.body.classList.contains('map'));
$('#keep').onclick = keepLine;
let rz; addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!S.part) return; metrics(); world?.size(); openAt(S.part.pi, S.g - S.part.g0); }, 150); });

// ---------- open on the line you left ----------
metrics(); world?.size();
try { localStorage.setItem('eastroom:last', SLUG); } catch {}
holdText([book], library);                                        // this book's whole text stays on the device
const left = V.place ? { pi: order.indexOf(V.place.ch), w: V.place.w } : null;   // ?part=4&w=205&flow=1&wpm=300&voice=0 opens at a place, for review
{ let was = 0; try { was = +localStorage.getItem('eastroom:wpm'); } catch {} nudge(+Q.get('wpm') || was || 250); }
if (Q.has('voice')) $('#voice').click();
await openAt(clamp((Q.has('part') ? Q.get('part') - 1 : left?.pi) | 0, 0, book.chapters.length - 1), (Q.get('w') ?? (Q.has('part') ? 0 : left?.w)) | 0);
if (!parts.length) $('#count span').textContent = 'This part could not be loaded. Reload to try again.';
stage.focus({ preventScroll: true });                               // arrow and page keys scroll the text from the start
const further = V.far && (order.indexOf(V.far.ch) - (left?.pi ?? 0) || ((V.far.w | 0) - (left?.w ?? 0) > 250 ? 1 : 0));
if (further > 0 && !Q.has('part')) {                                // another device read clearly further on: one press goes there
  const b = el('button', '', `Furthest read: part ${order.indexOf(V.far.ch) + 1}, on ${V.farBy}`), far = V.far; b.id = 'far';
  b.onclick = () => { jump(order.indexOf(far.ch), far.w | 0); b.remove(); }; document.body.append(b); setTimeout(() => b.remove(), 20000);
}
let saved = '';
function record(leaving) {                                          // this device's record: where it is, and the seconds it has read. Opening a book writes nothing; reading in it does
  if (!S.part || !W[S.g]) return; const at = S.part.ch.id + ':' + (S.g - S.part.g0);
  if (saved && at !== saved && S.touched) rec.setPlace(SLUG, S.part.ch.id, S.g - S.part.g0, W[S.g].ln.el.textContent.slice(0, 160));
  // shortcut: words read are the words the place moved forward between two looks (2 s apart); a jump is not reading. Upgrade if the look interval changes.
  const moved = S.g - (S.gSeen ?? S.g); S.gSeen = S.g; if (moved > 0 && moved <= 60) S.words = (S.words || 0) + moved;
  saved = at; if (S.secs >= (leaving ? 1 : 15)) { rec.addSeconds(SLUG, Math.round(S.secs), S.words || 0); S.secs = 0; S.words = 0; }
}
setInterval(() => { if (!document.hidden) record(); }, 2000);
addEventListener('pagehide', () => record(true));
// leaving for the library: the text and the instruments step back, the room stays, and the library opens in the same colours
$('#lib').addEventListener('click', (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey) return; setFlow(false); record(true); rec.sync(true);
  try { sessionStorage.setItem('eastroom:back', JSON.stringify({ slug: SLUG, t: Date.now() })); } catch {}
  if (still) return; e.preventDefault(); document.body.classList.add('leaving'); setTimeout(() => { location.href = './'; }, 230);
});
addEventListener('pageshow', (e) => { if (e.persisted) document.body.classList.remove('leaving'); });
gsap.ticker.add(frame);
// arriving from the library: the cover that came forward there is standing here; once the page is drawn it lifts away and the text comes in under it
requestAnimationFrame(() => requestAnimationFrame(() => { root.classList.remove('arriving'); try { sessionStorage.removeItem('eastroom:open'); } catch {} }));
if (Q.has('flow')) setFlow(true);
if (Q.has('check')) {                                                // self-check: the lines hold every word of the author's text, once, in order
  let g = 0; for (const p of parts) for (const b of p.ch.blocks.some((x) => x.t.trim()) ? p.ch.blocks : [{ t: p.ch.title.trim() || '·' }]) for (const w of b.t.trim().split(/\s+/).filter(Boolean)) {
    console.assert(W[g].s === w && W[g].part === p, 'word', g, w, W[g]?.s); const t = W[g].ln.el.textContent.slice(W[g].a, W[g].b);
    console.assert(w.startsWith(t) && t.length > 0, 'line text', g, w, t); g++; }
  console.assert(g === W.length, 'word count', g, W.length); console.log('check: ' + g + ' words in ' + LN.length + ' lines');
}
window.eastroom = { S, W, LN, parts, scenes, go, jump, setFlow, showBook, settle };
