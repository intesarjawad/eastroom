// Reading records as plain data: how an older state file is read, and how many devices' records become one view.
// No browser, no network, no clock in here, so the rules can be tested on their own (tests/web/records.test.mjs).
// The single state file of older versions, read as one more device.
export function fromBefore(s) {
  if (!('g' in s) && !Array.isArray(s.kept) && !Array.isArray(s.done)) return s;
  const t = s.at || 0, r = { device: 'before', name: 'an earlier version', kept: {}, done: {}, days: s.days || {} };
  if (s.ch) r.place = { ch: s.ch, w: s.g | 0, t, exact: s.line || '' };
  for (const k of s.kept || []) r.kept[`${k.ch}:${k.g}:${k.n}`] = { t, exact: k.t || '' };
  for (const c of s.done || []) r.done[c] = { t, v: true };
  return r;
}

// One view from many records. `order` is the book's chapter ids in reading order. The result does not depend on the order of `records`.
export function combine(records, order) {
  const v = { place: null, by: '', far: null, farBy: '', kept: {}, done: {}, days: {}, seconds: 0, words: {}, read: 0 }, at = {};
  const pos = (p) => order.indexOf(p.ch) * 1e7 + (p.w | 0), newer = (t, d, k) => !at[k] || t > at[k][0] || (t === at[k][0] && d > at[k][1]);
  for (const r of records) {
    const d = r.device || '', p = r.place;
    if (p && order.includes(p.ch)) {
      if (newer(p.t || 0, d, 'place')) { at.place = [p.t || 0, d]; v.place = p; v.by = r.name || d; }
      if (!v.far || pos(p) > pos(v.far) || (pos(p) === pos(v.far) && d > at.far)) { at.far = d; v.far = p; v.farBy = r.name || d; }
    }
    for (const kind of ['kept', 'done']) for (const [k, e] of Object.entries(r[kind] || {})) if (newer(e.t || 0, d, kind + k)) { at[kind + k] = [e.t || 0, d]; v[kind][k] = e; }
    for (const [day, s] of Object.entries(r.days || {})) { v.days[day] = (v.days[day] || 0) + s; v.seconds += s; }
    for (const [day, n] of Object.entries(r.words || {})) { v.words[day] = (v.words[day] || 0) + n; v.read += n; }
  }
  for (const k in v.kept) if (v.kept[k].gone) delete v.kept[k];
  if (v.far && v.place && pos(v.far) <= pos(v.place)) v.far = null;   // "furthest" is only worth offering when it is ahead of where you are
  return v;
}
