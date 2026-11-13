// The focused book's cover as a lit object, computed from the cover image alone (plus its depth map when one was made at import):
// near things slide against far ones as the book tilts, the print catches the light like an embossed cover, strong colours flash like foil.
const VERT = `#version 300 es
in vec2 p; out vec2 v; void main(){ v = p * .5 + .5; gl_Position = vec4(p, 0., 1.); }`;
const FRAG = `#version 300 es
precision highp float;
in vec2 v; out vec4 o;
uniform sampler2D uPic, uDep; uniform vec2 uLight, uTilt, uPx; uniform float uHas;
float lum(vec3 c){ return dot(c, vec3(.2126, .7152, .0722)); }
float height(vec2 q){ return lum(textureLod(uPic, q, 2.5).rgb) * .3 + texture(uDep, q).r * uHas * .9; }   // a softened copy of the print, so file noise does not become relief
void main(){
  vec2 uv = vec2(v.x, 1. - v.y);
  float d = texture(uDep, uv).r;
  uv -= uTilt * .028 * (d - .45) * uHas;                                   // parallax from the depth map
  vec3 c = texture(uPic, uv).rgb;
  vec2 e = uPx * 5.;
  vec3 n = normalize(vec3(height(uv - vec2(e.x, 0.)) - height(uv + vec2(e.x, 0.)), height(uv - vec2(0., e.y)) - height(uv + vec2(0., e.y)), .055));
  vec3 l = normalize(vec3(uLight - (uv * 2. - 1.), .6));
  float spec = pow(max(dot(reflect(-l, n), vec3(0., 0., 1.)), 0.), 20.);
  c *= .8 + .32 * dot(n, l);                                                // relief
  float sat = max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
  c += spec * (.07 + .6 * sat * smoothstep(.2, .65, lum(c))) * mix(vec3(1.), c / max(lum(c), .06), .65);  // foil: only what is both bright and strongly coloured flashes
  float band = uTilt.x * 1.5 + .5 - (uv.x + (uv.y - .5) * .35);
  c += exp(-band * band * 16.) * .08;                                       // a sheen crosses the cover as it turns
  o = vec4(c, 1.);
}`;

export function makeCover() {
  const el = Object.assign(document.createElement('canvas'), { className: 'glass' }), gl = el.getContext('webgl2', { antialias: false, alpha: false });
  if (!gl) return null;                                   // no WebGL2: the plain cover image stays
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram(); gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG)); gl.bindAttribLocation(prog, 0, 'p');
  gl.linkProgram(prog); gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const U = (k) => gl.getUniformLocation(prog, k), cache = new Map();
  function tex(src) {
    if (cache.has(src)) return cache.get(src);
    const rec = { t: gl.createTexture(), ok: false, w: 1, h: 1 }; cache.set(src, rec);
    gl.bindTexture(gl.TEXTURE_2D, rec.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    const img = new Image(); img.onload = () => { rec.ok = true; rec.w = img.width; rec.h = img.height; gl.bindTexture(gl.TEXTURE_2D, rec.t);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D);
      for (const [k, x] of [[gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR], [gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE], [gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE]]) gl.texParameteri(gl.TEXTURE_2D, k, x); };
    if (src) img.src = src; return rec;
  }
  let pic = null, dep = null;
  return {
    el,
    show(src, depthSrc) { pic = tex(src); dep = tex(depthSrc); el.style.opacity = 0; },
    // light and tilt in the card's own space, -1..1, y down
    draw(light, tilt) {
      if (!pic?.ok) return; const k = Math.min(devicePixelRatio, 2), w = Math.round(el.clientWidth * k), h = Math.round(el.clientHeight * k);
      if (!w || !h) return; if (el.width !== w || el.height !== h) { el.width = w; el.height = h; gl.viewport(0, 0, w, h); }
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, pic.t); gl.uniform1i(U('uPic'), 0);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, dep.t); gl.uniform1i(U('uDep'), 1);
      gl.uniform2f(U('uLight'), light[0], light[1]); gl.uniform2f(U('uTilt'), tilt[0], tilt[1]); gl.uniform2f(U('uPx'), 1 / pic.w, 1 / pic.h); gl.uniform1f(U('uHas'), dep.ok ? 1 : 0);
      gl.drawArrays(gl.TRIANGLES, 0, 3); el.style.opacity = 1;
    },
  };
}
