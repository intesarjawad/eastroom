// The rules every device relies on: many records become one view, whatever order they arrive in.
// Run: node --test tests/web
import test from 'node:test';
import assert from 'node:assert/strict';
import { combine, fromBefore } from '../../eastroom/web/records.js';

const order = ['c001', 'c002', 'c003'];
const phone = { device: 'phone', name: 'iPhone', place: { ch: 'c002', w: 40, t: 2000 }, kept: { 'c001:5:3': { t: 100, exact: 'a b c' } }, done: { c001: { t: 1500, v: true } }, days: { '2026-11-12': 60 } };
const tablet = { device: 'tablet', name: 'iPad', place: { ch: 'c003', w: 9, t: 1000 }, kept: { 'c001:5:3': { t: 300, gone: true }, 'c002:1:2': { t: 50, exact: 'd e' } }, done: { c001: { t: 900, v: false } }, days: { '2026-11-12': 30, '2026-11-11': 10 } };
const before = fromBefore({ ch: 'c001', g: 7, at: 10, line: 'old words', kept: [{ ch: 'c001', g: 5, n: 3, t: 'a b c' }], done: ['c001'], days: { '2026-11-10': 5 }, wpm: 240 });
const orders = (xs) => xs.length < 2 ? [xs] : xs.flatMap((x, i) => orders([...xs.slice(0, i), ...xs.slice(i + 1)]).map((r) => [x, ...r]));

test('any order of records gives the same view', () => {
  const [first, ...rest] = orders([phone, tablet, before]).map((rs) => combine(rs, order));
  for (const v of rest) assert.deepEqual(v, first);
});
test('the newest place wins and a place further on is offered', () => {
  const v = combine([phone, tablet], order);
  assert.deepEqual([v.place.ch, v.place.w, v.by], ['c002', 40, 'iPhone']);
  assert.deepEqual([v.far.ch, v.farBy], ['c003', 'iPad']);
  assert.equal(combine([phone], order).far, null, 'nothing is offered when no device is ahead');
});
test('a later release on another device removes a kept line; other kept lines stay', () => {
  assert.deepEqual(Object.keys(combine([phone, tablet, before], order).kept), ['c002:1:2']);
});
test('an older release does not remove a line kept again later', () => {
  const again = { device: 'mac', kept: { 'c001:5:3': { t: 999, exact: 'a b c' } } };
  assert.ok(combine([tablet, again], order).kept['c001:5:3']);
});
test('the newest word on a finished part wins, and reading time adds up', () => {
  const v = combine([phone, tablet, before], order);
  assert.equal(v.done.c001.v, true);
  assert.deepEqual([v.days['2026-11-12'], v.seconds], [90, 105]);
  const w = combine([{ ...phone, words: { '2026-11-12': 300 } }, { ...tablet, words: { '2026-11-12': 100, '2026-11-11': 50 } }, before], order);
  assert.deepEqual([w.words['2026-11-12'], w.read, v.read], [400, 450, 0]);
});
test('the state file of older versions reads as one more device', () => {
  assert.deepEqual(before.place, { ch: 'c001', w: 7, t: 10, exact: 'old words' });
  assert.deepEqual(before.kept, { 'c001:5:3': { t: 10, exact: 'a b c' } });
  assert.equal(fromBefore(phone), phone, 'a record in the present shape is left alone');
});
test('two stamps that tie are settled the same way from either side', () => {
  const a = { device: 'a', place: { ch: 'c001', w: 1, t: 5 } }, b = { device: 'b', place: { ch: 'c002', w: 1, t: 5 } };
  assert.equal(combine([a, b], order).place.ch, combine([b, a], order).place.ch);
});
test('a place in a chapter the book no longer has is ignored', () => {
  assert.equal(combine([{ device: 'x', place: { ch: 'c099', w: 1, t: 9 } }], order).place, null);
});
