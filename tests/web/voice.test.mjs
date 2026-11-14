// Waking the device's voice. A phone ignores, in silence, what is asked before a touch has ended on the page,
// so one try that came to nothing must not be the last.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('the voice is woken again until it has spoken once', async () => {
  const asked = [];
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  globalThis.window = { speechSynthesis: { speaking: false, pending: false, speak: (u) => asked.push(u) } };
  const { wake } = await import('../../eastroom/web/voice.js');
  wake(); wake();
  assert.equal(asked.length, 2);
  asked[1].onstart();
  wake();
  assert.equal(asked.length, 2);
});
