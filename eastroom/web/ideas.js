// Every line you kept, from every book and every device, with your notes. A line carries its own words, so it is shown even when
// its book has been removed. Notes are optional and are written here.
import './carry.js';
import * as rec from './state.js';

const $ = (s, r = document) => r.querySelector(s);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const room = $('#room'), sayBox = $('#say'); let sayTimer, q = '';
const say = (t) => { sayBox.textContent = t; sayBox.hidden = false; clearTimeout(sayTimer); sayTimer = setTimeout(() => (sayBox.hidden = true), 4000); };

await Promise.race([rec.sync(), new Promise((ok) => setTimeout(ok, 2500))]);
const library = await fetch('api/library?all').then((r) => r.json()).catch(() => []);
function gather() {                                               // books with kept lines, the one most recently kept from first
  return library.map((b) => { const order = b.chapters.map((c) => c.id), v = rec.view(b.slug, order);
    const lines = Object.entries(v.kept).filter(([, e]) => e.exact).map(([key, e]) => { const [ch, w] = key.split(':'); return { key, e, ch, w: +w, pi: order.indexOf(ch) }; }).sort((a, c) => a.pi - c.pi || a.w - c.w);
    return { b, lines, last: Math.max(0, ...lines.map((l) => l.e.t || 0)) }; }).filter((x) => x.lines.length).sort((a, c) => c.last - a.last);
}
function markdown(sets) {
  return sets.map(({ b, lines }) => `# ${b.title}${b.author ? `\n\n${b.author}` : ''}\n\n` + lines.map((l) => `> ${l.e.exact}\n\n${l.e.note ? l.e.note.trim() + '\n\n' : ''}`).join('')).join('\n');
}
function mark(text) {                                             // the words you searched for, shown where they are
  const out = el('blockquote'), f = q.trim().toLowerCase(), at = f ? text.toLowerCase().indexOf(f) : -1;
  if (at < 0) out.textContent = text; else out.append(text.slice(0, at), el('mark', '', text.slice(at, at + f.length)), text.slice(at + f.length));
  return out;
}
function show() {
  const f = q.trim().toLowerCase(), all = gather(), sets = all.map((s) => ({ ...s, lines: s.lines.filter((l) => !f || (l.e.exact + ' ' + (l.e.note || '') + ' ' + s.b.title).toLowerCase().includes(f)) })).filter((s) => s.lines.length);
  if (!all.length) return room.replaceChildren(el('p', 'empty', 'Nothing kept yet. In the reader, press Keep (or K) on a sentence worth carrying. It appears here, from every device.'));
  if (!sets.length) return room.replaceChildren(el('p', 'empty', 'No kept line has those words.'));
  room.replaceChildren(...sets.map(({ b, lines }) => {
    const s = el('section', 'idea-book'); s.id = b.slug; s.append(el('h2', '', b.title), el('p', '', [b.author, `${lines.length} ${lines.length === 1 ? 'line' : 'lines'}`, b.removed && 'book removed'].filter(Boolean).join(' · ')));
    for (const l of lines) {
      const row = el('div', 'idea'), note = el('div', 'note'), ta = el('textarea'), acts = el('div', 'acts'), part = b.chapters[l.pi];
      Object.assign(ta, { rows: l.e.note ? Math.min(6, Math.ceil(l.e.note.length / 70)) : 1, placeholder: 'Add a note', value: l.e.note || '' }); ta.setAttribute('aria-label', 'Your note on this line');
      ta.onchange = () => { rec.noteLine(b.slug, l.key, l.e, ta.value.trim()); l.e = { ...l.e, note: ta.value.trim() }; say('Note saved.'); };
      note.append(ta);
      const pill = (label, fn) => { const k = el('button', 'pill', label); k.type = 'button'; k.onclick = fn; acts.append(k); };
      if (!b.removed) pill('Open', () => { rec.setPlace(b.slug, l.ch, l.w, l.e.exact); location.href = `read.html?book=${encodeURIComponent(b.slug)}`; });
      pill('Copy', () => navigator.clipboard?.writeText(`${l.e.exact}\n\n${b.title}${b.author ? ', ' + b.author : ''}`).then(() => say('Copied.'), () => say('This browser did not allow copying.')));
      pill('Release', () => { rec.release(b.slug, l.key); say('Released.'); show(); });
      row.append(mark(l.e.exact), el('div', 'where', part ? `Part ${l.pi + 1} of ${b.chapters.length} · ${part.title}` : ''), note, acts); s.append(row);
    }
    return s;
  }));
  if (location.hash && !show.jumped) { show.jumped = true; document.getElementById(location.hash.slice(1))?.scrollIntoView(); }
}
const find = el('input', 'find'); Object.assign(find, { type: 'text', placeholder: 'Find in your kept lines and notes' }); find.setAttribute('aria-label', 'Find in your kept lines and notes'); find.style.margin = '0'; find.oninput = () => { q = find.value; show(); };
const out = el('button', '', 'Export as Markdown'); out.onclick = () => { const sets = gather(); if (!sets.length) return say('There is nothing to export yet.');
  const a = el('a'); a.href = URL.createObjectURL(new Blob([markdown(sets)], { type: 'text/markdown' })); a.download = `eastroom-ideas-${new Date().toISOString().slice(0, 10)}.md`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000); say('Saved to your downloads.'); };
$('#rooms').append(find, out);
rec.watch(() => document.activeElement?.tagName !== 'TEXTAREA' && show());   // another device's lines arrive when Home answers
show();
