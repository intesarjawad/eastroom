import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPanels } from '../../eastroom/web/panels.js';

const W = 300, H = 400;
function page(boxes, paper = 255, art = 90) {                      // a page of the gutter's colour with filled panels on it
  const lum = new Uint8Array(W * H).fill(paper);
  for (const [x, y, w, h] of boxes) for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) lum[j * W + i] = art;
  return lum;
}
const corners = (found) => found.map(([x, y]) => [Math.round(x * W), Math.round(y * H)]);
const GRID = [[10, 10, 135, 185], [155, 10, 135, 185], [10, 205, 135, 185], [155, 205, 135, 185]];

test('four panels are read across, then down', () => {
  assert.deepEqual(corners(findPanels(page(GRID), W, H)), [[10, 10], [155, 10], [10, 205], [155, 205]]);
});
test('a book read right to left starts each row at the right', () => {
  assert.deepEqual(corners(findPanels(page(GRID), W, H, true)), [[155, 10], [10, 10], [155, 205], [10, 205]]);
});
test('a wide panel above two small ones gives three, and each box hugs its panel', () => {
  const found = findPanels(page([[10, 10, 280, 150], [10, 180, 130, 200], [160, 180, 130, 200]]), W, H);
  assert.deepEqual(corners(found), [[10, 10], [10, 180], [160, 180]]);
  assert.deepEqual([Math.round(found[0][2] * W), Math.round(found[0][3] * H)], [280, 150]);
});
test('black gutters work like white ones', () => {
  assert.equal(findPanels(page(GRID, 0, 200), W, H).length, 4);
});
test('a page with nothing to cut is read whole', () => {
  assert.deepEqual(findPanels(page([[0, 0, W, H]]), W, H), []);
  assert.deepEqual(findPanels(page([]), W, H), []);
  assert.deepEqual(findPanels(page([[10, 10, 280, 380]]), W, H), []);
});
test('a page of text is not mistaken for panels', () => {
  const lines = Array.from({ length: 30 }, (_, i) => [20, 10 + i * 13, 260, 5]);
  assert.deepEqual(findPanels(page(lines), W, H), []);
});
