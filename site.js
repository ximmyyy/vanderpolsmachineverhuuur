/* Van der Pols: nav over the hero, the sector tabs and the aerial map. No dependencies. */

/* the nav turns solid once the hero scrolls away */
(() => {
  const nav = document.querySelector('.nav--over'); if (!nav) return;
  const sync = () => nav.classList.toggle('is-solid', scrollY > 40);
  sync(); addEventListener('scroll', sync, { passive: true });
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

/* the aerial map: PDOK Luchtfoto tiles in Web Mercator, pins on real coordinates */
(() => {
  const map = document.querySelector('[data-map]'); if (!map) return;
  const TILE = 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg';
  const pinsLayer = map.querySelector('.map__pins');
  const panel = document.querySelector('.map__panel');
  const allBtn = map.querySelector('.map__all');
  const buttons = [...document.querySelectorAll('[data-lat]')];
  const home = { lat: +map.dataset.homeLat, lng: +map.dataset.homeLng, name: map.dataset.homeName };

  const world = (lat, lng, z) => {
    const s = 256 * 2 ** z, r = (lat * Math.PI) / 180;
    return [((lng + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
  };

  /* one pin per place; projects at the same place share it */
  const places = new Map();
  buttons.forEach((b) => {
    const key = b.dataset.place;
    if (!places.has(key)) places.set(key, { lat: +b.dataset.lat, lng: +b.dataset.lng, name: key });
  });
  const pinEls = new Map();
  const addPin = (p, cls) => {
    const el = document.createElement('div');
    el.className = 'pin' + (cls ? ' ' + cls : '');
    el.innerHTML = '<i></i><span></span>';
    el.querySelector('span').textContent = p.name;
    pinsLayer.append(el); pinEls.set(p.name, { el, p });
  };
  if (!Number.isNaN(home.lat)) addPin(home, 'is-home');
  places.forEach((p) => addPin(p));

  /* the free part of the map: right of the list panel when it floats over the map */
  const area = () => {
    const r = map.getBoundingClientRect();
    let left = 0;
    if (panel && getComputedStyle(panel).position === 'absolute') left = panel.getBoundingClientRect().right - r.left + 24;
    return { W: r.width, H: r.height, left, w: r.width - left };
  };

  let layer = null;
  const overview = () => {
    const pts = [...pinEls.values()].map((v) => v.p), a = area(), pad = 72, padR = 190;
    const xs = pts.map((p) => world(p.lat, p.lng, 0)), minX = Math.min(...xs.map((q) => q[0])), maxX = Math.max(...xs.map((q) => q[0])), minY = Math.min(...xs.map((q) => q[1])), maxY = Math.max(...xs.map((q) => q[1]));
    const z = Math.min(Math.log2((a.w - pad - padR) / (maxX - minX)), Math.log2((a.H - pad * 2) / (maxY - minY)), 14);
    const s = 2 ** z;
    return { cx: ((minX + maxX) / 2) * s, cy: ((minY + maxY) / 2) * s, z, ax: a.left + pad + (a.w - pad - padR) / 2, ay: a.H / 2 };
  };
  const focus = (lat, lng, z) => { const a = area(); const [x, y] = world(lat, lng, z); return { cx: x, cy: y, z, ax: a.left + a.w / 2, ay: a.H / 2 }; };

  const render = (v) => {
    const { W, H } = area();
    const zi = Math.min(18, Math.ceil(v.z)), scale = 2 ** (v.z - zi);
    const ox = (v.cx - v.ax) / scale, oy = (v.cy - v.ay) / scale;
    const next = document.createElement('div'); next.className = 'map__tiles'; next.setAttribute('aria-hidden', 'true');
    next.style.transform = `scale(${scale})`;
    const n = 2 ** zi;
    for (let ty = Math.floor(oy / 256); ty <= Math.floor((oy + H / scale) / 256); ty++) {
      for (let tx = Math.floor(ox / 256); tx <= Math.floor((ox + W / scale) / 256); tx++) {
        if (ty < 0 || ty >= n) continue;
        const img = document.createElement('img');
        img.alt = ''; img.decoding = 'async'; img.draggable = false;
        img.src = TILE.replace('{z}', zi).replace('{x}', ((tx % n) + n) % n).replace('{y}', ty);
        img.style.left = (tx * 256 - ox) + 'px'; img.style.top = (ty * 256 - oy) + 'px';
        next.append(img);
      }
    }
    map.prepend(next);
    if (layer) { const old = layer; old.classList.add('is-leaving'); setTimeout(() => old.remove(), 450); }
    layer = next;
    pinEls.forEach(({ el, p }) => {
      const [x, y] = world(p.lat, p.lng, v.z);
      el.style.left = (x - (v.cx - v.ax)) + 'px'; el.style.top = (y - (v.cy - v.ay)) + 'px';
    });
  };

  const open = (b) => {
    buttons.forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
    pinEls.forEach(({ el, p }) => el.classList.toggle('is-open', !!b && p.name === b.dataset.place));
    if (allBtn) allBtn.hidden = !b;
    render(b ? focus(+b.dataset.lat, +b.dataset.lng, +b.dataset.zoom || 14) : overview());
  };
  buttons.forEach((b) => b.addEventListener('click', () => open(b)));
  if (allBtn) allBtn.addEventListener('click', () => open(null));

  open(null);
  let raf; addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => { const b = buttons.find((o) => o.getAttribute('aria-pressed') === 'true'); open(b || null); });
  });
})();
