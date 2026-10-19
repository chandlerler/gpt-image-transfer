import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { unzipSync } from 'fflate';
import UTIF from 'utif';

const profile = await mkdtemp(join(tmpdir(), 'image-port-test-'));
const extensionMode = process.env.TEST_EXTENSION === '1';
const manifest = JSON.parse(await readFile('dist/manifest.json', 'utf8'));
const server = createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  if (pathname === '/host') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Extension test</title><h1>Local fixture page</h1>'); return; }
  const file = resolve('dist', `.${pathname}`);
  if (!file.startsWith(resolve('dist') + '/')) { res.writeHead(403).end(); return; }
  try {
    const data = await readFile(file);
    res.setHeader('Content-Type', pathname.endsWith('.html') ? 'text/html' : pathname.endsWith('.css') ? 'text/css' : pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream');
    res.setHeader('Content-Security-Policy', manifest.content_security_policy.extension_pages);
    res.end(data);
  } catch { res.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext(profile, {
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--no-sandbox', ...(extensionMode ? [`--disable-extensions-except=${resolve('dist')}`, `--load-extension=${resolve('dist')}`] : [])],
    viewport: { width: 1180, height: 980 }, acceptDownloads: true,
  });
  let baseURL = `http://127.0.0.1:${server.address().port}`;
  if (extensionMode) {
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 15000 });
    baseURL = `chrome-extension://${new URL(worker.url()).host}`;
  }
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${baseURL}/app.html`);
  await page.waitForSelector('[data-format=png]');
  const input = await page.evaluate(() => {
    const c = document.createElement('canvas'); c.width = 40; c.height = 20;
    const ctx = c.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 20, 20);
    return c.toDataURL('image/png').split(',')[1];
  });
  const png = Buffer.from(input, 'base64');
  await page.locator('#file-input').setInputFiles([
    { name: 'sample.png', mimeType: 'image/png', buffer: png },
    { name: 'sample.png', mimeType: 'image/png', buffer: png },
    { name: 'broken.heic', mimeType: 'image/heic', buffer: Buffer.from('invalid image') },
  ]);
  await page.locator('#pattern').fill('旅行_{n}');
  await page.locator('#start').fill('7');
  const exported = [];
  for (const format of ['png', 'jpg', 'webp', 'gif', 'bmp', 'tiff', 'ico']) {
    await page.locator(`[data-format=${format}]`).click();
    await page.locator('#convert').click();
    await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('转换完成'));
    assert.match(await page.locator('#status').textContent(), /2 张成功，1 张失败/);
    const downloaded = page.waitForEvent('download');
    await page.locator('#download-all').click();
    const download = await downloaded;
    const archive = unzipSync(await readFile(await download.path()));
    const expected = [`旅行_007.${format}`, `旅行_008.${format}`];
    assert.deepEqual(Object.keys(archive), expected);
    const data = archive[expected[0]];
    const signatures = { png: [137,80,78,71], jpg: [255,216,255], webp: [82,73,70,70], gif: [71,73,70,56], bmp: [66,77], tiff: [77,77,0,42], ico: [0,0,1,0] };
    assert.deepEqual([...data.slice(0, signatures[format].length)], signatures[format], `${format} signature`);
    if (format === 'tiff') {
      const buffer = data.slice().buffer, pages = UTIF.decode(buffer); UTIF.decodeImage(buffer, pages[0]);
      assert.equal(pages[0].width, 40); assert.equal(pages[0].height, 20);
      assert.deepEqual([...UTIF.toRGBA8(pages[0]).slice(0, 4)], [255, 0, 0, 255]);
    } else {
      const pixels = await page.evaluate(async ({ data, format }) => {
        const blob = new Blob([new Uint8Array(data)], { type: `image/${format === 'jpg' ? 'jpeg' : format}` });
        const url = URL.createObjectURL(blob), img = new Image(); img.src = url; await img.decode();
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        c.getContext('2d').drawImage(img, 0, 0);
        const result = { width: img.width, height: img.height, opaque: [...c.getContext('2d').getImageData(5, 5, 1, 1).data], transparent: [...c.getContext('2d').getImageData(35, 5, 1, 1).data] };
        URL.revokeObjectURL(url); return result;
      }, { data: [...data], format });
      assert.equal(pixels.width, 40); assert.equal(pixels.height, 20);
      assert.ok(pixels.opaque[0] > 230 && pixels.opaque[1] < 25, `${format} preserves red pixels`);
      if (['png', 'webp', 'ico'].includes(format)) assert.equal(pixels.transparent[3], 0);
      else assert.ok(pixels.transparent[0] > 230 && pixels.transparent[3] === 255, `${format} fills transparency`);
    }
    exported.push({ name: `roundtrip.${format}`, mimeType: `image/${format}`, buffer: Buffer.from(data) });
    console.log(`PASS ${format}: actual encoding, pixels, dimensions, rename and ZIP; bad input isolated`);
    await page.waitForFunction(() => !document.getElementById('convert').disabled);
  }
  await page.locator('#clear').click();
  await page.locator('#file-input').setInputFiles(exported);
  await page.locator('[data-format=png]').click();
  await page.locator('summary').click();
  await page.locator('#max-width').fill('10');
  await page.locator('#convert').click();
  await page.waitForFunction(() => document.getElementById('status').textContent.startsWith('转换完成'));
  assert.match(await page.locator('#status').textContent(), /7 张成功/);
  assert.equal(await page.locator('.file-meta.success').count(), 7);
  assert.match(await page.locator('.file-meta.success').first().textContent(), /10 × 5/);
  const singleDownload = page.waitForEvent('download');
  await page.locator('.row-actions button').first().click();
  assert.equal((await singleDownload).suggestedFilename(), '旅行_007.png');
  console.log('PASS all seven formats round-trip, resize and individual download');
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/screenshot-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: 'artifacts/screenshot-mobile.png', fullPage: true });
  console.log('PASS responsive layout at 390px');
  await page.setViewportSize({ width: 1180, height: 980 });
  const host = await context.newPage();
  await host.goto(`http://127.0.0.1:${server.address().port}/host`);
  if (!extensionMode) {
    // Test the real content script with a small runtime API stub. This is not an installed-extension test.
    await host.evaluate(baseURL => { window.chrome = { runtime: { getURL: path => `${baseURL}/${path.replace(/^\//, '')}`, onMessage: { addListener() {} } } }; }, baseURL);
    await host.addScriptTag({ url: `${baseURL}/content.js` });
  }
  await host.waitForSelector('#image-port-root');
  await host.mouse.click(1090, 932);
  let panel;
  for (let i = 0; i < 50; i++) {
    panel = host.frames().find(frame => frame.url().includes('app.html?panel=1'));
    if (panel) break;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.ok(panel, 'floating launcher opens extension iframe');
  await panel.waitForSelector('#convert');
  await panel.locator('#file-input').setInputFiles({ name: 'floating.png', mimeType: 'image/png', buffer: png });
  await panel.locator('#convert').click();
  await panel.waitForFunction(() => document.getElementById('status').textContent.startsWith('转换完成'));
  assert.match(await panel.locator('#status').textContent(), /1 张成功/);
  await host.screenshot({ path: 'artifacts/screenshot-floating.png' });
  await panel.locator('#close').click();
  await host.mouse.click(1090, 932);
  assert.equal(await panel.locator('.file-meta.success').count(), 1, 'closing preserves results');
  console.log(`PASS ${extensionMode ? 'installed extension' : 'content script with runtime stub'}: floating panel, conversion and reopen state`);
  assert.deepEqual(errors, []);
  console.log('Browser validation complete.');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(profile, { recursive: true, force: true });
}
