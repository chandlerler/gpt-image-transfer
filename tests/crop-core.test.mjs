import test from 'node:test';
import assert from 'node:assert/strict';
import { centerRect, clampRect, resizeRect, batchStem, uniqueNames } from '../src/crop-core.js';

test('centered crop uses the largest source rectangle for the requested ratio', () => {
  assert.deepEqual(centerRect(300, 100, 1), { x: 100, y: 0, w: 100, h: 100 });
  assert.deepEqual(centerRect(300, 100, 2), { x: 50, y: 0, w: 200, h: 100 });
  assert.deepEqual(centerRect(100, 300, 0.5), { x: 0, y: 50, w: 100, h: 200 });
});
test('tiny images and extreme ratios never expand crops past their source', () => {
  for (const [width, height] of [[8, 6], [300, 100], [16, 4096]]) {
    for (const ratio of [0.01, 0.5, 1, 2, 100]) {
      const crop = clampRect({ x: -500, y: 9000, w: 20000 }, width, height, ratio);
      assert.ok(crop.x >= 0 && crop.y >= 0 && crop.w > 0 && crop.h > 0);
      assert.ok(crop.x + crop.w <= width + 1e-8 && crop.y + crop.h <= height + 1e-8);
      assert.ok(Math.abs(crop.w / crop.h - ratio) < 1e-8);
    }
  }
});
test('all four resize handles preserve ratio and opposite corner within image bounds', () => {
  const start = { x: 50, y: 30, w: 100, h: 50 };
  for (const corner of ['tl', 'tr', 'bl', 'br']) {
    for (const point of [{ x: -100, y: -100 }, { x: 90, y: 55 }, { x: 500, y: 300 }]) {
      const result = resizeRect(start, corner, point, 300, 200, 2);
      assert.equal(result.w / result.h, 2);
      assert.ok(result.x >= 0 && result.y >= 0 && result.x + result.w <= 300 && result.y + result.h <= 200);
      assert.equal(corner.endsWith('r') ? result.x : result.x + result.w, corner.endsWith('r') ? start.x : start.x + start.w);
      assert.equal(corner.startsWith('b') ? result.y : result.y + result.h, corner.startsWith('b') ? start.y : start.y + start.h);
    }
  }
});
test('crop naming supports defaults, original-page prefixes and tokens without ZIP collisions', () => {
  assert.equal(batchStem('{n}', 'photo.png', 0, 2), '001');
  assert.equal(batchStem('商品', 'photo.png', 1, 2), '商品_2');
  assert.equal(batchStem('{name}_{n}', '$&.png', 2, 4), '$&_003');
  assert.deepEqual(uniqueNames([{ name: 'a', ext: 'png' }, { name: 'A', ext: 'png' }, { name: 'A (2)', ext: 'png' }, { name: '../a', ext: 'jpg' }]), ['a.png', 'A (2).png', 'A (2) (2).png', '.._a.jpg']);
});
