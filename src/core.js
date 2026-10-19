export const formats = {
  png: { label: 'PNG', mime: 'image/png' },
  jpg: { label: 'JPG', mime: 'image/jpeg' },
  webp: { label: 'WebP', mime: 'image/webp' },
  gif: { label: 'GIF', mime: 'image/gif' },
  bmp: { label: 'BMP', mime: 'image/bmp' },
  tiff: { label: 'TIFF', mime: 'image/tiff' },
  ico: { label: 'ICO', mime: 'image/x-icon' },
};
export function stem(name) { return name.replace(/\.[^.]+$/, '') || 'image'; }
export function safeName(name) {
  const clean = name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').trim().slice(0, 160) || 'image';
  return /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(clean) ? `_${clean}` : clean;
}
export function outputNames(files, { format, pattern = '{name}', start = 1, digits = 3 }) {
  const used = new Set();
  return files.map((file, i) => {
    const base = safeName((pattern.trim() || '{name}').replace(/\{name\}/g, () => stem(file.name)).replace(/\{n\}/g, String(start + i).padStart(digits, '0')));
    let name = `${base}.${format}`, count = 2;
    while (used.has(name.toLowerCase())) name = `${base} (${count++}).${format}`;
    used.add(name.toLowerCase());
    return name;
  });
}
export function fitSize(width, height, maxWidth, maxHeight, format) {
  const limit = format === 'ico' ? 256 : Infinity;
  const scale = Math.min(1, (maxWidth || Infinity) / width, (maxHeight || Infinity) / height, limit / width, limit / height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}
export function bytes(size) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}
export function encodeBMP({ data, width, height }) {
  const stride = Math.ceil(width * 3 / 4) * 4;
  const buffer = new ArrayBuffer(54 + stride * height), view = new DataView(buffer);
  view.setUint16(0, 0x4d42, true); view.setUint32(2, buffer.byteLength, true); view.setUint32(10, 54, true);
  view.setUint32(14, 40, true); view.setInt32(18, width, true); view.setInt32(22, height, true);
  view.setUint16(26, 1, true); view.setUint16(28, 24, true); view.setUint32(34, stride * height, true);
  const out = new Uint8Array(buffer);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const src = (y * width + x) * 4, dst = 54 + (height - 1 - y) * stride + x * 3;
    out[dst] = data[src + 2]; out[dst + 1] = data[src + 1]; out[dst + 2] = data[src];
  }
  return buffer;
}
export function encodeICO(png, width, height) {
  const buffer = new Uint8Array(22 + png.length), view = new DataView(buffer.buffer);
  view.setUint16(2, 1, true); view.setUint16(4, 1, true);
  buffer[6] = width === 256 ? 0 : width; buffer[7] = height === 256 ? 0 : height;
  view.setUint16(10, 1, true); view.setUint16(12, 32, true);
  view.setUint32(14, png.length, true); view.setUint32(18, 22, true); buffer.set(png, 22);
  return buffer;
}
