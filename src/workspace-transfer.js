// Chrome messages use JSON. Blob/File bytes are transferred in bounded chunks;
// object URLs, DOM nodes, decoded images and canvases never cross windows.
const CHUNK_SIZE = 192 * 1024;
// Crop files originate in another iframe realm: instanceof Blob/File would miss them.
const isFile = value => Object.prototype.toString.call(value) === '[object File]';
const isBlob = value => isFile(value) || Object.prototype.toString.call(value) === '[object Blob]';
export const transferPrefix = 'image-port:workspace:';

async function request(action, data = {}) {
  const response = await chrome.runtime.sendMessage({ type: transferPrefix + action, ...data });
  if (!response?.ok) throw new Error(response?.error || '无法连接插件，请重新加载插件后重试');
  return response;
}
function pack(value, blobs, seen) {
  if (isBlob(value)) {
    let index = seen.get(value);
    if (index === undefined) { index = blobs.length; seen.set(value, index); blobs.push(value); }
    return { __imagePortBlob: index };
  }
  if (Array.isArray(value)) return value.map(item => pack(item, blobs, seen));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, pack(item, blobs, seen)]));
  return value;
}
function unpack(value, blobs) {
  if (value && typeof value === 'object' && Number.isInteger(value.__imagePortBlob)) return blobs[value.__imagePortBlob];
  if (Array.isArray(value)) return value.map(item => unpack(item, blobs));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item, blobs)]));
  return value;
}
function encode(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
export async function openWorkspace(snapshot, progress = () => {}) {
  const blobs = [], meta = pack(snapshot, blobs, new WeakMap());
  const descriptors = blobs.map(blob => ({ size: blob.size, type: blob.type, chunks: Math.ceil(blob.size / CHUNK_SIZE),
    name: isFile(blob) ? blob.name : null, lastModified: isFile(blob) ? blob.lastModified : null }));
  const { id } = await request('begin', { meta, blobs: descriptors });
  try {
    let sent = 0; const total = descriptors.reduce((sum, item) => sum + item.size, 0);
    for (let index = 0; index < blobs.length; index++) {
      for (let chunk = 0; chunk < descriptors[index].chunks; chunk++) {
        const bytes = new Uint8Array(await blobs[index].slice(chunk * CHUNK_SIZE, (chunk + 1) * CHUNK_SIZE).arrayBuffer());
        await request('put', { id, index, chunk, data: encode(bytes) });
        sent += bytes.length; progress(sent, total);
      }
    }
    return await request('open', { id });
  } catch (error) {
    await request('discard', { id }).catch(() => {});
    throw error;
  }
}
export async function loadWorkspace(id) {
  const { meta, blobs: descriptors } = await request('get', { id });
  const blobs = [];
  for (let index = 0; index < descriptors.length; index++) {
    const descriptor = descriptors[index], parts = [];
    for (let chunk = 0; chunk < descriptor.chunks; chunk++) {
      const { data } = await request('part', { id, index, chunk });
      parts.push(Uint8Array.from(atob(data), character => character.charCodeAt(0)));
    }
    const options = { type: descriptor.type, lastModified: descriptor.lastModified };
    const blob = descriptor.name === null ? new Blob(parts, options) : new File(parts, descriptor.name, options);
    if (blob.size !== descriptor.size) throw new Error('工作内容读取不完整，请从悬浮窗重新打开');
    blobs.push(blob);
  }
  return unpack(meta, blobs);
}
export async function discardWorkspace(id) { await request('discard', { id }); }

export function captureControls(root) {
  return Object.fromEntries([...root.querySelectorAll('input[id]:not([type=file]), select[id], textarea[id]')]
    .map(input => [input.id, { value: input.value, checked: input.checked }]));
}
export function restoreControls(root, values) {
  for (const [id, state] of Object.entries(values || {})) {
    const input = root.querySelector('#' + CSS.escape(id));
    if (!input || input.type === 'file') continue;
    input.value = state.value;
    if ('checked' in input) input.checked = !!state.checked;
  }
}
