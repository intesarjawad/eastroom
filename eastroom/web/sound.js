// Recorded interface sounds (sfx/sources.json says what each one is), loaded after the reader's first gesture. A missing file is silence.
// Levels are set here so every sound sits at the same loudness under the narration.
export const kit = { go: 0.7, stop: 0.7, key: 0.14, tick: 0.2, part: 0.8, book: 0.7, turn: 0.6, open: 0.55 };
const buf = {}; let ac, quiet = false; try { quiet = localStorage.getItem('eastroom:quiet') === 'true'; } catch {}   // the owner may switch the interface sounds off in Settings
export function sound(name, gain = kit[name]) {
  if (!ac || !buf[name] || quiet) return;
  const s = ac.createBufferSource(), g = ac.createGain(); g.gain.value = gain; s.buffer = buf[name];
  if (name === 'tick' || name === 'turn') s.playbackRate.value = 0.96 + Math.random() * 0.08;   // repeats never sound stamped
  s.connect(g).connect(ac.destination); s.start();
}
function load() {
  if (ac || !window.AudioContext) return; ac = new AudioContext();
  for (const n in kit) fetch(`sfx/${n}.wav`).then((r) => (r.ok ? r.arrayBuffer() : null)).then((b) => b && ac.decodeAudioData(b)).then((d) => { if (d) buf[n] = d; }).catch(() => {});
}
addEventListener('pointerdown', load, { once: true }); addEventListener('keydown', load, { once: true });
