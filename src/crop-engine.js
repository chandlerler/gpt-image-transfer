// Crop in source coordinates, then progressively downsample for clean edges.
export function drawCropped(img, crop, tw, th) {
  let cw = Math.max(1, Math.round(crop.w)), ch = Math.max(1, Math.round(crop.h));
  let current = document.createElement('canvas');
  current.width = cw; current.height = ch;
  const ctx = current.getContext('2d');
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.x, crop.y, crop.w, crop.h, 0, 0, cw, ch);
  while (cw > tw * 2 && ch > th * 2) {
    const next = document.createElement('canvas');
    next.width = Math.max(tw, Math.round(cw / 2)); next.height = Math.max(th, Math.round(ch / 2));
    const c = next.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
    c.drawImage(current, 0, 0, next.width, next.height);
    current.width = 0; current = next; cw = next.width; ch = next.height;
  }
  const output = document.createElement('canvas'); output.width = tw; output.height = th;
  const c = output.getContext('2d'); c.imageSmoothingEnabled = true; c.imageSmoothingQuality = 'high';
  c.drawImage(current, 0, 0, tw, th); current.width = 0;
  return output;
}
function canvasBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => canvas.toBlob(blob => {
    if (!blob || blob.type !== type) reject(new Error('浏览器无法编码所选格式'));
    else resolve(blob);
  }, type, quality));
}
export async function encodeBest(canvas, type, maxBytes = Infinity) {
  let source = canvas;
  if (type === 'image/jpeg') {
    source = document.createElement('canvas'); source.width = canvas.width; source.height = canvas.height;
    const c = source.getContext('2d'); c.fillStyle = '#ffffff'; c.fillRect(0, 0, source.width, source.height); c.drawImage(canvas, 0, 0);
  }
  try {
    const top = await canvasBlob(source, type, 1);
    if (type === 'image/png') return { blob: top, quality: null, over: top.size > maxBytes };
    if (top.size <= maxBytes) return { blob: top, quality: 1, over: false };
    let lo = 0.4, hi = 1, best = null;
    for (let i = 0; i < 8; i++) {
      const mid = (lo + hi) / 2, blob = await canvasBlob(source, type, mid);
      if (blob.size <= maxBytes) { best = { blob, quality: mid, over: false }; lo = mid; }
      else hi = mid;
    }
    if (best) return best;
    const blob = await canvasBlob(source, type, 0.4);
    return { blob, quality: 0.4, over: blob.size > maxBytes };
  } finally { if (source !== canvas) source.width = 0; }
}
