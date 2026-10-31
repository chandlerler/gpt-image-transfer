export function setTheme(theme, persist = true) {
  const dark = theme === 'dark';
  document.documentElement.toggleAttribute('data-theme', dark);
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  if (persist) { try { localStorage.setItem('iz-theme', dark ? 'dark' : 'light'); } catch {} }
  window.dispatchEvent(new CustomEvent('image-port:theme-change'));
}
export function initTheme() {
  const $ = id => document.getElementById(id);
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  // ---- 背景极光缓慢随机游走 ----
  (function auroraWander() {
    if (reduceMotion) return;
    const blobs = Array.from(document.querySelectorAll('.aurora'));
    const rand = (a, b) => a + Math.random() * (b - a);
    function move(el) {
      const w = window.innerWidth, h = window.innerHeight;
      const x = rand(-0.42 * w, 0.42 * w);
      const y = rand(-0.42 * h, 0.42 * h);
      el.style.transform = `translate(calc(-50% + ${x.toFixed(0)}px), calc(-50% + ${y.toFixed(0)}px))`;
    }
    blobs.forEach((el, i) => {
      const step = () => { move(el); setTimeout(step, rand(9000, 15000)); };
      setTimeout(step, 1200 + i * 1800); // 错峰启动，先保留初始对角布局片刻
    });
  })();

  let fxSync = () => {};
  const sync = () => {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const button = document.getElementById('themeToggle');
    button?.setAttribute('aria-pressed', String(dark));
    button?.setAttribute('aria-label', dark ? '切换浅色主题' : '切换墨绿暗色主题');
    fxSync();
    window.dispatchEvent(new CustomEvent('image-port:theme'));
  };
  document.getElementById('themeToggle')?.addEventListener('click', () => {
    setTheme(document.documentElement.getAttribute('data-theme') !== 'dark' ? 'dark' : 'light');
  });
  window.addEventListener('image-port:theme-change', sync);
  window.addEventListener('storage', event => {
    if (event.key === 'iz-theme' || event.key === null) setTheme(event.newValue === 'dark' ? 'dark' : 'light', false);
  });
  // ---- 粒子星座网（仅暗色 · 鼠标交互 · 减动守卫） ----
  (function constellation() {
    const cv = $('fx'); if (!cv) return;
    const ctx = cv.getContext('2d');
    let W = 0, H = 0, dpr = Math.min(window.devicePixelRatio || 1, 2);
    let pts = [], raf = 0;
    const mouse = { x: -9999, y: -9999, on: false };
    const root0 = document.documentElement;
    const isDark = () => root0.getAttribute('data-theme') === 'dark';

    function fxColor() {
      const c = getComputedStyle(root0).getPropertyValue('--fx').trim();
      return c || '66,224,176';
    }

    function resize() {
      W = window.innerWidth; H = window.innerHeight;
      cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const target = Math.min(96, Math.round(W * H / 16000));
      pts = [];
      for (let i = 0; i < target; i++) {
        pts.push({
          x: (i * 9301 + 49297) % W,               // 确定性初值，避免依赖随机
          y: (i * 24593 + 12345) % H,
          vx: ((i % 7) - 3) * 0.05 + 0.02,
          vy: (((i * 3) % 7) - 3) * 0.05 + 0.02,
        });
      }
    }

    const LINK = 128, LINK2 = LINK * LINK, MZ = 168, MZ2 = MZ * MZ;

    function frame() {
      if (!isDark() || document.hidden || document.body.classList.contains('crop-active')) { raf = 0; ctx.clearRect(0, 0, W, H); return; }  // 切回浅色即停
      const col = fxColor();
      ctx.clearRect(0, 0, W, H);
      for (const p of pts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < 0) p.x += W; else if (p.x > W) p.x -= W;
        if (p.y < 0) p.y += H; else if (p.y > H) p.y -= H;
        // 鼠标轻微吸引，制造聚拢的酷炫感
        if (mouse.on) {
          const dx = mouse.x - p.x, dy = mouse.y - p.y, d2 = dx * dx + dy * dy;
          if (d2 < MZ2 && d2 > 1) { const f = 0.6 / Math.sqrt(d2); p.x += dx * f; p.y += dy * f; }
        }
      }
      // 连线
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i];
        for (let j = i + 1; j < pts.length; j++) {
          const b = pts[j], dx = a.x - b.x, dy = a.y - b.y, d2 = dx * dx + dy * dy;
          if (d2 < LINK2) {
            const al = (1 - d2 / LINK2) * 0.5;
            ctx.strokeStyle = 'rgba(' + col + ',' + al.toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
          }
        }
        // 连到鼠标
        if (mouse.on) {
          const dx = a.x - mouse.x, dy = a.y - mouse.y, d2 = dx * dx + dy * dy;
          if (d2 < MZ2) {
            const al = (1 - d2 / MZ2) * 0.55;
            ctx.strokeStyle = 'rgba(' + col + ',' + al.toFixed(3) + ')';
            ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(mouse.x, mouse.y); ctx.stroke();
          }
        }
      }
      // 节点
      ctx.fillStyle = 'rgba(' + col + ',0.85)';
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 6.2832); ctx.fill(); }
      raf = requestAnimationFrame(frame);
    }

    function drawStatic() {
      const col = fxColor();
      ctx.clearRect(0, 0, W, H);
      ctx.fillStyle = 'rgba(' + col + ',0.7)';
      for (const p of pts) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.6, 0, 6.2832); ctx.fill(); }
    }

    window.addEventListener('resize', () => { resize(); if (isDark()) { if (reduceMotion) drawStatic(); else if (!raf) raf = requestAnimationFrame(frame); } }, { passive: true });
    window.addEventListener('pointermove', (e) => { mouse.x = e.clientX; mouse.y = e.clientY; mouse.on = true; }, { passive: true });
    window.addEventListener('pointerleave', () => { mouse.on = false; });
    document.addEventListener('mouseleave', () => { mouse.on = false; });

    // 主题切换时启停：仅暗色运行，浅色清空停帧
    fxSync = function () {
      if (isDark() && !document.hidden && !document.body.classList.contains('crop-active')) {
        if (reduceMotion) drawStatic();
        else if (!raf) raf = requestAnimationFrame(frame);
      } else {
        if (raf) { cancelAnimationFrame(raf); raf = 0; }
        ctx.clearRect(0, 0, W, H);
      }
    };

    resize();
    fxSync();
  })();

  document.addEventListener("visibilitychange", () => fxSync());
  window.addEventListener("image-port:tool-change", () => fxSync());
  sync();
}
