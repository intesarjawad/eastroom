// Finding the panels of a comic page without a model: cut the page along its gutters, across then down, until nothing more can be cut.
// A gutter is a run of lines that hold nothing but the colour of the page's edge (white paper, or black). No browser in here, so the rule
// can be tested on its own (tests/web/panels.test.mjs).
// shortcut: pages whose panels have no gutters (full-bleed art, overlapping insets, slanted frames) come back as no panels and are read whole; a trained detector is the upgrade.
export function findPanels(lum, w, h, rtl = false) {               // lum: one brightness per pixel, 0 to 255. Returns boxes [x, y, width, height] as fractions of the page, in reading order
  let edge = 0, n = 0;
  for (let x = 0; x < w; x += 2) for (const y of [1, h - 2]) { edge += lum[y * w + x]; n++; }
  for (let y = 0; y < h; y += 2) for (const x of [1, w - 2]) { edge += lum[y * w + x]; n++; }
  const paper = edge / n > 127, ink = (x, y) => (paper ? lum[y * w + x] < 205 : lum[y * w + x] > 50);
  const bands = ([x0, y0, x1, y1], down) => {                     // the stretches between gutters, along one direction
    const long = down ? y1 - y0 : x1 - x0, wide = down ? x1 - x0 : y1 - y0, need = Math.max(3, Math.round((down ? h : w) * 0.012)), out = []; let start = -1, gap = 0;
    for (let a = 0; a < long; a++) {
      let c = 0; for (let b = 0; b < wide; b++) c += ink(down ? x0 + b : x0 + a, down ? y0 + a : y0 + b);
      if (c <= wide * 0.012) { gap++; continue; }
      if (start < 0) start = a; else if (gap >= need) { out.push([start, a - gap]); start = a; }
      gap = 0;
    }
    if (start >= 0) out.push([start, long - gap]);
    return out.map(([a, b]) => (down ? [x0, y0 + a, x1, y0 + b] : [x0 + a, y0, x0 + b, y1]));
  };
  const cut = (box, down, depth, stuck) => {
    const parts = bands(box, down);
    if (parts.length <= 1) { const b = parts[0] || box; return stuck || depth >= 6 ? [b] : cut(b, !down, depth, true); }   // nothing to cut this way: try the other way once
    if (!down && rtl) parts.reverse();
    return parts.flatMap((p) => cut(p, !down, depth + 1, false));
  };
  const found = cut([0, 0, w, h], true, 0, false).filter(([x0, y0, x1, y1]) => x1 - x0 > w * 0.1 && y1 - y0 > h * 0.06);
  return found.length > 1 && found.length <= 16 ? found.map(([x0, y0, x1, y1]) => [x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h]) : [];   // one box is the page itself; a great many is a page of text
}
