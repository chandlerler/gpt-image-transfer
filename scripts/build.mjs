import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { zipSync } from 'fflate';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/icons', { recursive: true });
await mkdir('dist/assets', { recursive: true });
await copyFile('src/assets/launcher-hands.png', 'dist/assets/launcher-hands.png');
await copyFile('src/theme.css', 'dist/theme.css');
await copyFile('src/conversion-theme.css', 'dist/conversion-theme.css');
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['src/app.js', 'src/background.js', 'src/content.js', 'src/crop.js', 'src/crop-theme.js', 'src/popup.js'], bundle: true, outdir: 'dist', platform: 'browser', target: 'chrome120', legalComments: 'eof', minify: true });
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/app.html', 'dist/app.html');
await copyFile('src/popup.html', 'dist/popup.html');
await copyFile('src/popup.css', 'dist/popup.css');
await copyFile('src/app.css', 'dist/app.css');
await copyFile('README.md', 'dist/README.md');
await copyFile('USAGE.md', 'dist/USAGE.md');
await copyFile('src/crop.html', 'dist/crop.html');
await copyFile('src/crop.css', 'dist/crop.css');
for (const size of [16, 24, 32, 48, 128]) await copyFile(`src/assets/icons/${size}.png`, `dist/icons/${size}.png`);
const licenses = [];
for (const dep of ['fflate', 'gifenc', 'utif', 'pako']) {
  const dir = `node_modules/${dep}`;
  const name = (await readdir(dir)).find(name => /^license/i.test(name));
  if (name) licenses.push(`${dep}\n${await readFile(`${dir}/${name}`, 'utf8')}`);
}
await writeFile('dist/THIRD_PARTY_LICENSES.txt', licenses.join('\n\n----\n\n'));
const files = {};
async function collect(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) await collect(`${dir}/${entry.name}`, `${prefix}${entry.name}/`);
    else files[prefix + entry.name] = new Uint8Array(await readFile(`${dir}/${entry.name}`));
  }
}
await collect('dist');
await writeFile('artifacts/image-port-chrome.zip', zipSync(files, { level: 6 }));
console.log('Built dist/ and artifacts/image-port-chrome.zip');
