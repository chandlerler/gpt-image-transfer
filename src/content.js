(() => {
  if (window.top !== window || document.getElementById('image-port-root')) return;
  const host = document.createElement('div');
  host.id = 'image-port-root';
  host.style.cssText = 'all:initial!important;position:fixed!important;right:20px!important;bottom:24px!important;z-index:2147483647!important;';
  const root = host.attachShadow({ mode: 'closed' });
  const style = document.createElement('style');
  style.textContent = `
    :host{font-family:system-ui,sans-serif}button{cursor:pointer;border:0;font:inherit}
    .launcher{display:flex;align-items:center;gap:9px;padding:13px 18px;border-radius:18px;background:#194e43;color:white;font-size:14px;font-weight:600;box-shadow:0 6px 28px #143e4333}
    .launcher:hover{background:#236353}.launcher svg{width:21px;height:21px}
    .panel{position:fixed;right:20px;bottom:86px;width:min(1000px,calc(100vw - 40px));height:min(760px,calc(100dvh - 110px));background:#f8faf7;border:1px solid #d6e2da;border-radius:22px;box-shadow:0 20px 90px #10281b40;overflow:hidden}
    .panel[hidden]{display:none}iframe{width:100%;height:100%;border:0;display:block}
    @media(max-width:600px){.panel{right:8px;bottom:82px;width:calc(100vw - 16px);height:calc(100dvh - 100px)}}
  `;
  const button = document.createElement('button');
  button.className = 'launcher';
  button.title = '打开图片转换面板';
  button.setAttribute('aria-expanded', 'false');
  button.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="3" y="3" width="18" height="18" rx="5"/><circle cx="9" cy="9" r="1.5"/><path d="m4 17 5-5 4 4 3-3 5 5"/></svg>图片转换';
  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.hidden = true;
  let frame;
  function toggle(force) {
    const open = typeof force === 'boolean' ? force : panel.hidden;
    if (open && !frame) {
      frame = document.createElement('iframe');
      frame.src = chrome.runtime.getURL('app.html?panel=1');
      frame.title = '图像港 · 批量图片转换';
      panel.append(frame);
    }
    panel.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
  }
  button.addEventListener('click', () => toggle());
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
})();
