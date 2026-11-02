// Rasterize the actual floating launcher at rest; do not redraw its artwork.
// Run explicitly after changing launcher.js or its hands asset. Normal builds
// copy the checked-in PNGs and do not require a browser installation.
import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
const artwork = `data:image/png;base64,${(await readFile('src/assets/launcher-hands.png')).toString('base64')}`;
const source = (await readFile('src/launcher.js', 'utf8')).replace('export function', 'function');
await mkdir('src/assets/icons', { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
try {
  const page = await browser.newPage({ viewport: { width: 256, height: 256 }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  await page.setContent('<style>html,body{margin:0;background:transparent}#icon{width:128px;height:128px}svg{display:block;width:100%;height:100%}</style><div id="icon"></div>');
  await page.evaluate(artwork => { window.chrome = { runtime: { getURL: () => artwork } }; }, artwork);
  await page.addScriptTag({ content: source + '\nmountImagePortLauncher(document.getElementById("icon"));' });
  await page.evaluate(async artwork => { const img = new Image(); img.src = artwork; await img.decode(); await new Promise(requestAnimationFrame); }, artwork);
  for (const size of [16, 24, 32, 48, 128]) {
    await page.locator('#icon').evaluate((el, size) => { el.style.width = `${size}px`; el.style.height = `${size}px`; }, size);
    await page.locator('#icon').screenshot({ path: `src/assets/icons/${size}.png`, omitBackground: true });
  }
} finally { await browser.close(); }
console.log('Exported circular launcher icons at 16, 24, 32, 48 and 128px');
