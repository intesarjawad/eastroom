// The library as shelves of books. Every book is a solid with its own cover, its lettered spine and its pages, lit by one light that follows the hand,
// standing on walnut boards before the back of the case, all drawn in a single pass. The sheet they are drawn on rides with the page, so a spine stays locked to the words around it and only depth is redrawn.
import { titleRows } from './world.js';

const VERT = `#version 300 es
layout(location=0) in vec3 c; layout(location=1) in vec3 n;
layout(location=2) in vec4 aPos; layout(location=3) in vec4 aDim; layout(location=4) in vec4 aSp; layout(location=5) in vec4 aCv; layout(location=6) in vec4 aTint; layout(location=7) in vec4 aFx;
uniform vec3 uCam; uniform vec4 uBox;
out vec3 vC, vW, vN; flat out vec3 vF, vT; flat out vec4 vDim, vSp, vCv, vTint, vFx;
void main(){
  // a book in its own space: the spine is the front, the cover is the right side, the hinge between them is the axis it turns on
  vec3 p = vec3((c.x - 1.) * aDim.x, c.y * aDim.y, (c.z - 1.) * aDim.z);
  if (aDim.w < 1. && c.z > .5) p.z += min(aDim.x * .16, 6.5) * (1. - (2. * c.x - 1.) * (2. * c.x - 1.));   // the rounded back of a bound book
  if (aDim.w == 5. && c.z < .5) p.z += min(aDim.x * .1, 4.) * (1. - (2. * c.x - 1.) * (2. * c.x - 1.));   // and the fore-edge of its pages is hollow to match
  float s = sin(aPos.w), k = cos(aPos.w);
  vec3 q = vec3(p.x * k + p.z * s, p.y, p.z * k - p.x * s);
  vW = vec3(aPos.x + q.x, aPos.y - q.y, aPos.z + q.z);                     // page px, y down, z toward the reader
  vN = vec3(n.x * k + n.z * s, n.y, n.z * k - n.x * s); vT = vec3(k, 0., -s);
  vC = c; vF = n; vDim = aDim; vSp = aSp; vCv = aCv; vTint = aTint; vFx = aFx;
  float w = (uCam.z - vW.z) / uCam.z;                                      // the plane of the spines is the page itself: nothing on it moves when the eye does
  vec2 scr = uCam.xy + (vW.xy - uCam.xy) / w;
  if (aDim.w == 6.) scr.y = max(scr.y, aSp.x);                             // the back of the case never shows above the shelf that closes its bay, however far below the eye it stands
  gl_Position = vec4(((scr - uBox.xy) / uBox.zw * 2. - 1.) * vec2(1., -1.) * w, -vW.z / 4000. * w, w);
}`;

const FRAG = `#version 300 es
precision highp float;
in vec3 vC, vW, vN; flat in vec3 vF, vT; flat in vec4 vDim, vSp, vCv, vTint, vFx;
uniform sampler2D uInk, uCovers, uHi, uWood;
uniform vec3 uLight, uAcc, uPage, uDeep; uniform vec2 uInkSize, uCovSize;
out vec4 o;
const vec3 LUM = vec3(.2126, .7152, .0722);
float hash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
void main(){
  if (vFx.x < .995 && hash(floor(gl_FragCoord.xy)) >= vFx.x) discard;       // a book arrives and leaves grain by grain: nothing to sort, nothing seen through
  // a book is built as a binder builds it: a rounded back (0), two boards (3 front, 4 back) and the block of pages (5) standing a little inside them. 1 is the shelf, 2 a marker, 6 the back of the case
  float kind = floor(vDim.w + .001), cw = fract(vDim.w) * 2000.;
  vec3 N = normalize(vN), px = vC * vDim.xyz, tint = vTint.rgb, col, glint = vec3(1.), glow = vec3(0.);
  float foil = 0., gloss = 30., tl = dot(tint, LUM);
  bool cover = kind == 3. && vF.x > .5;
  if (kind == 2.) { col = uAcc * .8; glow = uAcc * .35;
  } else if (kind == 1.) {                                                   // the shelf: a walnut board whose front edge catches the light
    vec3 wood = texture(uWood, (vF.z > .5 ? vec2(vW.x, vW.y * 2.5) : vec2(vW.x, vW.z)) / 760.).rgb;
    col = wood * (vF.z > .5 ? 1.5 : vF.y > .5 ? .35 + 1.1 * vC.z * vC.z : .3);
    if (vF.z > .5) { foil = .12 + .7 * smoothstep(.6, 1., vC.y); glint = mix(uAcc, uPage, .3); gloss = 5.; }
  } else if (kind == 6.) {                                                   // the back of the case: darker under the shelf above, darkest in its corners
    col = texture(uWood, vW.xy / 900.).rgb * (.07 + .34 * smoothstep(1., .3, vC.y)) * smoothstep(0., .05, vC.y);
  } else if (kind == 0.) {
    if (vF.z > .5) {                                                         // the back: the cover's own picture comes round the hinge onto it, as a printed jacket does
    vec2 wr = vec2(min((1. - vC.x) * vDim.x / cw, .07), 1. - vC.y);              // only the cover's edge comes round: further in there may be lettering, which would arrive mirrored
    vec3 art = vFx.z > .5 ? texture(uHi, wr).rgb : vCv.z > .5 ? texture(uCovers, (vCv.xy + .5 + wr * (vCv.zw - 1.)) / uCovSize).rgb : tint;
    col = mix(art, tint, .22);
    float m = vSp.z > .5 ? texture(uInk, (vSp.xy + vec2(vC.x, 1. - vC.y) * vSp.zw) / uInkSize).r : 0., bed = smoothstep(.06, .38, m), word = smoothstep(.5, .88, m);
    bool pale = tl < .52;                                                    // pale lettering on a dark jacket, dark on a light one; under the letters the picture steps back so they can be read
    col = mix(col, pale ? col * .38 : mix(col, vec3(.95, .93, .88), .62), bed * .85);
    col = mix(col, pale ? mix(vec3(.96, .93, .86), tint, .08) : tint * .12, word); foil = word * (pale ? 1. : .15); glint = mix(vec3(1.), tint / max(tl, .08), .35);
    N = normalize(N + vT * (vC.x - .5) * 8. * min(.16, 6.5 / vDim.x));        // the back of a bound book is rounded: the light follows the curve it is drawn with
    col *= .95 + .1 * hash(floor(px.xy * 1.6) + tint.rg * 61.);              // the tooth of paper and cloth
    col *= 1. - .5 * (exp(-px.x / 2.2) + exp(-(vDim.x - px.x) / 2.2));       // the hinges either side
    col *= 1. - .28 * (exp(-px.y / 3.5) + exp(-(vDim.y - px.y) / 3.5));      // head and tail, rubbed dark
    foil = max(foil, .1); gloss = 26.;                                       // the jacket itself takes a soft shine down its curve
    float up = (px.y - 7.) / (vDim.y - 14.), edge = smoothstep(1.2, 2.2, px.x) * smoothstep(5., 4., px.x) * step(0., up) * step(up, 1.);
    if (vTint.a > 0.) { float lit = step(up, vTint.a); col = mix(col, mix(col, uPage, .25), edge * (1. - lit)); col *= 1. - edge * lit; glow = uPage * edge * lit * .7; }   // how far it has been read: light climbs the edge of the spine
    if (vFx.w > .5) { float d = length(vec2(px.x - vDim.x * .5, px.y - vDim.y + 10.)), dot_ = smoothstep(3.3, 2.3, d); col *= 1. - dot_; glow += uAcc * dot_; }   // not opened yet
    } else col = tint * .55;
  } else if (kind == 5.) {                                                   // the pages
    bool gilt = hash(tint.rg * 61. + 3.) > .72;                               // about one book in four has gilt edges
    col = (gilt ? vec3(.72, .55, .26) : vec3(.93, .89, .8)) * (.86 + .14 * step(.5, fract(px.x * .9))) * (vF.y > .5 ? .8 : 1.);
    if (vF.z < -.5) N = normalize(N - vT * (vC.x - .5) * .9);                 // the hollow fore-edge
    foil = gilt ? .7 : .08; gloss = gilt ? 9. : 14.; glint = gilt ? vec3(1., .82, .5) : vec3(1.);
    col *= 1. - .42 * (exp(-px.x / 2.5) + exp(-(vDim.x - px.x) / 2.5));      // the boards stand proud of the pages and shade them
    if (abs(vF.y) > .5 && px.z > vDim.z - 3.5) col = mix(tint * .9, vec3(.88, .85, .78), step(.5, fract(px.x * .5)));   // the headband, sewn in the book's own colour
    if (vF.y < -.5) col *= .3;
  } else {                                                                   // the boards
    vec2 q = vec2((1. - vC.z) * vDim.z - vDim.z + 3., 3. - min(px.y, vDim.y - px.y));
    if (abs(vF.x) > .5 && q.x > 0. && q.y > 0. && length(q) > 3.) discard;   // their outer corners are rounded
    if (cover) {
    vec2 uv = vec2(1. - vC.z, 1. - vC.y);
    col = vFx.z > .5 ? texture(uHi, uv).rgb : vCv.z > .5 ? texture(uCovers, (vCv.xy + .5 + uv * (vCv.zw - 1.)) / uCovSize).rgb : tint * (.75 + .5 * uv.y);
    float hx = uv.x * vDim.z, cl = dot(col, LUM), sat = max(col.r, max(col.g, col.b)) - min(col.r, min(col.g, col.b));
    col *= (1. - .5 * exp(-hx / 1.8)) * (1. - .2 * exp(-pow((hx - 7.) / 2.2, 2.))); col += .05 * exp(-pow((hx - 10.5) / 1.6, 2.));   // the groove every bound book has
    foil = .1 + .55 * sat * smoothstep(.2, .65, cl); glint = mix(vec3(1.), col / max(cl, .06), .65); gloss = 22.;                      // what is bright and strongly coloured flashes like foil
    vec3 Z = cross(vT, vec3(0., 1., 0.)); float eT = exp(-(vDim.y - px.y) / 1.5), eB = exp(-px.y / 1.5), eF = exp(-px.z / 1.5), jo = (hx - 7.) / 2.2;
    N = normalize(N + vec3(0., 1., 0.) * (eT - eB) * .9 - Z * eF * .9 + Z * jo * exp(-jo * jo) * 1.4);   // the board's edges are turned over and rounded, and the joint is a valley: the light finds both
    col *= 1. - .22 * eB - .1 * eF; col += .07 * eT * (1. - eF);              // the top edge catches what light there is, the tail sits in its own shade
    } else if (abs(vF.x) < .5 && kind == 3.) {                               // the print carried over the board's edges
      vec2 uv = vF.z < -.5 ? vec2(.992, 1. - vC.y) : vec2(1. - vC.z, vF.y > 0. ? .008 : .992);
      col = (vFx.z > .5 ? texture(uHi, uv).rgb : vCv.z > .5 ? texture(uCovers, (vCv.xy + .5 + uv * (vCv.zw - 1.)) / uCovSize).rgb : tint) * .9;
    } else col = abs(vF.x) < .5 ? tint * .92 : kind == 4. && vF.x < -.5 ? tint * .8 : mix(tint, vec3(.84, .8, .7), .55) * .62;   // the cloth turned over the edges, the back board, and the endpaper pasted inside
  }
  vec3 Lv = vec3(uLight.x - vW.x, vW.y - uLight.y, uLight.z - vW.z);
  float d2 = dot(Lv, Lv), att = 1. / (1. + d2 / 372000.); vec3 L = Lv * inversesqrt(d2);
  float dif = max(dot(N, L), 0.), sp = pow(max(dot(N, normalize(L + vec3(0., 0., 1.))), 0.), gloss) * att;
  if (kind != 1. && kind != 2. && kind != 6.) col *= .7 + .3 * smoothstep(0., 16., px.y + (kind == 5. ? 3. : 0.));   // where a book meets the shelf
  // a cover keeps its own colours whatever the light does; everything else stands in the half dark until the light comes by
  col = col * ((cover ? .76 : kind == 5. ? .6 : .4) + .1 * vFx.y + (cover ? .3 : .8) * dif * att) + glint * foil * sp * 1.25 + glow;
  o = vec4(col, 1.);
}`;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255), clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const NONE = [0, 0, 0, 0], PLAIN = [0.2, 0.18, 0.17], DEEP = 250,   // how deep a shelf is: deeper than the largest book standing spine out
  rnd = (n) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

export function makeShelf() {
  const el = Object.assign(document.createElement('canvas'), { className: 'shelf' }); el.setAttribute('aria-hidden', 'true');
  const gl = el.getContext('webgl2', { antialias: true, alpha: true, powerPreference: 'high-performance' });
  if (!gl) return null;                                   // no WebGL2: the library keeps its wall of covers
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.linkProgram(prog); gl.useProgram(prog);
  const U = new Proxy({}, { get: (m, k) => m[k] ??= gl.getUniformLocation(prog, k) });
  const mesh = [];                                         // a unit box: six faces, each knowing which way it looks
  for (const n of [[0, 0, 1], [0, 0, -1], [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0]]) { const a = n.findIndex(Boolean), strips = a ? 8 : 1, other = a === 1 ? 2 : 1;   // faces that run across the thickness are cut into strips so they can follow a curve
    for (let k = 0; k < strips; k++) for (const [i, j] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) { const c = [0, 0, 0]; c[a] = n[a] > 0 ? 1 : 0;
      if (a) { c[0] = (k + i) / strips; c[other] = j; } else { c[1] = i; c[2] = j; } mesh.push(...c, ...n); } }
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(mesh), gl.STATIC_DRAW);
  for (let i = 0; i < 2; i++) { gl.enableVertexAttribArray(i); gl.vertexAttribPointer(i, 3, gl.FLOAT, false, 24, i * 12); }
  const ib = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ib);
  for (let i = 0; i < 6; i++) { gl.enableVertexAttribArray(2 + i); gl.vertexAttribPointer(2 + i, 4, gl.FLOAT, false, 96, i * 16); gl.vertexAttribDivisor(2 + i, 1); }
  gl.enable(gl.DEPTH_TEST); gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  const MAX = Math.min(4096, gl.getParameter(gl.MAX_TEXTURE_SIZE));
  const make = (unit, mip) => { const t = gl.createTexture(); gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  make(0); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.R8, MAX, MAX);              // the lettering of every spine, one channel
  make(2, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));   // the one cover in the hand, at full sharpness
  const wood = make(3, true); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([58, 34, 24, 255]));   // the case's walnut: one plain brown until its picture has come
  const ready = (() => { const im = new Image(); im.src = 'room/walnut.webp'; return im.decode().then(() => { gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, wood); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); gl.generateMipmap(gl.TEXTURE_2D); }, () => {}); })();
  gl.uniform1i(U.uInk, 0); gl.uniform1i(U.uCovers, 1); gl.uniform1i(U.uHi, 2); gl.uniform1i(U.uWood, 3); gl.uniform2f(U.uInkSize, MAX, MAX);

  // ---- lettering: each spine is set once and kept ----
  const sc = document.createElement('canvas'), sx = sc.getContext('2d', { willReadFrequently: true }); let ax = 0, ay = 0, ah = 0, G = 0;
  // a spine lettered like its cover: where Home's vision model has looked at the cover, the title is set in the nearest face of the reader's own shelf of typefaces
  const faces = new Map(), WEIGHT = { light: 420, regular: 520, bold: 700, black: 850 };   // a spine is small: nothing is set thinner than a book weight
  const own = (b) => { const f = b.book?.spine?.face; if (!f) return null; if (!faces.has(f)) { faces.set(f, false); document.fonts.load(`700 20px "${f}"`).then((l) => faces.set(f, l.length > 0), () => {}); } return faces.get(f) ? b.book.spine : null; };
  const key = (b) => `${b.t}|${b.bh}|${G}|${own(b)?.face || ''}`;
  function letter(b) {
    const k = Math.min(devicePixelRatio, 2), w = Math.round(b.t * k), h = Math.round(b.bh * k);
    if (ax + w > MAX) { ax = 0; ay += ah; ah = 0; }
    if (ay + h > MAX) { ax = ay = ah = 0; G++; return; }                     // the sheet is full: start it again, and every spine in view is set afresh
    sc.width = w; sc.height = h; sx.setTransform(k, 0, 0, k, 0, 0); sx.fillStyle = '#fff'; sx.textBaseline = 'middle';
    // a publisher's hand differs from book to book: three ways of setting a spine, chosen by the book itself (0 grotesque capitals, 1 a serif on a label, 2 spaced serif capitals between rules)
    const t = b.t, seed = b.total % 9973 + b.title.length * 7, sp = own(b), way = sp ? 3 : rnd(seed) < 0.38 ? 0 : rnd(seed) < 0.72 || t < 32 ? 1 : 2, soft = way === 1 || way === 2, top = 13 + Math.round(rnd(seed + 3) * 12), end = b.bh - 12;
    const name = (b.author || '').trim().split(/\s+/).pop().toUpperCase(), small = clamp(t * 0.3, 8.5, 11.5), face = sp ? `"${sp.face}"` : way ? 'Literata' : '"Science Gothic"', thin = sp && /Script|Unifraktur|Caveat|Poiret/.test(sp.face);
    const font = (f, st, sp = 0) => { sx.font = f; sx.fontStretch = st; sx.letterSpacing = sp + 'px'; };   // width and spacing are set after the face: setting the face clears them
    sx.translate(t / 2, 0); sx.rotate(Math.PI / 2);                          // down the spine, as English spines read
    sx.shadowColor = 'rgba(255,255,255,.4)'; sx.shadowBlur = 5 * k;          // a soft bed round every letter: read back as "the picture steps back here"
    // the author's name at the foot; in a script or blackletter face capitals cannot be read, so there it is set plainly
    font(`${soft ? 600 : 650} ${small}px ${thin ? '"Science Gothic"' : face}`, 'normal', soft ? 0.6 : 0); const aw = name ? Math.min(sx.measureText(name).width, (end - top) * 0.3) : 0;
    if (name) { sx.globalAlpha = 0.9; sx.fillText(name, end - aw, 0, aw); sx.globalAlpha = 1; }
    // a spine carries the book's short name, whole: no printed spine ends in dots. A long name takes more rows and smaller type, and at the very last is set narrower
    const short = b.title.split(/[:;]|,? or,? |\s[–—]\s/i)[0].trim() || b.title, text = way === 1 || (sp && (sp.case !== 'upper' || thin)) ? short : short.toUpperCase(), wt = sp ? WEIGHT[sp.weight] || 600 : way === 0 ? 750 : way === 1 ? 600 : 500,
      st = way === 0 || (sp && sp.width === 'condensed' && sp.face === 'Science Gothic') ? 'extra-condensed' : 'normal', track = way === 2 ? 0.08 : sp && sp.spacing === 'wide' ? 0.1 : 0;
    const room = end - top - (name ? aw + 20 : 0), most = clamp(Math.floor(t / (soft ? 12 : 10.5)), 1, 3);
    font(`${wt} 100px ${face}`, st, track * 100);
    const fit = titleRows(text, (r) => sx.measureText(r).width, room, t * (most > 1 ? 0.86 : 0.56), most), size = clamp(fit.px * 0.98, soft ? 8 : 8.5, Math.min(soft ? 17 : 21, t * (soft ? 0.46 : 0.56)));
    font(`${wt} ${size}px ${face}`, st, size * track);
    const rows = fit.rows, long = Math.min(room, Math.max(...rows.map((r) => sx.measureText(r).width))), at = way === 2 ? top + (room - long) / 2 : top;
    sx.shadowBlur = 0;
    if (way === 1) { sx.globalAlpha = 0.34; sx.fillRect(at - 9, -t / 2 + 2.5, long + 18, t - 5); sx.globalAlpha = 0.9; sx.fillRect(at - 9, -t / 2 + 2.5, 1, t - 5); sx.fillRect(at + long + 8, -t / 2 + 2.5, 1, t - 5); }   // a label, ruled at both ends
    if (way === 2) { sx.globalAlpha = 0.75; for (const y of [7, 10, end - aw - 12]) sx.fillRect(y, -t / 2 + 4, 1, t - 8); }
    if (!soft && name) { sx.globalAlpha = 0.5; sx.fillRect(end - aw - 10, -t / 2 + 5, 1, t - 10); }
    sx.globalAlpha = 1; sx.shadowBlur = 5 * k;
    rows.forEach((r, i) => sx.fillText(r, at, (i - (rows.length - 1) / 2) * size * (soft ? 1.12 : 1.02), room));   // the first row stands on the right, as on any spine
    const d = sx.getImageData(0, 0, w, h).data, one = new Uint8Array(w * h); for (let i = 0; i < one.length; i++) one[i] = d[i * 4 + 3];
    gl.activeTexture(gl.TEXTURE0); gl.texSubImage2D(gl.TEXTURE_2D, 0, ax, ay, w, h, gl.RED, gl.UNSIGNED_BYTE, one);
    b.sp = [ax, ay, w, h]; b.spk = key(b); ax += w + 1; ah = Math.max(ah, h + 1);
  }

  // ---- covers: a small copy of every cover on one sheet, fetched as its row comes near ----
  const cc = document.createElement('canvas'), cx = cc.getContext('2d', { willReadFrequently: true }), cells = new Map(); let CW = 0, CH = 0, cols = 0, rows = 0, active = 0, hi = null, hiWant = null;
  function put(b) {
    if (!cells.has(b)) cells.set(b, cells.size); const i = cells.get(b); if (i >= cols * rows) return void (b.cs = 3);
    const x = (i % cols) * CW, y = Math.floor(i / cols) * CH; gl.activeTexture(gl.TEXTURE1); gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, gl.RGBA, gl.UNSIGNED_BYTE, cc);
    if (b.cover) { const d = cx.getImageData(0, 0, Math.max(2, CW * 0.08 | 0), CH).data, c = [0, 0, 0]; for (let j = 0; j < d.length; j += 4) for (let q = 0; q < 3; q++) c[q] += d[j + q]; const m = c.map((v) => v / (d.length / 4) / 255), l = m[0] * 0.2126 + m[1] * 0.7152 + m[2] * 0.0722; b.sc = m.map((v) => clamp(l + (v - l) * 1.35)); }   // a spine is the colour its cover has where it meets it
    b.cv = [x, y, CW, CH]; b.cs = 2;
  }
  function want(b) {
    if (b.cs || !CW) return;
    if (!b.cover) {                                        // a book without a cover: its title on its own two colours
      const g = cx.createLinearGradient(0, 0, CW * 0.6, CH); g.addColorStop(0, b.a || '#6b6258'); g.addColorStop(1, b.g || '#2a2523'); cx.fillStyle = g; cx.fillRect(0, 0, CW, CH);
      cx.fillStyle = '#fff'; cx.font = '800 100px "Science Gothic"'; cx.fontStretch = 'extra-condensed'; cx.textBaseline = 'alphabetic';
      const t = titleRows(b.title.toUpperCase(), (r) => cx.measureText(r).width, CW * 0.8, CH * 0.5, 5); cx.font = `800 ${t.px}px "Science Gothic"`;
      t.rows.forEach((r, i) => cx.fillText(r, CW * 0.1, CH * 0.9 - (t.rows.length - 1 - i) * t.px * 0.9)); return put(b);
    }
    if (active >= 4) return; b.cs = 1; active++; const size = CW, im = new Image(); im.src = b.cover;
    im.decode().then(() => { if (size !== CW) return void (b.cs = 0); b.ar = im.naturalWidth / im.naturalHeight; cx.drawImage(im, 0, 0, CW, CH); put(b); }, () => { b.cs = 3; }).finally(() => { active--; });
  }

  let data = new Float32Array(24 * 256), ct = null, last = '', lx = null, ly = 0;
  return {
    ready,                                                 // the case's wood is in hand: the shelves can be shown
    el,
    // room for this many books; fewer books get larger copies of their covers
    fit(count) {
      const cw = count <= 18 ? 320 : count <= 70 ? 192 : 112, c = Math.floor(MAX / cw), r = Math.min(Math.ceil((count + 12) / c), Math.floor(MAX / (cw * 1.5)));
      if (cw === CW && r <= rows) return; for (const b of cells.keys()) b.cs = 0; cells.clear();
      CW = cw; CH = cw * 1.5; cols = c; rows = r; cc.width = CW; cc.height = CH; make(1); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, cols * CW, rows * CH); gl.uniform2f(U.uCovSize, cols * CW, rows * CH);
    },
    sharp(b) {                                             // the book in the hand gets its cover at full size
      if (hiWant === b || !b.cover) return; hiWant = b; const im = new Image(); im.src = b.cover;
      im.decode().then(() => { if (hiWant !== b) return; gl.activeTexture(gl.TEXTURE2); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im); gl.generateMipmap(gl.TEXTURE_2D); hi = b; }, () => {});
    },
    // books: each with gx, gy (the foot of its hinge, in the field's px), t, bh, face, vis; s: where the window is over the field, the light, the hand.
    // s.lines: the shelves, each with y and, where the back of the case stands behind it, the height h of its bay (a shelf with its own depth d has something standing on it that is not a book); s.pad: how far in from the window's edge the case's standards reach
    draw(books, s) {
      const vw = document.documentElement.clientWidth, vh = innerHeight, ch = Math.round(vh * 1.5), D = Math.max(1500, vh * 2.2);
      let k = Math.min(devicePixelRatio, 2); while (vw * ch * k * k > 15e6 && k > 1) k -= 0.25;
      const w = Math.round(vw * k), h = Math.round(ch * k);
      if (el.width !== w || el.height !== h) { el.width = w; el.height = h; el.style.width = vw + 'px'; el.style.height = ch + 'px'; ct = null; }
      if (ct == null || s.top < ct + 30 || s.top + vh > ct + ch - 30) ct = Math.round(Math.min(s.top - (ch - vh) / 2, s.fieldH + 140 - ch));   // moved only when the window nears its edge; between moves it scrolls with the page
      const tf = `translate(${-s.left}px,${ct}px)`; if (tf !== last) el.style.transform = last = tf;
      const cam = [vw / 2 - s.left, s.top + vh / 2, D], L = s.leave, kin = s.still ? 1 : 1 - Math.exp(-s.dt * 9), kout = s.still ? 1 : 1 - Math.exp(-s.dt * 26); let n = 0, budget = 14;
      const push = (v) => { if ((n + 1) * 24 > data.length) { const d = new Float32Array(data.length * 2); d.set(data); data = d; } data.set(v, n++ * 24); };
      for (const b of books) {
        if (b.gx == null) continue;
        if (b.wait > 0 && !s.still) { b.wait -= s.dt; continue; }
        if (b.go && (b.seen || 0) < 0.03) { b.gx = b.go[0]; b.gy = b.go[1]; b.go = null; }   // a book bound for another shelf steps back out of sight here and forward again there
        const tv = b.vis && !b.go && !s.out ? 1 : 0; b.seen = clamp((b.seen || 0) + (tv - (b.seen || 0)) * (tv ? kin : kout) + (tv ? 0.004 : -0.004));   // leaving is quick, arriving unhurried
        if (b.seen <= 0 || b.gy < ct - 140 || b.gy - b.bh > ct + ch + 140) { b.o = b.ov = 0; continue; }
        want(b); if (budget && b.spk !== key(b)) { letter(b); budget--; }
        const tg = b === s.hover ? 1 : 0; b.o ??= 0; b.ov ??= 0;
        if (s.still) b.o = tg; else { b.ov += ((tg - b.o) * 210 - b.ov * 25) * s.dt; b.o += b.ov * s.dt; }   // a spring just short of settling at once: the book arrives with a breath of overshoot
        const e = b.o, es = b.seen * b.seen * (3 - 2 * b.seen), cw = b.bh * clamp(b.ar || 0.66, 0.56, 0.78), q = clamp(e, 0, 1.04), near = b.near || (b.face ? 1.12 : 1.36);
        // taken in the hand a book leaves the shelf first and turns as it comes, until its whole cover faces you, larger, over the place it came from
        const zT = D * (1 - 1 / near), mid = clamp(b.gx - (b.face ? -cw / 2 : b.t / 2), cw * near / 2 + 8 - s.left + s.pad, s.W + s.left - s.pad - cw * near / 2 - 8), out = 1 - (1 - q) * (1 - q), turn = q * q * (3 - 2 * q);
        let x = b.gx + (cam[0] + (mid - cw * near / 2 - cam[0]) / near - b.gx) * turn, y = b.gy + (cam[1] + (b.gy - cam[1]) / near - b.gy) * out,
          z = (es - 1) * 70 + Math.sin(Math.PI * (b.lf ?? 1)) * 64 - (b.face ? 0 : (b.zin ??= rnd(b.total % 977 + 5) * 9) * (1 - out)) + out * zT,
          yaw = (b.face ? -1.36 : 0) + turn * (b.face ? -0.21 : -Math.PI / 2) + (tg ? s.tx * 0.13 * q : 0), fade = b.seen;
        b.hand = q > 0.35 ? [mid - cw * near / 2, mid + cw * near / 2, b.gy - b.bh * near] : null;   // where its cover now lies over the page
        if (L) { if (L.b === b) { const f = L.at ??= b.pose || [x, y, z, yaw], hp = Math.min(vh * 0.56, 520), to = [cam[0] - cw / 2, cam[1] + b.bh / 2, D * (1 - b.bh / hp), -Math.PI / 2];
          [x, y, z, yaw] = f.map((v, i) => v + (to[i] - v) * L.e); } else fade *= 1 - L.e; }   // into the book: it comes to the middle of the window, face on, at the size the reader shows it
        else b.pose = [x, y, z, yaw];
        const c = b.sc || (b.g ? b.gc ??= rgb(b.g) : PLAIN);
        const sn0 = Math.sin(yaw), cs0 = Math.cos(yaw), bt = Math.max(2, b.bh * 0.012), sq = Math.max(2.5, b.bh * 0.016), cv = b.cs === 2 ? b.cv : NONE, sharp = hi === b ? 1 : 0;
        const part = (ox, oy, oz, dx, dy, dz, kind, sp, read, fresh) => push([x + ox * cs0 + oz * sn0, y - oy, z + oz * cs0 - ox * sn0, yaw, dx, dy, dz, kind, ...sp, ...cv, c[0], c[1], c[2], read, fade, e, sharp, fresh]);
        part(0, 0, 0, b.t, b.bh, 1.5, Math.min(0.9, cw / 2000), b.spk === key(b) ? b.sp : NONE, b.p || 0, b.fresh ? 1 : 0);   // the rounded back, lettered
        part(0, 0, -1.5, bt, b.bh, cw - 1.5, 3, NONE, 0, 0); part(-b.t + bt, 0, -1.5, bt, b.bh, cw - 1.5, 4, NONE, 0, 0);       // the two boards
        part(-bt, sq, -1.5, b.t - 2 * bt, b.bh - 2 * sq, cw - 1.5 - sq, 5, NONE, 0, 0);                                         // the pages, a little inside the boards on three sides
        if (b.p > 0 && b.p < 1) { const ox = -b.t / 2 + 1.5, oz = -cw * (0.18 + 0.5 * b.p), sn = Math.sin(yaw), cs = Math.cos(yaw);   // further into the book the further you have read
          push([x + ox * cs + oz * sn, y - b.bh + 5, z + oz * cs - ox * sn, yaw, 3, 19, 1.2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, fade, 0, 0, 0]); }
      }
      for (const l of s.lines) { if (l.y < ct - 40 || l.y - (l.h || 0) > ct + ch + 40) continue; const fade = L ? 1 - L.e : 1, mid = vw / 2 - s.left, back = (D + DEEP - 14) / D, inL = s.pad - s.left, inR = s.W + s.left - s.pad, under = (x) => mid + (x - mid) * back;   // inL, inR: the inner faces of the standards. What stands at the depth of the back is seen nearer the middle, so it must reach `under` a standard to end out of sight behind it
        const a = Math.max(under(inL - 6), inL - 140), b = Math.min(under(inR + 6), inR + 140);   // a shelf ends inside the standards, front and back; a standard is never wider than 150 px unless it runs off the window
        push([b, l.y + 11, 14, 0, b - a, 11, l.d || DEEP, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, fade, 0, 0, 0]);
        if (l.h) push([under(inR + 12), l.y, 14 - DEEP, 0, under(inR + 12) - under(inL - 12), l.h, 1, 6, l.y - l.h, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, fade, 0, 0, 0]); }
      gl.viewport(0, 0, w, h); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      if (!n) return;
      const to = L ? [cam[0], cam[1]] : s.mouse ? [s.ptr[0] - s.left, s.ptr[1] + s.top] : [cam[0], s.top + vh * 0.42], kl = lx == null || s.still ? 1 : 1 - Math.exp(-s.dt * 10); lx ??= to[0];
      lx += (to[0] - lx) * kl; ly += (to[1] - ly) * kl;
      gl.uniform3f(U.uCam, ...cam); gl.uniform4f(U.uBox, -s.left, ct, vw, ch); gl.uniform3f(U.uLight, lx, ly, 230);
      gl.uniform3fv(U.uAcc, rgb(s.accent)); gl.uniform3fv(U.uPage, rgb(s.ink)); gl.uniform3fv(U.uDeep, rgb(s.deep));
      gl.bindBuffer(gl.ARRAY_BUFFER, ib); gl.bufferData(gl.ARRAY_BUFFER, data.subarray(0, n * 24), gl.DYNAMIC_DRAW);
      gl.drawArraysInstanced(gl.TRIANGLES, 0, mesh.length / 6, n);
    },
  };
}
