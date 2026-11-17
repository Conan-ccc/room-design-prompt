// 가구: 상자·원기둥·둥근 모서리 조합으로 코드에서 만든다.
// 가구 자체 좌표: 원점은 바닥 중심, 정면이 +z, 폭이 x, 위가 y.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { FURNITURE, footprint } from './catalog.js';
import { makeMaterial, worldUV, artTexture } from './textures.js';

const YAW = { S: 0, E: Math.PI / 2, N: Math.PI, W: -Math.PI / 2 };
let seed = 1;
const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const plain = new Map();
const flat = (color, rough = 0.7, extra = {}) => {
  const k = color + rough + JSON.stringify(extra);
  if (!plain.has(k)) plain.set(k, new THREE.MeshStandardMaterial({ color, roughness: rough, shadowSide: THREE.DoubleSide, ...extra }));
  return plain.get(k);
};

export function buildFurniture(spec, style, lit) {
  const group = new THREE.Group(), lights = [], colliders = [];
  (spec.furniture || []).forEach((f, idx) => {
    const def = FURNITURE[f.type] || FURNITURE.box, fp = footprint(f);
    seed = 1000 + idx * 7919;
    const g = new THREE.Group();
    const m1 = makeMaterial(f.material ?? def.mat, spec, style);
    const m2 = makeMaterial(f.material2 ?? def.mat2 ?? '@metal', spec, style);
    const o = f.options || {};
    const on = o.on === true || o.on === 'always' ? true : o.on === false || o.on === 'never' ? false : lit;
    const ctx = { w: fp.w, d: fp.d, h: fp.h, m1, m2, o, on, g, lights, mat: (r) => makeMaterial(r, spec, style),
      part(w, h, d, m, x = 0, y = 0, z = 0, { r = 0.004, cast = true, vert = false } = {}) {
        const rr = Math.min(r, w * 0.45, h * 0.45, d * 0.45);
        const geo = rr > 0.0012 ? new RoundedBoxGeometry(w, h, d, rr > 0.02 ? 4 : 2, rr) : new THREE.BoxGeometry(w, h, d);
        worldUV(geo, rnd() * 3, rnd() * 3);
        if (vert) { const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getY(i), uv.getX(i)); }
        const mesh = new THREE.Mesh(geo, m);
        mesh.position.set(x, y + h / 2, z); mesh.castShadow = cast; mesh.receiveShadow = true;
        g.add(mesh); return mesh;
      },
      cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 24, open = false) {
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), m);
        mesh.position.set(x, y + h / 2, z); mesh.castShadow = mesh.receiveShadow = true; g.add(mesh); return mesh;
      } };
    (BUILD[f.type] || BUILD.box)(ctx);
    g.position.set(f.x, f.y ?? 0, f.z);
    g.rotation.y = (YAW[f.facing] ?? 0) + ((f.rot ?? 0) * Math.PI) / 180;
    group.add(g);
    if (fp.h > 0.25 && (f.y ?? 0) < 0.9 && f.type !== 'rug')
      colliders.push({ x0: f.x - fp.sx / 2, x1: f.x + fp.sx / 2, z0: f.z - fp.sz / 2, z1: f.z + fp.sz / 2 });
  });
  group.updateMatrixWorld(true);
  for (const l of lights) l.position.applyMatrix4(l.owner.matrixWorld);
  return { group, lights, colliders };
}

const screenMat = (on, hue = 0.6) => on
  ? new THREE.MeshStandardMaterial({ color: 0x05070a, emissive: new THREE.Color().setHSL(hue, 0.35, 0.55), emissiveIntensity: 0.55, roughness: 0.7 })
  : flat(0x050608, 0.18);

function drawers(c, n, x0, x1, y0, y1, zf, handle = true) {
  const gap = 0.004, hh = (y1 - y0) / n;
  for (let i = 0; i < n; i++) {
    c.part(x1 - x0 - gap * 2, hh - gap * 2, 0.018, c.m1, (x0 + x1) / 2, y0 + i * hh + gap, zf + 0.009, { r: 0.003, cast: false });
    if (handle) c.part(Math.min(0.16, (x1 - x0) * 0.3), 0.012, 0.016, flat(0x2a2a2c, 0.4, { metalness: 0.6 }), (x0 + x1) / 2, y0 + (i + 0.72) * hh, zf + 0.026, { cast: false });
  }
}

function books(c, x0, x1, y, zc, maxH, depth, fill) {
  const cols = [0x6d3a30, 0x2e4352, 0xd6ccba, 0x46553b, 0x25262a, 0xa8854f, 0x7f8388, 0x4d3a52, 0xe4dfd4, 0x8a5a44, 0x39506b, 0xb9b2a4];
  const paper = flat(0xe9e3d3, 0.95), band = flat(0xd8c9a0, 0.6), bandD = flat(0x1c1c1e, 0.6);
  let x = x0 + 0.012;
  while (x < x1 - 0.03) {
    if (rnd() > fill) { x += 0.04 + rnd() * 0.1; continue; }
    if (rnd() < 0.1 && x + 0.2 < x1) {                      // 눕혀 쌓은 책 몇 권
      let yy = y; const n = 2 + Math.floor(rnd() * 3);
      for (let k = 0; k < n; k++) {
        const th = 0.018 + rnd() * 0.022, bw = 0.15 + rnd() * 0.04, bd = depth * (0.72 + rnd() * 0.2);
        const b = c.part(bw, th, bd, flat(cols[Math.floor(rnd() * cols.length)], 0.8), x + 0.1, yy, zc - (depth - bd) / 2, { r: 0.002, cast: false });
        b.rotation.y = (rnd() - 0.5) * 0.25; yy += th;
      }
      x += 0.21; continue;
    }
    const bw = 0.016 + rnd() * 0.028, bh = maxH * (0.62 + rnd() * 0.34), bd = depth * (0.68 + rnd() * 0.26);
    if (x + bw > x1 - 0.01) break;
    const zb = zc - (depth - bd) / 2, col = cols[Math.floor(rnd() * cols.length)];
    c.part(bw, bh, bd, flat(col, 0.78), x + bw / 2, y, zb, { r: 0.0025, cast: false });
    c.part(bw - 0.005, bh - 0.006, bd - 0.004, paper, x + bw / 2, y + 0.003, zb - 0.003, { r: 0, cast: false });   // 종이 단면
    if (rnd() < 0.7) c.part(bw + 0.0008, 0.012 + rnd() * 0.03, 0.002, rnd() < 0.5 ? band : bandD, x + bw / 2, y + bh * (0.62 + rnd() * 0.22), zb + bd / 2, { r: 0, cast: false });
    x += bw + 0.0015;
  }
}

function lampLight(c, y, power, r, shade) {
  const always = c.o.on === true || c.o.on === 'always';
  if (c.o.on === false || c.o.on === 'never') { shade.emissiveIntensity = 0; return; }
  c.lights.push({ position: new THREE.Vector3(0, y, 0), owner: c.g, temp: c.o.temp ?? 2700, lumens: c.o.lumens ?? 900 * power, range: 6 * r, lamp: true, always, shade });
}
const shadeMat = () => new THREE.MeshStandardMaterial({ color: 0xe9dfcc, roughness: 0.9, side: THREE.DoubleSide, emissive: 0xffc98a, emissiveIntensity: 0 });

function seating(c, seats, arms = true) {
  const { w, d, h } = c, aw = arms ? 0.14 : 0, sh = 0.42, leg = 0.1;
  c.part(w, sh - leg - 0.12, d - 0.02, c.m1, 0, leg, 0, { r: 0.03 });
  const iw = w - aw * 2, sw = iw / seats;
  for (let i = 0; i < seats; i++) {
    const x = -iw / 2 + sw * (i + 0.5);
    c.part(sw - 0.012, 0.14, d - 0.26, c.m1, x, sh - 0.13, 0.1, { r: 0.045 });
    const back = c.part(sw - 0.012, h - sh + 0.02, 0.18, c.m1, x, sh - 0.02, -d / 2 + 0.2, { r: 0.06 });
    back.rotation.x = -0.14;
  }
  c.part(w, h - leg - 0.06, 0.12, c.m1, 0, leg, -d / 2 + 0.06, { r: 0.04 });
  if (arms) for (const s of [-1, 1]) c.part(aw, 0.6 - leg, d - 0.02, c.m1, s * (w / 2 - aw / 2), leg, 0, { r: 0.05 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.cyl(0.018, 0.014, leg, c.m2, sx * (w / 2 - 0.07), 0, sz * (d / 2 - 0.07), 10);
}

function tableLike(c, legInset = 0.05) {
  const { w, d, h } = c, tt = c.o.topThickness ?? 0.028;
  if (c.o.shape === 'round') {
    const top = c.cyl(w / 2, w / 2, tt, c.m1, 0, h - tt, 0, 48); void top;
    c.cyl(0.03, 0.03, h - tt - 0.02, c.m2, 0, 0.02, 0, 16); c.cyl(w * 0.28, w * 0.3, 0.02, c.m2, 0, 0, 0, 32);
    return;
  }
  c.part(w, tt, d, c.m1, 0, h - tt, 0, { r: 0.006 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1])
    c.part(0.035, h - tt, 0.035, c.m2, sx * (w / 2 - legInset - 0.0175), 0, sz * (d / 2 - legInset - 0.0175), { vert: true });
}

const BUILD = {
  box(c) { c.part(c.w, c.h, c.d, c.m1, 0, 0, 0, { r: 0.01 }); },

  desk(c) {
    const { w, d, h } = c, tt = c.o.topThickness ?? 0.025, legs = c.o.legs ?? 'frame';
    c.part(w, tt, d, c.m1, 0, h - tt, 0, { r: 0.005 });
    if (legs === 'panel') {
      for (const s of [-1, 1]) c.part(0.022, h - tt, d - 0.04, c.m1, s * (w / 2 - 0.02), 0, 0, { vert: true });
      c.part(w - 0.06, 0.3, 0.018, c.m1, 0, h - tt - 0.32, -d / 2 + 0.08);
    } else if (legs === 'motor') {
      for (const s of [-1, 1]) {
        const x = s * (w / 2 - 0.14);
        c.part(0.07, 0.022, d - 0.08, c.m2, x, 0, 0, { r: 0.006 });
        c.part(0.08, h - tt - 0.3, 0.05, c.m2, x, 0.02, 0); c.part(0.065, 0.3, 0.038, c.m2, x, h - tt - 0.31, 0);
      }
      c.part(w - 0.3, 0.035, 0.07, c.m2, 0, h - tt - 0.035, 0, { cast: false });
      c.part(0.09, 0.02, 0.03, flat(0x111214, 0.4), w / 2 - 0.2, h - tt - 0.02, d / 2 - 0.02, { cast: false }); // 조작부
    } else {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.part(0.04, h - tt, 0.04, c.m2, sx * (w / 2 - 0.05), 0, sz * (d / 2 - 0.05));
      c.part(w - 0.14, 0.04, 0.02, c.m2, 0, h - tt - 0.04, -d / 2 + 0.06, { cast: false });
    }
  },

  'office-chair'(c) {
    const { w, h } = c, m = c.m1, k = c.m2, sh = 0.47, dark = flat(0x141416, 0.55), R = w * 0.5;
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.31, arm = new THREE.Group(); arm.rotation.y = -a; c.g.add(arm);
      const bar = new THREE.Mesh(new RoundedBoxGeometry(R, 0.03, 0.05, 2, 0.012), k); bar.position.set(R / 2, 0.075, 0); bar.rotation.z = -0.09; bar.castShadow = true; arm.add(bar);
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.027, 0.027, 0.045, 14), dark); wheel.rotation.x = Math.PI / 2; wheel.position.set(R - 0.02, 0.027, 0); wheel.castShadow = true; arm.add(wheel);
    }
    c.cyl(0.045, 0.05, 0.05, k, 0, 0.06, 0, 16); c.cyl(0.022, 0.028, sh - 0.2, flat(0x9a9c9f, 0.3, { metalness: 0.9 }), 0, 0.1, 0, 14);
    c.part(0.2, 0.03, 0.22, dark, 0, sh - 0.1, 0);
    c.part(w * 0.8, 0.07, w * 0.78, m, 0, sh - 0.065, 0.03, { r: 0.034 });
    c.part(w * 0.74, 0.03, w * 0.7, dark, 0, sh - 0.085, 0.03, { r: 0.014, cast: false });
    // 등판: 가운데 + 양옆 날개를 살짝 꺾어 휜 모양
    const back = new THREE.Group(); back.position.set(0, sh + 0.06, -w * 0.4); back.rotation.x = -0.12; c.g.add(back);
    const bh = Math.min(0.52, h - sh - 0.2), bw = w * 0.74;
    for (const [dx, ry, ww] of [[0, 0, bw * 0.46], [-bw * 0.33, 0.26, bw * 0.34], [bw * 0.33, -0.26, bw * 0.34]]) {
      const p = new THREE.Mesh(new RoundedBoxGeometry(ww, bh, 0.035, 3, 0.016), m);
      worldUV(p.geometry); p.position.set(dx, bh / 2, dx ? 0.016 : 0); p.rotation.y = ry; p.castShadow = p.receiveShadow = true; back.add(p);
    }
    const spine = new THREE.Mesh(new RoundedBoxGeometry(0.07, bh * 0.75, 0.03, 2, 0.01), dark); spine.position.set(0, bh * 0.36, -0.035); back.add(spine);
    if (h > 1.18) { const hr = new THREE.Mesh(new RoundedBoxGeometry(w * 0.4, 0.13, 0.05, 3, 0.022), m); worldUV(hr.geometry); hr.position.set(0, bh + 0.11, 0.01); hr.castShadow = true; back.add(hr);
      const st = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.12, 0.012), dark); st.position.set(0, bh + 0.03, -0.02); back.add(st); }
    c.part(0.06, 0.035, 0.2, dark, 0, sh - 0.1, -w * 0.28, { cast: false });
    for (const sx of [-1, 1]) {
      c.part(0.028, 0.2, 0.04, dark, sx * w * 0.43, sh - 0.03, -0.02, { r: 0.008, cast: false });
      c.part(0.075, 0.028, 0.25, dark, sx * w * 0.43, sh + 0.17, 0.02, { r: 0.013, cast: false });
    }
  },

  monitor(c) {
    const { w, h } = c, ph = Math.min(h - 0.08, w * 0.58), bz = 0.02;
    c.part(0.24, 0.012, 0.18, c.m1, 0, 0, 0, { r: 0.004 });
    c.part(0.045, h - ph * 0.5, 0.03, c.m1, 0, 0.01, -0.03);
    c.part(w, ph, bz, flat(0x0d0e10, 0.45), 0, h - ph, 0, { r: 0.006 });
    c.part(w * 0.5, ph * 0.5, 0.03, flat(0x101113, 0.5), 0, h - ph * 0.78, -0.022, { r: 0.012, cast: false });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.016, ph - 0.022), screenMat(c.on, 0.58 + rnd() * 0.08));
    scr.position.set(0, h - ph / 2 + 0.003, bz / 2 + 0.0012); c.g.add(scr);
    if (c.on) c.lights.push({ position: new THREE.Vector3(0, h - ph / 2, 0.25), owner: c.g, color: 0x9fb8ff, power: 0.12, range: 2.2 });
  },

  keyboard(c) {
    const { w, d } = c, body = flat(0x1b1c1f, 0.5), key = flat(0x2c2d31, 0.65);
    const kb = c.part(w, 0.016, d, body, 0, 0.002, 0, { r: 0.005, cast: false }); kb.rotation.x = 0.05;
    const cols = 14, rows = 5, kw = (w - 0.02) / cols, kd = (d - 0.02) / rows;
    for (let r = 0; r < rows; r++) for (let q = 0; q < cols; q++) {
      if (r === rows - 1 && q > 3 && q < 9) { if (q === 4) c.part(kw * 5 - 0.003, 0.006, kd - 0.003, key, -w / 2 + 0.01 + kw * 6.5, 0.018, -d / 2 + 0.01 + kd * (r + 0.5), { r: 0.0015, cast: false }); continue; }
      c.part(kw - 0.003, 0.006, kd - 0.003, key, -w / 2 + 0.01 + kw * (q + 0.5), 0.018 + (rows - 1 - r) * 0.0012, -d / 2 + 0.01 + kd * (r + 0.5), { r: 0.0015, cast: false });
    }
    if (c.o.mouse !== false) {
      c.part(0.24, 0.003, 0.2, flat(0x26272b, 0.9), w / 2 + 0.16, 0, 0, { r: 0.001, cast: false });
      const ms = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10), flat(0x1a1b1e, 0.4)); ms.scale.set(0.031, 0.019, 0.052); ms.position.set(w / 2 + 0.15, 0.016, 0.01); ms.castShadow = true; c.g.add(ms);
    }
  },

  'pc-case'(c) {
    const { w, d, h } = c;
    c.part(w, h, d, flat(0x121315, 0.45), 0, 0.012, 0, { r: 0.008 });
    c.part(w * 0.5, h * 0.8, 0.004, flat(0x1c1d20, 0.3, { metalness: 0.5 }), 0, h * 0.1, d / 2 + 0.002, { cast: false });
    c.part(0.012, 0.012, 0.004, c.on ? new THREE.MeshStandardMaterial({ color: 0, emissive: 0x7fd0ff, emissiveIntensity: 3 }) : flat(0x222, 0.4), w * 0.3, h * 0.92, d / 2 + 0.002, { cast: false });
  },

  'air-purifier'(c) {
    const { w, d, h } = c;
    c.part(w, h, d, c.m1, 0, 0, 0, { r: Math.min(w, d) * 0.22 });
    c.cyl(w * 0.36, w * 0.36, 0.006, flat(0x2a2b2e, 0.6), 0, h, 0, 32);
    c.part(w * 0.7, h * 0.28, 0.004, flat(0xcfcdc8, 0.7), 0, h * 0.08, d / 2 + 0.001, { cast: false });
  },

  'drawer-unit'(c) {
    const { w, d, h } = c, leg = c.o.legs === false ? 0 : 0.06;
    c.part(w, h - leg, d - 0.018, c.m1, 0, leg, -0.009, { r: 0.004 });
    drawers(c, c.o.drawers ?? Math.max(2, Math.round((h - leg) / 0.22)), -w / 2, w / 2, leg, h - 0.004, d / 2 - 0.018);
    if (leg) for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.part(0.03, leg, 0.03, c.m2, sx * (w / 2 - 0.04), 0, sz * (d / 2 - 0.04));
  },
  nightstand(c) { c.o.drawers ??= 2; BUILD['drawer-unit'](c); },
  'tv-stand'(c) { c.o.drawers ??= 1; BUILD['drawer-unit'](c); },

  bookcase(c) {
    const { w, d, h } = c, th = 0.018, n = c.o.shelves ?? Math.max(2, Math.round(h / 0.36)), fill = c.o.filled ?? 0.65;
    for (const s of [-1, 1]) c.part(th, h, d, c.m1, s * (w / 2 - th / 2), 0, 0, { vert: true });
    c.part(w - th * 2, 0.006, 0.006 + 0, c.m1, 0, 0, 0, { cast: false });
    c.part(w - th * 2, h, 0.006, c.m1, 0, 0, -d / 2 + 0.003);
    const step = (h - th) / n;
    for (let i = 0; i <= n; i++) {
      const y = i === 0 ? 0.04 : i * step;
      c.part(w - th * 2, th, d - 0.008, c.m1, 0, y, 0.004);
      if (i < n) books(c, -w / 2 + th, w / 2 - th, y + th, 0, step - th - 0.03, d - 0.04, fill);
    }
  },

  'shelf-rack'(c) {
    const { w, d, h } = c, n = c.o.tiers ?? 5, fill = c.o.filled ?? 0.5, post = 0.032;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.part(post, h, post, c.m1, sx * (w / 2 - post / 2), 0, sz * (d / 2 - post / 2));
    for (let i = 0; i < n; i++) {
      const y = 0.08 + (i * (h - 0.11)) / (n - 1);
      for (const sz of [-1, 1]) c.part(w - post * 2, 0.03, 0.012, c.m1, 0, y - 0.03, sz * (d / 2 - 0.006), { cast: false });
      for (const sx of [-1, 1]) c.part(0.012, 0.03, d - post * 2, c.m1, sx * (w / 2 - 0.006), y - 0.03, 0, { cast: false });
      c.part(w - 0.02, 0.009, d - 0.02, c.m2, 0, y - 0.006, 0);
      if (i < n - 1) {
        const gapH = (h - 0.11) / (n - 1) - 0.05; let x = -w / 2 + 0.05;
        while (x < w / 2 - 0.12) {
          const bw = 0.1 + rnd() * 0.14;
          if (rnd() < fill && x + bw < w / 2 - 0.04) {
            const col = [0xd8d2c4, 0x394a5a, 0xa9794f, 0x2b2c2f, 0x8a9a7a][Math.floor(rnd() * 5)];
            c.part(bw, gapH * (0.45 + rnd() * 0.45), d * (0.55 + rnd() * 0.3), flat(col, 0.85), x + bw / 2, y + 0.004, 0, { r: 0.008, cast: false });
          }
          x += bw + 0.02;
        }
      }
    }
  },

  wardrobe(c) {
    const { w, d, h } = c, n = c.o.doors ?? Math.max(2, Math.round(w / 0.5)), dw = w / n;
    c.part(w, h - 0.05, d - 0.02, c.m1, 0, 0.05, -0.01);
    c.part(w - 0.04, 0.05, d - 0.08, flat(0x1a1a1c, 0.6), 0, 0, 0, { cast: false });
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + dw * (i + 0.5);
      c.part(dw - 0.006, h - 0.058, 0.019, c.m1, x, 0.054, d / 2 - 0.0095, { r: 0.003, vert: true, cast: false });
      if (c.o.handles !== false) c.part(0.01, 0.14, 0.014, flat(0x2a2a2c, 0.4, { metalness: 0.6 }), x + (i % 2 ? -1 : 1) * (dw / 2 - 0.04), h * 0.48, d / 2 + 0.007, { cast: false });
    }
  },

  bed(c) {
    const { w, d, h } = c, hb = c.o.headboard ?? 0.95, mh = 0.22, base = h - mh;
    c.part(w + 0.04, base - 0.08, d + 0.02, c.m2, 0, 0.08, 0, { r: 0.01 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) c.part(0.05, 0.08, 0.05, c.m2, sx * (w / 2 - 0.06), 0, sz * (d / 2 - 0.06));
    c.part(w + 0.04, hb, 0.06, c.m2, 0, 0, -d / 2 - 0.03, { r: 0.012 });
    const white = c.mat({ type: 'fabric', color: '#e8e4dc' });
    c.part(w, mh, d, white, 0, base, 0, { r: 0.06 });
    c.part(w + 0.06, 0.09, d * 0.66, c.m1, 0, h - 0.035, d * 0.17 + 0.01, { r: 0.04 });
    c.part(w + 0.05, 0.05, 0.22, c.m1, 0, h + 0.02, -d * 0.16 + 0.1, { r: 0.024 });   // 접힌 이불 끝
    const np = w > 1.3 ? 2 : 1, pw = Math.min(0.62, w / np - 0.1);
    for (let i = 0; i < np; i++) {
      const p = c.part(pw, 0.12, 0.4, white, (i - (np - 1) / 2) * (pw + 0.08), h - 0.01, -d / 2 + 0.27, { r: 0.055 });
      p.rotation.x = 0.12;
    }
  },

  sofa(c) { seating(c, c.o.seats ?? Math.max(2, Math.round(c.w / 0.85))); },
  armchair(c) { seating(c, 1); },
  'coffee-table'(c) { tableLike(c, 0.06); },
  table(c) { tableLike(c, 0.05); },

  chair(c) {
    const { w, d, h } = c, sh = 0.45;
    c.part(w, 0.04, d - 0.04, c.o.cushion === false ? c.m1 : c.m2, 0, sh - 0.04, 0.02, { r: 0.015 });
    for (const sx of [-1, 1]) {
      c.part(0.03, sh - 0.04, 0.03, c.m1, sx * (w / 2 - 0.025), 0, d / 2 - 0.045, { vert: true });
      c.part(0.03, h, 0.03, c.m1, sx * (w / 2 - 0.025), 0, -d / 2 + 0.025, { vert: true });
    }
    c.part(w - 0.05, 0.16, 0.02, c.m1, 0, h - 0.2, -d / 2 + 0.025, { r: 0.006 });
  },

  tv(c) {
    const { w, d, h } = c;
    c.part(w, h, d, flat(0x0c0d0f, 0.4), 0, 0, 0, { r: 0.006 });
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(w - 0.02, h - 0.02), screenMat(c.o.on === true, 0.07));
    scr.position.set(0, h / 2, d / 2 + 0.001); c.g.add(scr);
  },

  rug(c) {
    if (c.o.shape === 'round') { const m = c.cyl(c.w / 2, c.w / 2, c.h, c.m1, 0, 0, 0, 64); m.castShadow = false; return; }
    c.part(c.w, c.h, c.d, c.m1, 0, 0, 0, { cast: false });
  },

  plant(c) {
    const { w, h } = c, pr = Math.min(0.16, w * 0.32), ph = Math.min(0.32, h * 0.28);
    c.cyl(pr, pr * 0.78, ph, c.m1, 0, 0, 0, 28);
    c.cyl(pr * 0.92, pr * 0.92, 0.01, flat(0x3a2c22, 1), 0, ph - 0.012, 0, 20);
    const leafM = [flat(0x3f6b3a, 0.65), flat(0x4f7d45, 0.65), flat(0x2f5630, 0.7)];
    const n = c.o.kind === 'small' ? 9 : 16, geo = new THREE.SphereGeometry(1, 10, 6);
    for (let i = 0; i < n; i++) {
      const a = rnd() * Math.PI * 2, len = (h - ph) * (0.55 + rnd() * 0.45), tilt = Math.min(0.25 + rnd() * 0.75, Math.asin(Math.min(1, (w * 0.46) / len)));
      const stem = new THREE.Group(); stem.position.set(0, ph, 0); stem.rotation.set(0, a, 0);
      const arm = new THREE.Group(); arm.rotation.z = -tilt; stem.add(arm);
      const s = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.006, len, 5), leafM[2]); s.position.y = len / 2; arm.add(s);
      const leaf = new THREE.Mesh(geo, leafM[i % 3]); leaf.scale.set(0.035 + rnd() * 0.03, len * 0.3, 0.008);
      leaf.position.y = len * 0.92; leaf.rotation.y = rnd() * 3; leaf.castShadow = true; arm.add(leaf);
      c.g.add(stem);
    }
  },

  'floor-lamp'(c) {
    const { w, h } = c;
    c.cyl(w * 0.4, w * 0.42, 0.02, c.m1, 0, 0, 0, 32); c.cyl(0.011, 0.011, h - 0.25, c.m1, 0, 0.02, 0, 10);
    const sm = shadeMat(), sh = c.cyl(w * 0.36, w * 0.5, 0.26, sm, 0, h - 0.26, 0, 32, true); sh.castShadow = false;
    lampLight(c, h - 0.16, 1.0, 0.9, sm);
  },
  'table-lamp'(c) {
    const { w, h } = c;
    c.cyl(w * 0.3, w * 0.34, 0.02, c.m1, 0, 0, 0, 24); c.cyl(0.009, 0.009, h - 0.16, c.m1, 0, 0.02, 0, 8);
    const sm = shadeMat(), sh = c.cyl(w * 0.38, w * 0.5, 0.16, sm, 0, h - 0.16, 0, 28, true); sh.castShadow = false;
    lampLight(c, h - 0.1, 0.5, 0.7, sm);
  },

  'wall-art'(c) {
    const { w, d, h } = c, fr = 0.02;
    c.part(w, h, d, c.m1, 0, 0, 0, { cast: false });
    const m = new THREE.MeshStandardMaterial({ map: artTexture(c.o.seed ?? Math.floor(rnd() * 99) + 1, c.o.palette), roughness: 0.9 });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w - fr * 2, h - fr * 2), m); p.position.set(0, h / 2, d / 2 + 0.001); c.g.add(p);
  },
  mirror(c) {
    const { w, d, h } = c, fr = 0.018;
    c.part(w, h, d, c.m1, 0, 0, 0, { cast: false });
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w - fr * 2, h - fr * 2), flat(0xdfe6ea, 0.03, { metalness: 1 }));
    p.position.set(0, h / 2, d / 2 + 0.001); c.g.add(p);
  },
};
