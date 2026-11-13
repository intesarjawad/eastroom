// A book's colours: two per part (ground and accent, with a deep and an ink beside them).
// Home may hold a set made from the book's own pictures (worlds.json). Without one, the hues step round the wheel by the
// golden angle from the cover's strongest hue, so every part differs and the whole still belongs to the cover.
const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const unlin = (c) => (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(c, 0) ** (1 / 2.4) - 0.055);

function oklab(r, g, b) {
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b), m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b), s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
function rgb(L, C, h) {
  const a = C * Math.cos(h * Math.PI / 180), b = C * Math.sin(h * Math.PI / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s].map(unlin);
}
export function fit(L, C, h) {                                    // lower the chroma until the colour exists on a screen
  let c = rgb(L, C, h);
  while (C > 0 && (Math.min(...c) < -0.001 || Math.max(...c) > 1.001)) { C -= 0.004; c = rgb(L, Math.max(C, 0), h); }
  return '#' + c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('');
}

export function strongestHue(data) {                              // RGBA pixels -> the hue the picture holds most of, strong colour counting most
  const hist = new Array(36).fill(0);
  for (let i = 0; i < data.length; i += 4) {
    const [, a, b] = oklab(lin(data[i] / 255), lin(data[i + 1] / 255), lin(data[i + 2] / 255)), h = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    hist[Math.min(35, Math.floor(h / 10))] += a * a + b * b;
  }
  const soft = hist.map((v, i) => 0.25 * hist[(i + 35) % 36] + 0.5 * v + 0.25 * hist[(i + 1) % 36]);
  return soft.indexOf(Math.max(...soft)) * 10 + 5;
}

function coverHue(src) {
  return new Promise((ok) => {
    const im = new Image();
    im.onload = () => { try { const c = new OffscreenCanvas(64, 64).getContext('2d'); c.drawImage(im, 0, 0, 64, 64); ok(strongestHue(c.getImageData(0, 0, 64, 64).data)); } catch { ok(null); } };
    im.onerror = () => ok(null); im.src = src;
  });
}

export function stepped(chapters, start) {
  return chapters.map((ch, i) => {
    const ground = (start + i * 137.508) % 360, accent = (ground + 150) % 360;
    return { id: ch.id, ground: fit(0.28, 0.14, ground), deep: fit(0.17, 0.09, ground), ink: fit(0.95, 0.03, accent), accent: fit(0.8, 0.17, accent), h: [Math.round(ground), Math.round(accent)], thumb: false };
  });
}

export async function worldsFor(book) {
  if (book.worlds) { try { const r = await fetch(`api/book/${book.slug}/worlds`); if (r.ok) return await r.json(); } catch {} }
  const key = 'eastroom:hue:' + book.slug; let hue = null;
  try { hue = JSON.parse(localStorage.getItem(key)); } catch {}
  if (hue == null && book.cover) { hue = await coverHue(`media/${book.slug}/${book.cover}`); try { if (hue != null) localStorage.setItem(key, hue); } catch {} }
  return stepped(book.chapters, hue ?? [...book.title].reduce((a, c) => a + c.charCodeAt(0), 0) * 37 % 360);
}
