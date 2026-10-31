import { transferPrefix } from './workspace-transfer.js';
const TTL = 24 * 60 * 60 * 1000;
let database;
function db() {
  return database ||= new Promise((resolve, reject) => {
    const opening = indexedDB.open('image-port-workspace-transfer', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('records', { keyPath: 'key' });
    opening.onsuccess = () => resolve(opening.result);
    opening.onerror = () => { database = null; reject(opening.error); };
  });
}
async function read(key) {
  const connection = await db();
  return new Promise((resolve, reject) => {
    const transaction = connection.transaction('records', 'readonly');
    const query = transaction.objectStore('records').get(key);
    query.onsuccess = () => resolve(query.result);
    query.onerror = () => reject(query.error);
  });
}
async function write(record) {
  const connection = await db();
  await new Promise((resolve, reject) => {
    const transaction = connection.transaction('records', 'readwrite');
    transaction.objectStore('records').put(record);
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error || new Error('本地存储空间不足'));
    transaction.onerror = () => {};
  });
}
async function clean(id) {
  const connection = await db();
  await new Promise((resolve, reject) => {
    const transaction = connection.transaction('records', 'readwrite');
    const cursor = transaction.objectStore('records').openCursor();
    cursor.onsuccess = () => {
      const item = cursor.result;
      if (!item) return;
      if (id ? item.value.id === id : item.value.created < Date.now() - TTL) item.delete();
      item.continue();
    };
    transaction.oncomplete = resolve;
    transaction.onabort = () => reject(transaction.error);
  });
}
async function session(id) {
  if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的工作内容编号');
  const item = await read(id + ':meta');
  if (!item || item.created < Date.now() - TTL) throw new Error('工作内容已过期，请回到悬浮窗重新打开');
  return item;
}
function partKey(item, index, chunk) {
  if (!Number.isInteger(index) || !Number.isInteger(chunk) || !item.blobs[index] || chunk < 0 || chunk >= item.blobs[index].chunks) throw new Error('无效的图片数据分块');
  return `${item.id}:${index}:${chunk}`;
}
export async function handleWorkspaceMessage(message, sender) {
  const app = chrome.runtime.getURL('app.html');
  if (sender.id !== chrome.runtime.id || !sender.url || sender.url.split('?')[0].split('#')[0] !== app) throw new Error('只能在图像港页面中复制工作内容');
  const action = message.type.slice(transferPrefix.length);
  if (action === 'begin') {
    if (message.meta?.version !== 1 || !Array.isArray(message.blobs)) throw new Error('工作内容格式不正确');
    for (const blob of message.blobs) {
      if (!Number.isSafeInteger(blob.size) || blob.size < 0 || blob.chunks !== Math.ceil(blob.size / (192 * 1024))) throw new Error('图片数据格式不正确');
    }
    await clean();
    const id = crypto.randomUUID();
    await write({ key: id + ':meta', id, created: Date.now(), meta: message.meta, blobs: message.blobs, ready: false });
    return { id };
  }
  const item = await session(message.id);
  if (action === 'discard') { await clean(item.id); return {}; }
  if (action === 'put') {
    if (item.ready || typeof message.data !== 'string' || message.data.length > 262144 || !/^[A-Za-z0-9+/]*={0,2}$/.test(message.data)) throw new Error('图片数据分块不正确');
    const key = partKey(item, message.index, message.chunk);
    const expected = Math.min(192 * 1024, item.blobs[message.index].size - message.chunk * 192 * 1024);
    if (atob(message.data).length !== expected) throw new Error('图片分块长度不正确');
    await write({ key, id: item.id, created: item.created, data: message.data });
    return {};
  }
  if (action === 'open') {
    for (let index = 0; index < item.blobs.length; index++) {
      for (let chunk = 0; chunk < item.blobs[index].chunks; chunk++) if (!await read(partKey(item, index, chunk))) throw new Error('图片传输未完成，请重试');
    }
    item.ready = true; await write(item);
    const tab = await chrome.tabs.create({ url: chrome.runtime.getURL(`app.html?workspace=${item.id}`) });
    return { tabId: tab.id };
  }
  if (!item.ready) throw new Error('工作内容尚未传输完成');
  if (action === 'get') return { meta: item.meta, blobs: item.blobs };
  if (action === 'part') {
    const part = await read(partKey(item, message.index, message.chunk));
    if (!part) throw new Error('找不到图片数据，请重新复制工作内容');
    return { data: part.data };
  }
  throw new Error('不支持的工作内容操作');
}
