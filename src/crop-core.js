import { safeName, stem } from './core.js';

export function centerRect(width, height, ratio) {
  const w = Math.min(width, height * ratio), h = w / ratio;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}
export function clampRect(rect, width, height, ratio) {
  const maxW = Math.min(width, height * ratio);
  const minW = Math.min(maxW, 40 * Math.max(1, ratio));
  const w = Math.max(minW, Math.min(rect.w, maxW)), h = w / ratio;
  return { x: Math.max(0, Math.min(rect.x, width - w)), y: Math.max(0, Math.min(rect.y, height - h)), w, h };
}
export function resizeRect(start, corner, point, width, height, ratio) {
  const right = corner.endsWith('r'), bottom = corner.startsWith('b');
  const fx = right ? start.x : start.x + start.w;
  const fy = bottom ? start.y : start.y + start.h;
  const available = Math.min(right ? width - fx : fx, (bottom ? height - fy : fy) * ratio);
  const minW = Math.min(available, 40 * Math.max(1, ratio));
  const desired = Math.max((point.x - fx) * (right ? 1 : -1), (point.y - fy) * (bottom ? 1 : -1) * ratio);
  const w = Math.max(minW, Math.min(desired, available)), h = w / ratio;
  return clampRect({ x: right ? fx : fx - w, y: bottom ? fy : fy - h, w, h }, width, height, ratio);
}
export function batchStem(template, original, index, total) {
  const pattern = template.trim() || '{n}';
  const hasTokens = /\{(n|name)\}/.test(pattern);
  const named = pattern.replace(/\{name\}/g, () => stem(original)).replace(/\{n\}/g, String(index + 1).padStart(3, '0'));
  return safeName(hasTokens || total === 1 ? named : `${named}_${String(index + 1).padStart(String(total).length, '0')}`);
}
export function uniqueNames(entries) {
  const used = new Set();
  return entries.map(({ name, ext }) => {
    const base = safeName(name || 'image');
    let result = `${base}.${ext}`, suffix = 2;
    while (used.has(result.toLowerCase())) result = `${base} (${suffix++}).${ext}`;
    used.add(result.toLowerCase());
    return result;
  });
}
