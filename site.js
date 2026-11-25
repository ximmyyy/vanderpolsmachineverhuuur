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

/* the aerial map: PDOK Luchtfoto tiles in Web Mercator, pins on real coordinates.
   A case opens from its row or its pin: the map flies in, the row unfolds with the photograph and the facts. */
(() => {
  const map = document.querySelector('[data-map]'); if (!map) return;
  const TILE = 'https://service.pdok.nl/hwh/luchtfotorgb/wmts/v1_0/Actueel_ortho25/EPSG:3857/{z}/{x}/{y}.jpeg';
  const still = matchMedia('(prefers-reduced-motion: reduce)');
  const pinsLayer = map.querySelector('.map__pins');
  const panel = document.querySelector('.map__panel');
  const list = panel ? panel.querySelector('ul') : null;
  const allBtn = map.querySelector('.map__all');
  const heads = [...document.querySelectorAll('.case-item__head')];

  const world = (lat, lng, z) => {
    const s = 256 * 2 ** z, r = (lat * Math.PI) / 180;
    return [((lng + 180) / 360) * s, ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * s];
  };

  /* one pin per place; cases at the same place share it, the pin opens the first */
  const places = new Map();
  heads.forEach((b) => {
    const key = b.dataset.place;
    if (!places.has(key)) places.set(key, { lat: +b.dataset.lat, lng: +b.dataset.lng, name: key, head: b });
  });
  const pinEls = new Map();
  places.forEach((p) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'pin'; el.tabIndex = -1;
    el.innerHTML = '<i></i><span></span>';
    el.querySelector('span').textContent = p.name;
    el.addEventListener('click', () => {
      const open = heads.find((h) => h.getAttribute('aria-expanded') === 'true' && h.dataset.place === p.name);
      toggle(open || p.head, { reveal: true });
    });
    pinsLayer.append(el); pinEls.set(p.name, { el, p });
  });

  /* the free part of the map: right of the list panel when it stands over the map */
  const area = () => {
    const r = map.getBoundingClientRect();
    let left = 0;
    if (panel && getComputedStyle(panel).position === 'absolute') left = Math.max(0, panel.getBoundingClientRect().right - r.left + 24);
    return { W: r.width, H: r.height, left, w: r.width - left };
  };

  const overview = () => {
    const pts = [...places.values()], a = area(), pad = 72, padR = 190;
    const xs = pts.map((p) => world(p.lat, p.lng, 0));
    const minX = Math.min(...xs.map((q) => q[0])), maxX = Math.max(...xs.map((q) => q[0])), minY = Math.min(...xs.map((q) => q[1])), maxY = Math.max(...xs.map((q) => q[1]));
    const z = Math.min(Math.log2((a.w - pad - padR) / (maxX - minX)), Math.log2((a.H - pad * 2) / (maxY - minY)), 14);
    const s = 2 ** z;
    return { cx: ((minX + maxX) / 2) * s, cy: ((minY + maxY) / 2) * s, z, ax: a.left + pad + (a.w - pad - padR) / 2, ay: a.H / 2 };
  };
  const focus = (lat, lng, z) => { const a = area(); const [x, y] = world(lat, lng, z); return { cx: x, cy: y, z, ax: a.left + a.w / 2, ay: a.H / 2 }; };

  let layer = null, current = null;
  const render = (v) => {
    const { W, H } = area();
    const zi = Math.min(18, Math.ceil(v.z)), scale = 2 ** (v.z - zi);
    const ox = (v.cx - v.ax) / scale, oy = (v.cy - v.ay) / scale;
    const next = document.createElement('div'); next.className = 'map__tiles'; next.setAttribute('aria-hidden', 'true');
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
    /* the fly: the new layer starts at the scale the old view had around the same point, then settles */
    const end = `translate(0px, 0px) scale(${scale})`;
    if (current && !still.matches) {
      /* a world point sits at L*scale on screen at the end; in the old view it sat k times further out, shifted by the old origin */
      const k = 2 ** (current.z - v.z);
      const sx = k * (v.cx - v.ax) - current.cx + current.ax, sy = k * (v.cy - v.ay) - current.cy + current.ay;
      next.style.transform = `translate(${sx}px, ${sy}px) scale(${scale * k})`;
      next.style.opacity = '0';
      next.classList.add('is-flying');
      pinsLayer.classList.add('is-moving');
      requestAnimationFrame(() => requestAnimationFrame(() => { next.style.transform = end; next.style.opacity = '1'; }));
      clearTimeout(render.t); render.t = setTimeout(() => pinsLayer.classList.remove('is-moving'), 650);
    } else {
      next.style.transform = end;
    }
    map.prepend(next);
    if (layer) { const old = layer; old.classList.add('is-leaving'); setTimeout(() => old.remove(), 700); }
    layer = next;
    pinEls.forEach(({ el, p }) => {
      const [x, y] = world(p.lat, p.lng, v.z);
      el.style.left = (x - (v.cx - v.ax)) + 'px'; el.style.top = (y - (v.cy - v.ay)) + 'px';
    });
    current = v;
  };
  const toggle = (head, opts = {}) => {
    const opening = head && head.getAttribute('aria-expanded') !== 'true';
    heads.forEach((h) => {
      const on = opening && h === head;
      h.setAttribute('aria-expanded', String(on));
      document.getElementById(h.getAttribute('aria-controls')).hidden = !on;
      h.closest('.case-item').classList.toggle('is-open', on);
    });
    pinEls.forEach(({ el, p }) => el.classList.toggle('is-open', opening && p.name === head.dataset.place));
    if (allBtn) allBtn.hidden = !opening;
    render(opening ? focus(+head.dataset.lat, +head.dataset.lng, +head.dataset.zoom || 14) : overview());
    if (opening && opts.reveal) {
      const item = head.closest('.case-item');
      if (list && getComputedStyle(panel).position === 'absolute') list.scrollTo({ top: item.offsetTop - list.offsetTop, behavior: still.matches ? 'auto' : 'smooth' });
      else item.scrollIntoView({ block: 'nearest', behavior: still.matches ? 'auto' : 'smooth' });
    }
  };
  heads.forEach((h) => h.addEventListener('click', () => toggle(h, { reveal: true })));
  if (allBtn) allBtn.addEventListener('click', () => toggle(null));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && heads.some((h) => h.getAttribute('aria-expanded') === 'true')) toggle(null); });

  render(overview());
  let raf; addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const open = heads.find((h) => h.getAttribute('aria-expanded') === 'true');
      current = null;
      render(open ? focus(+open.dataset.lat, +open.dataset.lng, +open.dataset.zoom || 14) : overview());
    });
  });
})();
