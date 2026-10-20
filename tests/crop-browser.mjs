import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { unzipSync } from 'fflate';

export async function runCropChecks({ page, host, panel, baseURL, png }) {
  const beforeConversionCount = await page.locator('#count').textContent();
  await page.locator('#show-crop').click();
  const crop = await (await page.locator('#crop-frame').elementHandle()).contentFrame();
  await crop.waitForSelector('#file', { state: 'attached' });
  assert.equal(await page.locator('#show-crop').getAttribute('aria-selected'), 'true');
  assert.equal(await crop.locator('#batchName').inputValue(), '{n}');
  const idle = () => crop.waitForFunction(() => document.getElementById('results').getAttribute('aria-busy') === 'false');
  const fixtures = await crop.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 100;
    const ctx = c.getContext('2d');
    for (const [i, color] of ['#ff0000', '#00ff00', '#0000ff'].entries()) { ctx.fillStyle = color; ctx.fillRect(i * 100, 0, 100, 100); }
    const stripes = c.toDataURL().split(',')[1];
    c.width = 512; c.height = 512;
    const image = ctx.createImageData(512, 512); let seed = 7;
    for (let i = 0; i < image.data.length; i += 4) {
      for (let k = 0; k < 3; k++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; image.data[i + k] = seed >>> 24; }
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
    return { stripes, noise: c.toDataURL().split(',')[1] };
  });
  await crop.locator('#file').setInputFiles([
    { name: 'stripes.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.stripes, 'base64') },
    { name: 'noise.png', mimeType: 'image/png', buffer: Buffer.from(fixtures.noise, 'base64') },
    { name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('broken') },
  ]);
  await idle();
  assert.equal(await crop.locator('.card[data-state=ready]').count(), 2);
  assert.equal(await crop.locator('.card[data-state=error]').count(), 1);
  const first = crop.locator('.card').nth(0), second = crop.locator('.card').nth(1);
  async function output(card, fraction = 0.5) {
    return card.locator('.rthumb').evaluate(async (img, fraction) => {
      await img.decode();
      const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight;
      const ctx = c.getContext('2d'); ctx.drawImage(img, 0, 0);
      return { width: c.width, height: c.height, pixel: [...ctx.getImageData(Math.floor(c.width * fraction), Math.floor(c.height / 2), 1, 1).data] };
    }, fraction);
  }
  let result = await output(first);
  assert.equal(result.width, 800); assert.equal(result.height, 800);
  assert.ok(result.pixel[1] > 240 && result.pixel[0] < 10, 'default centered square selects green band');
  assert.match(await first.getAttribute('style'), /--tint:/, 'source color tints its card');
  await first.locator('.cropbox').evaluate(el => el.scrollIntoView({ block: 'center' }));
  const box = await first.locator('.cropbox').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down();
  await page.mouse.move(box.x - box.width / 2, box.y + box.height / 2, { steps: 8 }); await page.mouse.up();
  await idle(); result = await output(first);
  assert.ok(result.pixel[0] > 240 && result.pixel[1] < 10, 'moving the crop changes actual output pixels to red');
  await crop.locator('#resetCrop').click(); await idle();
  assert.ok((await output(first)).pixel[1] > 240, 'reset restores centered pixels');
  await crop.locator('#size').selectOption('480'); await idle();
  assert.equal((await output(first)).width, 480);
  await crop.locator('#size').selectOption('custom'); await idle();
  await crop.locator('#cw').fill('120'); await crop.locator('#cw').press('Tab'); await idle();
  await crop.locator('#ch').fill('60'); await crop.locator('#ch').press('Tab'); await idle();
  result = await output(first); assert.equal(result.width, 120); assert.equal(result.height, 60);
  await first.locator('.cropbox').evaluate(el => el.scrollIntoView({ block: 'center' }));
  const before = await first.locator('.cropbox').boundingBox(), corner = await first.locator('.h.br').boundingBox();
  const hx = corner.x + corner.width / 2 - 3, hy = corner.y + corner.height / 2 - 3;
  await page.mouse.move(hx, hy); await page.mouse.down(); await page.mouse.move(hx - 20, hy - 10, { steps: 8 }); await page.mouse.up();
  await idle();
  const after = await first.locator('.cropbox').boundingBox();
  assert.ok(after.width < before.width, 'corner drag shrinks the source selection');
  assert.ok(Math.abs(after.width / after.height - 2) < 0.02, 'selection remains at output aspect ratio');
  assert.equal((await output(first)).width, 120);
  await first.locator('.result').click();
  assert.ok(await crop.locator('#lightbox').evaluate(el => el.classList.contains('show')));
  assert.match(await crop.locator('#lightboxCap').textContent(), /120×60/);
  await crop.locator('#lightboxClose').click();
  assert.equal(await crop.locator('#lightbox').evaluate(el => el.classList.contains('show')), false);
  console.log('PASS crop: auto-processing, 800/480/custom output, actual crop pixels, resize, center reset, source tint and lightbox');

  await crop.locator('#size').selectOption('800'); await idle();
  await crop.locator('#maxkb').fill('150'); await crop.locator('#maxkb').press('Tab'); await idle();
  assert.equal(await second.locator('.card-badge').evaluate(el => el.classList.contains('over')), false);
  const firstDownload = page.waitForEvent('download'); await second.locator('button.dl').click();
  const compressed = await readFile(await (await firstDownload).path());
  assert.ok(compressed.length <= 150 * 1024, 'lossy compression meets achievable size limit');
  assert.match(await second.locator('.stats').textContent(), /质量 (?!100%)/);
  await crop.locator('#maxkb').fill('10'); await crop.locator('#maxkb').press('Tab'); await idle();
  assert.equal(await second.locator('.card-badge').evaluate(el => el.classList.contains('over')), true, 'unachievable size target is reported');
  await second.locator('.fmtSel').selectOption('image/png'); await idle();
  assert.equal(await second.locator('.card-badge').evaluate(el => el.classList.contains('over')), true, 'PNG size overage is not hidden');
  assert.match(await second.locator('.stats').textContent(), /无损/);
  await crop.locator('#maxkb').fill(''); await crop.locator('#maxkb').press('Tab'); await idle();
  assert.equal(await second.locator('.card-badge').evaluate(el => el.classList.contains('over')), false);
  await crop.locator('#batchFmt').selectOption('image/webp'); await crop.locator('#applyFmt').click(); await idle();
  assert.equal(await first.locator('.fmtSel').inputValue(), 'image/webp');
  assert.match(await first.locator('.stats').textContent(), /质量 100%/);
  console.log('PASS crop compression: quality search, exact byte limit, explicit over-limit badges, PNG and unlimited-size mode');

  await crop.locator('#applyName').click();
  assert.equal(await first.locator('.nameInput').inputValue(), '001');
  assert.equal(await second.locator('.nameInput').inputValue(), '002');
  // Native drag-and-drop reorders the cards; names are applied in the new order.
  await crop.locator('.card-grip').nth(1).scrollIntoViewIfNeeded();
  const grip = await second.locator('.card-grip').boundingBox();
  const target = await first.locator('.card-grip').boundingBox();
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 2, target.y + target.height / 2, { steps: 20 });
  await page.mouse.move(target.x + 3, target.y + target.height / 2); await page.mouse.up();
  assert.equal(await crop.locator('.card').first().getAttribute('data-id'), '2', 'card handle performs actual drag reorder');
  await crop.locator('#batchName').fill('商品'); await crop.locator('#applyName').click();
  assert.equal(await crop.locator('.nameInput').nth(0).inputValue(), '商品_1');
  await crop.locator('#batchName').fill('{name}_{n}'); await crop.locator('#applyName').click();
  assert.equal(await crop.locator('.nameInput').nth(0).inputValue(), 'noise_001');
  await crop.locator('#selectAll').click();
  assert.match(await crop.locator('#dlsel').textContent(), /2/);
  await crop.locator('#selectAll').click(); assert.equal(await crop.locator('#dlsel').isDisabled(), true);
  await crop.locator('.card[data-state=ready] .pickbox').first().check();
  await crop.locator('#zipToggle').check(); await crop.locator('#zipName').fill('裁剪结果');
  const selectedDownload = page.waitForEvent('download'); await crop.locator('#dlsel').click();
  const selected = await selectedDownload;
  assert.equal(selected.suggestedFilename(), '裁剪结果.zip');
  assert.deepEqual(Object.keys(unzipSync(await readFile(await selected.path()))), ['noise_001.webp']); await idle();
  await crop.locator('.card[data-state=ready] .nameInput').nth(0).fill('same');
  await crop.locator('.card[data-state=ready] .nameInput').nth(1).fill('SAME');
  const allDownload = page.waitForEvent('download'); await crop.locator('#dlall').click();
  assert.deepEqual(Object.keys(unzipSync(await readFile(await (await allDownload).path()))), ['same.webp', 'SAME (2).webp']); await idle();
  await crop.locator('#zipToggle').uncheck();
  const multiple = []; const collect = download => multiple.push(download);
  page.on('download', collect); await crop.locator('#dlall').click(); await idle(); page.off('download', collect);
  assert.equal(multiple.length, 2, 'non-ZIP export downloads each successful image');
  console.log('PASS crop exports: native reordering, template/prefix naming, selection, custom ZIP name, collision handling and multiple downloads');

  await crop.locator('#fmt').selectOption('image/png');
  await crop.evaluate(data => {
    const files = new DataTransfer();
    files.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'pasted.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: files, bubbles: true, cancelable: true }));
  }, png.toString('base64'));
  await idle();
  assert.equal(await crop.locator('.card[data-state=ready]').count(), 3);
  const pasted = crop.locator('.card').last();
  assert.equal(await pasted.locator('.fmtSel').inputValue(), 'image/png');
  assert.equal(await crop.locator('.card').first().locator('.fmtSel').inputValue(), 'image/webp', 'default format affects new files only');
  assert.equal((await output(pasted, 0.9)).pixel[3], 0, 'transparent PNG stays transparent');
  await pasted.locator('.fmtSel').selectOption('image/jpeg'); await idle();
  const white = (await output(pasted, 0.9)).pixel;
  assert.ok(white[0] > 240 && white[1] > 240 && white[2] > 240 && white[3] === 255, 'JPEG fills transparency white');
  await crop.evaluate(data => {
    const files = new DataTransfer(); files.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], 'dropped.png', { type: 'image/png' }));
    document.getElementById('drop').dispatchEvent(new DragEvent('drop', { dataTransfer: files, bubbles: true, cancelable: true }));
  }, png.toString('base64')); await idle();
  assert.equal(await crop.locator('.card[data-state=ready]').count(), 4);
  await crop.locator('#themeToggle').click();
  assert.equal(await crop.locator('html').getAttribute('data-theme'), 'dark');
  assert.equal(await crop.locator('#fx').isVisible(), true);
  const themePage = await page.context().newPage(); await themePage.goto(`${baseURL}/crop.html`);
  assert.equal(await themePage.locator('html').getAttribute('data-theme'), 'dark', 'theme persists for subsequent pages');
  await themePage.close();
  await page.locator('#show-convert').click();
  assert.equal(await page.locator('#count').textContent(), beforeConversionCount);
  await page.locator('#show-crop').click();
  assert.equal(await crop.locator('.card[data-state=ready]').count(), 4, 'tool switching preserves the crop queue');
  await page.screenshot({ path: 'artifacts/screenshot-crop-dark.png', fullPage: true });
  await crop.locator('#themeToggle').click();
  await crop.locator('#clear').click(); assert.equal(await crop.locator('.card').count(), 0);
  console.log('PASS crop inputs and state: clipboard, drop, transparency, light/dark theme persistence, queue isolation and clear');

  // Exercise the nested crop page inside the compact draggable panel too.
  await panel.locator('#show-crop').click();
  const embedded = await (await panel.locator('#crop-frame').elementHandle()).contentFrame();
  await embedded.waitForSelector('#file', { state: 'attached' });
  await embedded.locator('#file').setInputFiles({ name: 'panel.png', mimeType: 'image/png', buffer: png });
  await embedded.waitForFunction(() => document.getElementById('results').getAttribute('aria-busy') === 'false');
  assert.equal(await embedded.locator('.card[data-state=ready]').count(), 1);
  assert.equal(await embedded.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await embedded.locator('#zipToggle').check();
  const embeddedDownload = host.waitForEvent('download'); await embedded.locator('#dlall').click();
  assert.equal(Object.keys(unzipSync(await readFile(await (await embeddedDownload).path()))).length, 1);
  await panel.locator('#show-convert').click(); assert.equal(await panel.locator('.file-meta.success').count(), 1);
  await panel.locator('#show-crop').click(); assert.equal(await embedded.locator('.card').count(), 1);
  await host.screenshot({ path: 'artifacts/screenshot-crop-floating.png' });
  console.log('PASS dual entries inside floating panel: nested crop, ZIP download, compact layout and state preservation');
}
