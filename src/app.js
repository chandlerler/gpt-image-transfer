import { initTheme, setTheme } from './theme.js';
import { openWorkspace, loadWorkspace, discardWorkspace, captureControls, restoreControls } from './workspace-transfer.js';
import { Zip, ZipPassThrough } from 'fflate';
import { formats, outputNames, bytes } from './core.js';
import { convert } from './convert.js';

const $ = id => document.getElementById(id);
document.body.classList.toggle('in-panel', new URLSearchParams(location.search).has('panel'));
let cropFrame;
let currentTool = "convert";
function selectTool(tool) {
  currentTool = tool;
  const cropping = tool === 'crop';
  $('conversion-view').hidden = cropping;
  $('crop-view').hidden = !cropping;
  document.body.classList.toggle('crop-active', cropping);
  window.dispatchEvent(new CustomEvent('image-port:tool-change'));
  for (const name of ['convert', 'crop']) {
    const button = $(`show-${name}`), active = name === tool;
    button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
  }
  if (cropping && !cropFrame) {
    cropFrame = document.createElement('iframe'); cropFrame.id = 'crop-frame';
    cropFrame.title = '图片批量裁剪'; cropFrame.src = 'crop.html';
    $('crop-view').append(cropFrame);
  }
}
for (const tool of ['convert', 'crop']) {
  $(`show-${tool}`).addEventListener('click', () => selectTool(tool));
  $(`show-${tool}`).addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'convert' : event.key === 'End' ? 'crop' : tool === 'crop' ? 'convert' : 'crop';
    selectTool(next); $(`show-${next}`).focus();
  });
}
const entries = [];
let selectedFormat = 'png', busy = false, stopped = false, sequence = 0;
const tips = {
  png: '无损压缩，保留透明背景。', jpg: '适合照片；透明区域将填充为指定颜色。',
  webp: '兼顾体积与画质，支持透明背景。', gif: '静态 GIF，最多 256 色；透明区域使用填充色。',
  bmp: '24 位位图，兼容性好，文件较大。', tiff: '无损 TIFF，保留透明背景，适合进一步编辑。',
  ico: 'PNG 编码图标，保持比例，最大 256 × 256。',
};
function status(message) { $('status').textContent = message; }
function options() {
  return {
    format: selectedFormat, quality: Number($('quality').value) / 100, background: $('background').value,
    pattern: $('pattern').value, start: Number($('start').value), digits: Number($('digits').value),
    maxWidth: Number($('max-width').value), maxHeight: Number($('max-height').value),
  };
}
function validOptions() {
  for (const id of ['start', 'max-width', 'max-height']) if (!$(id).checkValidity()) { $(id).reportValidity(); return false; }
  return true;
}
function names() { return outputNames(entries.map(entry => entry.file), options()); }
function release(entry) {
  if (entry.previewURL) URL.revokeObjectURL(entry.previewURL);
  entry.previewURL = null; entry.previewBlob = null; entry.result = null;
}
function refresh() {
  const listNames = names();
  $('count').textContent = entries.length;
  $('total-size').textContent = entries.length ? `${entries.length} 张图片 · ${bytes(entries.reduce((n, entry) => n + entry.file.size, 0))}` : '尚未添加图片';
  $('empty').hidden = entries.length > 0;
  $('clear').disabled = busy || !entries.length;
  $('convert').disabled = busy || !entries.length;
  const ready = entries.filter(entry => entry.result).length;
  $('download-all').disabled = busy || !ready;
  $('download-all').textContent = ready ? `↓ 打包下载 ZIP · ${ready} 张` : '↓ 打包下载 ZIP';
  $('name-preview').textContent = listNames[0] || outputNames([{ name: 'image.png' }], options())[0];
  entries.forEach((entry, i) => {
    entry.title.textContent = entry.result ? listNames[i] : entry.file.name;
    entry.title.title = `${entry.file.name} → ${listNames[i]}`;
    entry.download.disabled = busy || !entry.result;
    entry.remove.disabled = busy;
  });
}
function setBusy(value) {
  busy = value;
  document.querySelectorAll('.settings input, .settings select, .format-grid button').forEach(el => { el.disabled = value; });
  $('file-input').disabled = value;
  $('drop-zone').setAttribute('aria-disabled', String(value));
  refresh();
}
function invalidate() {
  entries.forEach(entry => {
    entry.result = null;
    entry.meta.className = 'file-meta'; entry.meta.textContent = `${bytes(entry.file.size)} · 等待转换`;
  });
  $('progress').hidden = true;
  if (entries.length) status('转换设置已更新，点击开始转换生成新文件。');
  refresh();
}
function addFiles(files) {
  if (busy) { status('当前任务处理中，请完成后再添加图片。'); return; }
  const fragment = document.createDocumentFragment();
  for (const file of files) {
    const entry = { id: ++sequence, file, result: null, previewURL: null };
    const row = document.createElement('li'); row.className = 'file-row';
    const thumb = document.createElement('div'); thumb.className = 'thumb file-icon'; thumb.textContent = '▧';
    const info = document.createElement('div'); info.className = 'file-info';
    const title = document.createElement('span'); title.className = 'file-name'; title.textContent = file.name;
    const meta = document.createElement('div'); meta.className = 'file-meta'; meta.textContent = `${bytes(file.size)} · 等待转换`;
    info.append(title, meta);
    const actions = document.createElement('div'); actions.className = 'row-actions';
    const download = document.createElement('button'); download.textContent = '↓'; download.title = '下载此图片'; download.setAttribute('aria-label', `下载 ${file.name}`); download.disabled = true;
    download.addEventListener('click', () => saveBlob(entry.result.blob, names()[entries.indexOf(entry)]));
    const remove = document.createElement('button'); remove.textContent = '×'; remove.title = '移除'; remove.setAttribute('aria-label', `移除 ${file.name}`);
    remove.addEventListener('click', () => { if (busy) return; release(entry); entries.splice(entries.indexOf(entry), 1); row.remove(); refresh(); });
    actions.append(download, remove); row.append(thumb, info, actions); fragment.append(row);
    Object.assign(entry, { row, thumb, title, meta, download, remove }); entries.push(entry);
  }
  $('file-list').append(fragment); refresh();
  status(`已添加 ${entries.length} 张图片，可以开始转换。`);
}
function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob), anchor = document.createElement('a');
  anchor.href = url; anchor.download = name; document.body.append(anchor); anchor.click(); anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
const yieldUI = () => new Promise(resolve => setTimeout(resolve, 0));
async function run() {
  if (busy || !entries.length || !validOptions()) return;
  const settings = options();
  stopped = false; setBusy(true); $('cancel').hidden = false;
  $('cancel').disabled = false; $('cancel').textContent = '停止处理';
  $('progress').hidden = false; $('progress').max = entries.length; $('progress').value = 0;
  let succeeded = 0, failed = 0, processed = 0;
  // Clear old results so a stopped second run cannot mix conversion settings.
  entries.forEach(entry => { entry.result = null; entry.meta.className = 'file-meta'; entry.meta.textContent = `${bytes(entry.file.size)} · 等待转换`; });
  try {
    for (const entry of entries) {
      if (stopped) break;
      status(`正在转换 ${processed + 1} / ${entries.length}：${entry.file.name}`);
      entry.meta.textContent = '正在处理…';
      await yieldUI();
      try {
        const result = await convert(entry.file, settings);
        release(entry); entry.result = result; entry.previewBlob = result.preview; entry.previewURL = URL.createObjectURL(result.preview);
        const preview = document.createElement('img'); preview.className = 'thumb'; preview.alt = entry.file.name; preview.src = entry.previewURL;
        entry.thumb.replaceWith(preview); entry.thumb = preview;
        entry.meta.className = 'file-meta success';
        entry.meta.textContent = `✓ ${result.width} × ${result.height} · ${bytes(entry.file.size)} → ${bytes(result.blob.size)}`;
        succeeded++;
      } catch (error) {
        entry.meta.className = 'file-meta error'; entry.meta.textContent = error.message || '转换失败，请重试'; failed++;
      }
      processed++; $('progress').value = processed;
    }
    status(`${stopped ? '已停止' : '转换完成'}：${succeeded} 张成功${failed ? `，${failed} 张失败（见文件提示）` : ''}${processed < entries.length ? `，${entries.length - processed} 张未处理` : ''}。成功的文件可直接下载。`);
  } finally { setBusy(false); $('cancel').hidden = true; }
}
async function buildArchive(batch) {
  const chunks = [];
  let zipError;
  const zip = new Zip((error, chunk) => { if (error) zipError = error; else chunks.push(chunk); });
  for (const { entry, name } of batch) {
    const file = new ZipPassThrough(name);
    zip.add(file);
    const reader = entry.result.blob.stream().getReader();
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        file.push(value, false);
        if (zipError) throw zipError;
      }
      file.push(new Uint8Array(0), true);
    } finally { reader.releaseLock(); }
  }
  zip.end(); if (zipError) throw zipError;
  return new Blob(chunks, { type: 'application/zip' });
}
async function downloadAll() {
  if (busy || !validOptions()) return;
  const listNames = names();
  const ready = entries.map((entry, i) => ({ entry, name: listNames[i] })).filter(item => item.entry.result);
  if (!ready.length) return;
  setBusy(true);
  try {
    // Split before ZIP32 bounds; large batches still work without a fixed queue limit.
    const batches = []; let batch = [], size = 0;
    for (const item of ready) {
      if (item.entry.result.blob.size >= 2 ** 31) throw new Error('单个文件超过 2 GB，请使用单张下载或缩小尺寸');
      if (batch.length && (size + item.entry.result.blob.size > 512 * 1024 ** 2 || batch.length >= 10000)) { batches.push(batch); batch = []; size = 0; }
      batch.push(item); size += item.entry.result.blob.size;
    }
    if (batch.length) batches.push(batch);
    for (let i = 0; i < batches.length; i++) {
      status(`正在打包 ${i + 1} / ${batches.length}，共 ${ready.length} 张图片…`);
      await yieldUI();
      saveBlob(await buildArchive(batches[i]), `image-port${batches.length > 1 ? `-${i + 1}` : ''}.zip`);
    }
    status(`已生成 ${batches.length} 个 ZIP，包含 ${ready.length} 张图片。${batches.length > 1 ? '如浏览器提示，请允许多个文件下载。' : ''}`);
  } catch (error) { status(`打包失败：${error.message}。可使用每张图片旁的下载按钮。`); }
  finally { setBusy(false); }
}
for (const [format, { label }] of Object.entries(formats)) {
  const button = document.createElement('button'); button.textContent = label; button.dataset.format = format;
  button.setAttribute('aria-pressed', String(format === selectedFormat)); button.classList.toggle('active', format === selectedFormat);
  button.addEventListener('click', () => {
    if (busy || selectedFormat === format) return;
    selectedFormat = format;
    document.querySelectorAll('#formats button').forEach(el => { el.classList.toggle('active', el.dataset.format === format); el.setAttribute('aria-pressed', String(el.dataset.format === format)); });
    $('format-tip').textContent = tips[format]; $('quality-field').hidden = !['jpg', 'webp'].includes(format);
    $('background-field').hidden = !['jpg', 'bmp', 'gif'].includes(format); invalidate();
  });
  $('formats').append(button);
}
$('quality-field').hidden = true;
$('file-input').addEventListener('change', event => { addFiles(event.target.files); event.target.value = ''; });
$('drop-zone').addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); if (!busy) $('file-input').click(); } });
for (const type of ['dragenter', 'dragover']) $('drop-zone').addEventListener(type, event => { event.preventDefault(); $('drop-zone').classList.add('dragover'); });
for (const type of ['dragleave', 'drop']) $('drop-zone').addEventListener(type, event => { event.preventDefault(); $('drop-zone').classList.remove('dragover'); });
$('drop-zone').addEventListener('drop', event => addFiles(event.dataTransfer.files));
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('clear').addEventListener('click', () => {
  if (busy) return;
  entries.forEach(release); entries.length = 0; $('file-list').replaceChildren(); $('progress').hidden = true; refresh(); status('队列已清空，可以添加新的图片。');
});
for (const id of ['pattern', 'start', 'digits']) $(id).addEventListener('input', refresh);
for (const id of ['quality', 'background', 'max-width', 'max-height']) $(id).addEventListener('input', () => { $('quality-value').textContent = `${$('quality').value}%`; invalidate(); });
$('convert').addEventListener('click', run);
$('cancel').addEventListener('click', () => { stopped = true; $('cancel').disabled = true; $('cancel').textContent = '正在完成当前图片…'; });
$('download-all').addEventListener('click', downloadAll);
$('close').hidden = window.parent === window;
$('close').addEventListener('click', () => window.parent.postMessage({ type: 'image-port:close' }, '*'));
window.addEventListener('beforeunload', event => { if (busy || workspaceBusy) { event.preventDefault(); event.returnValue = ''; } });
refresh();

function cropWorkspace() {
  if (!cropFrame) return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const check = () => {
      if (cropFrame.contentWindow?.imagePortCropWorkspace) return resolve(cropFrame.contentWindow.imagePortCropWorkspace);
      if (Date.now() - start > 20000) return reject(new Error('裁剪页面尚未就绪，请稍后重试'));
      setTimeout(check, 50);
    };
    check();
  });
}
let workspaceBusy = false;
function transferNotice(message, error = false) {
  $('workspace-notice').hidden = false;
  $('workspace-notice').textContent = message;
  $('workspace-notice').classList.toggle('error', error);
}
function freezeUI(freeze) {
  document.querySelector('.shell').inert = freeze;
  $('workspace-overlay').hidden = !freeze;
}
function notifyHost(message) {
  if (parent !== window) parent.postMessage(message, '*');
}
async function detachWorkspace() {
  if (workspaceBusy) return;
  workspaceBusy = true; freezeUI(true);
  notifyHost({ type: 'image-port:detach-status', busy: true });
  let crop;
  try {
    $('workspace-overlay-text').textContent = busy ? '等待当前图片处理完成，再复制到新标签页…' : '正在复制图片与设置…';
    crop = await cropWorkspace();
    if (crop) await crop.freeze();
    while (busy) await new Promise(resolve => setTimeout(resolve, 50));
    const snapshot = {
      version: 1, tool: currentTool, theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light',
      conversion: {
        controls: captureControls(document), format: selectedFormat, status: $('status').textContent,
        details: [...$('conversion-view').querySelectorAll('details')].map(el => el.open),
        scroll: { x: scrollX, y: scrollY, list: $('file-list').scrollTop },
        progress: { hidden: $('progress').hidden, value: $('progress').value, max: $('progress').max },
        entries: entries.map(entry => ({ file: entry.file, result: entry.result, preview: entry.previewBlob || null,
          meta: entry.meta.textContent, metaClass: entry.meta.className }))
      },
      crop: crop ? crop.snapshot() : null
    };
    await openWorkspace(snapshot, (done, total) => {
      $('workspace-overlay-text').textContent = `正在复制图片与设置… ${total ? Math.round(done / total * 100) : 100}%`;
    });
    transferNotice('已在新标签页复制全部工作内容。这里的图片与设置仍保留，两边可独立继续操作。');
    notifyHost({ type: 'image-port:detach-status', busy: false });
  } catch (error) {
    transferNotice(`打开失败：${error.message}。原悬浮窗的工作内容已保留，可重新点击重试。`, true);
    notifyHost({ type: 'image-port:detach-status', busy: false, error: error.message });
  } finally {
    crop?.thaw(); workspaceBusy = false; freezeUI(false);
  }
}
async function restoreWorkspace(id) {
  workspaceBusy = true; freezeUI(true);
  $('workspace-overlay-text').textContent = '正在恢复悬浮窗中的图片、设置与处理结果…';
  try {
    const snapshot = await loadWorkspace(id);
    if (snapshot.version !== 1) throw new Error('不支持的工作内容版本');
    const state = snapshot.conversion;
    restoreControls(document, state.controls);
    selectedFormat = state.format;
    document.querySelectorAll('#formats button').forEach(el => {
      const active = el.dataset.format === selectedFormat;
      el.classList.toggle('active', active); el.setAttribute('aria-pressed', String(active));
    });
    $('format-tip').textContent = tips[selectedFormat];
    $('quality-field').hidden = !['jpg', 'webp'].includes(selectedFormat);
    $('background-field').hidden = !['jpg', 'bmp', 'gif'].includes(selectedFormat);
    $('quality-value').textContent = `${$('quality').value}%`;
    addFiles(state.entries.map(entry => entry.file));
    entries.forEach((entry, index) => {
      const saved = state.entries[index]; entry.result = saved.result;
      entry.previewBlob = saved.preview || saved.result?.preview;
      if (entry.previewBlob) {
        entry.previewURL = URL.createObjectURL(entry.previewBlob);
        const img = document.createElement('img'); img.className = 'thumb'; img.alt = entry.file.name; img.src = entry.previewURL;
        entry.thumb.replaceWith(img); entry.thumb = img;
      }
      entry.meta.textContent = saved.meta; entry.meta.className = saved.metaClass;
    });
    $('conversion-view').querySelectorAll('details').forEach((el, index) => { el.open = !!state.details[index]; });
    Object.assign($('progress'), state.progress); refresh(); status(state.status);
    setTheme(snapshot.theme);
    if (snapshot.crop) {
      // Create the iframe even when conversion is the selected tab: both queues
      // must survive the handoff, not just the currently visible one.
      selectTool('crop'); const api = await cropWorkspace(); await api.restore(snapshot.crop);
    }
    selectTool(snapshot.tool);
    requestAnimationFrame(() => { scrollTo(state.scroll.x, state.scroll.y); $('file-list').scrollTop = state.scroll.list; });
    history.replaceState(null, '', location.pathname);
    await discardWorkspace(id).catch(() => {});
    transferNotice('已恢复两个工具的图片、设置及处理结果，可继续编辑或直接下载。');
  } catch (error) {
    transferNotice(`恢复失败：${error.message}。原悬浮窗的内容仍保留，请回原窗口重试。`, true);
  } finally { workspaceBusy = false; freezeUI(false); }
}
$('open-workspace').addEventListener('click', detachWorkspace);
window.addEventListener('message', event => {
  if (event.source === parent && parent !== window && event.data?.type === 'image-port:detach') detachWorkspace();
});
function shareTheme() {
  notifyHost({ type: 'image-port:theme', theme: document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light' });
}
window.addEventListener('image-port:theme', shareTheme);
initTheme(); shareTheme();
const workspaceId = new URLSearchParams(location.search).get('workspace');
if (workspaceId) restoreWorkspace(workspaceId);
