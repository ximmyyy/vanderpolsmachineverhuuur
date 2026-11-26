/* Van der Pols: nav over the hero, the client band, the sector tabs and the aerial map. No dependencies. */
const still = matchMedia('(prefers-reduced-motion: reduce)');

/* the nav turns solid once the hero scrolls away */
(() => {
  const nav = document.querySelector('.nav--over'); if (!nav) return;
  const sync = () => nav.classList.toggle('is-solid', scrollY > 40);
  sync(); addEventListener('scroll', sync, { passive: true });
})();

/* the client band: drifts sideways, stops for a hand, a focus, an open logo or the pause button */
(() => {
  const root = document.querySelector('[data-logos]'); if (!root) return;
  const rail = root.querySelector('.logos__rail');
  const toggleBtn = root.querySelector('[data-logos-toggle]');
  const logos = [...root.querySelectorAll('.logo')];
  const s = { seen: false, hover: false, focus: false, touch: false, open: false, held: still.matches };
  let last = 0, pos = 0;
  const running = () => s.seen && !s.hover && !s.focus && !s.touch && !s.open && !s.held;
  const sync = () => {
    toggleBtn.textContent = s.held ? 'Afspelen' : 'Pauzeer';
    toggleBtn.setAttribute('aria-pressed', String(s.held));
    root.classList.toggle('is-running', running());
  };
  const step = (t) => {
    const dt = last ? Math.min(100, t - last) : 0; last = t;
    if (running()) {
      const half = rail.scrollWidth / 2;
      /* keep the position in a float of our own: scrollLeft rounds, and would swallow sub-pixel steps */
      if (Math.abs(rail.scrollLeft - pos) > 2) pos = rail.scrollLeft;
      pos += dt * 0.045;
      if (pos >= half) pos -= half;
      rail.scrollLeft = pos;
    } else { pos = rail.scrollLeft; }
    requestAnimationFrame(step);
  };
  /* the copy at the end keeps the loop seamless when someone scrolls by hand */
  rail.addEventListener('scroll', () => { const half = rail.scrollWidth / 2; if (rail.scrollLeft >= half) rail.scrollLeft -= half; }, { passive: true });
  [['pointerenter', 'hover', true], ['pointerleave', 'hover', false], ['focusin', 'focus', true], ['focusout', 'focus', false]].forEach(([e, k, v]) => rail.addEventListener(e, () => { s[k] = v; sync(); }));
  rail.addEventListener('touchstart', () => { s.touch = true; sync(); }, { passive: true });
  rail.addEventListener('touchend', () => { setTimeout(() => { s.touch = false; sync(); }, 2500); }, { passive: true });
  toggleBtn.addEventListener('click', () => { s.held = !s.held; sync(); });
  logos.forEach((b) => b.addEventListener('click', () => {
    const on = b.getAttribute('aria-pressed') !== 'true';
    logos.forEach((o) => o.setAttribute('aria-pressed', String(on && o === b)));
    s.open = on; sync();
  }));
  new IntersectionObserver(([e]) => { s.seen = e.isIntersecting; sync(); }).observe(root);
  sync(); requestAnimationFrame(step);
})();

/* sector tabs: every panel shows without script; with script one at a time */
(() => {
  document.querySelectorAll('[data-tabs]').forEach((root) => {
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute('aria-controls')));
    const select = (i, focus) => {
      tabs.forEach((t, j) => { t.setAttribute('aria-selected', String(i === j)); t.tabIndex = i === j ? 0 : -1; panels[j].hidden = i !== j; });
      if (focus) tabs[i].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener('click', () => select(i));
      t.addEventListener('keydown', (e) => {
        const k = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
        if (k) { e.preventDefault(); select((i + k + tabs.length) % tabs.length, true); }
        if (e.key === 'Home') { e.preventDefault(); select(0, true); }
        if (e.key === 'End') { e.preventDefault(); select(tabs.length - 1, true); }
      });
    });
    select(0);
  });
})();

/* the aerial map: PDOK Luchtfoto tiles in Web Mercator, pins on real coordinates.
   A case opens from its row or its pin; the camera flies there along a smooth zoom path
   (out a little, across, then down), sharper tiles arriving as it descends, the coordinates
   and scale reading out live. */
(() => {
  const map = document.querySelector('[data-map]'); if (!map) return;
  const TILE = 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg';
  const pinsLayer = map.querySelector('.map__pins');
  const panel = document.querySelector('.map__panel');
  const list = panel ? panel.querySelector('ul') : null;
  const allBtn = map.querySelector('.map__all');
  const readout = map.querySelector('.map__readout');
  const heads = [...document.querySelectorAll('.case-item__head')];

  /* world pixels at zoom 0 (256 wide), and back */
  const project = (lat, lng) => { const r = (lat * Math.PI) / 180; return [((lng + 180) / 360) * 256, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 256]; };
  const unproject = (x, y) => [(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 256))) * 180) / Math.PI, (x / 256) * 360 - 180];

  /* one pin per place; cases at the same place share it, the pin opens the first */
  const places = new Map();
  heads.forEach((b) => { const k = b.dataset.place; if (!places.has(k)) places.set(k, { lat: +b.dataset.lat, lng: +b.dataset.lng, name: k, head: b }); });
  const pins = [];
  places.forEach((p) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pin'; el.tabIndex = -1;
    el.innerHTML = '<i></i><span></span>';
    el.querySelector('span').textContent = p.name;
    el.addEventListener('click', () => {
      const open = heads.find((h) => h.getAttribute('aria-expanded') === 'true' && h.dataset.place === p.name);
      toggle(open || p.head);
    });
    pinsLayer.append(el); pins.push({ el, p, w: project(p.lat, p.lng) });
  });

  /* the free part of the map, right of the list panel when it stands over the map */
  const area = () => {
    const r = map.getBoundingClientRect();
    let left = 0;
    if (panel && getComputedStyle(panel).position === 'absolute') left = Math.max(0, panel.getBoundingClientRect().right - r.left + 24);
    return { W: r.width, H: r.height, left, w: r.width - left };
  };

  /* a view: the world point (x, y at zoom 0) shown at screen point (ax, ay), at zoom z */
  const overview = () => {
    const a = area(), narrow = a.w < 700, pad = narrow ? 28 : 72, padR = narrow ? 28 : 190, ws = pins.map((q) => q.w);
    const minX = Math.min(...ws.map((q) => q[0])), maxX = Math.max(...ws.map((q) => q[0])), minY = Math.min(...ws.map((q) => q[1])), maxY = Math.max(...ws.map((q) => q[1]));
    const z = Math.min(Math.log2((a.w - pad - padR) / (maxX - minX)), Math.log2((a.H - pad * 2) / (maxY - minY)), 14);
    return { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z, ax: a.left + pad + (a.w - pad - padR) / 2, ay: a.H / 2 };
  };
  const focus = (lat, lng, z) => { const a = area(), [x, y] = project(lat, lng); return { x, y, z, ax: a.left + a.w / 2, ay: a.H / 2 }; };

  /* tile layers: each is drawn once for the view it was made for, then only transformed */
  let layers = [], view = null, base = null;
  const drawLayer = (v, below) => {
    const { W, H } = area();
    const zi = Math.max(0, Math.min(16, Math.ceil(v.z))), s = 2 ** zi, n = 2 ** zi;
    const ox = v.x * s - v.ax * 2 ** (zi - v.z), oy = v.y * s - v.ay * 2 ** (zi - v.z);
    const span = 2 ** (zi - v.z);
    const el = document.createElement('div'); el.className = 'map__tiles'; el.setAttribute('aria-hidden', 'true');
    for (let ty = Math.floor(oy / 256) - 1; ty <= Math.floor((oy + H * span) / 256) + 1; ty++) {
      for (let tx = Math.floor(ox / 256) - 1; tx <= Math.floor((ox + W * span) / 256) + 1; tx++) {
        if (ty < 0 || ty >= n) continue;
        const img = document.createElement('img');
        img.alt = ''; img.decoding = 'async'; img.draggable = false;
        img.src = TILE.replace('{z}', zi).replace('{x}', ((tx % n) + n) % n).replace('{y}', ty);
        img.style.left = tx * 256 + 'px'; img.style.top = ty * 256 + 'px';
        el.append(img);
      }
    }
    /* newer layers sit above older ones, except mid-flight layers, which slide in under the destination */
    map.insertBefore(el, below ? below.el : pinsLayer);
    const layer = { el, zi };
    if (below) layers.splice(layers.indexOf(below), 0, layer); else layers.push(layer);
    return layer;
  };
  /* place every layer and pin for view v: a world point at zoom 0 lands at (p - v) * 2^z + anchor */
  const apply = (v) => {
    const k0 = 2 ** v.z;
    layers.forEach(({ el, zi }) => {
      const k = 2 ** (v.z - zi);
      el.style.transform = `translate(${v.ax - v.x * k0}px, ${v.ay - v.y * k0}px) scale(${k})`;
    });
    pins.forEach(({ el, w }) => { el.style.left = (w[0] - v.x) * k0 + v.ax + 'px'; el.style.top = (w[1] - v.y) * k0 + v.ay + 'px'; });
    if (readout) {
      const [lat, lng] = unproject(v.x, v.y);
      const mpp = (156543.03 * Math.cos((lat * Math.PI) / 180)) / k0;
      const scale = Math.round((mpp / 0.000264583) / 500) * 500;
      readout.innerHTML = `<span>${lat.toFixed(4).replace('.', ',')}° N</span><span>${lng.toFixed(4).replace('.', ',')}° O</span><span>1 : ${scale.toLocaleString('nl-NL')}</span>`;
    }
    view = v;
  };
  /* keep only the sharpest layer once it has had time to load */
  const settle = (keep) => {
    clearTimeout(settle.t);
    settle.t = setTimeout(() => { layers.filter((l) => l !== keep && l !== base).forEach((l) => l.el.remove()); layers = layers.filter((l) => l === keep || l === base); }, 1400);
  };

  /* the smooth zoom path of van Wijk and Nuij, as d3 uses it: w is the view width in zoom-0 pixels */
  const RHO = 1.5;
  const zoomPath = (p0, p1) => {
    const [ux0, uy0, w0] = p0, [ux1, uy1, w1] = p1, dx = ux1 - ux0, dy = uy1 - uy0, d2 = dx * dx + dy * dy;
    let S, at;
    if (d2 < 1e-12) {
      S = Math.log(w1 / w0) / RHO;
      at = (t) => [ux0 + t * dx, uy0 + t * dy, w0 * Math.exp(RHO * t * S)];
    } else {
      const d1 = Math.sqrt(d2), r2 = RHO * RHO, r4 = r2 * r2;
      const b0 = (w1 * w1 - w0 * w0 + r4 * d2) / (2 * w0 * r2 * d1), b1 = (w1 * w1 - w0 * w0 - r4 * d2) / (2 * w1 * r2 * d1);
      const q0 = Math.log(Math.sqrt(b0 * b0 + 1) - b0), q1 = Math.log(Math.sqrt(b1 * b1 + 1) - b1);
      S = (q1 - q0) / RHO;
      at = (t) => { const s = t * S, c = Math.cosh(q0), u = (w0 / (r2 * d1)) * (c * Math.tanh(RHO * s + q0) - Math.sinh(q0)); return [ux0 + u * dx, uy0 + u * dy, (w0 * c) / Math.cosh(RHO * s + q0)]; };
    }
    return { at, S: Math.abs(S) };
  };
  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

  let flight = 0;
  const flyTo = (target) => {
    const id = ++flight;
    if (!view || still.matches) { const l = drawLayer(target); apply(target); settle(l); return; }
    const a = area(), from = view;
    const p0 = [from.x, from.y, a.w / 2 ** from.z], p1 = [target.x, target.y, a.w / 2 ** target.z];
    const path = zoomPath(p0, p1);
    const dur = Math.max(1400, Math.min(3200, path.S * 900));
    clearTimeout(settle.t);
    /* going in, the destination draws on top and sharpens as it lands; going out, it lies underneath */
    const zoomingIn = target.z > from.z;
    const dest = drawLayer(target, zoomingIn ? undefined : layers[layers.indexOf(base) + 1]);
    map.classList.add('is-flying');
    let lastZi = Math.ceil(from.z), lastDraw = 0;
    const t0 = performance.now();
    const frame = (now) => {
      if (id !== flight) return;
      const t = Math.min(1, (now - t0) / dur), e = ease(t);
      const [x, y, w] = path.at(e);
      const v = { x, y, z: Math.log2(a.w / w), ax: from.ax + (target.ax - from.ax) * e, ay: from.ay + (target.ay - from.ay) * e };
      /* a fresh layer whenever the camera has moved two zoom steps from the last one drawn */
      if (zoomingIn && Math.abs(Math.ceil(v.z) - lastZi) >= 2 && now - lastDraw > 200 && t < 0.85) { lastZi = drawLayer(v, dest).zi; lastDraw = now; }
      apply(v);
      if (t < 1) requestAnimationFrame(frame);
      else { apply(target); map.classList.remove('is-flying'); settle(dest); arrive(); }
    };
    requestAnimationFrame(frame);
  };
  /* the pin that was flown to marks its arrival */
  const arrive = () => {
    const open = pins.find(({ el }) => el.classList.contains('is-open'));
    if (!open) return;
    open.el.classList.remove('is-arrived'); void open.el.offsetWidth; open.el.classList.add('is-arrived');
  };

  const toggle = (head) => {
    const opening = !!head && head.getAttribute('aria-expanded') !== 'true';
    heads.forEach((h) => {
      const on = opening && h === head;
      h.setAttribute('aria-expanded', String(on));
      document.getElementById(h.getAttribute('aria-controls')).hidden = !on;
      h.closest('.case-item').classList.toggle('is-open', on);
    });
    pins.forEach(({ el, p }) => { el.classList.toggle('is-open', opening && p.name === head.dataset.place); el.classList.remove('is-arrived'); });
    if (allBtn) allBtn.hidden = !opening;
    flyTo(opening ? focus(+head.dataset.lat, +head.dataset.lng, +head.dataset.zoom || 14) : overview());
    if (opening) {
      const item = head.closest('.case-item');
      if (list && getComputedStyle(panel).position === 'absolute') list.scrollTo({ top: item.offsetTop - list.offsetTop, behavior: still.matches ? 'auto' : 'smooth' });
      else item.scrollIntoView({ block: 'nearest', behavior: still.matches ? 'auto' : 'smooth' });
    }
  };
  heads.forEach((h) => h.addEventListener('click', () => toggle(h)));
  if (allBtn) allBtn.addEventListener('click', () => toggle(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && heads.some((h) => h.getAttribute('aria-expanded') === 'true')) toggle(null); });

  /* the whole work area, drawn once at a wide zoom, stays underneath so a flight never shows bare ground */
  const makeBase = () => { const o = overview(); base = drawLayer({ ...o, z: o.z - 1 }); };
  makeBase();
  const start = overview(); const first = drawLayer(start); apply(start); settle(first);
  /* only a change of width redraws: a phone's address bar changes the height while scrolling */
  let raf, lastW = map.getBoundingClientRect().width; addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const w = map.getBoundingClientRect().width;
      if (Math.abs(w - lastW) < 1) return;
      lastW = w;
      flight++; map.classList.remove('is-flying');
      const open = heads.find((h) => h.getAttribute('aria-expanded') === 'true');
      const v = open ? focus(+open.dataset.lat, +open.dataset.lng, +open.dataset.zoom || 14) : overview();
      layers.forEach((l) => l.el.remove()); layers = [];
      makeBase(); const l = drawLayer(v); apply(v); settle(l);
    });
  });
})();
