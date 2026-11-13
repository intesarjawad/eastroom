// The world behind the text: one fixed canvas. Each part is its picture in two colours,
// dark until the reading light reaches it. A new part rises from below as you scroll into it.
const VERT = `#version 300 es
in vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;

const FRAG = `#version 300 es
precision highp float;
uniform vec2 uRes, uLight, uCol;
uniform float uTime, uSplit, uPower, uStill, uTitleSide, uTravel;
uniform sampler2D uPicA, uDepA, uPicB, uDepB, uTitle;
uniform vec3 uGroundA, uDeepA, uInkA, uAccA, uGroundB, uDeepB, uInkB, uAccB;
uniform float uAspA, uAspB, uOpenA, uOpenB, uNearA, uNearB;
out vec4 o;

float hash(vec2 q){ return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 q){ vec2 i = floor(q), f = fract(q); f = f*f*(3.-2.*f);
  return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }

// open: 0 = the picture as a poster, 1 = the picture as a dark room you read in
vec3 world(vec2 px, sampler2D pic, sampler2D dep, float asp, float open, vec3 ground, vec3 deep, vec3 ink, vec3 acc, float title, float near, float travel){
  vec2 uv = px / uRes, c = uv - .5; float va = uRes.x / uRes.y;
  vec2 fit = va > asp ? vec2(1., asp / va) : vec2(va / asp, 1.);
  float push = uStill > .5 ? 1. : 1. + .5 * open * open;                 // scrolling pushes into the picture
  float read = smoothstep(.3, .8, open);
  vec2 q = c * fit / push + .5;
  q.y += (travel - .5) * .15 * read * (1. - uStill);                     // the picture drifts as you read through it
  vec2 toL = (uLight - px) / uRes.y;
  float d = texture(dep, q).r;
  q -= toL * .018 * (d - .45) * (1. - uStill);                           // near things lean toward the light
  d = texture(dep, q).r;
  float lum = smoothstep(.03, .9, dot(texture(pic, q).rgb, vec3(.2126, .7152, .0722)));
  vec3 duo = mix(deep, ground * 1.5, smoothstep(0., .42, lum));
  duo = mix(duo, acc, smoothstep(.38, .8, lum));
  duo = mix(duo, ink, smoothstep(.78, 1., lum));
  // relief: the depth map gives every surface a direction to catch light from
  vec2 e = vec2(2. / 512., 0.);
  vec3 n = normalize(vec3(texture(dep, q - e.xy).r - texture(dep, q + e.xy).r, texture(dep, q - e.yx).r - texture(dep, q + e.yx).r, .05));
  float lam = clamp(dot(n, normalize(vec3(toL, .25))), 0., 1.);
  float pool = exp(-(toL.x * toL.x * 1.5 + toL.y * toL.y * 9.));           // wide and low: it reaches both margins at the height of the line
  // the poster title stands behind whatever is near
  vec2 tuv = (uv - vec2(.5, .44)) / (1. + .35 * open) + vec2(.5, .44);
  float t = texture(uTitle, tuv).a * title * (1. - smoothstep(.15, .55, open)) * (1. - smoothstep(near - .012, near + .012, d));
  duo = mix(duo, ink, max(t, texture(uTitle, tuv).a * title * (1. - smoothstep(.15, .55, open)) * .16));   // hidden letters stay faintly legible
  float calm = smoothstep(uCol.x - 190., uCol.x - 40., px.x) * (1. - smoothstep(uCol.y + 40., uCol.y + 190., px.x));
  float seen = (.05 + pool * (.7 + 1.3 * lam) * uPower) * (1. - .9 * calm);
  vec3 col = mix(ground, duo, mix(1., seen, read));
  col += ground * pool * .28 * read * uPower;                             // the light also warms the bare ground
  return col;
}

void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec3 col;
  if (uSplit >= uRes.y + 80.) col = world(px, uPicA, uDepA, uAspA, uOpenA, uGroundA, uDeepA, uInkA, uAccA, 1. - uTitleSide, uNearA, uTravel);
  else {
    float edge = uSplit + (noise(vec2(px.x * .0035, uTime * .12)) - .5) * 70. * (1. - uStill);
    float below = smoothstep(-1.5, 1.5, px.y - edge);
    vec3 a = world(px, uPicA, uDepA, uAspA, uOpenA, uGroundA, uDeepA, uInkA, uAccA, 1. - uTitleSide, uNearA, uTravel);
    vec3 b = world(px, uPicB, uDepB, uAspB, uOpenB, uGroundB, uDeepB, uInkB, uAccB, uTitleSide, uNearB, 0.);
    col = mix(a, b, below) + uAccB * exp(-abs(px.y - edge) / 2.5) * .45;   // the lit front of the new world
  }
  col += (hash(px + fract(uTime) * 91. * (1. - uStill)) - .5) * .03;                // the grain holds still for reduced motion
  o = vec4(col, 1.);
}`;

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export function makeWorld(canvas) {
  const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return null;                                   // no WebGL2: the page keeps its CSS ground colour
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.bindAttribLocation(prog, 0, 'p'); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = new Proxy({}, { get: (m, k) => m[k] ??= gl.getUniformLocation(prog, k) });
  const blank = () => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); return t; };
  const cache = new Map(), title = blank();
  function tex(src) {
    if (!cache.has(src)) {
      const rec = { t: blank(), asp: 1.5 }; cache.set(src, rec);
      const img = new Image(); img.onload = () => { rec.asp = img.width / img.height; gl.bindTexture(gl.TEXTURE_2D, rec.t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); }; img.src = src;
    }
    return cache.get(src);
  }
  const bind = (unit, name, t) => { gl.activeTexture(gl.TEXTURE0 + unit); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(U[name], unit); };
  const side = (s, w, open, unit) => {
    const pic = tex(w.look.pic), dep = tex(w.look.depth), near = w.look.near; w = w.w; bind(unit, 'uPic' + s, pic.t); bind(unit + 1, 'uDep' + s, dep.t);
    gl.uniform1f(U['uAsp' + s], pic.asp); gl.uniform1f(U['uOpen' + s], open); gl.uniform1f(U['uNear' + s], near);
    w.rgb ??= {};
    for (const [k, n] of [['ground', 'Ground'], ['deep', 'Deep'], ['ink', 'Ink'], ['accent', 'Acc']]) gl.uniform3fv(U['u' + n + s], w.rgb[k] ??= rgb(w[k]));
  };
  let seen = false;
  return {
    dpr: 1,
    size() { this.dpr = Math.min(devicePixelRatio, 1.5); canvas.width = innerWidth * this.dpr; canvas.height = innerHeight * this.dpr; gl.viewport(0, 0, canvas.width, canvas.height); },
    title(src) { gl.bindTexture(gl.TEXTURE_2D, title); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src); },
    // a, b: scenes ({ w: colours, look: { pic, depth, near } }) above and below the split line (css px from the top); light and col in css px
    draw({ a, b, openA, openB, travel, split, light, col, power, time, still, titleSide }) {
      const k = this.dpr;
      gl.uniform2f(U.uRes, canvas.width, canvas.height); gl.uniform2f(U.uLight, light[0] * k, light[1] * k); gl.uniform2f(U.uCol, col[0] * k, col[1] * k);
      gl.uniform1f(U.uTime, time); gl.uniform1f(U.uSplit, split * k); gl.uniform1f(U.uPower, power); gl.uniform1f(U.uStill, still ? 1 : 0); gl.uniform1f(U.uTitleSide, titleSide); gl.uniform1f(U.uTravel, travel);
      side('A', a, openA, 0); side('B', b || a, openB, 2); bind(4, 'uTitle', title);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (!seen) { seen = true; canvas.style.opacity = 1; }      // an undrawn canvas is a black sheet: it stays out of sight until it holds a picture
    },
  };
}

const papers = new Map();
export function endpaper(seed) {                                         // marbled relief, different for every part, used as both picture and depth
  if (papers.has(seed)) return papers.get(seed);
  const n = 256, c = Object.assign(document.createElement('canvas'), { width: n, height: n }), x = c.getContext('2d'), im = x.createImageData(n, n);
  let s = (seed * 2654435761) >>> 0; const k = Array.from({ length: 9 }, () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let Y = 0, i = 0; Y < n; Y++) for (let X = 0; X < n; X++, i += 4) {
    const u = X / n * 6.283, v = Y / n * 6.283;
    const a = Math.sin(u * (1 + (k[0] * 2 | 0)) + 6 * k[1] + 2.2 * Math.sin(v * (1 + (k[2] * 2 | 0)) + 6 * k[3]));
    const b = Math.sin(v * (2 + (k[4] * 2 | 0)) + 6 * k[5] + 1.8 * Math.sin(u * (1 + (k[6] * 3 | 0)) + a * 1.5 + 6 * k[7]));
    im.data[i] = im.data[i + 1] = im.data[i + 2] = 255 * (0.5 + 0.25 * a + 0.25 * b * Math.sin(a * 2 + b + 6 * k[8])) ** 1.8; im.data[i + 3] = 255;
  }
  x.putImageData(im, 0, 0); const url = c.toDataURL(), l = { pic: url, depth: url, near: 0.9 }; papers.set(seed, l); return l;
}
// any title: the row count (up to max) that lets the letters stand tallest in a box w by h; wide(row) is the row's width at 100px
export function titleRows(title, wide, w, h, max = 5) {
  const words = title.split(/\s+/).filter(Boolean); let best = { px: 0, rows: [title] };
  for (let n = 1; n <= Math.min(max, words.length); n++) {
    const rows = [], per = title.length / n; let row = '';
    for (const x of words) { if (row && rows.length < n - 1 && (row + ' ' + x).length > per + 2) { rows.push(row); row = x; } else row = row ? row + ' ' + x : x; }
    rows.push(row); const px = Math.min(100 * w / Math.max(...rows.map(wide)), h / rows.length);
    if (px > best.px) best = { px, rows };
  }
  return best;
}
