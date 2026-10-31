import { initTheme } from './theme.js';
import { captureControls, restoreControls } from './workspace-transfer.js';
import { safeName } from './core.js';
import { centerRect, clampRect, resizeRect, batchStem, uniqueNames } from './crop-core.js';
import { drawCropped, encodeBest } from './crop-engine.js';
import { buildZip, saveBlob, splitArchives } from './archive.js';
// Adapted from the user-provided image-resizer-crop-theme-v4 HTML.
// Original attribution is retained in crop.html.
(function () {
  const $ = (id) => document.getElementById(id);
  const drop = $('drop'), fileInput = $('file'), results = $('results'), batch = $('batch');
  const items = [];
  let seq = 0, pending = 0;
  let tasks = Promise.resolve();
  let workspaceLocked = false;
  function syncControls() {
    document.querySelectorAll('.controls input, .controls select, .batch button, .batch input, .batch select, .card input, .card select, .card > .dl, #file').forEach(el => { el.disabled = pending > 0; });
    items.forEach(item => {
      item.el.querySelector('.dl').disabled = pending > 0 || !item.blob;
      item.el.querySelector('.fmtSel').disabled = pending > 0 || !item.canvas;
      item.el.querySelector('.pickbox').disabled = pending > 0 || !item.blob;
    });
    $('dlall').disabled = pending > 0 || !items.some(item => item.blob);
    results.setAttribute('aria-busy', String(pending > 0));
    drop.setAttribute('aria-disabled', String(pending > 0));
    updateSelUI();
  }
  function runTask(label, action) {
    if (workspaceLocked) return Promise.resolve(false);
    pending++; syncControls();
    const next = tasks.then(async () => {
      $('cropStatus').textContent = label;
      await action();
      const count = items.filter(item => item.blob).length;
      const failed = items.filter(item => item.error).length;
      $('cropStatus').textContent = `处理完成：${count} 张可下载${failed ? `，${failed} 张失败（见图片提示）` : ''}。`;
      return true;
    }).catch(error => { $('cropStatus').textContent = `处理失败：${error.message}`; return false; }).finally(() => { pending--; syncControls(); });
    tasks = next;
    return next;
  }
  function failItem(item, error) {
    item.error = error.message || String(error); item.blob = null;
    if (item.url) URL.revokeObjectURL(item.url);
    item.url = null;
    item.el.dataset.state = 'error';
    item.el.querySelector('.rthumb').removeAttribute('src');
    item.el.querySelector('.result').classList.remove('loading');
    item.el.querySelector('.stats').textContent = `失败：${item.error}`;
    item.el.querySelector('.dl').disabled = true;
  }
  function validSettings() {
    for (const id of ['cw', 'ch', 'maxkb']) {
      if ((id === 'cw' || id === 'ch') && $('size').value !== 'custom') continue;
      if (!$(id).checkValidity()) { $(id).reportValidity(); return false; }
    }
    return true;
  }

  const EXT = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
  const FMT_LABEL = { 'image/jpeg': 'JPEG', 'image/png': 'PNG', 'image/webp': 'WebP' };
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fmtBytes(b) {
    if (b < 1024) return b + ' B';
    if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB';
    return (b / 1024 / 1024).toFixed(2) + ' MB';
  }
  function stemOf(name) {
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(0, dot) : name;
  }
  // 当前目标输出尺寸：内置 800/480 为正方形，自定义可为任意宽高（非正方形）
  function targetSize() {
    if ($('size').value === 'custom') {
      const clamp = (v) => Math.max(16, Math.min(parseInt(v, 10) || 800, 4096));
      return { tw: clamp($('cw').value), th: clamp($('ch').value) };
    }
    const n = parseInt($('size').value, 10) || 800;
    return { tw: n, th: n };
  }

  // ---- 按图取色 ----
  function rgb2hsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    let h, s, l = (mx + mn) / 2;
    if (mx === mn) { h = 0; s = 0; }
    else {
      const d = mx - mn;
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      switch (mx) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h *= 60;
    }
    return [h, s, l];
  }
  // 按饱和度加权的主色采样（偏向鲜艳区域，避免灰蒙蒙）
  function sampleColor(img) {
    try {
      const s = 40;
      const c = document.createElement('canvas'); c.width = s; c.height = s;
      const x = c.getContext('2d');
      x.drawImage(img, 0, 0, s, s);
      const d = x.getImageData(0, 0, s, s).data;
      let r = 0, g = 0, b = 0, w = 0;
      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < 128) continue;
        const R = d[i], G = d[i + 1], B = d[i + 2];
        const mx = Math.max(R, G, B), mn = Math.min(R, G, B);
        const sat = (mx - mn) / 255;
        const wt = sat * sat + 0.04;
        r += R * wt; g += G * wt; b += B * wt; w += wt;
      }
      if (w <= 0) return null;
      return [r / w, g / w, b / w];
    } catch (e) { return null; }
  }
  function applyTint(item, rgb) {
    let [h, s, l] = rgb2hsl(rgb[0], rgb[1], rgb[2]);
    s = Math.max(s, 0.5);
    l = Math.min(Math.max(l, 0.46), 0.60);
    const H = h.toFixed(0), S = (s * 100).toFixed(0), L = (l * 100).toFixed(0);
    const el = item.el;
    el.style.setProperty('--tint', `hsl(${H} ${S}% ${L}%)`);
    el.style.setProperty('--tint-soft', `hsla(${H}, ${S}%, ${L}%, .16)`);
    el.style.setProperty('--tint-glow', `hsla(${H}, ${S}%, ${L}%, .4)`);
  }

  async function renderOutput(item, flash) {
    try {
      if (item.canvas) item.canvas.width = 0;
      item.canvas = drawCropped(item.bitmap || item.img, item.crop, item.tw, item.th);
      item.upscaled = item.crop.w < item.tw || item.crop.h < item.th;
      await reencode(item, flash);
    } catch (error) { failItem(item, error); }
  }

  async function reencode(item, flash) {
    item.el.dataset.state = 'processing';
    item.blob = null;
    try {
      const limit = $('maxkb').value.trim();
      const maxBytes = limit ? Number(limit) * 1024 : Infinity;
      const { blob, quality, over } = await encodeBest(item.canvas, item.format, maxBytes);
      if (item.url) URL.revokeObjectURL(item.url);
      item.blob = blob; item.url = URL.createObjectURL(blob);
      item.over = !!over; item.quality = quality; item.error = null;
      item.el.dataset.state = 'ready';
      refreshCard(item, flash);
    } catch (error) { failItem(item, error); }
  }

  function refreshCard(item, flash) {
    const c = item.el;
    const rthumb = c.querySelector('.rthumb');
    rthumb.src = item.url;
    c.querySelector('.result').classList.remove('loading');
    c.querySelector('.ext').textContent = '.' + EXT[item.format];
    c.querySelector('.fmtSel').value = item.format;
    const nameInput = c.querySelector('.nameInput');
    if (document.activeElement !== nameInput) nameInput.value = item.stem;
    // 只在压缩后仍超出上限时提示；低于上限不再展示正向徽章
    const overBadge = item.over ? `<span class="badge err">超出上限</span>` : '';
    const upBadge = item.upscaled ? `<span class="badge warn">已放大</span>` : '';
    const qText = item.quality != null ? `质量 ${(item.quality * 100).toFixed(0)}%` : '无损';
    // 尺寸·格式·体积已在顶栏徽章展示，这里只保留原图尺寸与画质，避免冗余
    c.querySelector('.stats').innerHTML =
      `原图 ${item.origW}×${item.origH} · ${qText}${upBadge}${overBadge}`;
    const badge = c.querySelector('.card-badge');
    if (badge) {
      badge.textContent = `${item.tw}×${item.th} · ${FMT_LABEL[item.format]} · ${fmtBytes(item.blob.size)}`;
      badge.classList.toggle('over', item.over);
    }
    // 灯箱开启且正是此图，实时刷新预览
    if (lightboxItem === item) showLightbox(item);
    const btn = c.querySelector('.dl');
    btn.disabled = pending > 0;
    btn.onclick = () => downloadOne(item);

    if (!reduceMotion) {
      rthumb.animate([{ opacity: .25, transform: 'scale(.92)' }, { opacity: 1, transform: 'none' }],
        { duration: 280, easing: 'cubic-bezier(.2,.7,.3,1)' });
      if (flash && badge) badge.animate(
        [{ backgroundColor: 'var(--tint-soft)', color: 'var(--tint)', borderColor: 'var(--tint)' }, {}],
        { duration: 750, easing: 'ease-out' });
    }
  }

  function buildCard(item) {
    const card = document.createElement('div');
    card.className = 'card';
    card.dataset.id = item.id; card.dataset.state = 'loading';
    card.innerHTML = `
      <div class="card-bar">
        <span class="card-grip" tabindex="0" role="button" aria-label="拖动排序，也可用方向键调整" title="按住拖动，或用方向键调整顺序">⠿</span>
        <span class="card-badge"></span>
        <div class="card-actions">
          <label class="card-pick" title="勾选后可只下载选中的图片"><input type="checkbox" class="pickbox"> 选择</label>
        </div>
      </div>
      <div class="editor">
        <img class="src" alt="" draggable="false">
        <div class="cropbox" style="display:none">
          <span class="h tl"></span><span class="h tr"></span>
          <span class="h bl"></span><span class="h br"></span>
        </div>
      </div>
      <div class="row">
        <div class="result loading"><img class="rthumb" alt=""></div>
        <div class="meta">
          <div class="namerow">
            <input class="nameInput" type="text" spellcheck="false" aria-label="图片名称" maxlength="160">
            <span class="ext">.jpg</span>
            <select class="fmtSel" aria-label="此图片的输出格式">
              <option value="image/jpeg">JPEG</option>
              <option value="image/png">PNG</option>
              <option value="image/webp">WebP</option>
            </select>
          </div>
          <div class="stats">处理中…</div>
        </div>
      </div>
      <button class="dl" disabled>下载</button>`;
    item.el = card;
    item.editorEl = card.querySelector('.editor');
    item.srcEl = card.querySelector('.src');
    item.boxEl = card.querySelector('.cropbox');
    results.appendChild(card);
    batch.classList.add('show');

    card.querySelector('.nameInput').addEventListener('input', (e) => { item.stem = e.target.value; });
    card.querySelector('.fmtSel').addEventListener('change', (e) => {
      item.format = e.target.value;
      runTask('正在更新图片格式…', () => reencode(item, true));
    });
    bindPick(item);
    bindReorder(item);
    bindLightbox(item);
    syncControls();
    return card;
  }

  function centerCrop(item) { item.crop = centerRect(item.origW, item.origH, item.tw / item.th); }
  function clampCrop(item) { item.crop = clampRect(item.crop, item.origW, item.origH, item.tw / item.th); }
  function layoutCropBox(item) {
    // ResizeObserver can run while the decoded image is awaiting its bitmap.
    if (!item.crop || !item.origW) return;
    const ir = item.srcEl.getBoundingClientRect();
    const er = item.editorEl.getBoundingClientRect();
    if (!ir.width) return;
    const s = ir.width / item.origW;
    const box = item.boxEl;
    box.style.left = (ir.left - er.left + item.crop.x * s) + 'px';
    box.style.top = (ir.top - er.top + item.crop.y * s) + 'px';
    box.style.width = (item.crop.w * s) + 'px';
    box.style.height = (item.crop.h * s) + 'px';
  }
  function springLayout(item) {
    if (reduceMotion) { layoutCropBox(item); return; }
    const box = item.boxEl;
    box.classList.add('spring');
    layoutCropBox(item);
    setTimeout(() => box.classList.remove('spring'), 460);
  }

  function ptSrc(item, e) {
    const r = item.srcEl.getBoundingClientRect();
    const s = r.width / item.origW;
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s };
  }

  let drag = null;
  function startDrag(item, e, mode) {
    if (pending || !e.isPrimary || e.button !== 0) return;
    e.preventDefault();
    item.boxEl.setPointerCapture(e.pointerId);
    drag = { item, mode, down: ptSrc(item, e), start: { ...item.crop } };
    window.addEventListener('pointermove', onDragMove);
    window.addEventListener('pointerup', onDragUp);
    window.addEventListener('pointercancel', onDragUp);
  }
  function resizeCorner(item, corner, start, p) {
    item.crop = resizeRect(start, corner, p, item.origW, item.origH, item.tw / item.th);
  }
  function onDragMove(e) {
    if (!drag) return;
    const { item, mode, down, start } = drag;
    const p = ptSrc(item, e);
    if (mode === 'move') {
      item.crop.x = start.x + (p.x - down.x);
      item.crop.y = start.y + (p.y - down.y);
    } else {
      resizeCorner(item, mode, start, p);
    }
    clampCrop(item);
    layoutCropBox(item);
  }
  function onDragUp() {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragUp);
    window.removeEventListener('pointercancel', onDragUp);
    if (drag) { const item = drag.item; drag = null; runTask('正在更新裁剪预览…', () => renderOutput(item, true)); }
  }
  function bindCropDrag(item) {
    item.boxEl.addEventListener('pointerdown', (e) => startDrag(item, e, 'move'));
    item.boxEl.querySelectorAll('.h').forEach((h) => {
      const corner = ['tl', 'tr', 'bl', 'br'].find((k) => h.classList.contains(k));
      h.addEventListener('pointerdown', (e) => { e.stopPropagation(); startDrag(item, e, corner); });
    });
  }

  // ---- 选择下载 ----
  function selectedItems() { return items.filter(it => it.selected && it.blob); }
  function updateSelUI() {
    const sel = items.filter(it => it.selected && it.blob);
    const dlsel = $('dlsel');
    if (dlsel) { dlsel.disabled = pending > 0 || sel.length === 0; dlsel.textContent = sel.length ? `下载选中 (${sel.length})` : '下载选中'; }
    const sa = $('selectAll');
    if (sa) sa.textContent = (sel.length && sel.length === items.filter(item => item.blob).length) ? '取消全选' : '全选';
  }
  function bindPick(item) {
    const box = item.el.querySelector('.pickbox');
    box.addEventListener('change', () => {
      item.selected = box.checked;
      item.el.classList.toggle('selected', box.checked);
      updateSelUI();
    });
  }

  // ---- 拖动排序 ----
  let dragCard = null;
  function syncOrderFromDOM() {
    const order = Array.from(results.children);
    items.sort((a, b) => order.indexOf(a.el) - order.indexOf(b.el));
  }
  function bindReorder(item) {
    const card = item.el, grip = card.querySelector('.card-grip');
    // 仅从手柄发起拖拽，避免与裁切框/按钮冲突
    grip.addEventListener('mousedown', () => { if (!pending) card.setAttribute('draggable', 'true'); });
    grip.addEventListener('keydown', event => {
      if (pending || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      if (['ArrowLeft', 'ArrowUp'].includes(event.key)) { if (card.previousElementSibling) results.insertBefore(card, card.previousElementSibling); }
      else if (card.nextElementSibling) results.insertBefore(card.nextElementSibling, card);
      syncOrderFromDOM(); grip.focus();
    });
    grip.addEventListener('mouseup', () => card.removeAttribute('draggable'));
    card.addEventListener('dragstart', (e) => {
      dragCard = card; card.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', String(item.id)); } catch (x) {}
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging'); card.removeAttribute('draggable');
      dragCard = null; syncOrderFromDOM();
    });
    card.addEventListener('dragover', (e) => {
      if (!dragCard || dragCard === card) return;
      e.preventDefault();
      const r = card.getBoundingClientRect();
      const dragged = dragCard.getBoundingClientRect();
      const sameRow = Math.abs(dragged.top - r.top) < r.height / 2;
      const before = sameRow ? e.clientX < r.left + r.width / 2 : e.clientY < r.top + r.height / 2;
      results.insertBefore(dragCard, before ? card : card.nextSibling);
    });
  }

  // ---- 压缩成品灯箱 ----
  let lightboxItem = null;
  function showLightbox(item) {
    if (!item || !item.url) return;
    $('lightboxImg').src = item.url;
    $('lightboxCap').textContent =
      `${item.tw}×${item.th} · ${FMT_LABEL[item.format]} · ${fmtBytes(item.blob.size)}` +
      (item.quality != null ? ` · 质量 ${(item.quality * 100).toFixed(0)}%` : ' · 无损') +
      (item.over ? ' · 超出上限' : '');
  }
  function openLightbox(item) {
    if (!item.url) return;
    lightboxItem = item;
    showLightbox(item);
    $('lightbox').classList.add('show');
    document.body.style.overflow = 'hidden';
  }
  function closeLightbox() {
    if (!lightboxItem) return;
    lightboxItem = null;
    $('lightbox').classList.remove('show');
    $('lightboxImg').removeAttribute('src');
    document.body.style.overflow = '';
  }
  function bindLightbox(item) {
    const preview = item.el.querySelector('.result');
    preview.tabIndex = 0; preview.setAttribute('role', 'button'); preview.setAttribute('aria-label', '放大查看裁剪结果');
    preview.addEventListener('click', () => openLightbox(item));
    preview.addEventListener('keydown', event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openLightbox(item); } });
  }

  async function processFile(file, saved = null) {
    const { tw, th } = targetSize();
    const item = {
      file, id: ++seq, format: $('fmt').value, tw, th,
      stem: stemOf(file.name) + `_${tw}x${th}`,
      origSize: file.size, originalName: file.name,
    };
    if (saved) Object.assign(item, { format: saved.format, tw: saved.tw, th: saved.th, stem: saved.stem });
    items.push(item);
    buildCard(item);
    if (saved?.error && !saved.crop) { failItem(item, new Error(saved.error)); return; }

    try {
      const url = URL.createObjectURL(file);
      item.imgUrl = url;
      const img = item.srcEl;
      await new Promise((res, rej) => {
        img.onload = res;
        img.onerror = () => rej(new Error('无法读取图片'));
        img.src = url;
      });
      if (!img.naturalWidth || !img.naturalHeight || img.naturalWidth * img.naturalHeight > 80_000_000 || Math.max(img.naturalWidth, img.naturalHeight) > 32767) throw new Error('图片尺寸无效或超过 8000 万像素处理范围');
      item.img = img;
      item.origW = img.naturalWidth; item.origH = img.naturalHeight;
      try { item.bitmap = await createImageBitmap(file); } catch { /* SVG may need the decoded image element. */ }
      const col = sampleColor(img);
      if (col) applyTint(item, col);
      if (saved?.crop) item.crop = { ...saved.crop }; else centerCrop(item);
      item.boxEl.style.display = 'block';
      layoutCropBox(item);
      if (!reduceMotion) item.boxEl.animate(
        [{ opacity: 0, transform: 'scale(1.05)' }, { opacity: 1, transform: 'none' }],
        { duration: 300, easing: 'cubic-bezier(.2,.7,.3,1)' });
      bindCropDrag(item);
      if (saved) {
        item.canvas = drawCropped(item.bitmap || item.img, item.crop, item.tw, item.th);
        Object.assign(item, { blob: saved.blob, over: saved.over, quality: saved.quality, error: saved.error, upscaled: saved.upscaled, selected: saved.selected });
        if (saved.tint) item.el.style.cssText = saved.tint;
        item.el.querySelector('.pickbox').checked = !!saved.selected;
        item.el.classList.toggle('selected', !!saved.selected);
        if (saved.error || !saved.blob) failItem(item, new Error(saved.error || '尚无处理结果'));
        else { item.url = URL.createObjectURL(saved.blob); item.el.dataset.state = 'ready'; refreshCard(item, false); }
      } else await renderOutput(item, false);
    } catch (error) { failItem(item, error); }
  }

  function downloadNames(list) {
    return uniqueNames(list.map(item => ({ name: item.stem, ext: EXT[item.format] })));
  }
  function downloadOne(item) {
    if (pending || !item.blob) return;
    saveBlob(item.blob, downloadNames([item])[0]);
  }

  function handleFiles(fileList) {
    if (workspaceLocked) return;
    if (!validSettings()) return;
    const files = Array.from(fileList).filter(file => file && (file.type.startsWith('image/') || /\.(jpe?g|png|webp|gif|svg|avif|bmp|ico|tiff?|heic|heif)$/i.test(file.name)));
    if (!files.length) { $('cropStatus').textContent = '请选择图片文件。'; return; }
    return runTask('正在导入并裁剪图片…', async () => {
      for (const file of files) await processFile(file);
    });
  }

  drop.addEventListener('click', event => { if (event.target !== fileInput && !pending) fileInput.click(); });
  drop.addEventListener('keydown', event => { if (!pending && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); fileInput.click(); } });
  fileInput.addEventListener('change', event => { handleFiles(event.target.files); fileInput.value = ''; });
  for (const type of ['dragenter', 'dragover']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.add('drag'); });
  for (const type of ['dragleave', 'drop']) drop.addEventListener(type, event => { event.preventDefault(); drop.classList.remove('drag'); });
  drop.addEventListener('drop', event => { if (event.dataTransfer.files.length) handleFiles(event.dataTransfer.files); });
  window.addEventListener('dragover', event => event.preventDefault());
  window.addEventListener('drop', event => event.preventDefault());
  document.addEventListener('paste', event => {
    const files = Array.from(event.clipboardData?.items || []).filter(item => item.type.startsWith('image/')).map(item => item.getAsFile()).filter(Boolean);
    if (files.length) { event.preventDefault(); handleFiles(files); }
  });

  window.addEventListener('resize', () => {
    items.forEach(it => { if (it.img) layoutCropBox(it); });
  });

  async function applySize() {
    const { tw, th } = targetSize();
    const ar = tw / th;
    for (const it of items.filter(x => x.img)) {
      const oldAr = it.tw / it.th;
      it.tw = tw; it.th = th;
      // 宽高比变化时重新居中裁切，比例不变则保留用户已调好的取景
      if (Math.abs(oldAr - ar) > 0.001) { centerCrop(it); springLayout(it); }
      await renderOutput(it, true);
    }
  }
  function toggleCustomSize() {
    const custom = $('size').value === 'custom';
    ['cw', 'customX', 'ch', 'customUnit'].forEach(id => $(id).style.display = custom ? '' : 'none');
    return custom;
  }
  $('size').addEventListener('change', () => {
    if (toggleCustomSize()) $('cw').focus();
    if (validSettings()) runTask('正在更新输出尺寸…', applySize);
  });
  ['cw', 'ch'].forEach(id => $(id).addEventListener('change', async () => {
    if ($('size').value !== 'custom') return;
    if (validSettings()) await runTask('正在更新输出尺寸…', applySize);
  }));
  $('maxkb').addEventListener('change', async () => {
    if (validSettings()) await runTask('正在按体积上限压缩…', async () => { for (const it of items.filter(x => x.canvas)) await reencode(it, true); });
  });

  $('applyName').onclick = () => {
    const done = items.filter(item => item.img);
    done.forEach((item, index) => {
      item.stem = batchStem($('batchName').value, item.originalName, index, done.length);
      item.el.querySelector('.nameInput').value = item.stem;
    });
    $('cropStatus').textContent = `已按当前顺序为 ${done.length} 张图片应用命名。`;
  };
  $('applyFmt').onclick = () => {
    const fmt = $('batchFmt').value;
    if (!fmt || !validSettings()) return;
    runTask('正在统一图片格式…', async () => {
      for (const item of items.filter(item => item.canvas)) { item.format = fmt; await reencode(item, true); }
    });
  };
  $('resetCrop').onclick = () => {
    if (!validSettings()) return;
    runTask('正在恢复居中裁剪…', async () => {
      for (const item of items.filter(item => item.img)) { centerCrop(item); springLayout(item); await renderOutput(item, true); }
    });
  };
  $('clear').onclick = () => {
    if (pending) return;
    closeLightbox();
    items.forEach(item => { if (item.url) URL.revokeObjectURL(item.url); if (item.imgUrl) URL.revokeObjectURL(item.imgUrl); item.bitmap?.close(); if (item.canvas) item.canvas.width = 0; });
    items.length = 0; results.replaceChildren(); batch.classList.remove('show'); syncControls();
    $('cropStatus').textContent = '队列已清空，可以继续添加图片。';
  };
  // 灯箱关闭：点遮罩空白 / ✕ / Esc
  $('lightbox').addEventListener('click', (e) => { if (e.target === $('lightbox')) closeLightbox(); });
  $('lightboxClose').addEventListener('click', closeLightbox);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeLightbox(); });
  // 空白处放下允许排序
  results.addEventListener('dragover', (e) => { if (dragCard) e.preventDefault(); });
  results.addEventListener('drop', (e) => { if (dragCard) e.preventDefault(); });
  $('zipToggle').onchange = () => {
    const on = $('zipToggle').checked;
    $('zipNameField').style.display = on ? '' : 'none';
    $('dlall').textContent = on ? '打包下载' : '全部下载';
  };
  async function exportImages(list) {
    if (pending) return;
    const ready = list.filter(item => item.blob), names = downloadNames(ready);
    if (!ready.length) return;
    const entries = ready.map((item, index) => ({ blob: item.blob, name: names[index] }));
    const success = await runTask('正在准备下载…', async () => {
      if (!$('zipToggle').checked) {
        for (const entry of entries) { saveBlob(entry.blob, entry.name); await new Promise(resolve => setTimeout(resolve, 250)); }
      } else {
        const groups = splitArchives(entries);
        const name = safeName(($('zipName').value || 'images').trim().replace(/\.zip$/i, ''));
        for (let i = 0; i < groups.length; i++) saveBlob(await buildZip(groups[i]), `${name}${groups.length > 1 ? `-${i + 1}` : ''}.zip`);
      }
    });
    if (success) $('cropStatus').textContent = `已生成 ${entries.length} 张图片的下载。多个文件下载时，请允许浏览器的下载提示。`;
  }
  $('dlall').onclick = () => exportImages(items);
  $('dlsel').onclick = () => exportImages(selectedItems());
  $('selectAll').onclick = () => {
    const ready = items.filter(item => item.blob);
    const turnOn = !(ready.length && ready.every(it => it.selected));
    ready.forEach(it => {
      it.selected = turnOn;
      const box = it.el.querySelector('.pickbox');
      if (box) box.checked = turnOn;
      it.el.classList.toggle('selected', turnOn);
    });
    updateSelUI();
  };

  new ResizeObserver(() => items.forEach(item => { if (item.img) layoutCropBox(item); })).observe(results);
  window.addEventListener('beforeunload', event => { if (pending) { event.preventDefault(); event.returnValue = ''; } });
  syncControls();


  // Same-origin API used only by the parent extension page. Each restored item
  // gets fresh image/canvas/object URLs; the original encoded result is retained.
  window.imagePortCropWorkspace = {
    async freeze() { workspaceLocked = true; document.body.inert = true; await tasks; },
    thaw() { workspaceLocked = false; document.body.inert = false; },
    snapshot() {
      return {
        controls: captureControls(document), status: $('cropStatus').textContent,
        scroll: { x: scrollX, y: scrollY }, details: [...document.querySelectorAll('details')].map(el => el.open),
        lightbox: items.indexOf(lightboxItem),
        items: items.map(item => ({ file: item.file, format: item.format, tw: item.tw, th: item.th, stem: item.stem,
          crop: item.crop ? { ...item.crop } : null, blob: item.blob || null, over: item.over, quality: item.quality,
          error: item.error, upscaled: item.upscaled, selected: !!item.selected, tint: item.el.style.cssText }))
      };
    },
    async restore(snapshot) {
      workspaceLocked = true; document.body.inert = true;
      try {
        restoreControls(document, snapshot.controls);
        toggleCustomSize(); $('zipToggle').onchange();
        for (const saved of snapshot.items) await processFile(saved.file, saved);
        document.querySelectorAll('details').forEach((el, index) => { el.open = !!snapshot.details?.[index]; });
        syncControls(); $('cropStatus').textContent = snapshot.status;
        if (snapshot.lightbox >= 0) openLightbox(items[snapshot.lightbox]);
        requestAnimationFrame(() => { items.forEach(layoutCropBox); scrollTo(snapshot.scroll?.x || 0, snapshot.scroll?.y || 0); });
      } finally { workspaceLocked = false; document.body.inert = false; }
    }
  };

  initTheme();
})();
