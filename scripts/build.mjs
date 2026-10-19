import { build } from 'esbuild';
import { mkdir, copyFile, readFile, writeFile, readdir, rm } from 'node:fs/promises';
import { deflateSync } from 'node:zlib';
import { zipSync } from 'fflate';

await rm('dist', { recursive: true, force: true });
await mkdir('dist/icons', { recursive: true });
await mkdir('artifacts', { recursive: true });
await build({ entryPoints: ['src/app.js', 'src/background.js', 'src/content.js'], bundle: true, outdir: 'dist', platform: 'browser', target: 'chrome120', legalComments: 'eof', minify: true });
await copyFile('manifest.json', 'dist/manifest.json');
await copyFile('src/app.html', 'dist/app.html');
await copyFile('src/app.css', 'dist/app.css');
await copyFile('README.md', 'dist/README.md');
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1)); }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const name = Buffer.from(type), result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length); name.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE(crc32(Buffer.concat([name, data])), result.length - 4); return result;
}
function icon(size) {
  const data = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x / size, py = y / size;
    const border = px > .20 && px < .80 && py > .20 && py < .80 && (px < .24 || px > .76 || py < .24 || py > .76);
    const sun = (px - .36) ** 2 + (py - .36) ** 2 < .003;
    const mountain = px > .26 && px < .74 && py > .48 + Math.abs(px - .48) * .9 && py < .73;
    const color = border || sun || mountain ? [215, 238, 174, 255] : [33, 78, 64, 255];
    data.set(color, y * (size * 4 + 1) + 1 + x * 4);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header), chunk('IDAT', deflateSync(data)), chunk('IEND', Buffer.alloc(0))]);
}
for (const size of [16, 48, 128]) await writeFile(`dist/icons/${size}.png`, icon(size));
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
