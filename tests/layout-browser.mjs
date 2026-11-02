import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname, file = resolve('dist', '.' + path);
  if (!file.startsWith(resolve('dist') + '/')) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream'); res.end(await readFile(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ reducedMotion: 'reduce' });
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  for (const [width, height] of [[1920, 1080], [2560, 1440], [1366, 768], [390, 844]]) {
    await page.setViewportSize({ width, height }); await page.goto(base + '/app.html');
    await page.locator('[data-format=png]').waitFor();
    const shell = await page.locator('.shell').boundingBox();
    assert.equal(shell.x, 0); assert.equal(shell.y, 0); assert.equal(shell.width, width); assert.ok(shell.height >= height);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    const workspace = await page.locator('.workspace').boundingBox(); assert.ok(workspace.width >= width - 80);
    const footer = await page.locator('footer').boundingBox(); assert.ok(footer.y + footer.height >= height - 1);
    if (width === 1920) await page.screenshot({ path: 'artifacts/fullpage-conversion.png', fullPage: true });
    const switchBefore = await page.locator('#themeToggle').boundingBox();
    await page.locator('#show-crop').click();
    const frame = await (await page.locator('#crop-frame').elementHandle()).contentFrame(); await frame.locator('#file').waitFor({ state: 'attached' });
    const crop = await page.locator('#crop-frame').boundingBox();
    assert.ok(crop.width >= width - 80); assert.ok(crop.height > height * .65);
    assert.ok(Math.abs(crop.y + crop.height - (height - (width <= 720 ? 8 : 12))) < 2, 'crop reaches bottom padding');
    assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true, 'only crop iframe scrolls');
    const inner = await frame.locator('.wrap').boundingBox(); assert.ok(inner.width >= crop.width - 34, 'wide crop contents use available width');
    assert.equal(await frame.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(await page.locator('#themeToggle').boundingBox(), switchBefore);
    if (width === 1920) await page.screenshot({ path: 'artifacts/fullpage-crop.png', fullPage: true });
    await page.locator('#show-convert').click(); assert.equal(await page.locator('#drop-zone').isVisible(), true);
  }
  await page.setViewportSize({ width: 600, height: 564 }); await page.goto(base + '/app.html?panel=1');
  await page.locator('[data-format=png]').waitFor();
  assert.equal(await page.locator('header').isVisible(), false);
  const compact = await page.locator('.workspace').boundingBox(); assert.equal(compact.width, 568);
  await page.locator('#show-crop').click(); const crop = await page.locator('#crop-frame').boundingBox(); assert.equal(Math.round(crop.height), 476);
  assert.deepEqual(errors, []);
  console.log('PASS full-page conversion/crop at 1920, 2560, 1366 and 390px; viewport height, full content width, no horizontal overflow, shared switch alignment and unchanged compact panel');
} finally { await browser?.close(); server.close(); }
