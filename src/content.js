(() => {
  if (window.top !== window || document.getElementById('image-port-root')) return;
  const host = document.createElement('div');
  host.id = 'image-port-root';
  host.style.cssText = 'all:initial!important;position:fixed!important;width:44px!important;height:44px!important;z-index:2147483647!important;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host{font-family:system-ui,sans-serif}*{box-sizing:border-box}button{cursor:pointer;border:0;font:inherit}
    button:focus-visible{outline:3px solid #a8c776;outline-offset:2px}
    .launcher{display:grid;place-items:center;width:44px;height:44px;padding:0;border-radius:14px;background:#194e43;color:white;box-shadow:0 4px 20px #143e4333;touch-action:none;user-select:none;cursor:grab}
    .launcher:hover{background:#236353}.launcher svg{width:22px;height:22px;pointer-events:none}
    .panel{position:fixed;display:flex;flex-direction:column;width:min(600px,calc(100vw - 16px));height:min(600px,calc(100dvh - 96px));background:#f8faf7;border:1px solid #d6e2da;border-radius:16px;box-shadow:0 12px 48px #10281b33;overflow:hidden}
    .panel[hidden]{display:none}.panel-titlebar{height:36px;flex-shrink:0;display:flex;align-items:center;gap:8px;padding:0 10px 0 14px;background:#eef3e9;border-bottom:1px solid #dfe7d9;cursor:grab;touch-action:none;user-select:none;color:#315340;font-size:12px}
    .drag-hint{color:#87997c;font-size:10px;margin-left:auto}.panel-close{display:grid;place-items:center;width:26px;height:26px;background:transparent;border-radius:6px;color:#6e8063;font-size:16px}.panel-close:hover{background:#e0e9d8}
    .dragging,.dragging .panel-titlebar{cursor:grabbing}.panel.dragging iframe{pointer-events:none}
    iframe{width:100%;flex:1;min-height:0;border:0;display:block}
  `;
  const button = document.createElement('button');
  button.className = 'launcher';
  button.title = '图像港 · 格式批量转换 / 图片批量裁剪 · 拖动移动';
  button.setAttribute('aria-label', '图像港：点击打开格式转换或图片裁剪，拖动移动');
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg>';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-label', '图像港 · 格式转换与图片裁剪');
  const titlebar = document.createElement('div');
  titlebar.className = 'panel-titlebar';
  titlebar.title = '拖动标题栏移动面板';
  titlebar.innerHTML = '<span aria-hidden="true">⠿</span><strong>图像港</strong><span class="drag-hint">拖动移动</span>';
  const close = document.createElement('button');
  close.className = 'panel-close';
  close.textContent = '×';
  close.title = '收起面板';
  close.setAttribute('aria-label', '收起面板');
  close.addEventListener('click', () => { toggle(false); button.focus({ preventScroll: true }); });
  titlebar.append(close);
  panel.append(titlebar);
  let frame;
  let launcherPosition = { x: innerWidth - 64, y: innerHeight - 68 };
  let panelPosition = null;
  let suppressClick = false;
  function bounded(point, width, height) {
    return {
      x: Math.max(8, Math.min(point.x, innerWidth - width - 8)),
      y: Math.max(8, Math.min(point.y, innerHeight - height - 8)),
    };
  }
  function placePanel() {
    if (panel.hidden) return;
    const { width, height } = panel.getBoundingClientRect();
    const desired = panelPosition || {
      x: launcherPosition.x + 44 - width,
      y: launcherPosition.y >= height + 20 ? launcherPosition.y - height - 12 : launcherPosition.y + 56,
    };
    const position = bounded(desired, width, height);
    if (panelPosition) panelPosition = position;
    panel.style.left = `${position.x}px`;
    panel.style.top = `${position.y}px`;
  }
  function placeLauncher() {
    launcherPosition = bounded(launcherPosition, 44, 44);
    host.style.setProperty('left', `${launcherPosition.x}px`, 'important');
    host.style.setProperty('top', `${launcherPosition.y}px`, 'important');
    placePanel();
  }
  // Pointer capture keeps dragging reliable when the pointer crosses the iframe.
  // The movement threshold prevents a drag from also toggling the launcher.
  function draggable(handle, target, getPosition, move, onFinish = () => {}) {
    let drag;
    handle.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || (event.target.closest('button') && event.target.closest('button') !== handle)) return;
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY, position: getPosition(), moved: false };
      handle.setPointerCapture(event.pointerId);
    });
    handle.addEventListener('pointermove', event => {
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
      if (!drag.moved && Math.hypot(dx, dy) < 4) return;
      drag.moved = true;
      target.classList.add('dragging');
      move({ x: drag.position.x + dx, y: drag.position.y + dy });
    });
    function finish(event) {
      if (!drag || drag.id !== event.pointerId) return;
      onFinish(drag.moved);
      drag = null;
      target.classList.remove('dragging');
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
    handle.addEventListener('lostpointercapture', finish);
  }
  draggable(button, button, () => ({ ...launcherPosition }), position => { launcherPosition = position; placeLauncher(); }, moved => { suppressClick = moved; });
  draggable(titlebar, panel, () => { const rect = panel.getBoundingClientRect(); return { x: rect.x, y: rect.y }; }, position => { panelPosition = position; placePanel(); });
  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    if (open && !frame) {
      frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL('app.html?panel=1');
      frame.title = '图像港 · 格式转换与图片裁剪';
      panel.append(frame);
    }
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    placePanel();
  }
  button.addEventListener('click', event => {
    if (suppressClick && event.detail !== 0) { suppressClick = false; return; }
    toggle();
  });
  window.addEventListener('resize', placeLauncher);
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (message.type === 'image-port:toggle') { toggle(); reply({ ok: true }); }
  });
  window.addEventListener('message', (event) => {
    const url = new URL(chrome.runtime.getURL('/'));
    const origin = `${url.protocol}//${url.host}`;
    if (frame && event.source === frame.contentWindow && event.origin === origin && event.data?.type === 'image-port:close') toggle(false);
  });
  root.append(style, panel, button);
  document.documentElement.append(host);
  placeLauncher();
})();
