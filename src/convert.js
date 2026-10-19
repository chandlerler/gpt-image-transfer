import UTIF from 'utif';
import gifenc from 'gifenc';
import { formats, fitSize, encodeBMP, encodeICO } from './core.js';

const { GIFEncoder, quantize, applyPalette } = gifenc;
export async function decode(file) {
  if (/\.tiff?$/i.test(file.name) || /image\/tiff/i.test(file.type)) {
    const buffer = await file.arrayBuffer();
    const pages = UTIF.decode(buffer);
    if (!pages.length) throw new Error('TIFF 没有可读取的页面');
    const page = pages[0];
    const width = page.t256?.[0], height = page.t257?.[0];
    checkSize(width, height);
    UTIF.decodeImage(buffer, page);
    const canvas = document.createElement('canvas');
    canvas.width = page.width; canvas.height = page.height;
    canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(UTIF.toRGBA8(page)), page.width, page.height), 0, 0);
    return { source: canvas, width: canvas.width, height: canvas.height, release: () => { canvas.width = 0; } };
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    checkSize(img.naturalWidth, img.naturalHeight);
    // createImageBitmap captures a stable first frame and honors EXIF orientation.
    let source;
    try { source = await createImageBitmap(file); } catch { source = img; }
    return { source, width: source.width || img.naturalWidth, height: source.height || img.naturalHeight, release: () => { source.close?.(); URL.revokeObjectURL(url); } };
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('无法解码：文件可能损坏，或属于浏览器不支持的格式（如 HEIC / RAW）');
  }
}
function checkSize(width, height) {
  if (!width || !height || width * height > 80_000_000 || width > 32767 || height > 32767) throw new Error('图片尺寸无效或超过安全处理范围（8000 万像素）');
}
function canvasBlob(canvas, mime, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== mime) reject(new Error(`当前浏览器无法编码 ${mime}`));
    else resolve(blob);
  }, mime, quality));
}
export async function convert(file, options) {
  const decoded = await decode(file);
  const canvas = document.createElement('canvas');
  try {
    const { width, height } = fitSize(decoded.width, decoded.height, options.maxWidth, options.maxHeight, options.format);
    canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('无法分配图片内存，请缩小图片后重试');
    if (['jpg', 'bmp', 'gif'].includes(options.format)) {
      context.fillStyle = options.background;
      context.fillRect(0, 0, width, height);
    }
    context.drawImage(decoded.source, 0, 0, width, height);
    let blob;
    if (['png', 'jpg', 'webp'].includes(options.format)) blob = await canvasBlob(canvas, formats[options.format].mime, options.quality);
    else if (options.format === 'ico') {
      const png = await canvasBlob(canvas, 'image/png');
      blob = new Blob([encodeICO(new Uint8Array(await png.arrayBuffer()), width, height)], { type: formats.ico.mime });
    } else {
      const pixels = context.getImageData(0, 0, width, height);
      let buffer;
      if (options.format === 'bmp') buffer = encodeBMP(pixels);
      if (options.format === 'tiff') buffer = UTIF.encodeImage(pixels.data, width, height);
      if (options.format === 'gif') {
        const palette = quantize(pixels.data, 256);
        const index = applyPalette(pixels.data, palette);
        const gif = GIFEncoder();
        gif.writeFrame(index, width, height, { palette }); gif.finish(); buffer = gif.bytes();
      }
      blob = new Blob([buffer], { type: formats[options.format].mime });
    }
    // Always use a PNG preview, including formats Chrome cannot display directly.
    const thumbnail = document.createElement('canvas');
    const scale = Math.min(1, 96 / width, 96 / height);
    thumbnail.width = Math.max(1, Math.round(width * scale)); thumbnail.height = Math.max(1, Math.round(height * scale));
    thumbnail.getContext('2d').drawImage(canvas, 0, 0, thumbnail.width, thumbnail.height);
    const preview = await canvasBlob(thumbnail, 'image/png');
    return { blob, preview, width, height };
  } finally { decoded.release(); canvas.width = 0; canvas.height = 0; }
}
