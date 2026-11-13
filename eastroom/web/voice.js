// The device's own voice: the last resort, for a part that has no recorded narration. It speaks one sentence at a time and
// reports each word it begins, where the device does that; where it does not, the reader's light moves by pace instead.
// Measured on the owner's devices (2026-11-12): every word is reported; the first sentence starts seconds late unless the
// voice has been woken; on an iPhone in silent mode it speaks without sound, and a page cannot tell.
const sy = window.speechSynthesis; let cur = null, woken = false, cancelled = -1e9;
export const canSpeak = !!sy, RATE = 180;                         // words a minute at rate 1, near enough for the built-in voices
export const ready = () => performance.now() - cancelled > 150;   // a sentence queued right after a cancel loses its events on iOS
export function wake() { if (!sy || woken) return; woken = true; const u = new SpeechSynthesisUtterance(' '); u.volume = 0; sy.speak(u); }
export function hush() { cur = null; if (sy && (sy.speaking || sy.pending)) { sy.cancel(); cancelled = performance.now(); } }
export function speak(words, wpm, on) {                           // on.start(), on.word(i), on.end(), on.fail()
  const starts = []; let at = 0; for (const w of words) { starts.push(at); at += w.length + 1; }
  const u = new SpeechSynthesisUtterance(words.join(' ')), me = cur = u;
  u.rate = Math.min(2, Math.max(0.5, wpm / RATE));
  try { const want = JSON.parse(localStorage.getItem('eastroom:say')); const v = want && sy.getVoices().find((x) => x.name === want); if (v) u.voice = v; } catch {}   // the voice chosen in Settings, when this device still has it
  u.onstart = () => { if (cur === me) on.start(); };
  u.onboundary = (e) => { if (cur !== me || e.name !== 'word') return; let i = starts.length - 1; while (i > 0 && starts[i] > e.charIndex) i--; on.word(i); };
  u.onend = () => { if (cur === me) { cur = null; on.end(); } };
  u.onerror = () => { if (cur === me) { cur = null; on.fail(); } };
  sy.speak(u);
}
