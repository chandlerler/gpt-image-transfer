import { Zip, ZipPassThrough } from 'fflate';

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
export function splitArchives(entries) {
  const batches = []; let batch = [], size = 0;
  for (const entry of entries) {
    if (entry.blob.size >= 2 ** 31) throw new Error('单张图片超过 2 GB，请缩小尺寸或单独下载');
    if (batch.length && (size + entry.blob.size > 512 * 1024 ** 2 || batch.length >= 10000)) {
      batches.push(batch); batch = []; size = 0;
    }
    batch.push(entry); size += entry.blob.size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export async function buildZip(entries) {
  const chunks = []; let failure;
  const zip = new Zip((error, chunk) => { if (error) failure = error; else chunks.push(chunk); });
  for (const { blob, name } of entries) {
    const entry = new ZipPassThrough(name); zip.add(entry);
    const reader = blob.stream().getReader();
    try {
      while (true) {
        const { value, done } = await reader.read(); if (done) break;
        entry.push(value, false); if (failure) throw failure;
      }
      entry.push(new Uint8Array(), true);
    } finally { reader.releaseLock(); }
  }
  zip.end(); if (failure) throw failure;
  return new Blob(chunks, { type: 'application/zip' });
}
