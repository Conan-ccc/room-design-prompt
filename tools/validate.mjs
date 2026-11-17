// 방 사양 검사: node tools/validate.mjs <방이름 또는 room.json 경로>
// 형식, 문·창이 벽 안에 있는지, 가구가 방 안에 있고 서로·문 앞과 겹치지 않는지 보고 평면도를 글자로 찍는다.
// 파일을 읽기만 한다. 끝날 때 오류가 있으면 종료 코드 1.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FURNITURE, FLAT_TYPES, MATERIALS, MATERIAL_TYPES, STYLES, TIMES, WALLS, footprint } from '../src/catalog.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = process.argv[2];
if (!arg) { console.error('쓰는 법: node tools/validate.mjs <방이름>'); process.exit(1); }
const file = arg.endsWith('.json') ? path.resolve(arg) : path.join(root, 'rooms', arg, 'room.json');
let spec;
try { spec = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^﻿/, '')); }
catch (e) { console.error(`오류: ${file} 을 못 읽었어 (${e.message})`); process.exit(1); }

const errors = [], warns = [];
const err = (m) => errors.push(m), warn = (m) => warns.push(m);
const num = (v) => typeof v === 'number' && Number.isFinite(v);

const R = spec.room || {};
if (!num(R.w) || !num(R.d)) err('room.w, room.d (방 안치수, m)가 숫자여야 해');
const W = R.w || 1, D = R.d || 1, H = R.h ?? 2.4;
if (W < 1 || W > 15 || D < 1 || D > 15) warn(`방 크기 ${W}×${D}m 가 보통 방 범위(1~15m)를 벗어나. mm 로 적은 건 아닌지 확인해`);
if (H < 2 || H > 4) warn(`천장 높이 ${H}m 확인`);
if (spec.style && !STYLES[spec.style]) err(`style "${spec.style}" 없음. 가능: ${Object.keys(STYLES).join(', ')}`);
if (spec.environment?.time && !TIMES.includes(spec.environment.time) && !/^\d{1,2}:?\d{2}$/.test(spec.environment.time)) err(`environment.time "${spec.environment.time}" 은 ${TIMES.join(' | ')} 또는 "17:30" 같은 시각이어야 해`);
if (spec.environment?.north != null && !num(spec.environment.north)) err('environment.north 는 도면 위쪽이 향하는 방위각(숫자. 0=북, 90=동, 180=남, 270=서)');
if (spec.environment?.season && !['spring', 'summer', 'winter'].includes(spec.environment.season)) err('environment.season 은 spring | summer | winter');
if (!Array.isArray(spec.assumptions)) warn('assumptions 가 없어. 설명·사진에 없어서 가정한 값을 한 줄씩 적어');

const checkMat = (ref, where) => {
  if (ref == null) return;
  if (typeof ref === 'object') { if (!MATERIAL_TYPES.includes(ref.type)) err(`${where}: 재질 type "${ref.type}" 없음. 가능: ${MATERIAL_TYPES.join(', ')}`); return; }
  if (ref[0] === '@') { if (!(ref.slice(1) in STYLES['wood-minimal'].roles)) err(`${where}: 역할 "${ref}" 없음. 가능: ${Object.keys(STYLES['wood-minimal'].roles).map((k) => '@' + k).join(' ')}`); return; }
  if (ref[0] === '#') return;
  if (!MATERIALS[ref] && !(spec.materials && spec.materials[ref])) err(`${where}: 재질 "${ref}" 없음. 기본 제공: ${Object.keys(MATERIALS).join(', ')}`);
};
for (const k of ['floor', 'wall', 'ceiling', 'trim']) checkMat(R[k], `room.${k}`);
for (const [k, v] of Object.entries(spec.materials || {})) checkMat(v, `materials.${k}`);

// 벽 덩어리(기둥·꺾인 벽)
const blocks = (R.blocks || []).map((b, i) => {
  if (![b.x, b.z, b.w, b.d].every(num)) err(`room.blocks[${i}]: x, z, w, d 가 숫자여야 해`);
  if (b.x < -0.001 || b.z < -0.001 || b.x + b.w > W + 0.001 || b.z + b.d > D + 0.001) err(`room.blocks[${i}]: 방 밖으로 나가`);
  return { tag: `벽 덩어리 ${i + 1}`, x0: b.x, x1: b.x + b.w, z0: b.z, z1: b.z + b.d };
});

// 문·창
const ops = (spec.openings || []).map((o, i) => {
  const tag = `openings[${i}] ${o.type}`;
  if (!['window', 'door', 'opening'].includes(o.type)) err(`${tag}: type 은 window | door | opening`);
  if (!WALLS.includes(o.wall)) err(`${tag}: wall 은 N | E | S | W`);
  if (!num(o.offset) || !num(o.width)) err(`${tag}: offset, width 가 숫자여야 해`);
  const L = o.wall === 'N' || o.wall === 'S' ? W : D, isWin = o.type === 'window';
  const sill = o.sill ?? (isWin ? 0.9 : 0), top = sill + (o.height ?? (isWin ? 1.2 : 2.1));
  if (o.offset < 0.03 || o.offset + o.width > L - 0.03) err(`${tag}: ${o.wall} 벽(길이 ${L}m) 밖으로 나가. offset ${o.offset} + width ${o.width}`);
  if (top > H + 1e-6) err(`${tag}: 위쪽(${top.toFixed(2)}m)이 천장(${H}m)보다 높아`);
  checkMat(o.curtainColor, `${tag}.curtainColor`); checkMat(o.leaf, `${tag}.leaf`);
  return { ...o, sill, top, a: o.offset, b: o.offset + o.width, tag };
});
for (let i = 0; i < ops.length; i++) for (let j = i + 1; j < ops.length; j++)
  if (ops[i].wall === ops[j].wall && ops[i].a < ops[j].b + 0.05 && ops[j].a < ops[i].b + 0.05) err(`${ops[i].tag} 와 ${ops[j].tag} 가 같은 벽에서 겹쳐`);

// 방 사이 벽(집 전체). 가로(z0=z1) 또는 세로(x0=x1)로만 놓는다. 문·개구부의 offset 은 서쪽(가로 벽)·북쪽(세로 벽) 끝에서 잰다
const partSolids = [], partClear = [];
(spec.partitions || []).forEach((P, i) => {
  const tag = `partitions[${i}]`;
  if (![P.x0, P.z0, P.x1, P.z1].every(num)) return err(`${tag}: x0, z0, x1, z1 이 숫자여야 해`);
  const horiz = Math.abs(P.z1 - P.z0) < 1e-6, vert = Math.abs(P.x1 - P.x0) < 1e-6;
  if (horiz === vert) return err(`${tag}: 가로(z0 = z1) 또는 세로(x0 = x1)로만 놓을 수 있어. 비스듬한 벽은 안 돼`);
  if (Math.min(P.x0, P.x1) < -0.001 || Math.max(P.x0, P.x1) > W + 0.001 || Math.min(P.z0, P.z1) < -0.001 || Math.max(P.z0, P.z1) > D + 0.001) err(`${tag}: 집 밖으로 나가`);
  const tp = P.t ?? 0.12, s0 = horiz ? Math.min(P.x0, P.x1) : Math.min(P.z0, P.z1), L = (horiz ? Math.abs(P.x1 - P.x0) : Math.abs(P.z1 - P.z0));
  const c = horiz ? P.z0 : P.x0;
  const rect = (a, b, n0 = -tp / 2, n1 = tp / 2, t2 = tag) => (horiz ? { x0: s0 + a, x1: s0 + b, z0: c + n0, z1: c + n1, tag: t2 } : { x0: c + n0, x1: c + n1, z0: s0 + a, z1: s0 + b, tag: t2 });
  const list = (P.openings || []).map((o, j) => {
    const ot = `${tag}.openings[${j}] ${o.type}`;
    if (!['window', 'door', 'opening'].includes(o.type)) err(`${ot}: type 은 door | opening | window`);
    if (!num(o.offset) || !num(o.width)) err(`${ot}: offset, width 가 숫자여야 해`);
    if (o.offset < -0.001 || o.offset + o.width > L + 0.001) err(`${ot}: 벽(길이 ${L.toFixed(2)}m) 밖으로 나가. offset ${o.offset} + width ${o.width}`);
    if (o.swing && !['N', 'S', 'E', 'W', 'in', 'out'].includes(o.swing)) err(`${ot}: swing 은 문이 열리는 쪽 N | S(가로 벽) 또는 W | E(세로 벽)`);
    const isWin = o.type === 'window', sill = o.sill ?? (isWin ? 0.9 : 0), top = sill + (o.height ?? (isWin ? 1.2 : o.type === 'opening' ? H - 0.25 : 2.1));
    if (top > H + 1e-6) err(`${ot}: 위쪽(${top.toFixed(2)}m)이 천장(${H}m)보다 높아`);
    return { ...o, a: o.offset, b: o.offset + o.width, tag: ot };
  }).sort((p, q) => p.a - q.a);
  for (let j = 1; j < list.length; j++) if (list[j].a < list[j - 1].b + 0.05) err(`${list[j - 1].tag} 와 ${list[j].tag} 가 같은 벽에서 겹쳐`);
  let cur = 0;
  for (const o of list) {
    if (o.a - cur > 0.02) partSolids.push(rect(cur, o.a));
    if (o.type === 'window') partSolids.push(rect(o.a, o.b));
    else {            // 문은 열리는 쪽으로 문 폭만큼, 개구부는 양쪽 0.5m 를 비운다
      const out = o.swing === 'S' || o.swing === 'E' || o.swing === 'out';
      if (o.type === 'door') partClear.push(out ? rect(o.a, o.b, tp / 2, tp / 2 + o.width, o.tag) : rect(o.a, o.b, -tp / 2 - o.width, -tp / 2, o.tag));
      else partClear.push(rect(o.a, o.b, -tp / 2 - 0.5, tp / 2 + 0.5, o.tag));
    }
    cur = o.b;
  }
  if (L - cur > 0.02) partSolids.push(rect(cur, L));
});
(spec.areas || []).forEach((a, i) => {
  const tag = `areas[${i}] ${a.name || ''}`;
  if (!a.name) err(`${tag}: name(방 이름)이 있어야 해`);
  if (![a.x, a.z, a.w, a.d].every(num)) return err(`${tag}: x, z(북서 모서리), w, d 가 숫자여야 해`);
  if (a.x < -0.001 || a.z < -0.001 || a.x + a.w > W + 0.001 || a.z + a.d > D + 0.001) err(`${tag}: 집 밖으로 나가`);
  checkMat(a.floor, `${tag}.floor`);
  if (a.outside) {            // 집 밖 빈 곳: 가구를 놓을 수 없고, 닿는 바깥 벽 구간에는 문·창을 낼 수 없다(그 가장자리는 partitions 로 적는다)
    const o = { tag: `집 밖 빈 곳(${a.name})`, out: true, x0: a.x, x1: a.x + a.w, z0: a.z, z1: a.z + a.d };
    blocks.push(o);
    for (const p of ops) {
      const ns = p.wall === 'N' || p.wall === 'S', touch = p.wall === 'N' ? o.z0 <= 0.02 : p.wall === 'S' ? o.z1 >= D - 0.02 : p.wall === 'W' ? o.x0 <= 0.02 : o.x1 >= W - 0.02;
      if (touch && p.a < (ns ? o.x1 : o.z1) && p.b > (ns ? o.x0 : o.z0)) err(`${p.tag}: 이 자리는 ${o.tag}이라 바깥 벽이 없어. 집과 맞닿는 가장자리의 partitions 에 적어야 해`);
    }
    for (const [j, l] of (spec.lights || []).entries()) if (l.x > o.x0 && l.x < o.x1 && l.z > o.z0 && l.z < o.z1) err(`lights[${j}]: ${o.tag} 안에 있어`);
  }
});

// 문·개구부 앞에 비워 둘 자리(문은 열리는 반경, 개구부는 0.6m)
const keepClear = ops.filter((o) => o.type !== 'window').map((o) => {
  const dep = o.type === 'door' && o.swing !== 'out' ? o.width : 0.6;
  if (o.wall === 'N') return { x0: o.a, x1: o.b, z0: 0, z1: dep, tag: o.tag };
  if (o.wall === 'S') return { x0: o.a, x1: o.b, z0: D - dep, z1: D, tag: o.tag };
  if (o.wall === 'W') return { x0: 0, x1: dep, z0: o.a, z1: o.b, tag: o.tag };
  return { x0: W - dep, x1: W, z0: o.a, z1: o.b, tag: o.tag };
});

// 가구
const items = (spec.furniture || []).map((f, i) => {
  const tag = `furniture[${i}] ${f.type}`;
  if (!FURNITURE[f.type]) err(`${tag}: 종류 없음. 가능: ${Object.keys(FURNITURE).join(', ')} (목록에 없는 물건은 box)`);
  if (!num(f.x) || !num(f.z)) err(`${tag}: x, z (가구 중심, m)가 숫자여야 해`);
  if (f.facing && !WALLS.includes(f.facing)) err(`${tag}: facing 은 N | E | S | W`);
  checkMat(f.material, `${tag}.material`); checkMat(f.material2, `${tag}.material2`);
  const fp = footprint(f), y0 = f.y ?? 0;
  const b = { tag, type: f.type, x0: f.x - fp.sx / 2, x1: f.x + fp.sx / 2, z0: f.z - fp.sz / 2, z1: f.z + fp.sz / 2, y0, y1: y0 + fp.h, flat: FLAT_TYPES.has(f.type) };
  if (b.x0 < -0.005 || b.x1 > W + 0.005 || b.z0 < -0.005 || b.z1 > D + 0.005)
    err(`${tag}: 벽을 뚫고 나가. 차지하는 자리 x ${b.x0.toFixed(2)}~${b.x1.toFixed(2)}, z ${b.z0.toFixed(2)}~${b.z1.toFixed(2)} / 방은 x 0~${W}, z 0~${D}. facing 이 E·W 면 w 가 z 방향으로 놓여`);
  if (b.y1 > H + 0.005) err(`${tag}: 천장보다 높아 (${b.y1.toFixed(2)}m)`);
  return b;
});
const hit = (a, b, m = 0.005) => a.x0 < b.x1 - m && b.x0 < a.x1 - m && a.z0 < b.z1 - m && b.z0 < a.z1 - m;
for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
  const a = items[i], b = items[j];
  if (a.type === 'rug' || b.type === 'rug') continue;
  if (!hit(a, b) || a.y1 <= b.y0 + 0.005 || b.y1 <= a.y0 + 0.005) continue;
  // 책상·탁자 밑에 들어가는 것, 위에 올린 것은 허용
  const tops = ['desk', 'table', 'coffee-table'];
  const under = (t, s) => tops.includes(t.type) && s.y1 <= t.y1 - 0.02;
  if (under(a, b) || under(b, a)) { warn(`${b.tag} 가 ${a.tag} 와 평면에서 겹쳐(밑에 들어간 걸로 봄). 다리에 걸리는지는 캡처로 확인`); continue; }
  if (a.flat || b.flat) continue;
  err(`${a.tag} 와 ${b.tag} 가 겹쳐`);
}
for (const k of blocks) for (const b of items) if (b.type !== 'rug' && hit(k, b)) err(`${b.tag} 가 ${k.tag} 에 박혀`);
for (const k of partSolids) for (const b of items) if (b.type !== 'rug' && !b.flat && hit(k, b)) err(`${b.tag} 가 방 사이 벽 ${k.tag} 에 박혀. 벽 두께의 절반(보통 0.06m)만큼 떼어야 해`);
for (const k of partClear) for (const b of items) if (b.type !== 'rug' && !b.flat && b.y0 < 2 && hit(k, b, 0.02)) err(`${b.tag} 가 ${k.tag} 앞(여닫는 자리)을 막아`);
for (const k of partClear) for (const b of blocks) if (!b.out && hit(k, b, 0.02)) err(`${b.tag} 가 ${k.tag} 앞을 막아`);
for (const k of keepClear) for (const b of blocks) if (hit(k, b, 0.02)) err(`${b.tag} 가 ${k.tag} 앞을 막아`);
for (const o of ops) for (const b of blocks) {
  const flush = o.wall === 'N' ? b.z0 < 0.01 : o.wall === 'S' ? b.z1 > D - 0.01 : o.wall === 'W' ? b.x0 < 0.01 : b.x1 > W - 0.01;
  const [p0, p1] = o.wall === 'N' || o.wall === 'S' ? [b.x0, b.x1] : [b.z0, b.z1];
  if (flush && p0 < o.b && o.a < p1) err(`${o.tag} 가 ${b.tag} 에 가려져. 문·창은 벽 덩어리가 없는 벽 구간에만 낼 수 있어`);
}
for (const k of keepClear) for (const b of items) if (b.type !== 'rug' && !b.flat && b.y0 < 2 && hit(k, b, 0.02)) err(`${b.tag} 가 ${k.tag} 앞(여닫는 자리)을 막아`);
for (const o of ops.filter((o) => o.type === 'window')) for (const b of items) {
  const near = o.wall === 'N' ? b.z0 < 0.1 : o.wall === 'S' ? b.z1 > D - 0.1 : o.wall === 'W' ? b.x0 < 0.1 : b.x1 > W - 0.1;
  const [p0, p1] = o.wall === 'N' || o.wall === 'S' ? [b.x0, b.x1] : [b.z0, b.z1];
  if (near && p0 < o.b && o.a < p1 && b.y1 > o.sill + 0.25 && !b.flat) warn(`${b.tag} 가 ${o.tag} 를 ${(b.y1 - o.sill).toFixed(2)}m 가려`);
}
for (const [i, l] of (spec.lights || []).entries()) {
  if (l.type && !['ceiling', 'stand', 'point'].includes(l.type)) err(`lights[${i}]: type 은 ceiling | stand | point`);
  if (l.lumens != null && (!num(l.lumens) || l.lumens < 0 || l.lumens > 30000)) err(`lights[${i}]: lumens 는 0~30000 사이 숫자(루멘)`);
}
for (const [i, l] of (spec.lights || []).entries()) if (!num(l.x) || !num(l.z) || l.x < 0 || l.x > W || l.z < 0 || l.z > D) err(`lights[${i}]: x, z 가 방 안이어야 해`);
for (const v of [spec.start, ...(spec.views || [])].filter(Boolean)) {
  if (!num(v.x) || !num(v.z) || v.x < 0.1 || v.x > W - 0.1 || v.z < 0.1 || v.z > D - 0.1) err(`시점 ${v.name || 'start'}: x, z 가 방 안(벽에서 0.1m 이상)이어야 해`);
  else if (items.some((b) => !b.flat && b.type !== 'rug' && b.y1 > 1.3 && v.x > b.x0 && v.x < b.x1 && v.z > b.z0 && v.z < b.z1)) err(`시점 ${v.name || 'start'}: 키 큰 가구 안에 서 있어`);
}

// 평면도(글자). 한 칸 = 0.1m × 0.2m, 위가 북쪽
const cw = 0.1, ch = 0.2, cols = Math.round(W / cw), rows = Math.round(D / ch);
const grid = Array.from({ length: rows }, () => Array(cols).fill(' '));
const letters = 'abcdefghijklmnopqrstuvwxyz0123456789';
items.forEach((b, i) => {
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const x = (c + 0.5) * cw, z = (r + 0.5) * ch;
    if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1 && (grid[r][c] === ' ' || b.y0 > 0 || b.type !== 'rug')) grid[r][c] = letters[i % letters.length];
  }
});
for (const b of blocks) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = (c + 0.5) * cw, z = (r + 0.5) * ch; if (x > b.x0 && x < b.x1 && z > b.z0 && z < b.z1) grid[r][c] = b.out ? '/' : '#'; }
for (const b of partSolids) for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const x = (c + 0.5) * cw, z = (r + 0.5) * ch; if (x > Math.min(b.x0, b.x1 - cw) && x < Math.max(b.x1, b.x0 + cw) && z > Math.min(b.z0, b.z1 - ch) && z < Math.max(b.z1, b.z0 + ch)) grid[r][c] = '#'; }        // 방 사이 벽(얇아서 한 칸으로 부풀려 찍는다)
const edge = (wall, L, n) => {
  const line = Array(n).fill(wall === 'N' || wall === 'S' ? '─' : '│');
  for (const o of ops.filter((o) => o.wall === wall)) for (let k = 0; k < n; k++) { const s = ((k + 0.5) * L) / n; if (s > o.a && s < o.b) line[k] = o.type === 'window' ? '≈' : o.type === 'door' ? 'D' : ' '; }
  return line;
};
const n = edge('N', W, cols), s = edge('S', W, cols), wl = edge('W', D, rows), el = edge('E', D, rows);
console.log(`\n${spec.name || arg}   ${W} × ${D} × ${H} m   (위가 북쪽 N, 왼쪽이 서쪽 W · ≈ 창, D 문, # 벽 덩어리·방 사이 벽, / 집 밖 빈 곳)`);
console.log('  ┌' + n.join('') + '┐');
grid.forEach((row, r) => console.log('  ' + wl[r] + row.join('') + el[r]));
console.log('  └' + s.join('') + '┘');
if ((spec.areas || []).length) console.log('  구역: ' + spec.areas.filter((a) => !a.outside).map((a) => `${a.name}(x ${a.x}~${+(a.x + a.w).toFixed(2)}, z ${a.z}~${+(a.z + a.d).toFixed(2)})`).join('  '));
items.forEach((b, i) => console.log(`  ${letters[i % letters.length]}  ${b.tag.replace(/^furniture\[\d+\] /, '')}  x ${b.x0.toFixed(2)}~${b.x1.toFixed(2)}  z ${b.z0.toFixed(2)}~${b.z1.toFixed(2)}  높이 ${b.y0.toFixed(2)}~${b.y1.toFixed(2)}`));
console.log('');
for (const w of warns) console.log('주의: ' + w);
for (const e of errors) console.log('오류: ' + e);
console.log(errors.length ? `\n오류 ${errors.length}개. 고치고 다시 돌려.` : `\n통과${warns.length ? ` (주의 ${warns.length}개)` : ''}.`);
process.exit(errors.length ? 1 : 0);
