// East Room's settings: five rooms. Reading is this device's own; the other four show and steer what Home does to the books.
// Every answer from Home is shown in its own words; nothing here guesses a state it was not told.
import './carry.js';
import * as rec from './state.js';
import { sound } from './sound.js';
import { textUrl, ownBooks, dropBook } from './hold.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const set = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
const room = $('#room'), sayBox = $('#say'); let sayTimer;
const say = (t) => { sayBox.textContent = t; sayBox.hidden = false; clearTimeout(sayTimer); sayTimer = setTimeout(() => (sayBox.hidden = true), 5200); };
async function api(path, body, method = body ? 'POST' : 'GET', wait = 20000) {   // Home's answer, or its reason in words
  let r; try { r = await fetch(path, { method, body: body && JSON.stringify(body), cache: 'no-store', signal: AbortSignal.timeout(wait) }); } catch { throw new Error('Home did not answer. Is it awake?'); }
  const out = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error(`Home was not told that this address may change things. Start it with --origin ${location.origin}`);
  if (!r.ok) throw new Error(out.error || `Home answered ${r.status}.`);
  return out;
}
const act = (fn, done) => async (e) => { const b = e?.currentTarget; if (b) b.disabled = true; try { const out = await fn(); if (done) say(typeof done === 'function' ? done(out) : done); await show(); } catch (err) { say(err.message); if (b) b.disabled = false; } };
const size = (n) => (n >= 1e9 ? (n / 1e9).toFixed(1) + ' GB' : n >= 1e6 ? Math.round(n / 1e6) + ' MB' : n >= 1e3 ? Math.round(n / 1e3) + ' KB' : n ? n + ' B' : '0');
const ago = (t) => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`; };

// ---------- small parts ----------
function box(title, why, ...kids) { const s = el('section', 'box'); s.append(el('h2', '', title)); if (why) s.append(el('p', 'why', why)); s.append(...kids); return s; }
function row(name, why, control, cls = '') { const r = el('div', 'row ' + cls); r.append(el('b', '', name)); if (why) r.append(el('small', '', why)); if (control) { if (control.classList.contains('lamp')) control.setAttribute('aria-label', name); r.append(control); } return r; }
function rows(...kids) { const d = el('div', 'rows'); d.append(...kids.filter(Boolean)); return d; }
function pill(label, fn, cls = '') { const b = el('button', 'pill ' + cls, label); b.type = 'button'; b.onclick = fn; return b; }
function seg(options, value, pick) {                               // one of a few: every choice in sight, and one thumb that travels between them
  const d = el('div', 'pick'); d.setAttribute('role', 'group'); d.style.cssText = `--n:${options.length};--i:${Math.max(0, options.findIndex(([v]) => v === value))}`;
  options.forEach(([v, label], i) => { const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-pressed', String(v === value));
    b.onclick = (e) => { const me = e.currentTarget, all = me.parentNode; all.style.setProperty('--i', i); for (const k of all.children) k.setAttribute('aria-pressed', String(k === me)); pick(v); }; d.append(b); });
  return d;
}
function onOff(value, pick) { const b = el('button', 'lamp'); b.type = 'button'; b.setAttribute('aria-pressed', String(!!value)); b.onclick = (e) => { const me = e.currentTarget, v = me.getAttribute('aria-pressed') !== 'true'; me.setAttribute('aria-pressed', String(v)); pick(v); }; return b; }   // a lamp, lit or not
function slide(el, { min, max, step, get, set, text, vertical = false }) {   // a value held and moved: drag, arrows, Page keys, Home and End
  el.setAttribute('role', 'slider'); el.tabIndex = 0; el.setAttribute('aria-valuemin', min); el.setAttribute('aria-valuemax', max); if (vertical) el.setAttribute('aria-orientation', 'vertical');
  const fit = (v) => Math.min(max, Math.max(min, Math.round(v / step) * step)), tell = () => { el.setAttribute('aria-valuenow', get()); el.setAttribute('aria-valuetext', text(get())); };
  const at = (e) => { const r = el.getBoundingClientRect(), f = vertical ? 1 - (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width; set(fit(min + f * (max - min))); tell(); };
  el.onpointerdown = (e) => { el.setPointerCapture(e.pointerId); at(e); el.onpointermove = (m) => { el.classList.add('held'); at(m); }; };   // a press glides there; once it moves, the knob is the finger
  el.onpointerup = el.onpointercancel = () => { el.onpointermove = null; el.classList.remove('held'); };
  el.onkeydown = (e) => { const d = { ArrowRight: step, ArrowUp: step, ArrowLeft: -step, ArrowDown: -step, PageUp: step * 5, PageDown: -step * 5 }[e.key]; if (d) set(fit(get() + d)); else if (e.key === 'Home') set(min); else if (e.key === 'End') set(max); else return; e.preventDefault(); tell(); };
  tell();
}
const span = (words, wpm) => { const m = Math.max(1, Math.round(words / wpm)); return m < 90 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`; };
const steps = (...items) => { const l = el('ol', 'steps'); for (const parts of items) { const li = el('li'); li.append(...parts); l.append(li); } return l; };
const group = (...kids) => { const d = el('div', 'acts'); d.append(...kids.filter(Boolean)); return d; };
// A room is never rebuilt in front of the reader: the new state is laid over the old one, node by node, so a lamp that changes is the same lamp and can move.
const HANDLERS = ['onclick', 'onchange', 'oninput', 'onkeydown'];
function morph(old, fresh) {
  const a = [...old.childNodes], b = [...fresh.childNodes];
  b.forEach((n, i) => { const o = a[i];
    if (!o) return old.append(n);
    if (o.nodeType !== n.nodeType || o.nodeName !== n.nodeName || (o.id || '') !== (n.id || '')) return o.replaceWith(n);
    if (n.nodeType !== 1) { if (o.data !== n.data) o.data = n.data; return; }
    if (n.namespaceURI !== 'http://www.w3.org/1999/xhtml') return;   // a drawing keeps itself up to date
    for (const at of [...o.attributes]) if (!n.hasAttribute(at.name)) o.removeAttribute(at.name);
    for (const at of n.attributes) if (o.getAttribute(at.name) !== at.value) o.setAttribute(at.name, at.value);
    for (const h of HANDLERS) o[h] = n[h];
    if ('value' in n && o !== document.activeElement && o.value !== n.value) o.value = n.value;
    morph(o, n); });
  a.slice(b.length).forEach((o) => o.remove());
}
// What can be done with one thing floats by its button and moves nothing. One for the page; it also asks before anything that cannot be undone.
// shortcut: needs the Popover API (Safari 17, Firefox 125, Chrome 114), upgrade to a positioned panel if an older browser must be served
const pop = el('div'); pop.id = 'menu'; pop.popover = 'auto'; document.body.append(pop); let shut = [null, 0];
pop.addEventListener('beforetoggle', (e) => { if (e.newState === 'closed') shut = [pop.by, performance.now()]; });
pop.onclick = (e) => { const b = e.target.closest('button'); if (b && !b.dataset.stay) pop.hidePopover(); };
function menu(by, items, note) {
  if (by === shut[0] && performance.now() - shut[1] < 350 && !pop.matches(':popover-open')) return;   // the press that closed it is not a press to open it
  pop.by = by; pop.replaceChildren(...(note ? [el('p', '', note)] : []), ...items.filter(Boolean)); if (!pop.matches(':popover-open')) pop.showPopover();
  stay(); pop.querySelector('button')?.focus({ preventScroll: true });
}
function stay() {
  if (!pop.matches(':popover-open')) return; const r = pop.by.getBoundingClientRect(), h = pop.offsetHeight, w = pop.offsetWidth, up = r.bottom + h + 16 > innerHeight && r.top - h - 8 > 0;
  if (r.bottom < 0 || r.top > innerHeight || !pop.by.isConnected) return pop.hidePopover();
  const left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)); pop.style.left = left + 'px'; pop.style.top = (up ? r.top - h - 8 : r.bottom + 8) + 'px';
  pop.style.transformOrigin = `${Math.max(0, Math.min(w, r.left + r.width / 2 - left))}px ${up ? '100%' : '0'}`;   // it grows out of the button that opened it
}
addEventListener('scroll', stay, { passive: true }); addEventListener('resize', stay);
const sure = (label, text, yes, fn, done) => { const b = pill(label, (e) => menu(pop.contains(e.currentTarget) ? pop.by : e.currentTarget, [pill(yes, act(fn, done), 'warn'), pill('Keep it', () => {})], text), 'warn'); b.dataset.stay = 1; return b; };

// ---------- Home's side, fetched when a room that needs it opens ----------
const met = rec.sync();                                           // whether there is a Home at all is known once it was asked
const H = { work: null, settings: null, engines: null, now: null, none: false, own: [] }, got = new Set();
async function now() {                                            // the book this reader was last in: its name, the line they are on, the words still ahead
  let best = null;
  for (const b of await api('api/library')) { const order = b.chapters.map((c) => c.id), v = rec.view(b.slug, order); if (!v.place || (best && v.place.t <= best.t)) continue;
    const i = Math.max(0, order.indexOf(v.place.ch)); best = { t: v.place.t, slug: b.slug, ch: b.chapters[i], w: v.place.w | 0, title: b.title, line: v.place.exact || '', left: Math.max(0, b.chapters.slice(i).reduce((a, c) => a + c.words, 0) - Math.min(v.place.w | 0, b.chapters[i].words)) }; }
  if (best) try { const part = await api(textUrl(best.slug, best.ch)), all = part.blocks.filter((x) => x.k === 'p').map((x) => x.t.replace(/<[^>]+>/g, '')).join(' ').split(/\s+/), at = all.join(' ').indexOf(best.line.slice(0, 40));   // a passage from where they are, not the whole part
    const from = at >= 0 && best.line ? all.join(' ').slice(0, at).split(' ').length - 1 : Math.min(best.w, Math.max(0, all.length - 60)); best.line = all.slice(from, from + 58).join(' '); best.key = part.takeaways?.[0]?.quote || ''; } catch {}
  return best;
}
async function load(what) {
  H.own = await ownBooks().catch(() => []);
  try {
    if (what.includes('now')) H.now = await now().catch(() => H.now);   // Reading works without Home: it then shows a line of its own
    if (what.includes('work')) H.work = await api('api/work');
    if (what.includes('settings')) H.settings = await api('api/settings');
    if (what.includes('engines')) H.engines = await api('api/engines');
    H.none = false; for (const k of what) got.add(k);
  } catch (err) { await met; H.none = rec.home.none ? 'This is the demo: there is no Home behind it. Books you add and your place in them are kept in this browser. East Room on your own computer records voices, finds pictures and brings your books to every device: github.com/intesarjawad/eastroom' : err.message; }
}
const save = (patch) => api('api/settings', patch, 'PUT').then((s) => (H.settings = s));
const away = () => el('p', 'empty', H.none || 'Home has not answered yet.');

// ---------- Reading: this device only. The page is the control: its text is sized by hand and its light runs at the chosen pace ----------
const short = (name) => name.replace(/ \(.*/, '');                 // 'Eddy (English (United States))' is Eddy
const OWN = 'These are the words of a book as this device shows them, at the size you give them and the pace you set for the light.';
const light = { words: [], i: 0, t: 0, last: 0, wpm: 250 }, still = matchMedia('(prefers-reduced-motion: reduce)');
const spot = (w) => [w.offsetLeft, w.offsetTop, w.offsetWidth, w.offsetHeight];
const lay = (r) => { const g = light.glow; g.style.translate = `${r[0]}px ${r[1]}px`; g.style.width = r[2] + 'px'; g.style.height = r[3] + 'px'; };
function beam() { const w = light.words[light.i]; if (w?.isConnected) lay((light.from = light.to = spot(w))); }   // set down on the current word, without travel
function step(to) {                                                // only the words in sight are read; then it begins again
  const w = light.words, was = light.to; if (to >= w.length || w[to].offsetTop + w[to].offsetHeight > light.box.clientHeight) to = 0;
  if (to) { w[to - 1].className = ''; w[to].className = 'now'; } else w.forEach((e, n) => (e.className = n ? 'next' : 'now'));
  light.i = to; light.to = spot(w[to]); light.from = to && was && was[1] === light.to[1] ? was : light.to;   // along a line it travels; to a new line it cuts
  if (light.from === light.to) { lay(light.to); light.glow.classList.remove('cut'); void light.glow.offsetWidth; light.glow.classList.add('cut'); }
}
function shine(now) {                                              // one clock for the light, whatever is on the page
  const w = light.words; if (w.length && w[0].isConnected && !document.hidden && !still.matches) { light.t += Math.min(500, now - light.last); const per = 60000 / light.wpm;
    if (light.t >= per) { light.t %= per; step(light.i + 1); }
    if (light.from !== light.to) { const f = Math.min(1, light.t / (per * 0.62)), e = f * f * (3 - 2 * f); lay(light.from.map((a, k) => a + (light.to[k] - a) * e)); if (f === 1) light.from = light.to; } }   // it travels for most of a word's time, then rests on the word
  light.last = now; requestAnimationFrame(shine);
}
addEventListener('resize', beam); document.fonts?.ready.then(beam);
function voicesBox() {                                             // every reading voice this device has, each one press away from being heard
  const voices = (window.speechSynthesis?.getVoices() || []).filter((v, i, a) => v.lang.startsWith('en') && !/^(Albert|Bad News|Bahh|Bells|Boing|Bubbles|Cellos|Good News|Jester|Organ|Superstar|Trinoids|Whisper|Wobble|Zarvox)\b/.test(v.name) && a.findIndex((o) => short(o.name) === short(v.name)) === i);
  if (!voices.length) return null; const box = el('div'), list = el('div'), chosen = get('eastroom:say', ''); box.id = 'voices';
  const chip = (name, label, voice) => { const b = el('button', '', label); b.type = 'button'; b.setAttribute('aria-pressed', String(name === chosen));
    b.onclick = () => { set('eastroom:say', name); for (const o of list.children) o.setAttribute('aria-pressed', String(o === b)); const u = new SpeechSynthesisUtterance('This is how I will read to you.'); if (voice) u.voice = voice; speechSynthesis.cancel(); speechSynthesis.speak(u); }; return b; };
  list.append(chip('', 'This device\'s choice'), ...voices.map((v) => chip(v.name, short(v.name), v))); box.append(el('span', 'k', 'Voice when none is recorded'), list); return box;
}
function reading() {
  const n = H.now;
  const S = { wpm: Math.min(600, Math.max(120, +get('eastroom:wpm', 250) || 250)), size: Math.min(1.4, Math.max(0.8, +get('eastroom:size', 1) || 1)) };
  const desk = el('div'), leaf = el('section'), keys = el('section'); desk.id = 'desk'; leaf.id = 'leaf'; keys.id = 'keys'; leaf.setAttribute('aria-label', 'How a book reads on this device'); keys.setAttribute('aria-label', 'More for this device');
  // the page
  const size = el('div'), sizeOut = el('output'), carry = el('p'), lines = el('p'), pace = el('div'), wpm = el('output'), num = document.createTextNode(''), rule = el('div'), means = el('p');
  size.id = 'size'; size.setAttribute('aria-label', 'Text size'); size.append(sizeOut, el('b', '', 'A'), el('i', '', 'a'), el('b', '', 'a'));
  carry.id = 'carry'; carry.append(el('b', '', 'Before each part'), el('span', '', n?.key || 'The key lines of the part before stand here, in the author\'s own words.')); carry.classList.toggle('off', get('eastroom:norecap', false));
  lines.id = 'lines'; const words = (n?.line && n.line.split(/\s+/).length > 7 ? n.line : OWN).split(/\s+/).filter(Boolean).map((w) => el('span', 'next', w)); const glow = el('i'); glow.id = 'glow'; lines.append(glow, ...words.flatMap((w) => [w, ' ']));
  words[Math.min(3, words.length - 1)].after(el('sup', '', '1')); leaf.classList.toggle('bare', get('eastroom:bare', false)); words[0].className = 'now'; Object.assign(light, { words, i: 0, t: 0, glow, box: lines }); requestAnimationFrame(beam);
  pace.id = 'tempo'; wpm.append(num, el('small', '', 'words a minute')); rule.id = 'rule'; rule.setAttribute('aria-label', 'Pace'); rule.append(el('i'), ...[120, 240, 360, 480, 600].map((v, i) => { const e = el('em', '', v); e.style.left = i * 25 + '%'; return e; }));
  pace.append(wpm, rule, means);
  const paint = () => { leaf.style.setProperty('--scale', S.size); size.style.setProperty('--f', (S.size - 0.8) / 0.6); sizeOut.textContent = Math.round(S.size * 100) + '%';
    rule.style.setProperty('--f', (S.wpm - 120) / 480); num.textContent = S.wpm; light.wpm = S.wpm; if (glow.isConnected) { const w = words[light.i]; if (w.offsetTop + w.offsetHeight > lines.clientHeight) step(0); else beam(); }
    means.replaceChildren(...(n?.left ? ['The rest of ', el('b', '', n.title), ' in ', el('b', '', span(n.left, S.wpm)), '. '] : []), 'A part of 2,000 words in ', el('b', '', span(2000, S.wpm)), '.'); };
  slide(size, { min: 0.8, max: 1.4, step: 0.05, vertical: true, get: () => S.size, set: (v) => { S.size = +v.toFixed(2); set('eastroom:size', S.size); paint(); }, text: (v) => Math.round(v * 100) + ' per cent' });
  slide(rule, { min: 120, max: 600, step: 10, get: () => S.wpm, set: (v) => { S.wpm = v; set('eastroom:wpm', v); paint(); }, text: (v) => v + ' words a minute' });
  leaf.append(el('span', 'k', n ? `${n.title}, as it reads here` : 'A book, as it reads here'), size, carry, lines, pace); paint();
  // the keys: each shows on the page what it does
  const key = (name, why, on, press, extra) => { const b = el('button', 'tog'); b.type = 'button'; b.setAttribute('aria-pressed', String(on)); b.append(el('b', '', name), el('span', '', why)); if (extra) b.append(extra);
    b.onclick = () => { const v = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', String(v)); press(v, b); }; return b; };
  const bars = el('i', 'bars'); bars.setAttribute('aria-hidden', 'true'); for (const [i, h] of [0.5, 1, 0.3, 0.8, 0.4].entries()) { const e = el('i'); e.style.setProperty('--n', i); e.style.setProperty('--h', h); bars.append(e); }
  keys.append(key('Sounds', 'The small sounds of the interface. Narration is not affected.', !get('eastroom:quiet', false), (v) => { set('eastroom:quiet', !v); bars.classList.remove('go'); if (v) { void bars.offsetWidth; bars.classList.add('go'); sound('key'); } }, bars),
    key('Pictures and notes', 'A book\'s own pictures, tables and notes, in the text.', !get('eastroom:bare', false), (v) => { set('eastroom:bare', !v); leaf.classList.toggle('bare', !v); }),
    key('Key lines first', 'Each part opens with what the last one said.', !get('eastroom:norecap', false), (v) => { set('eastroom:norecap', !v); carry.classList.toggle('off', !v); }));
  const v = voicesBox(); if (v) keys.append(v);
  desk.append(leaf, keys); return [desk];
}

// ---------- Workshop: the queue, and every book with what it has ----------
const STEP = { read: 'Read the file again', takeaways: 'Key lines', letters: 'Spine lettering', pictures: 'Pictures', voice: 'Recorded voice' };
const title = (slug) => H.work.books.find((b) => b.slug === slug)?.title || slug;
function jobRow(j) {
  const what = STEP[j.step] + (j.arg ? ` (${j.arg})` : ''), far = j.of ? `${j.done} of ${j.of} parts` : j.state === 'running' ? 'working' : 'waiting';
  const r = row(title(j.book), `${what} · ${far}`, pill(j.state === 'running' ? 'Stop' : 'Cancel', act(() => api('api/work/cancel', { id: j.id }))), 'job' + (j.state === 'running' ? ' run' : ''));
  r.style.setProperty('--p', j.of ? j.done / j.of : 0); return r;
}
function pastRow(j) {
  const again = j.state === 'failed' || j.state === 'stopped' ? pill('Try again', act(() => api('api/work', { book: j.book, step: j.step, arg: j.arg || '' }))) : null;
  return row(title(j.book), `${STEP[j.step]}${j.arg ? ` (${j.arg})` : ''} · ${j.state === 'done' ? 'done ' + ago(j.ended * 1000) : j.note || j.state}`, again, j.state === 'failed' ? 'bad' : '');
}
let filter = new URLSearchParams(location.search).get('find') || '', led = !!filter;   // the library can send you here for one book
function bookRow(b) {
  const r = el('div', 'bk'), name = el('div', 'name'), has = el('div', 'has'), s = b.steps, chip = (t, cls = '') => has.append(el('span', cls, t));
  const pic = s.pictures ??= {};                                    // a Home from before the pictures step says nothing about it
  name.append(el('b', '', b.title), el('small', '', [b.author, b.kind === 'pages' ? `${b.parts} parts of pages` : `${b.parts} parts`].filter(Boolean).join(' · ')));
  chip(b.original ? `File kept (${b.original.toUpperCase()})` : 'File not kept', b.original ? 'on' : '');
  if (b.kind === 'words') {
    chip(s.takeaways.state === 'done' ? `Key lines (${s.takeaways.by === 'model' ? 'model' : 'ranked'})` : s.takeaways.state === 'failed' ? 'Key lines failed' : s.takeaways.state === 'stale' ? 'Key lines can be improved' : 'No key lines', s.takeaways.state === 'done' ? 'on' : s.takeaways.state === 'failed' ? 'bad' : s.takeaways.state === 'stale' ? 'old' : '');
    chip(b.spine ? `Spine: ${b.spine.face}` : s.letters.state === 'failed' ? 'Lettering failed' : 'Plain spine', b.spine ? 'on' : s.letters.state === 'failed' ? 'bad' : '');
    chip(pic.state === 'done' ? `Pictures in ${pic.found} of ${b.parts} parts` : pic.state === 'failed' ? 'Pictures failed' : 'No found pictures', pic.state === 'done' ? 'on' : pic.state === 'failed' ? 'bad' : '');
    const v = Object.entries(b.voice); if (v.length) for (const [n, c] of v) chip(`${n} voice ${c} of ${b.parts}`, c >= b.parts ? 'on' : 'old'); else chip('No recorded voice');
  }
  const q = (label, step, arg = '') => pill(label, act(() => api('api/work', { book: b.slug, step, arg }), `${label}: added to the queue.`));
  r.append(name, has, pill('Do', (e) => menu(e.currentTarget, [b.original ? q('Read the file again', 'read') : null, ...(b.kind === 'words' ? [q('Make key lines', 'takeaways'), q('Match the spine to the cover', 'letters'), q('Find pictures', 'pictures'), s.pictures.state === 'done' ? pill('Remove found pictures', act(() => api('api/remove', { book: b.slug, what: 'pictures' }), 'The found pictures are removed. "Find pictures" brings pictures back.')) : null, q('Narrate, plain voice', 'voice', 'plain'), q('Narrate, storyteller', 'voice', 'storyteller')] : [])],
    ['read', 'takeaways', 'letters', 'pictures', 'voice'].filter((k) => s[k].state === 'failed' && s[k].note).map((k) => `${STEP[k]}: ${s[k].note}`).join(' ') || (b.original || b.kind === 'words' ? '' : 'Nothing more can be made for this book.'))));
  return r;
}
function workshop() {
  if (!H.work || !H.settings) return [away()];
  const q = H.work.queue, st = H.settings, out = [];
  const all = (label, step, arg = '') => pill(label, act(() => api('api/work', { book: '*', step, arg }), (o) => (o.added ? `${o.added} ${o.added === 1 ? 'book' : 'books'} added to the queue.` : 'Every book already has it.')));
  out.push(box('Under way', q.jobs.length ? '' : 'Nothing is being made right now.', rows(...q.jobs.map(jobRow), ...q.past.slice().reverse().slice(0, 6).map(pastRow),
    q.following ? row('Following your reading', `The ${st.voice.follow} voice is being made ahead of where you are.`) : null)));
  out.push(box('For every book', 'Work through the whole library. Books that already have a thing are skipped.',
    rows(row('Key lines', 'Three to five sentences a part, in the author\'s own words.', all('Make for all', 'takeaways')),
      row('Spine lettering', st.engines.eyes.engine ? `${named('eyes')} looks at each cover once.` : 'Needs an engine that can look at covers. Choose one in Engines.', st.engines.eyes.engine ? all('Match all', 'letters') : null),
      row('Pictures', st.engines.words.engine ? `${named('words')} names a picture for each part from how it begins. Home looks for it on Wikimedia Commons and keeps only public-domain files.` : 'Needs an engine that can read sentences. Choose one in Engines.', st.engines.words.engine ? all('Find for all', 'pictures') : null),
      row('Recorded voice, ahead of your reading', 'Home keeps a voice a few parts ahead in every book you are in.', seg([['', 'Off'], ['plain', 'Plain'], ['storyteller', 'Storyteller']], st.voice.follow, (v) => save({ voice: { follow: v } }).then(() => say(v ? `Home will follow your reading in the ${v} voice.` : 'Home stopped following.'), (e) => say(e.message)))))));
  out.push(box('When a book is added', 'What Home does by itself, after the text is in.',
    rows(row('Make key lines', '', onOff(st.auto.takeaways, (v) => save({ auto: { takeaways: v } }).catch((e) => say(e.message)))),
      row('Match the spine to the cover', st.engines.eyes.engine ? '' : 'Waits until an engine for covers is chosen in Engines.', onOff(st.auto.letters, (v) => save({ auto: { letters: v } }).catch((e) => say(e.message)))),
      row('Find pictures', st.engines.words.engine ? 'The names of the pictures go to Wikimedia Commons as search words.' : 'Waits until an engine for sentences is chosen in Engines.', onOff(st.auto.pictures, (v) => save({ auto: { pictures: v } }).catch((e) => say(e.message)))),
      row('Who picks the key lines', 'Ranked needs no engine. With one, it chooses among the ranked sentences and can only answer with sentences of the book.',
        seg([['rank', 'Ranked'], ['model', 'Engine']], st.takeaways.by, (v) => save({ takeaways: { by: v } }).then(() => v === 'model' && !st.engines.words.engine && say('Choose an engine for sentences in Engines, or the ranking is used.'), (e) => say(e.message)))))));
  const find = el('input', 'find'); Object.assign(find, { type: 'text', placeholder: 'Find a book', value: filter }); find.setAttribute('aria-label', 'Find a book'); find.oninput = (e) => { filter = e.currentTarget.value; const l = el('div'); l.append(...shown()); morph($('#books'), l); };
  const shown = () => { const f = filter.trim().toLowerCase(), l = H.work.books.filter((b) => !b.removed && (!f || (b.title + ' ' + b.author).toLowerCase().includes(f))); return l.length ? l.map(bookRow) : [el('p', 'empty', 'No book by that name.')]; };
  const list = el('div', 'rows'); list.id = 'books'; list.append(...shown());
  out.push(box('Every book', 'What each book has. "Do" shows what can be made for it.', find, list));
  return out;
}

// ---------- Engines: what Home has to work with ----------
const HELD = { claude: 'Starts with no tools at all.', codex: 'Starts read-only. The servers you connected to it still load.', agy: 'Starts in its planning mode, sandboxed. The servers you connected to it still load.', opencode: 'Starts as its planning agent. The servers you connected to it still load.' };
const PRESETS = [['ollama', 'Ollama on Home', 'http://127.0.0.1:11434/v1'], ['lmstudio', 'LM Studio on Home', 'http://127.0.0.1:1234/v1'], ['openrouter', 'OpenRouter', 'https://openrouter.ai/api/v1']];
const named = (role) => { const p = H.settings.engines[role], [kind, name] = p.engine.split(':'), who = kind === 'api' ? H.settings.apis.find((a) => a.id === name)?.name : { claude: 'Claude Code', codex: 'Codex', agy: 'agy', opencode: 'OpenCode' }[name]; return (who || 'The engine') + (p.model ? ` (${p.model})` : ''); };
function field(label, value, placeholder, change, type = 'text') { const i = el('input'); Object.assign(i, { type, value, placeholder }); i.setAttribute('aria-label', label); i.onchange = (e) => change(e.currentTarget.value.trim()); return i; }
let job = 'eyes'; const tried = {};
const PLAIN = { eyes: 'Spines keep their plain style.', words: 'Key lines are ranked.' };
function bay() {                                                   // two jobs on the left, everyone who could do them on the right, a line between a job and its engine
  const e = H.engines, st = H.settings, wrap = el('div'), svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'), jobs = el('div', 'side'), all = el('div', 'side'); wrap.id = 'bay'; svg.setAttribute('aria-hidden', 'true');
  const put = (role, engine, model) => { const was = st.engines[role]; st.engines[role] = { engine, model }; delete tried[role]; draw();   // shown at once, then told to Home
    save({ engines: { [role]: { engine, model } } }).then(draw, (err) => { H.settings.engines[role] = was; draw(); say(err.message); }); };
  jobs.append(el('span', 'k', 'Jobs')); all.append(el('span', 'k', 'Who Home can ask'));
  for (const [role, name, why] of [['eyes', 'Looks at covers', 'Matches each spine\'s lettering to its cover.'], ['words', 'Reads sentences', 'Chooses the key lines among the ranked ones, when the Workshop says "Engine".']]) {
    const pick = st.engines[role], server = e.apis.find((a) => 'api:' + a.id === pick.engine), j = el('div', 'task' + (pick.engine ? ' on' : '')); j.dataset.role = role; j.dataset.to = pick.engine; j.tabIndex = 0; j.setAttribute('role', 'button'); j.setAttribute('aria-pressed', String(role === job));
    j.append(el('b', '', name), el('span', 'who', pick.engine ? named(role) + (tried[role] ? ` · ${tried[role]}` : '') : 'Nobody yet'), el('span', '', why));
    j.onclick = j.onkeydown = (ev) => { if (ev.target.closest('input, button')) return; if (ev.type === 'keydown' && ev.key !== 'Enter' && ev.key !== ' ') return; ev.preventDefault(); job = role; draw(); };
    const row = el('div', 'with');
    if (pick.engine) { const model = field(`Model for ${name}`, pick.model, server ? 'Choose a model' : 'Its own choice of model', (v) => put(role, pick.engine, v));
      if (server) { const list = el('datalist'); list.id = 'models-' + role; for (const m of server.models) list.append(Object.assign(el('option'), { value: m })); model.setAttribute('list', list.id); row.append(list); }
      const go = act(() => api('api/engines/try', { engine: pick.engine, model: pick.model }, 'POST', 130000).then((o) => { tried[role] = o.ok ? `answered in ${o.seconds} s` : 'answered in another form than asked'; }, (err) => { tried[role] = 'did not answer'; say(err.message); }));
      const t = pill('Try it', (ev) => { ev.currentTarget.textContent = 'Asking'; return go(ev); }); if (server && !pick.model) t.disabled = true; row.append(model, t);
    } else row.append(el('small', '', PLAIN[role]));
    j.append(row); jobs.append(j);
  }
  const card = (ref, name, state, kind, off) => { const b = el('button', 'eng' + (Object.values(st.engines).some((p) => p.engine === ref) ? ' on' : '')); b.type = 'button'; b.dataset.ref = ref; b.append(el('b', '', name), el('span', '', state), el('em', '', kind));
    if (off) b.setAttribute('aria-disabled', 'true'); b.setAttribute('aria-pressed', String(st.engines[job].engine === ref));
    b.onclick = () => (off ? say(off) : put(job, st.engines[job].engine === ref ? '' : ref, '')); return b; };
  for (const t of e.tools.filter((x) => x.found)) all.append(card('tool:' + t.name, t.label, HELD[t.name], 'tool', job === 'eyes' && !t.sees ? `${t.label} cannot be given pictures.` : ''));
  for (const a of e.apis) all.append(card('api:' + a.id, a.name, a.up ? `${a.models.length} ${a.models.length === 1 ? 'model' : 'models'}. ${a.local ? 'Nothing leaves Home.' : 'What it is asked leaves Home.'}` : a.error || 'Not answering.', 'server', a.up ? '' : `${a.name} is not answering.`));
  if (all.children.length === 1) all.append(el('p', 'empty', 'No AI tool was found on Home and no server is added yet.'));
  wrap.append(svg, jobs, all); return wrap;
}
const NS = 'http://www.w3.org/2000/svg';
function wires() {                                                 // a line stays the same line while its ends stay; a new choice draws a new one
  const b = $('#bay'), svg = b?.querySelector('svg'); if (!svg) return; const box = b.getBoundingClientRect(), keep = new Set();
  for (const j of b.querySelectorAll('.task')) { const to = j.dataset.to && b.querySelector(`.eng[data-ref="${CSS.escape(j.dataset.to)}"]`); if (!to) continue;
    const a = j.getBoundingClientRect(), z = to.getBoundingClientRect(), x1 = a.right - box.left, y1 = a.top + 34 - box.top, x2 = z.left - box.left, y2 = z.top + 34 - box.top, bend = (x2 - x1) / 2;
    let path = [...svg.children].find((p) => p.dataset.role === j.dataset.role && p.dataset.to === j.dataset.to && !p.classList.contains('gone'));
    if (!path) { path = document.createElementNS(NS, 'path'); path.dataset.role = j.dataset.role; path.dataset.to = j.dataset.to; path.setAttribute('pathLength', 1); svg.append(path); }
    path.setAttribute('d', `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`); keep.add(path); }
  for (const p of [...svg.children]) if (!keep.has(p) && !p.classList.contains('gone')) { p.classList.add('gone'); setTimeout(() => p.remove(), 220); }
}
addEventListener('resize', wires);
function serverRow(a) {
  const st = H.settings, key = field(`Key for ${a.name}`, '', a.key ? 'A key is kept. Paste to replace' : 'Paste a key, if it needs one', (v) => act(() => api('api/engines/key', { id: a.id, key: v }).then(() => load(['engines'])), v ? 'The key is kept on Home. It is never shown again.' : 'The key is forgotten.')(), 'password');
  key.autocomplete = 'off';
  const gone = pill('Remove', act(() => api('api/engines/key', { id: a.id, key: '' }).then(() => save({ apis: st.apis.filter((x) => x.id !== a.id) })).then(() => load(['engines'])), `${a.name} is removed.`));
  const state = a.up ? `Answering, ${a.models.length} ${a.models.length === 1 ? 'model' : 'models'}.${a.local ? ' Nothing leaves Home.' : ' What it is asked leaves Home.'}` : a.error || 'Not answering.';
  return row(a.name, `${a.url} · ${state}`, group(a.local ? null : key, gone), a.up ? '' : 'bad');
}
const other = { name: '', url: '' };
function engines() {
  if (!H.engines || !H.settings) return [away()];
  const e = H.engines, st = H.settings;
  const add = (id, name, url) => act(() => save({ apis: [...st.apis, { id, name, url }] }).then(() => load(['engines'])), `${name} is added.`)();
  const unused = PRESETS.filter(([id]) => !st.apis.some((a) => a.id === id));
  const own = group(field('Name of the server', other.name, 'Name', (v) => (other.name = v)), field('Address of the server', other.url, 'https://…/v1', (v) => (other.url = v), 'url'),
    pill('Add', () => { const id = (other.name.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'server') + (st.apis.length + 1); if (!other.url) return say('Give the address of the server.'); const [n, u] = [other.name, other.url]; other.name = other.url = ''; add(id, n || 'Server', u); }));
  return [
    box('Who does what', 'Two jobs can use a model. Press a job, then whoever should do it. Neither is needed: without one, spines keep their plain style and key lines are ranked.', bay(),
      el('p', 'why', 'A tool is started in an empty folder and asked one question. For a book you do not trust, choose Claude Code or a server: those cannot act on what a book says.')),
    box('Servers', 'Anything that speaks the OpenAI chat API: a model on Home, or a service you have a key for.',
      rows(...e.apis.map(serverRow), unused.length ? row('Add one you may have', '', group(...unused.map(([id, name, url]) => pill(name, () => add(id, name, url))))) : null, row('Add another', 'Its address ends where /chat/completions would begin.', own))),
    box('Voices', 'Recorded narration is made on Home. The device voice needs nothing and is always there.',
      rows(row('Plain voice', e.voices.plain ? 'Installed. Several times faster than real time.' : 'Not installed.', e.voices.plain ? null : el('code', '', 'pip install "eastroom[voice]"'), e.voices.plain ? '' : 'bad'),
        row('Storyteller', e.voices.storyteller ? (e.storyteller_ref ? 'Installed, with its reference recording.' : 'Installed, but ref.wav and ref.txt are missing from the storyteller folder of the library.') : 'Not installed. Apple chips only.', e.voices.storyteller ? null : el('code', '', 'pip install "eastroom[storyteller]"'), e.voices.storyteller && e.storyteller_ref ? '' : 'bad'),
        row('Packing the sound', e.ffmpeg ? 'Ready.' : 'Narration needs ffmpeg to pack its audio.', null, e.ffmpeg ? '' : 'bad'))),
    box('Formats', 'EPUB, comics (CBZ) and plain text need nothing more.',
      rows(row('PDF', e.pdf ? 'Ready. Books of prose are read as text; everything else is kept as its pages.' : 'Needs one more package on Home.', e.pdf ? null : el('code', '', 'pip install "eastroom[pdf]"'), e.pdf ? '' : 'bad'))),
  ];
}

// ---------- Storage: what takes room, and taking it back ----------
function storage() {
  if (!H.work || !H.settings) return [away()];
  const books = H.work.books, sum = { Voice: 0, Originals: 0, Pictures: 0, Text: 0 }, st = H.settings.storage;
  for (const b of books) { sum.Originals += b.bytes.original; sum.Text += b.bytes.text; sum.Pictures += b.bytes.pictures; sum.Voice += Object.values(b.bytes.voice).reduce((a, n) => a + n, 0); }
  const total = Object.values(sum).reduce((a, n) => a + n, 0), big = el('div', 'big', size(total)), bar = el('div', 'bar'), legend = el('ul', 'legend'); big.append(el('span', '', `in ${books.filter((b) => !b.removed).length} books · ${size(H.work.free)} free on Home`));
  Object.entries(sum).forEach(([k, n], i) => { if (!n) return; const s = el('i'); s.style.cssText = `flex:${n};--n:${i}`; bar.append(s); const li = el('li', '', `${k} ${size(n)}`); li.style.setProperty('--n', i); legend.append(li); });
  const gone = (b, what, label) => pill(label, act(() => api('api/remove', { book: b.slug, what }), `Removed. It is held for ${H.work.hold_days} days and can be brought back below.`));
  const list = books.filter((b) => !b.removed).sort((a, b) => b.bytes.total - a.bytes.total).map((b) => {
    const parts = [b.bytes.original && `file ${size(b.bytes.original)}`, ...Object.entries(b.bytes.voice).map(([n, v]) => `${n} voice ${size(v)}`), b.bytes.pictures && `pictures ${size(b.bytes.pictures)}`, `text ${size(b.bytes.text)}`].filter(Boolean);
    return row(`${b.title} · ${size(b.bytes.total)}`, parts.join(' · '), pill('Free space', (e) => menu(e.currentTarget, [
      ...Object.keys(b.bytes.voice).filter((n) => n !== 'recorded' && !b.outside).map((n) => gone(b, 'voice:' + n, `Remove ${n} voice`)), b.original ? gone(b, 'original', 'Remove the file') : null, gone(b, 'book', 'Remove the book'),
      sure('Forget completely', `Forget "${b.title}" completely? Its reading history and kept lines go too. It is held for ${H.work.hold_days} days, then deleted.`, 'Forget it', () => api('api/remove', { book: b.slug, what: 'book', forget: true }), 'Forgotten. Held for a week, then deleted.')])));
  });
  const held = H.work.held.map((h) => row(`${h.title} · ${h.what === 'book' ? (h.forget ? 'the whole book' : 'the book') : h.what === 'original' ? 'its file' : h.what.replace('voice:', '') + ' voice'}`, `${size(h.bytes)} · deleted for good in ${h.days_left} ${h.days_left === 1 ? 'day' : 'days'}`,
    group(pill('Bring back', act(() => api('api/restore', { id: h.id }), (out) => (out?.left ? 'It is back. What you made again since was kept, and the older copy stays held.' : 'It is back.'))), sure('Delete now', 'Delete this for good? It cannot be brought back.', 'Delete for good', () => api('api/purge', { id: h.id }), 'Deleted.'))));
  return [
    box('Room taken', '', big, bar, legend),
    box('Rules', 'Home tidies by these on its own. What it removes is held like anything else.',
      rows(row('Remove recorded voice after a book is finished', 'The device voice still reads it, and the voice can be made again.', seg([[0, 'Never'], [30, '30 days'], [90, '90 days']], st.voice_days, (v) => save({ storage: { voice_days: v } }).catch((e) => say(e.message)))),
        row('Keep one voice for a book', 'When the storyteller has a whole book, its plain voice goes.', onOff(st.one_voice, (v) => save({ storage: { one_voice: v } }).catch((e) => say(e.message)))))),
    held.length ? box('Held', `Removed things wait here for ${H.work.hold_days} days.`, rows(...held)) : null,
    box('Books, largest first', 'Removing a book keeps your place, your reading time and your kept lines, unless you forget it completely.', rows(...list)),
  ].filter(Boolean);
}

// ---------- Devices and Home ----------
async function backup() {
  const [state, library] = await Promise.all([api('api/state'), api('api/library?all')]);
  const blob = new Blob([JSON.stringify({ made: new Date().toISOString(), books: library.map((b) => ({ slug: b.slug, title: b.title, author: b.author })), records: state }, null, 1)], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `eastroom-records-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function devices() {
  const name = el('input'); Object.assign(name, { type: 'text', value: rec.device.name, maxLength: 40 }); name.setAttribute('aria-label', 'Name of this device');
  name.onchange = () => { rec.device.name = name.value.trim() || rec.device.name; set('eastroom:device', rec.device); say('Renamed. Other devices see it after your next reading here.'); };
  const seen = new Map(); for (const records of Object.values(get('eastroom:others', {}))) for (const [id, r] of Object.entries(records)) if (r.seen && (!seen.has(id) || r.seen > seen.get(id)[1])) seen.set(id, [r.name || id, r.seen]);
  const others = [...seen].filter(([id]) => id !== rec.device.id && id !== 'before').sort((a, b) => b[1][1] - a[1][1]).map(([, [n, t]]) => row(n, `Last met Home ${ago(t)}.`));
  const login = H.engines?.login, reach = H.engines?.reach?.[0], out = [
    box('This device', '', rows(row('Name', 'How this device is named on the others.', name),
      row('Its own copy', 'Books and voice kept here so reading does not need Home. Clearing it loses nothing: Home has it all.', pill('Clear the copy', act(async () => { for (const k of await caches.keys()) if (k.startsWith('eastroom-books')) await caches.delete(k); for (const k of Object.keys(localStorage)) if (k.startsWith('eastroom:held:')) localStorage.removeItem(k); }, 'Cleared.'))))),
    H.own.length ? box('Books added in this browser', 'This browser read these files itself and keeps the books in its own storage. Nothing was sent anywhere. A browser may clear its storage when the device runs short of room: East Room on your own computer keeps books for good.',
      rows(...H.own.map((b) => row(b.title, b.author || '', sure('Remove', `Remove "${b.title}" from this browser? Your file stays where it is.`, 'Remove', () => dropBook(b.slug), 'Removed from this browser.'))))) : null,
    box('Other devices', others.length ? '' : 'No other device has met Home yet.', rows(reach ? row('Open East Room on a phone or tablet', 'On a device that is on your private network. Then Share, and "Add to Home Screen".', group(el('code', '', reach), pill('Copy', () => navigator.clipboard.writeText(reach).then(() => say('The address is copied.'), () => say('Select the address and copy it by hand.')))))
      : H.engines ? row('Open East Room on a phone or tablet', 'Home answers on this computer only. Three steps give it a private address that only your own devices can open.', steps(
        ['Install Tailscale on this computer and on the phone, signed in to the same account.'],
        ['On this computer, run ', el('code', '', `tailscale serve --bg --https=10000 http://127.0.0.1:${location.port || 4800}`), ' and then ', el('code', '', 'tailscale serve status'), ', which prints the address.'],
        ['Stop Home and start it with that address: ', el('code', '', 'eastroom --origin https://the-address-it-printed:10000'), '. Then open the address on the phone.'])) : null, ...others)),
  ];
  if (H.none) out.push(box('Home', H.none)); else out.push(box('Home', rec.home.met ? `Met ${ago(rec.home.met)}.` : '',
    rows(login?.can ? row('Start with the computer', login.on ? 'Home starts by itself when you log in.' : 'Today Home stops when its terminal closes. Takes effect at your next login.', onOff(login.on, (v) => api('api/login', { on: v }).then((o) => { H.engines.login.on = o.on; say(o.on ? 'Home will start at your next login.' : 'Home will not start by itself.'); show(); }, (e) => say(e.message)))) : null,
      row('Backup', 'One file with every device\'s place, reading time and kept lines, for every book.', pill('Download', act(backup, 'Saved to your downloads.'))))));
  return out.filter(Boolean);
}

// ---------- the rooms ----------
const ROOMS = { reading: ['Reading', reading, ['now'], 'Reading belongs to this device. A phone and a desk can differ.'], workshop: ['Workshop', workshop, ['work', 'settings'], 'What Home makes for your books, and what each book has.'],
  engines: ['Engines', engines, ['engines', 'settings'], 'Who Home may ask, the voices it can record and the files it can read.'], storage: ['Storage', storage, ['work', 'settings'], 'The room your books take. What you remove is held for seven days.'], devices: ['Devices', devices, ['engines'], 'This device, the others, and Home itself.'] };
let at = ROOMS[location.hash.slice(1)] ? location.hash.slice(1) : 'reading', timer, drawn = '', drawnNow;
const tabs = $('#rooms');
for (const [k, [label]] of Object.entries(ROOMS)) { const b = el('button', '', label); b.setAttribute('role', 'tab'); b.dataset.k = k; b.onclick = () => { at = k; history.replaceState(null, '', '#' + k); show(); }; tabs.append(b); }
function draw() {
  const fresh = drawn !== at, key = H.now ? H.now.slug + H.now.ch.id + H.now.line : '';
  if (at === 'reading' && !fresh && key === drawnNow && $('#desk')) return;   // the page holds its own state; only another book changes it
  const made = el('div'); made.append(...ROOMS[at][1]()); drawn = at; drawnNow = key;
  if (fresh || at === 'reading') { room.replaceChildren(...made.childNodes); room.classList.remove('in'); if (fresh) { void room.offsetWidth; room.classList.add('in'); scrollTo(0, 0); } } else morph(room, made);
  wires();
}
async function show() {
  for (const b of tabs.children) b.setAttribute('aria-selected', String(b.dataset.k === at)); $('#about').textContent = ROOMS[at][3]; tabs.querySelector('[aria-selected=true]')?.scrollIntoView({ inline: 'center', block: 'nearest' });
  const mine = at, need = ROOMS[at][2]; if (need.every((k) => got.has(k))) draw();
  await load(need); if (mine !== at) return; draw();
  if (led && at === 'workshop' && $('#books')) { led = false; $('#books').closest('section').scrollIntoView({ block: 'start' }); }
  clearTimeout(timer);                                            // while work is under way the workshop looks again by itself
  if (at === 'workshop' && H.work?.queue.jobs.length && !document.hidden) timer = setTimeout(show, 2500);
}
speechSynthesis?.addEventListener?.('voiceschanged', () => { const v = at === 'reading' && $('#keys') && voicesBox(); if (v) ($('#voices') ? $('#voices').replaceWith(v) : $('#keys').append(v)); });
addEventListener('visibilitychange', () => !document.hidden && show());
addEventListener('hashchange', () => { const k = location.hash.slice(1); if (ROOMS[k] && k !== at) { at = k; show(); } });   // a link to a room from elsewhere, or the back button
show().then(() => load(['work', 'settings', 'engines']));   // the other rooms are asked for ahead, so each stands the moment it is opened
requestAnimationFrame(shine);
