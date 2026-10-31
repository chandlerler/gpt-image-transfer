// Local artwork and hover animation for the content-script launcher.
export function mountImagePortLauncher(button) {
  button.innerHTML = "<svg viewBox=\"10.5 10.5 674 674\" xmlns=\"http://www.w3.org/2000/svg\" aria-hidden=\"true\">\n<defs><radialGradient id=\"paper\"><stop stop-color=\"#d0ae7f\"/><stop offset=\"1\" stop-color=\"#bc9567\"/></radialGradient><filter id=\"paper-grain\" x=\"0\" y=\"0\" width=\"100%\" height=\"100%\"><feTurbulence type=\"fractalNoise\" baseFrequency=\".76\" numOctaves=\"3\" stitchTiles=\"stitch\"/><feColorMatrix type=\"saturate\" values=\"0\"/><feComponentTransfer><feFuncA type=\"linear\" slope=\".33\"/></feComponentTransfer><feBlend in=\"SourceGraphic\" mode=\"multiply\"/></filter><clipPath id=\"disc\"><circle cx=\"347.5\" cy=\"347.5\" r=\"337\"/></clipPath></defs>\n<circle cx=\"347.5\" cy=\"347.5\" r=\"337\" fill=\"url(#paper)\"/>\n<g clip-path=\"url(#disc)\"><rect x=\"10\" y=\"10\" width=\"675\" height=\"675\" fill=\"#c6a176\" filter=\"url(#paper-grain)\" class=\"grain\" opacity=\".3\" style=\"mix-blend-mode:multiply\"/>\n<g id=\"outer-rays\" fill=\"#8f3021\"></g><g id=\"inner-rays\" fill=\"#8f3021\" opacity=\".84\"></g>\n<image class=\"hands\"  x=\"107\" y=\"83\" width=\"480\" height=\"480\" preserveAspectRatio=\"xMidYMid meet\"/>\n</g><circle cx=\"347.5\" cy=\"347.5\" r=\"337\" fill=\"none\" stroke=\"#8a6544\" stroke-opacity=\".22\" stroke-width=\"1.5\"/>\n</svg>";
  button.querySelector(".hands").setAttribute("href", chrome.runtime.getURL("assets/launcher-hands.png"));
  const ns = 'http://www.w3.org/2000/svg';
  const segments = [];
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const cycleSeconds = 2.8;
  let hovered = false;
  let keyboardFocused = false;
  let envelope = 0;
  let phase = 0;
  let lastTime = 0;
  let frame = 0;

  function noise(index, seed = 0) {
    const value = Math.sin(index * 127.1 + seed * 311.7) * 43758.5453;
    return value - Math.floor(value);
  }

  function addRing(id, count, base, minLength, maxLength, offset) {
    const group = button.querySelector('#' + id);
    for (let index = 0; index < count; index++) {
      const path = document.createElementNS(ns, 'path');
      path.setAttribute('opacity', String(0.64 + noise(index, 9) * 0.33));
      group.append(path);
      segments.push({
        path,
        angle: index / count * Math.PI * 2 + (noise(index, 3) - 0.5) * 0.015,
        inner: base + (noise(index, 4) - 0.5) * 11,
        length: minLength + noise(index, 5) * (maxLength - minLength),
        width: 0.8 + noise(index, 6) * 2,
        phase: offset + index / count * Math.PI * 4,
        jitter: noise(index, 7)
      });
    }
  }

  function render() {
    for (const segment of segments) {
      const { angle, inner, length, width, path } = segment;
      const cosine = Math.cos(angle), sine = Math.sin(angle);
      const wave = Math.sin(phase - segment.phase) * 0.25
        + Math.sin(phase * 0.64 + segment.phase * 1.5 + segment.jitter) * 0.085;
      const outer = inner + length * (1 + envelope * wave);
      const x = 347.5 + cosine * inner, y = 347.5 + sine * inner;
      path.setAttribute('d',
        `M${(x - sine * width).toFixed(2)},${(y + cosine * width).toFixed(2)} ` +
        `L${(347.5 + cosine * outer).toFixed(2)},${(347.5 + sine * outer).toFixed(2)} ` +
        `L${(x + sine * width).toFixed(2)},${(y - cosine * width).toFixed(2)}Z`);
    }
  }

  function tick(now) {
    frame = 0;
    if (!button.isConnected || document.hidden) {
      lastTime = 0;
      return;
    }
    const delta = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
    lastTime = now;
    const active = !reducedMotion.matches && (hovered || keyboardFocused);
    envelope += ((active ? 1 : 0) - envelope)
      * (1 - Math.exp(-delta / (active ? 0.22 : 0.38)));
    phase += delta * Math.PI * 2 / cycleSeconds * Math.max(envelope, 0.03);
    if (!active && envelope < 0.001) {
      envelope = 0;
      lastTime = 0;
      render();
      return;
    }
    render();
    frame = requestAnimationFrame(tick);
  }

  function wake() {
    if (!frame && !document.hidden && button.isConnected) {
      frame = requestAnimationFrame(tick);
    }
  }

  button.addEventListener('pointerenter', () => { hovered = true; wake(); });
  button.addEventListener('pointerleave', () => { hovered = false; wake(); });
  button.addEventListener('focus', () => {
    keyboardFocused = button.matches(':focus-visible');
    wake();
  });
  button.addEventListener('blur', () => { keyboardFocused = false; wake(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
    } else {
      wake();
    }
  });
  reducedMotion.addEventListener('change', () => {
    if (reducedMotion.matches) {
      cancelAnimationFrame(frame);
      frame = 0;
      lastTime = 0;
      envelope = 0;
      render();
    } else {
      wake();
    }
  });

  addRing('outer-rays', 144, 225, 40, 94, 0);
  addRing('inner-rays', 92, 116, 25, 57, 1.6);
  render();
}
