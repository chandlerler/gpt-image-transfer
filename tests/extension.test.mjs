import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
const background = await readFile('src/background.js', 'utf8');
test('manifest uses MV3, packaged scripts, and no remote code or privileged downloads API', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions || [], []);
  assert.ok(manifest.content_security_policy.extension_pages.includes("connect-src 'none'"));
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.content_scripts[0].js[0], 'content.js');
  for (const resource of manifest.web_accessible_resources[0].resources) assert.ok(!resource.includes('*') && !resource.includes('://'));
});
test('toolbar toggles supported page and opens standalone page when content script is unavailable', async () => {
  const sent = [], opened = [];
  let onClick;
  const chrome = {
    action: { onClicked: { addListener: fn => { onClick = fn; } } },
    runtime: { getURL: path => `chrome-extension://test/${path}` },
    tabs: { sendMessage: async (id, message) => { sent.push({ id, message }); }, create: async options => { opened.push(options); } },
  };
  runInNewContext(background, { chrome });
  await onClick({ id: 42 });
  assert.equal(sent[0].id, 42); assert.equal(sent[0].message.type, 'image-port:toggle'); assert.equal(opened.length, 0);
  chrome.tabs.sendMessage = async () => { throw new Error('Restricted page'); };
  await onClick({ id: 43 });
  assert.equal(opened[0].url, 'chrome-extension://test/app.html');
});
