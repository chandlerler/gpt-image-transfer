import test from 'node:test';
import assert from 'node:assert/strict';
import { outputNames, fitSize, encodeBMP, encodeICO, safeName } from '../src/core.js';

test('batch names preserve stems, pad sequence, sanitize paths, and avoid case-insensitive collisions', () => {
  assert.deepEqual(outputNames([{ name: 'Photo.png' }, { name: 'photo.jpg' }, { name: 'Photo (2).webp' }], { format: 'webp' }), ['Photo.webp', 'photo (2).webp', 'Photo (2) (2).webp']);
  assert.deepEqual(outputNames([{ name: 'one.png' }, { name: 'two.jpg' }], { format: 'jpg', pattern: '旅行/{n}_{name}', start: 7, digits: 3 }), ['旅行_007_one.jpg', '旅行_008_two.jpg']);
  assert.equal(safeName('CON'), '_CON');
  assert.equal(safeName('../bad:name. '), '.._bad_name');
  assert.deepEqual(outputNames([{ name: '$&.png' }], { format: 'png' }), ['$&.png']);
});
test('resizing keeps aspect ratio, never upscales, and bounds ICO dimensions', () => {
  assert.deepEqual(fitSize(400, 200, 100, 100, 'png'), { width: 100, height: 50 });
  assert.deepEqual(fitSize(100, 50, 1000, 1000, 'jpg'), { width: 100, height: 50 });
  assert.deepEqual(fitSize(1024, 512, 0, 0, 'ico'), { width: 256, height: 128 });
});
test('BMP has a correct header, bottom-up BGR pixels and padded rows', () => {
  const bmp = encodeBMP({ width: 1, height: 2, data: new Uint8Array([255, 0, 0, 255, 0, 0, 255, 255]) });
  const view = new DataView(bmp);
  assert.equal(view.getUint32(2, true), 62);
  assert.equal(view.getUint32(22, true), 2);
  assert.deepEqual([...new Uint8Array(bmp).slice(54)], [255, 0, 0, 0, 0, 0, 255, 0]);
});
test('ICO directory points to embedded PNG and represents 256 as zero', () => {
  const ico = encodeICO(new Uint8Array([137, 80, 78, 71]), 256, 128);
  const view = new DataView(ico.buffer);
  assert.equal(view.getUint16(2, true), 1);
  assert.equal(ico[6], 0); assert.equal(ico[7], 128);
  assert.equal(view.getUint32(18, true), 22);
  assert.equal(view.getUint32(14, true), 4);
  assert.deepEqual([...ico.slice(22)], [137, 80, 78, 71]);
});
