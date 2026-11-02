import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const server = createServer(async (req, res) => {
  const path = new URL(req.url, 'http://localhost').pathname;
  if (path === '/host') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><style>html{transform:translate(80px,90px);filter:opacity(1);contain:paint}body{height:3000px}div{margin:100px;direction:rtl}</style><h1>Hostile page styles</h1>'); return; }
  const file = resolve('dist', '.' + path);
  if (!file.startsWith(resolve('dist') + '/')) return res.writeHead(403).end();
  try { res.setHeader('Content-Type', path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'application/octet-stream'); res.end(await readFile(file)); } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  browser = await chromium.launch({ executablePath: '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width: 1200, height: 900 }, reducedMotion: 'reduce' });
  const errors = [], opened = [];
  context.on('page', p => p.on('pageerror', e => errors.push(e.message)));
  let stored = {}, host, failWrite = false;
  await context.exposeBinding('storageGet', () => ({ launcherEnabled: true, ...stored }));
  await context.exposeBinding('storageSet', async (_, value) => {
    if (failWrite) throw Error('test write failure');
    const changes = Object.fromEntries(Object.entries(value).map(([key, newValue]) => [key, { oldValue: stored[key], newValue }]));
    Object.assign(stored, value);
    await Promise.all(context.pages().map(p => p.evaluate(changes => window.storageListeners?.forEach(fn => fn(changes, 'local')), changes)));
  });
  await context.exposeBinding('sendTab', async (_, message) => {
    if (!host) throw Error('Restricted page');
    return host.evaluate(message => new Promise(resolve => { window.messageListeners.forEach(fn => fn(message, {}, resolve)); }), message);
  });
  await context.exposeBinding('createTab', (_, options) => { opened.push(options); return { id: 2 }; });
  await context.addInitScript(base => {
    window.storageListeners = []; window.messageListeners = [];
    window.chrome = { storage: { local: { get: () => window.storageGet(), set: value => window.storageSet(value) }, onChanged: { addListener: fn => window.storageListeners.push(fn) } }, runtime: { getURL: path => base + '/' + path.replace(/^\//, ''), onMessage: { addListener: fn => window.messageListeners.push(fn) } }, tabs: { query: async () => [{ id: 1 }], sendMessage: (_, msg) => window.sendTab(msg), create: options => window.createTab(options) } };
    const attach = Element.prototype.attachShadow;
    Element.prototype.attachShadow = function (options) { return attach.call(this, { ...options, mode: 'open' }); };
    window.close = () => { window.didClose = true; };
  }, base);
  host = await context.newPage(); await host.goto(base + '/host'); await host.addScriptTag({ url: base + '/content.js' });
  const launcher = host.locator('.launcher'); await launcher.waitFor();
  async function rightBottom() { const box = await launcher.boundingBox(), v = host.viewportSize(); assert.equal(Math.round(v.width - box.x - box.width), 20); assert.equal(Math.round(v.height - box.y - box.height), 24); }
  await rightBottom();
  await host.setViewportSize({ width: 600, height: 450 }); await host.evaluate(() => new Promise(requestAnimationFrame)); await rightBottom();
  await host.setViewportSize({ width: 1200, height: 900 }); await host.evaluate(() => new Promise(requestAnimationFrame)); await rightBottom();
  await host.evaluate(() => scrollTo(0, 1000)); await rightBottom();
  await launcher.click();
  const app = await (await host.locator('iframe').elementHandle()).contentFrame();
  await app.locator('#pattern').fill('保留内容_{n}');
  const box = await launcher.boundingBox();
  await host.mouse.move(box.x + 22, box.y + 22); await host.mouse.down(); await host.mouse.move(62, 102, { steps: 8 }); await host.mouse.up();
  await host.setViewportSize({ width: 800, height: 600 }); await host.evaluate(() => new Promise(requestAnimationFrame));
  const moved = await launcher.boundingBox(); assert.equal(Math.round(moved.x), 40); assert.equal(Math.round(moved.y), 80);
  console.log('PASS default bottom-right anchoring after shrink/grow, hostile page transforms, scrolling, and dragged edge anchoring');
  const popup = await context.newPage(); await popup.goto(base + '/popup.html');
  await popup.locator('#launcher-enabled').uncheck();
  await host.locator('#image-port-root').waitFor({ state: 'hidden' });
  const next = await context.newPage(); await next.goto(base + '/host'); await next.addScriptTag({ url: base + '/content.js' });
  await next.waitForFunction(() => window.storageListeners.length > 0);
  assert.equal(await next.locator('#image-port-root').isVisible(), false);
  await popup.reload(); assert.equal(await popup.locator('#launcher-enabled').isChecked(), false);
  await popup.locator('#open-page').click(); assert.deepEqual(opened, [{ url: base + '/app.html' }]);
  await popup.reload(); await popup.locator('#open-panel').click();
  await host.locator('.panel').waitFor(); await next.locator('.launcher').waitFor();
  assert.equal(stored.launcherEnabled, true); assert.equal(await app.locator('#pattern').inputValue(), '保留内容_{n}');
  console.log('PASS toolbar launch, persisted global visibility across existing/new pages, and preserved iframe workspace after re-enable');
  const savedHost = host; host = null;
  await popup.reload(); await popup.locator('#open-panel').click();
  assert.match(await popup.locator('#status').textContent(), /此页面暂不能/);
  await popup.locator('#open-page').click(); assert.equal(opened.length, 2);
  host = savedHost; failWrite = true;
  await popup.reload(); await popup.locator('#launcher-enabled').click();
  await popup.waitForFunction(() => document.getElementById('status').textContent.includes('设置保存失败'));
  assert.equal(await popup.locator('#launcher-enabled').isChecked(), true);
  assert.equal(await launcher.isVisible(), true);
  assert.deepEqual(errors, []);
  console.log('PASS restricted-page independent tool entry, storage failure recovery, no browser errors');
} finally { await browser?.close(); server.close(); }
