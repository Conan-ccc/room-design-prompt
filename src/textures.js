// 코드로 그리는 질감. 이미지 파일을 쓰지 않는다.
// 각 질감은 "S 미터짜리 정사각형"을 512px 캔버스 두 장(색 / 요철+거칠기)에 그리고 이음매 없이 반복한다.
import * as THREE from 'three';
import { MATERIALS, STYLES } from './catalog.js';

const N = 512;

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0;
  h = (h ^ (h >>> 13)) * 1274126177 | 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
// 주기 p 로 이어지는 값 노이즈
function vnoise(x, y, p, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % p) + p) % p;
  const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s);
  const c = hash(m(xi), m(yi + 1), s), d = hash(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// u,v 는 0~1. fx,fy 는 기본 주파수(정수면 이음매 없음)
function fbm(u, v, fx, fy, oct, s) {
  let sum = 0, amp = 0.5, tot = 0;
  for (let i = 0; i < oct; i++) {
    sum += amp * vnoise(u * fx, v * fy, Math.max(fx, 1), s + i * 17) ;
    tot += amp; amp *= 0.5; fx *= 2; fy *= 2;
  }
  return sum / tot;
}
// fx, fy 가 달라도 이어지도록 축마다 주기를 따로 쓰는 판
function fbm2(u, v, fx, fy, oct, s) {
  let sum = 0, amp = 0.5, tot = 0;
  for (let i = 0; i < oct; i++) {
    const x = u * fx, y = v * fy;
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = xf * xf * (3 - 2 * xf), b = yf * yf * (3 - 2 * yf);
    const mx = (k) => ((k % fx) + fx) % fx, my = (k) => ((k % fy) + fy) % fy;
    const h00 = hash(mx(xi), my(yi), s + i), h10 = hash(mx(xi + 1), my(yi), s + i);
    const h01 = hash(mx(xi), my(yi + 1), s + i), h11 = hash(mx(xi + 1), my(yi + 1), s + i);
    sum += amp * (h00 + (h10 - h00) * a + (h01 - h00) * b + (h00 - h10 - h01 + h11) * a * b);
    tot += amp; amp *= 0.5; fx *= 2; fy *= 2;
  }
  return sum / tot;
}

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// 각 생성기: (u, v, S미터, 옵션) -> [밝기배율, 요철 0~1, 거칠기배율 0~1, 색섞기(0=color,1=color2)]
const GEN = {
  plaster: { S: 1.6, bump: 0.004, rough: 0.92, f(u, v) {
    const big = fbm(u, v, 3, 3, 4, 1), fine = fbm(u, v, 160, 160, 2, 5);
    return [0.975 + big * 0.045 + fine * 0.01, fine * 0.5 + big * 0.5, 0.9 + fine * 0.1, 0];
  } },
  wallpaper: { S: 0.8, bump: 0.003, rough: 0.95, f(u, v) {
    const wx = Math.sin(u * Math.PI * 2 * 96), wy = Math.sin(v * Math.PI * 2 * 96);
    const weave = (wx * 0.5 + 0.5) * (wy * 0.5 + 0.5), n = fbm(u, v, 48, 48, 3, 9), big = fbm(u, v, 3, 3, 3, 2);
    return [0.965 + weave * 0.018 + n * 0.02 + big * 0.035, weave * 0.6 + n * 0.4, 0.92 + n * 0.08, 0];
  } },
  concrete: { S: 2.4, bump: 0.006, rough: 0.85, f(u, v) {
    const big = fbm(u, v, 4, 4, 5, 3), fine = fbm(u, v, 128, 128, 2, 4);
    const pit = smooth(0.78, 0.9, fbm(u, v, 40, 40, 2, 8));
    return [0.84 + big * 0.28 - pit * 0.15, 0.6 + fine * 0.3 - pit * 0.6, 0.8 + big * 0.2, 0];
  } },
  laminate: { S: 1.2, bump: 0.0008, rough: 0.5, f(u, v) {
    const n = fbm(u, v, 160, 160, 2, 6), big = fbm(u, v, 3, 3, 2, 7);
    return [0.975 + n * 0.03 + big * 0.02, n, 0.9 + n * 0.1, 0];
  } },
  'wood-solid': { S: 1.2, bump: 0.0015, rough: 0.6, f(u, v) { return grain(u, v, 0, 1); } },
  'wood-plank': { S: 1.92, px: 1024, bump: 0.004, rough: 0.55, f(u, v, S, o) {
    const pw = (o.scale || 0.12) / S, rows = Math.max(2, Math.round(1 / pw));
    const row = Math.floor(v * rows), fv = v * rows - row;
    // 널 길이 방향 이음: 줄마다 어긋난 위치에서 두 번 끊는다
    const off = hash(row, 3, 11), L = 0.5;
    const seg = Math.floor((u + off) / L), fu = ((u + off) / L) - seg;
    const id = hash(row, ((seg % 2) + 2) % 2, 21);
    const g = grain(u + id * 7.3, v + id * 3.1, id, 0.8);
    const edge = Math.min(fv, 1 - fv) * (S / rows), end = Math.min(fu, 1 - fu) * L * S;
    const gap = 1 - Math.min(smooth(0, 0.0022, edge), smooth(0, 0.0022, end));
    const bevel = Math.min(smooth(0, 0.006, edge), smooth(0, 0.006, end));
    return [g[0] * (0.86 + id * 0.26) * (1 - gap * 0.55), g[1] * 0.25 + bevel * 0.75 - gap * 0.6, g[2], 0];
  } },
  tile: { S: 1.2, bump: 0.003, rough: 0.3, f(u, v, S, o) {
    const t = (o.scale || 0.3) / S, n = Math.max(1, Math.round(1 / t));
    const cx = Math.floor(u * n), cy = Math.floor(v * n), fu = u * n - cx, fv = v * n - cy;
    const e = Math.min(fu, 1 - fu, fv, 1 - fv) * (S / n);
    const grout = 1 - smooth(0.0015, 0.004, e), id = hash(cx, cy, 31), nz = fbm(u, v, 24, 24, 3, 12);
    return [0.95 + id * 0.05 + nz * 0.04, (1 - grout) * (0.9 + nz * 0.1), grout ? 1 + grout * 2 : 0.9 + nz * 0.2, grout];
  } },
  fabric: { S: 0.4, bump: 0.002, rough: 0.97, f(u, v) {
    const k = 110, a = Math.sin(u * Math.PI * 2 * k), b = Math.sin(v * Math.PI * 2 * k);
    const over = (Math.floor(u * k) + Math.floor(v * k)) % 2 ? a * a : b * b;
    const n = fbm(u, v, 64, 64, 3, 14), big = fbm(u, v, 4, 4, 3, 15);
    return [0.82 + over * 0.2 + n * 0.08 + big * 0.06 - 0.08, over * 0.7 + n * 0.3, 1, 0];
  } },
  carpet: { S: 0.6, bump: 0.005, rough: 1, f(u, v) {
    const n = fbm(u, v, 180, 180, 2, 16), m = fbm(u, v, 40, 40, 3, 17), big = fbm(u, v, 3, 3, 3, 18);
    return [0.74 + n * 0.3 + m * 0.12 + big * 0.08 - 0.1, n * 0.7 + m * 0.3, 1, 0];
  } },
  metal: { S: 0.6, bump: 0.0006, rough: 0.5, f(u, v) {
    const streak = fbm2(u, v, 4, 256, 3, 19), n = fbm(u, v, 128, 128, 2, 20);
    return [0.94 + streak * 0.1 + n * 0.02, streak, 0.8 + streak * 0.4, 0];
  } },
};

// 나무결: u 방향으로 길게 흐른다
function grain(u, v, seed, amt) {
  const s = Math.floor(seed * 1000) + 40;
  const warp = fbm2(u, v, 2, 5, 3, s);
  const rings = Math.sin((v * 9 + warp * 4.5 + fbm2(u, v, 2, 9, 2, s + 3) * 1.2) * Math.PI * 2);        // 넓고 느슨한 무늬결
  const streak = fbm2(u, v, 3, 96, 3, s + 7), pores = fbm2(u, v, 16, 420, 2, s + 5), tone = fbm2(u, v, 2, 3, 3, s + 9);
  const b = 0.93 + (rings * 0.5 + 0.5) * 0.045 * amt + (streak - 0.5) * 0.12 * amt + (pores - 0.5) * 0.08 * amt + (tone - 0.5) * 0.14;
  return [b, 0.5 + (pores - 0.5) * 0.7 + (streak - 0.5) * 0.4, 0.85 + pores * 0.3, 0];
}

const cache = new Map();
let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = Math.min(8, a); }

function makeCanvas(n) { const c = document.createElement('canvas'); c.width = c.height = n; return c; }

function buildTextures(def) {
  const key = JSON.stringify([def.type, def.color, def.color2, def.scale]);
  if (cache.has(key)) return cache.get(key);
  const gen = GEN[def.type] || GEN.laminate, N = gen.px || 512;
  const c1 = new THREE.Color(def.color || '#cccccc').convertLinearToSRGB();
  const c2 = new THREE.Color(def.color2 || def.color || '#888888').convertLinearToSRGB();
  // Color 는 선형으로 들어오므로 sRGB 값으로 되돌려 캔버스에 쓴다
  const a = makeCanvas(N), b = makeCanvas(N);
  const ca = a.getContext('2d'), cb = b.getContext('2d');
  const ia = ca.createImageData(N, N), ib = cb.createImageData(N, N);
  for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const r = gen.f(x / N, y / N, gen.S, def), i = (y * N + x) * 4, m = clamp(r[3]);
    ia.data[i] = clamp((c1.r + (c2.r - c1.r) * m) * r[0]) * 255;
    ia.data[i + 1] = clamp((c1.g + (c2.g - c1.g) * m) * r[0]) * 255;
    ia.data[i + 2] = clamp((c1.b + (c2.b - c1.b) * m) * r[0]) * 255;
    ia.data[i + 3] = 255;
    ib.data[i] = clamp(r[1]) * 255; ib.data[i + 1] = clamp(r[2] * 0.75) * 255; ib.data[i + 2] = 0; ib.data[i + 3] = 255;
  }
  ca.putImageData(ia, 0, 0); cb.putImageData(ib, 0, 0);
  const mk = (cv, srgb) => {
    const t = new THREE.CanvasTexture(cv);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.setScalar(1 / gen.S); t.anisotropy = maxAniso;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const out = { map: mk(a, true), aux: mk(b, false), gen };
  cache.set(key, out);
  return out;
}

// 재질 참조("@역할" | 이름 | {type,color,...})를 풀어 정의 객체로 만든다
export function resolveMaterial(ref, spec, styleName) {
  const style = STYLES[styleName] || STYLES['wood-minimal'];
  let r = ref, guard = 0;
  while (typeof r === 'string' && guard++ < 5) {
    if (r[0] === '@') r = style.roles[r.slice(1)] || 'white-laminate';
    else r = (spec.materials && spec.materials[r]) || MATERIALS[r] || { type: 'laminate', color: r[0] === '#' ? r : '#cccccc' };
  }
  return r || MATERIALS['white-laminate'];
}

const matCache = new Map();
export function clearMaterials() { matCache.clear(); }

export function makeMaterial(ref, spec, styleName) {
  const def = resolveMaterial(ref, spec, styleName);
  const key = JSON.stringify(def);
  if (matCache.has(key)) return matCache.get(key);
  const t = buildTextures(def), g = t.gen;
  const m = new THREE.MeshStandardMaterial({
    map: t.map, bumpMap: t.aux, bumpScale: g.bump * 70, roughnessMap: t.aux,
    roughness: Math.min(1, (def.roughness ?? g.rough) / 0.75), metalness: def.metalness ?? 0,
    shadowSide: THREE.DoubleSide,     // 그림자를 양면으로 계산해 모서리 빛샘을 막는다
  });
  matCache.set(key, m);
  return m;
}

// 상자 꼴 도형의 UV 를 실제 길이(m) 기준으로 다시 매긴다. 질감이 늘어지지 않는다.
export function worldUV(geo, ox = 0, oy = 0) {
  const p = geo.attributes.position, n = geo.attributes.normal, uv = geo.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    let u, v;
    if (ay >= ax && ay >= az) { u = p.getX(i); v = p.getZ(i); }
    else if (ax >= az) { u = p.getZ(i); v = p.getY(i); }
    else { u = p.getX(i); v = p.getY(i); }
    uv.setXY(i, u + ox, v + oy);
  }
  uv.needsUpdate = true;
  return geo;
}

// 코드로 그린 추상화(액자용)
export function artTexture(seed = 1, palette) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 256;
  const g = c.getContext('2d');
  const pal = palette || ['#e8e0d2', '#c9a27c', '#3b4a63', '#a85d42', '#2a2b2e'];
  g.fillStyle = pal[0]; g.fillRect(0, 0, 384, 256);
  let k = seed * 9973;
  const rnd = () => (k = (k * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 5; i++) {
    g.fillStyle = pal[1 + Math.floor(rnd() * (pal.length - 1))]; g.globalAlpha = 0.75 + rnd() * 0.25;
    g.beginPath();
    if (rnd() < 0.5) g.arc(60 + rnd() * 260, 50 + rnd() * 160, 25 + rnd() * 60, 0, Math.PI * (rnd() < 0.5 ? 1 : 2));
    else g.rect(30 + rnd() * 220, 20 + rnd() * 140, 40 + rnd() * 120, 30 + rnd() * 90);
    g.fill();
  }
  g.globalAlpha = 1;
  const img = g.getImageData(0, 0, 384, 256);
  for (let i = 0; i < img.data.length; i += 4) { const n = (hash(i, i >> 9, 5) - 0.5) * 14; img.data[i] += n; img.data[i + 1] += n; img.data[i + 2] += n; }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
