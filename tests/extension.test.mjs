import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('manifest.json', 'utf8'));
test('manifest uses MV3, packaged scripts, and no remote code or privileged downloads API', () => {
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions || [], ['storage']);
  assert.ok(manifest.content_security_policy.extension_pages.includes("connect-src 'none'"));
  assert.equal(manifest.background.service_worker, 'background.js');
  assert.equal(manifest.content_scripts[0].js[0], 'content.js');
  for (const resource of manifest.web_accessible_resources[0].resources) assert.ok(!resource.includes('*') && !resource.includes('://'));
});
test('toolbar exposes the packaged popup without requiring page access', async () => {
  assert.equal(manifest.action.default_popup, 'popup.html');
  const popup = await readFile('src/popup.html', 'utf8');
  assert.ok(popup.includes('id="open-page"'));
  assert.ok(popup.includes('id="launcher-enabled"'));
});
