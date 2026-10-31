import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { unzipSync } from 'fflate';

// Exercises the real built content/app/background code and IndexedDB transport.
// Chrome runtime/tab creation is bridged by the fixture because this machine
// blocks installing unpacked extensions; no product state code is mocked.
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/host') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><h1>工作页面</h1><button>页面内容</button>'); return; }
  if (path === '/background-fixture') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><script src="background.js"></script>'); return; }
  const file = resolve('dist', '.' + path);
  if (!file.startsWith(resolve('dist') + '/')) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : path.endsWith('.png') ? 'image/png' : 'application/octet-stream');
    res.setHeader('Content-Security-Policy', manifest.content_security_policy.extension_pages);
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 1000 }, reducedMotion: 'reduce', acceptDownloads: true });
  const errors = [], opened = [], messages = [];
  let background, failTransfer = false;
  context.on('page', page => page.on('pageerror', error => errors.push(error.message)));
  await context.exposeBinding('fixtureSend', async ({ frame }, message) => {
    messages.push(message.type);
    if (failTransfer && message.type === 'image-port:workspace:begin') return { ok: false, error: '测试：存储空间不足' };
    return background.evaluate(({ message, sender }) => new Promise(resolve => {
      const listener = window.listeners.find(fn => fn(message, sender, resolve) === true);
      if (!listener) resolve({ ok: false, error: 'No listener' });
    }), { message, sender: { id: 'test', url: frame.url() } });
  });
  await context.exposeBinding('fixtureOpen', async (_source, options) => {
    const tab = await context.newPage(); opened.push(tab);
    // Browser tab creation resolves without waiting for application hydration.
    tab.goto(options.url).catch(error => errors.push(error.message));
    return { id: opened.length };
  });
  await context.addInitScript(({ base }) => {
    window.listeners = [];
    window.chrome = {
      runtime: { id: 'test', getURL: path => base + '/' + path.replace(/^\//, ''),
        sendMessage: message => window.fixtureSend(message), onMessage: { addListener: fn => window.listeners.push(fn) } },
      action: { onClicked: { addListener() {} } },
      tabs: { create: options => window.fixtureOpen(options), sendMessage: async () => {} }
    };
    // Inspect the closed production root in this fixture only.
    const original = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return original.call(this, { ...options, mode: 'open' }); };
  }, { base });
  background = await context.newPage(); await background.goto(base + '/background-fixture');
  await background.waitForFunction(() => window.listeners.length === 1);
  const host = await context.newPage(); await host.goto(base + '/host'); await host.addScriptTag({ url: base + '/content.js' });
  await host.locator('.launcher').click();
  const app = await (await host.locator('.panel iframe').elementHandle()).contentFrame();
  await app.waitForSelector('[data-format=png]');
  const fixture = await app.evaluate(() => {
    const canvas = document.createElement('canvas'); canvas.width = 350; canvas.height = 250;
    const ctx = canvas.getContext('2d'), image = ctx.createImageData(350, 250); let seed = 11;
    for (let i = 0; i < image.data.length; i += 4) {
      for (let j = 0; j < 3; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; image.data[i + j] = seed >>> 24; }
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0); return canvas.toDataURL().split(',')[1];
  });
  const png = Buffer.from(fixture, 'base64'); assert.ok(png.length > 192 * 1024, 'covers multi-chunk files');
  const good = { name: '原图.png', mimeType: 'image/png', buffer: png };
  const bad = { name: '损坏.heic', mimeType: 'image/heic', buffer: Buffer.from('bad image') };
  await app.locator('#file-input').setInputFiles([good, bad]);
  await app.locator('[data-format=webp]').click(); await app.locator('#quality').fill('67');
  await app.locator('#pattern').fill('新品_{n}_{name}'); await app.locator('#start').fill('12'); await app.locator('#digits').selectOption('4');
  await app.locator('details').evaluate(el => { el.open = true; }); await app.locator('#max-width').fill('180'); await app.locator('#max-height').fill('150');
  await app.locator('#convert').click(); await app.waitForFunction(() => document.getElementById('status').textContent.startsWith('转换完成'));
  assert.equal(await app.locator('.file-meta.error').count(), 1);
  async function conversionDownload(page, frame) {
    const download = page.waitForEvent('download'); await frame.locator('#download-all').click();
    return unzipSync(await readFile(await (await download).path()));
  }
  const converted = await conversionDownload(host, app);
  await app.locator('#show-crop').click();
  const crop = await (await app.locator('#crop-frame').elementHandle()).contentFrame();
  await crop.waitForFunction(() => !!window.imagePortCropWorkspace);
  const idle = () => crop.waitForFunction(() => document.getElementById('results').getAttribute('aria-busy') === 'false');
  await crop.locator('#size').selectOption('custom'); await idle();
  await crop.locator('#cw').fill('192'); await crop.locator('#cw').press('Tab'); await idle();
  await crop.locator('#ch').fill('128'); await crop.locator('#ch').press('Tab'); await idle();
  await idle(); await crop.locator('#fmt').selectOption('image/png');
  await crop.locator('#file').setInputFiles([good, { ...good, name: '第二张.png' }, bad]); await idle();
  assert.equal(await crop.locator('.card').count(), 3);
  const card = crop.locator('.card').first();
  // Change the actual crop via its resize handle, then preserve output bytes.
  await card.locator('.h.br').scrollIntoViewIfNeeded();
  const handle = await card.locator('.h.br').boundingBox();
  await host.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await host.mouse.down();
  await host.mouse.move(handle.x - 20, handle.y - 16, { steps: 5 }); await host.mouse.up(); await idle();
  await card.locator('.nameInput').fill('手工命名'); await card.locator('.pickbox').check();
  await crop.locator('.card').nth(1).locator('.fmtSel').selectOption('image/webp'); await idle();
  await card.locator('.card-grip').focus(); await card.locator('.card-grip').press('ArrowRight');
  await crop.locator('#batchName').fill('稍后应用_{n}'); await crop.locator('#batchFmt').selectOption('image/jpeg');
  await crop.locator('#zipToggle').check(); await crop.locator('#zipName').fill('商品主图');
  await crop.locator('#themeToggle').click();
  await app.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  assert.equal(await host.locator('.panel').getAttribute('data-theme'), 'dark');
  async function cropFingerprint(frame) {
    return frame.evaluate(async () => {
      const value = window.imagePortCropWorkspace.snapshot();
      async function digest(blob) {
        if (!blob) return null;
        return { size: blob.size, type: blob.type, name: blob.name || null, lastModified: blob.lastModified || null,
          sha: [...new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer()))].map(n => n.toString(16).padStart(2, '0')).join('') };
      }
      for (const item of value.items) { item.file = await digest(item.file); item.blob = await digest(item.blob); }
      delete value.scroll; return value;
    });
  }
  const originalCrop = await cropFingerprint(crop);
  const originalConversion = await app.evaluate(() => ({
    values: ['quality','pattern','start','digits','max-width','max-height'].map(id => document.getElementById(id).value),
    selected: document.querySelector('#formats .active').dataset.format,
    rows: [...document.querySelectorAll('.file-row')].map(el => el.textContent), details: document.querySelector('details').open
  }));
  await host.locator('.panel-expand').click();
  await host.waitForFunction(() => !document.querySelector('#image-port-root').shadowRoot.querySelector('.panel-expand').disabled);
  while (!opened.length) await new Promise(resolve => setTimeout(resolve, 50));
  const copied = opened[0];
  await host.close(); // All restored images/results must outlive the original document and its object URLs.
  await copied.waitForFunction(() => !document.getElementById('workspace-notice')?.hidden);
  assert.match(await copied.locator('#workspace-notice').textContent(), /^已恢复/);
  assert.equal(await copied.locator('#show-crop').getAttribute('aria-selected'), 'true');
  const copyCrop = await (await copied.locator('#crop-frame').elementHandle()).contentFrame();
  assert.deepEqual(await cropFingerprint(copyCrop), originalCrop);
  await copied.locator('#show-convert').click();
  assert.deepEqual(await copied.evaluate(() => ({
    values: ['quality','pattern','start','digits','max-width','max-height'].map(id => document.getElementById(id).value),
    selected: document.querySelector('#formats .active').dataset.format,
    rows: [...document.querySelectorAll('.file-row')].map(el => el.textContent), details: document.querySelector('details').open
  })), originalConversion);
  const copyZIP = await conversionDownload(copied, copied); assert.deepEqual(copyZIP, converted);
  assert.ok(messages.filter(type => type === 'image-port:workspace:put').length > 10);
  console.log('PASS: both queues, original bytes, converted bytes, crop geometry/order/selections, errors and all controls survive closing the source page');
  await mkdir('artifacts', { recursive: true });
  await copied.screenshot({ path: 'artifacts/workspace-conversion-dark.png', fullPage: true });
  const palette = await copied.evaluate(() => ['--bg','--surface','--text','--accent','--fx'].map(key => getComputedStyle(document.documentElement).getPropertyValue(key)));
  assert.deepEqual(palette, await copyCrop.evaluate(() => ['--bg','--surface','--text','--accent','--fx'].map(key => getComputedStyle(document.documentElement).getPropertyValue(key))));
  assert.equal(await copied.locator('#fx').evaluate(el => getComputedStyle(el).display), 'block');
  await copied.locator('#themeToggle').click(); await copyCrop.waitForFunction(() => !document.documentElement.hasAttribute('data-theme'));
  await copied.screenshot({ path: 'artifacts/workspace-conversion-light.png', fullPage: true });
  await copied.locator('#show-crop').click(); await copyCrop.locator('#themeToggle').click();
  await copied.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
  await copied.screenshot({ path: 'artifacts/workspace-crop-dark.png', fullPage: true });
  // Editing after restore needs original decoded pixels/canvas, not only thumbnails.
  await copyCrop.locator('.card').nth(1).locator('.fmtSel').selectOption('image/jpeg');
  await copyCrop.waitForFunction(() => document.getElementById('results').getAttribute('aria-busy') === 'false');
  assert.equal(await copyCrop.evaluate(() => window.imagePortCropWorkspace.snapshot().items[1].blob.type), 'image/jpeg');
  console.log('PASS: identical palette, aurora/star markup, switch synchronization and continued crop editing after restore');
  await copied.locator('#show-convert').click();
  // Explicit failure is visible and never clears source data; retry succeeds.
  failTransfer = true; await copied.locator('#open-workspace').click();
  await copied.waitForFunction(() => document.getElementById('workspace-notice').textContent.includes('存储空间不足'));
  assert.equal(await copied.locator('#count').textContent(), '2');
  assert.equal(await copied.locator('#workspace-overlay').isVisible(), false);
  failTransfer = false;
  await copied.locator('#pattern').fill('继续_{n}');
  await copied.locator('#open-workspace').click();
  while (opened.length < 2) await new Promise(resolve => setTimeout(resolve, 50));
  const second = opened[1]; await second.waitForFunction(() => document.getElementById('workspace-notice')?.textContent.startsWith('已恢复'));
  assert.equal(await second.locator('#show-convert').getAttribute('aria-selected'), 'true');
  assert.equal(await second.locator('#pattern').inputValue(), '继续_{n}');
  await second.locator('#pattern').fill('独立编辑');assert.equal(await copied.locator('#pattern').inputValue(), '继续_{n}');
  console.log('PASS: transfer from conversion view, error recovery/retry, and independent source/copy editing');
  // Copy while conversion runs: wait for a stable completed result, not half-written blobs.
  const busyPage = await context.newPage(); await busyPage.goto(base + '/app.html');
  await busyPage.locator('#file-input').setInputFiles(good);
  await busyPage.evaluate(() => {
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) { setTimeout(() => toBlob.apply(this, args), 250); };
    document.getElementById('convert').click(); document.getElementById('open-workspace').click();
  });
  while (opened.length < 3) await new Promise(resolve => setTimeout(resolve, 50));
  const afterBusy = opened[2]; await afterBusy.waitForFunction(() => document.getElementById('workspace-notice')?.textContent.startsWith('已恢复'));
  assert.equal(await afterBusy.locator('.file-meta.success').count(), 1);
  assert.equal(await afterBusy.locator('#crop-frame').count(), 0);
  assert.equal(await busyPage.locator('.file-meta.success').count(), 1);
  // The same handoff waits for an active cropping job and keeps conversion data.
  await busyPage.locator('#show-crop').click();
  const pendingCrop = await (await busyPage.locator('#crop-frame').elementHandle()).contentFrame();
  await pendingCrop.waitForFunction(() => !!window.imagePortCropWorkspace);
  await pendingCrop.evaluate(() => {
    const original = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (...args) { setTimeout(() => original.apply(this, args), 250); };
  });
  await pendingCrop.locator('#file').setInputFiles(good);
  await busyPage.evaluate(() => document.getElementById('open-workspace').click());
  while (opened.length < 4) await new Promise(resolve => setTimeout(resolve, 50));
  const cropAfterBusy = opened[3];
  await cropAfterBusy.waitForFunction(() => document.getElementById('workspace-notice')?.textContent.startsWith('已恢复'));
  const completedCrop = await (await cropAfterBusy.locator('#crop-frame').elementHandle()).contentFrame();
  assert.equal(await completedCrop.locator('.card[data-state=ready]').count(), 1);
  assert.equal(await cropAfterBusy.locator('.file-meta.success').count(), 1);
  // Validate sender rejection and service-worker data cleanup without relying on a live source.
  const unauthorized = await background.evaluate(() => new Promise(resolve => window.listeners[0]({ type: 'image-port:workspace:begin', meta: { version: 1 }, blobs: [] }, { id: 'test', url: 'http://untrusted.example/' }, resolve)));
  assert.equal(unauthorized.ok, false);
  const leftover = await background.evaluate(() => new Promise((resolve, reject) => {
    const open = indexedDB.open('image-port-workspace-transfer', 1);
    open.onsuccess = () => { const q = open.result.transaction('records').objectStore('records').count(); q.onsuccess = () => resolve(q.result); q.onerror = () => reject(q.error); };
  }));
  assert.equal(leftover, 0, 'successful transfers clear local temporary image data');
  assert.deepEqual(errors, []);
  console.log('PASS: busy-operation handoff, untouched crop initialization, sender checks, temporary data cleanup; no browser errors');
} finally {
  await browser?.close(); await new Promise(resolve => server.close(resolve));
}
