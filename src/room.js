// 방 뼈대: 바닥, 천장, 벽(문·창 구멍 포함), 걸레받이, 창틀, 문, 커튼.
// 집 전체(spec.partitions 가 있을 때): 방 사이 벽과 방문, 구역별 바닥을 더한다.
// 좌표: x=동쪽(+), z=남쪽(+), y=위. 방 안쪽 북서 모서리가 (0,0,0).
import * as THREE from 'three';
import { makeMaterial, worldUV } from './textures.js';

const capMat = new THREE.MeshBasicMaterial({ color: 0x2c2b2a });      // 잘린 벽 단면 색(빛을 받지 않는다)
const V3 = (x, y, z) => new THREE.Vector3(x, y, z);

export function buildRoom(spec, style) {
  const R = spec.room, W = R.w, D = R.d, H = R.h ?? 2.4, t = R.wallThickness ?? 0.15;
  const g = new THREE.Group();
  const mat = (ref) => makeMaterial(ref, spec, style);
  const mWall = mat(R.wall ?? '@wall'), mFloor = mat(R.floor ?? '@floor'), mCeil = mat(R.ceiling ?? '@ceiling');
  const mTrim = mat(R.trim ?? '@trim');
  const windows = [], solids = [];
  const parts = spec.partitions || [];
  // 집 전체일 때만: 위에서 볼 때 이 높이에서 벽을 자른다. 그래서 벽·창틀·문을 이 높이에서 아래위 두 토막으로 만든다
  const CUT = parts.length ? Math.min(H - 0.3, R.cut ?? 1.25) : null;
  // 집 밖 빈 곳(areas 의 outside: true): 감싸는 직사각형 안이지만 집이 아닌 자리. 바닥·천장을 깔지 않고 그 자리의 바깥 벽도 세우지 않는다.
  // 집과 맞닿는 가장자리의 벽·창·문은 partitions 로 적는다(그 창은 바깥 창으로 친다)
  const outs = (spec.areas || []).filter((a) => a.outside && a.w > 0 && a.d > 0).map((a) => ({ x0: a.x, x1: a.x + a.w, z0: a.z, z1: a.z + a.d }));
  const isOut = (x, z) => outs.some((o) => x > o.x0 && x < o.x1 && z > o.z0 && z < o.z1);

  const box = (x0, x1, y0, y1, z0, z1, m, o = {}) => {
    const geo = new THREE.BoxGeometry(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0));
    geo.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
    worldUV(geo);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = o.cast ?? true; mesh.receiveShadow = true;
    (o.parent || g).add(mesh);
    return mesh;
  };
  // 벽마다의 기준: o=벽 안쪽 면의 시작점, a=벽을 따라가는 방향, n=안쪽 면에서 벽 속으로 들어가는 방향
  const frames = {
    N: { o: V3(0, 0, 0), a: V3(1, 0, 0), n: V3(0, 0, -1) }, S: { o: V3(0, 0, D), a: V3(1, 0, 0), n: V3(0, 0, 1) },
    W: { o: V3(0, 0, 0), a: V3(0, 0, 1), n: V3(-1, 0, 0) }, E: { o: V3(W, 0, 0), a: V3(0, 0, 1), n: V3(1, 0, 0) },
  };
  const inward = {}, along = {};
  for (const k of Object.keys(frames)) { inward[k] = frames[k].n.clone().negate(); along[k] = frames[k].a.clone(); }
  const at = (wall, s, y, n) => { const f = frames[wall]; return V3(f.o.x + f.a.x * s + f.n.x * n, y, f.o.z + f.a.z * s + f.n.z * n); };
  // 벽 기준 상자: s=벽을 따라가는 거리, n=안쪽 면에서 바깥으로(+) / 방 안으로(-). CUT 을 지나면 두 토막으로 나눈다
  const wbox = (wall, s0, s1, y0, y1, n0, n1, m, o) => {
    if (s1 - s0 < 1e-4 || y1 - y0 < 1e-4) return null;
    const p = at(wall, s0, 0, n0), q = at(wall, s1, 0, n1);
    const mk = (ya, yb, mm = m, oo = o) => { const mesh = box(Math.min(p.x, q.x), Math.max(p.x, q.x), ya, yb, Math.min(p.z, q.z), Math.max(p.z, q.z), mm, oo); mesh.userData.wall = wall; return mesh; };   // wall: 내려다볼 때 카메라 쪽 벽을 걷어내는 데 쓴다
    if (CUT == null || y1 <= CUT + 1e-6) return mk(y0, y1);
    if (y0 >= CUT - 1e-6) { const up = mk(y0, y1); up.userData.upper = true; return up; }
    const low = mk(y0, CUT), up = mk(CUT, y1); up.userData.upper = true; low.userData.pair = up;
    if (m === mWall) { const cap = mk(CUT, CUT + 0.004, capMat, { cast: false }); cap.userData.cutCap = true; cap.visible = false; }      // 잘린 단면
    return low;
  };
  const both = (mesh, fn) => { if (mesh) { fn(mesh); if (mesh.userData.pair) fn(mesh.userData.pair); } };

  // 바닥·천장(벽 밑까지 넓게 깔아 빛이 새지 않게 한다)
  const slab = (y0, y1, m) => {            // 집 밖 빈 곳을 뺀 판. 가로줄마다 이어진 칸을 한 덩이로 만든다
    if (!outs.length) return [box(-t, W + t, y0, y1, -t, D + t, m)];
    const E = 0.02, cl = (v, L) => Math.min(L - 0.001, Math.max(0.001, v)), uniq = (a) => [...new Set(a)].sort((p, q) => p - q);
    const xs = uniq([-t, W + t, ...outs.flatMap((o) => [o.x0 <= E ? -t : o.x0, o.x1 >= W - E ? W + t : o.x1])]);
    const zs = uniq([-t, D + t, ...outs.flatMap((o) => [o.z0 <= E ? -t : o.z0, o.z1 >= D - E ? D + t : o.z1])]);
    const list = [];
    for (let j = 0; j < zs.length - 1; j++) {
      let run = null;
      for (let i = 0; i < xs.length - 1; i++) {
        const inside = !isOut(cl((xs[i] + xs[i + 1]) / 2, W), cl((zs[j] + zs[j + 1]) / 2, D));
        if (inside) run = run ? [run[0], xs[i + 1]] : [xs[i], xs[i + 1]];
        if (run && (!inside || i === xs.length - 2)) { list.push(box(run[0], run[1], y0, y1, zs[j], zs[j + 1], m)); run = null; }
      }
    }
    return list;
  };
  slab(-0.2, 0, mFloor);
  const ceilParts = slab(H, H + 0.2, mCeil), ceiling = ceilParts[0];
  for (const c of ceilParts) c.userData.wall = 'C';
  // 구역별 바닥(욕실 타일처럼 바닥재가 다른 곳). 본바닥 위에 얇게 덮는다
  for (const a of spec.areas || []) if (a.floor && !a.outside && a.w > 0 && a.d > 0) box(a.x, a.x + a.w, 0, 0.005, a.z, a.z + a.d, mat(a.floor), { cast: false });

  // 벽 덩어리: 기둥이나 꺾인 벽(ㄱ자 방의 빈 모서리)을 바닥부터 천장까지 채운다. x·z 는 서쪽·북쪽 벽에서 잰 거리
  const blocks = new THREE.Group(); g.add(blocks);
  for (const b of R.blocks || []) {
    const grp = new THREE.Group(); grp.position.set(b.x + b.w / 2, 0, b.z + b.d / 2); blocks.add(grp);
    const one = (w, h, d, m, y, cast) => { const mesh = new THREE.Mesh(worldUV(new THREE.BoxGeometry(w, h, d).translate(0, y + h / 2, 0), b.x, b.z), m); mesh.castShadow = cast; mesh.receiveShadow = true; grp.add(mesh); return mesh; };
    const part = (w, h, d, m, y, cast) => {
      if (CUT == null || y + h <= CUT) return one(w, h, d, m, y, cast);
      if (y >= CUT) { one(w, h, d, m, y, cast).userData.upper = true; return; }
      one(w, CUT - y, d, m, y, cast); one(w, y + h - CUT, d, m, CUT, cast).userData.upper = true;
      if (m === mWall) { const cap = one(w, 0.004, d, capMat, CUT, false); cap.userData.cutCap = true; cap.visible = false; }
    };
    part(b.w, H + 0.12, b.d, mWall, -0.06, true);
    part(b.w, 0.004, b.d, capMat, H + 0.06, false);
    if (R.baseboard !== false) part(b.w + 0.024, 0.07, b.d + 0.024, mTrim, 0, false);
    if (R.molding !== false) part(b.w + 0.036, 0.045, b.d + 0.036, mTrim, H - 0.045, false);
  }

  const ops = (spec.openings || []).map((o) => {
    const isWin = o.type === 'window';
    const sill = o.sill ?? (isWin ? 0.9 : 0), height = o.height ?? (isWin ? 1.2 : 2.1);
    return { ...o, sill, top: Math.min(H, sill + height), a: o.offset, b: o.offset + o.width };
  });

  for (const wall of ['N', 'E', 'S', 'W']) {
    const L = wall === 'N' || wall === 'S' ? W : D;
    // 벽끼리, 벽과 바닥·천장이 살짝 파묻히게 겹친다(이음매로 햇빛이 새지 않게)
    const ext = wall === 'N' || wall === 'S' ? t : t * 0.5, lo = -0.06, hi = H + 0.06;
    const ns = wall === 'N' || wall === 'S', E = 0.02;
    // 집 밖 빈 곳과 닿는 구간(틈). 맞닿는 방 사이 벽의 두께 절반만큼은 벽을 남겨 모서리를 메운다
    const raw = outs.filter((o) => (wall === 'N' ? o.z0 <= E : wall === 'S' ? o.z1 >= D - E : wall === 'W' ? o.x0 <= E : o.x1 >= W - E)).map((o) => (ns ? [o.x0, o.x1] : [o.z0, o.z1])).sort((p, q) => p[0] - q[0]);
    const merged = []; for (const r of raw) { const m = merged[merged.length - 1]; if (m && r[0] <= m[1] + E) m[1] = Math.max(m[1], r[1]); else merged.push([...r]); }      // 이웃한 빈 곳은 한 틈으로
    const gaps = merged.map(([a, b]) => ({ gap: true, sill: 0, top: H + 1, a: a <= E ? -ext - 0.01 : a + 0.075, b: b >= L - E ? L + ext + 0.01 : b - 0.075 }));
    const list = ops.filter((o) => o.wall === wall).concat(gaps).sort((p, q) => p.a - q.a);
    const spans = (s0, s1) => { const r = []; let c = s0; for (const o of gaps.slice().sort((p, q) => p.a - q.a)) { if (o.a > c) r.push([c, Math.min(o.a, s1)]); c = Math.max(c, o.b); } if (c < s1) r.push([c, s1]); return r; };
    let cur = -ext;
    for (const o of list) {
      wbox(wall, cur, o.a, lo, hi, 0, t, mWall);
      if (o.sill > 1e-4) wbox(wall, o.a, o.b, lo, o.sill, 0, t, mWall);
      if (o.top < H - 1e-4) wbox(wall, o.a, o.b, o.top, hi, 0, t, mWall);
      cur = Math.max(cur, o.b);
    }
    wbox(wall, cur, L + ext, lo, hi, 0, t, mWall);
    for (const [a, b] of spans(-ext, L + ext)) wbox(wall, a, b, hi, hi + 0.004, 0, t, capMat, { cast: false });       // 위에서 볼 때 잘린 단면(벽 윗면이 하늘빛에 하얗게 뜨지 않게)
    if (R.molding !== false) for (const [a, b] of spans(0, L)) {
      wbox(wall, a, b, H + 0.001, hi + 0.004, -0.02, 0, capMat, { cast: false });                  // 몰딩 윗면도 덮는다(천장 속이라 안에서는 안 보인다)
      wbox(wall, a, b, H - 0.045, H, -0.018, 0, mTrim, { cast: false });   // 천장 몰딩
    }
    // 걸레받이: 문·개구부 자리는 비운다
    if (R.baseboard !== false) {
      let c = 0;
      for (const o of list.filter((o) => o.sill < 0.08)) { wbox(wall, c, o.a, 0, 0.07, -0.012, 0, mTrim, { cast: false }); c = o.b; }
      wbox(wall, c, L, 0, 0.07, -0.012, 0, mTrim, { cast: false });
    }

    for (const o of list) {
      if (o.gap) continue;
      if (o.type === 'window') addWindow(wall, o);
      else { addHall(wall, o); if (o.type === 'door') addDoor(wall, o); }
    }
  }

  // 방 사이 벽. 가로(동서)로 놓이거나 세로(남북)로 놓인다. 문·개구부의 offset 은 서쪽(가로 벽) 또는 북쪽(세로 벽) 끝에서 잰다
  parts.forEach((P, i) => {
    const horiz = Math.abs(P.z1 - P.z0) < Math.abs(P.x1 - P.x0), tp = P.t ?? 0.12, key = 'P' + i;
    const s0 = horiz ? Math.min(P.x0, P.x1) : Math.min(P.z0, P.z1), s1 = horiz ? Math.max(P.x0, P.x1) : Math.max(P.z0, P.z1), L = s1 - s0;
    if (!(L > 0.05)) return;
    // 벽의 한쪽이 집 밖 빈 곳인지(sgn: +1 남·동쪽, -1 북·서쪽)
    const c0 = horiz ? P.z0 : P.x0, beyond = (s, sgn) => (horiz ? isOut(s0 + s, c0 + sgn * (tp / 2 + 0.25)) : isOut(c0 + sgn * (tp / 2 + 0.25), s0 + s));
    const mids = [L / 2, ...(P.openings || []).map((o) => o.offset + o.width / 2)];
    const flip = mids.some((s) => beyond(s, -1)) && !mids.some((s) => beyond(s, 1));       // 집 밖이 북·서쪽이면 '안쪽'이 집 안을 보게 기준을 뒤집는다
    frames[key] = horiz ? (flip ? { o: V3(s0, 0, P.z0 + tp / 2), a: V3(1, 0, 0), n: V3(0, 0, -1) } : { o: V3(s0, 0, P.z0 - tp / 2), a: V3(1, 0, 0), n: V3(0, 0, 1) })
      : (flip ? { o: V3(P.x0 + tp / 2, 0, s0), a: V3(0, 0, 1), n: V3(-1, 0, 0) } : { o: V3(P.x0 - tp / 2, 0, s0), a: V3(0, 0, 1), n: V3(1, 0, 0) });
    inward[key] = frames[key].n.clone().negate(); along[key] = frames[key].a.clone();
    const list = (P.openings || []).map((o) => {
      const isWin = o.type === 'window';
      const sill = o.sill ?? (isWin ? 0.9 : 0), height = o.height ?? (isWin ? 1.2 : o.type === 'opening' ? H - 0.25 : 2.1);
      const plus = o.swing === 'S' || o.swing === 'E' || o.swing === 'out';        // 문이 열리는 쪽: N·W 또는 S·E
      const mid = o.offset + o.width / 2;
      return { ...o, sill, top: Math.min(H, sill + height), a: o.offset, b: o.offset + o.width, swing: plus !== flip ? 'out' : 'in', open: o.open ?? 0.9, outer: beyond(mid, 1) || beyond(mid, -1) };
    }).sort((p, q) => p.a - q.a);
    const lo = -0.06, hi = H + 0.06, end = L + 0.03;
    const solid = (a, b) => { if (b - a < 0.02) return; const p = at(key, a, 0, 0), q = at(key, b, 0, tp); solids.push({ x0: Math.min(p.x, q.x), x1: Math.max(p.x, q.x), z0: Math.min(p.z, q.z), z1: Math.max(p.z, q.z) }); };
    let cur = -0.03;
    for (const o of list) {
      wbox(key, cur, o.a, lo, hi, 0, tp, mWall); solid(cur, o.a);
      if (o.sill > 1e-4) { wbox(key, o.a, o.b, lo, o.sill, 0, tp, mWall); if (o.sill > 0.25) solid(o.a, o.b); }
      else if (isGlass(o)) solid(o.a, o.b);
      if (o.top < H - 1e-4) wbox(key, o.a, o.b, o.top, hi, 0, tp, mWall);
      cur = o.b;
    }
    wbox(key, cur, end, lo, hi, 0, tp, mWall); solid(cur, end);
    wbox(key, -0.03, end, hi, hi + 0.004, 0, tp, capMat, { cast: false });
    for (const [n0, n1, m0, m1] of [[-0.012, 0, -0.018, 0], [tp, tp + 0.012, tp, tp + 0.018]]) {          // 양쪽 면의 걸레받이와 몰딩
      if (R.baseboard !== false) {
        let c = 0;
        for (const o of list.filter((o) => o.sill < 0.08)) { wbox(key, c, o.a, 0, 0.07, n0, n1, mTrim, { cast: false }); c = o.b; }
        wbox(key, c, L, 0, 0.07, n0, n1, mTrim, { cast: false });
      }
      if (R.molding !== false) wbox(key, 0, L, H - 0.045, H, m0, m1, mTrim, { cast: false });
    }
    for (const o of list) { if (o.type === 'window') addWindow(key, o, tp, !o.outer); else if (o.type === 'door') addDoor(key, o, tp, true); }
  });
  function isGlass(o) { return o.type === 'window'; }

  function addWindow(wall, o, tw = t, inner = false) {
    const fw = 0.05, n0 = tw * 0.5 - 0.035, n1 = tw * 0.5 + 0.035;
    const mFrame = mat(o.frame ?? 'white-laminate');
    wbox(wall, o.a, o.b, o.sill, o.sill + fw, n0, n1, mFrame);
    wbox(wall, o.a, o.b, o.top - fw, o.top, n0, n1, mFrame);
    wbox(wall, o.a, o.a + fw, o.sill + fw, o.top - fw, n0, n1, mFrame);
    wbox(wall, o.b - fw, o.b, o.sill + fw, o.top - fw, n0, n1, mFrame);
    const panes = o.panes ?? (o.width > 2.4 ? 3 : o.width > 0.9 ? 2 : 1);
    if (o.sill > 0.3) wbox(wall, o.a - 0.03, o.b + 0.03, o.sill - 0.03, o.sill, -0.04, n0, mFrame); // 창대
    // 미닫이 창짝: 칸마다 자기 틀이 있고 앞뒤 레일에 번갈아 놓인다
    const glass = new THREE.MeshBasicMaterial({ color: 0xcfe0e6, transparent: true, opacity: 0.07, depthWrite: false });
    const ia = o.a + fw, ib = o.b - fw, iy0 = o.sill + fw, iy1 = o.top - fw, pw = (ib - ia) / panes, sf = 0.034, mid = tw * 0.5;
    const mHandle = mat('brushed-steel');
    for (let i = 0; i < panes; i++) {
      const s0 = ia + pw * i - (i ? 0.02 : 0), s1 = ia + pw * (i + 1) + (i < panes - 1 ? 0.02 : 0), nn = mid + (i % 2 ? 0.016 : -0.016);
      wbox(wall, s0, s1, iy0, iy0 + sf, nn - 0.014, nn + 0.014, mFrame); wbox(wall, s0, s1, iy1 - sf, iy1, nn - 0.014, nn + 0.014, mFrame);
      wbox(wall, s0, s0 + sf, iy0 + sf, iy1 - sf, nn - 0.014, nn + 0.014, mFrame); wbox(wall, s1 - sf, s1, iy0 + sf, iy1 - sf, nn - 0.014, nn + 0.014, mFrame);
      both(wbox(wall, s0 + sf, s1 - sf, iy0 + sf, iy1 - sf, nn - 0.003, nn + 0.003, glass, { cast: false }), (gm) => { gm.receiveShadow = false; gm.renderOrder = 2; });
      if (i === 0 && panes > 1) wbox(wall, s1 - sf + 0.006, s1 - 0.006, (iy0 + iy1) / 2 - 0.045, (iy0 + iy1) / 2 + 0.045, nn - 0.03, nn - 0.014, mHandle, { cast: false });  // 잠금 손잡이
    }
    // 바깥 창만 하늘빛·햇빛이 들어오는 창으로 친다(방 사이 유리문은 빛을 만들지 않는다)
    if (!inner) windows.push({ wall, center: at(wall, (o.a + o.b) / 2, (o.sill + o.top) / 2, tw * 0.5), inward: inward[wall].clone(), width: o.width - fw * 2, height: o.top - o.sill - fw * 2, sill: o.sill, top: o.top, a: o.a, b: o.b, spec: o });
    if (o.curtain && o.curtain !== 'none') addCurtain(wall, o);
  }

  function addCurtain(wall, o) {
    const open = Math.min(1, Math.max(0, o.curtainOpen ?? 0.5));
    const sheer = o.curtain === 'sheer';
    const base = makeMaterial(o.curtainColor ?? '@curtain', spec, style);
    const m = base.clone();
    m.side = THREE.DoubleSide;
    if (sheer) { m.transparent = true; m.opacity = 0.42; m.depthWrite = false; m.color.set(0xffffff); }
    const top = Math.min(H - 0.03, o.top + 0.14), bottom = o.sill > 0.4 ? Math.max(0.02, o.sill - 0.1) : 0.02;
    const over = 0.14, half = o.width / 2 + over;
    const rod = mat('black-steel');
    wbox(wall, o.a - over - 0.05, o.b + over + 0.05, top + 0.005, top + 0.025, -0.105, -0.085, rod, { cast: false });
    const spans = CUT != null && bottom < CUT && top > CUT ? [[bottom, CUT, false], [CUT, top, true]] : [[bottom, top, CUT != null && bottom >= CUT]];
    for (const side of [0, 1]) for (const [yb, yt, upper] of spans) {
      const cover = Math.max(0.16, (1 - open) * half);        // 이 쪽 패널이 덮는 폭
      const s0 = side ? o.b + over - cover : o.a - over;
      const folds = Math.max(3, Math.round(half / 0.11)), amp = 0.012 + 0.03 * (1 - cover / half);
      const segs = folds * 8, rows = 6;
      const geo = new THREE.PlaneGeometry(1, 1, segs, rows);
      const p = geo.attributes.position, uv = geo.attributes.uv;
      for (let i = 0; i < p.count; i++) {
        const u = uv.getX(i), y = yb + uv.getY(i) * (yt - yb), v = (y - bottom) / (top - bottom);
        const wave = Math.sin(u * folds * Math.PI * 2 + side * 1.7) * amp * (0.75 + 0.25 * v) + Math.sin(u * 7.1 + v * 3) * 0.004;
        const pos = at(wall, s0 + u * cover, y, -0.095 + wave);
        p.setXYZ(i, pos.x, pos.y, pos.z);
        uv.setXY(i, u * half * 1.4, y - bottom);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, m);
      mesh.castShadow = !sheer; mesh.receiveShadow = true; mesh.userData.wall = wall; if (upper) mesh.userData.upper = true;
      g.add(mesh);
    }
  }

  // 문·개구부 뒤의 짧은 복도(밖의 하늘이 보이거나 햇빛이 들어오지 않게)
  function addHall(wall, o) {
    const dep = 1.3, a = o.a - 0.35, b = o.b + 0.35, m = mat('warm-plaster');
    for (const p of [wbox(wall, a, b, -0.2, 0, t, t + dep, mFloor), wbox(wall, a, b, H, H + 0.2, t, t + dep, mCeil),
      wbox(wall, a - t, a, -0.2, H + 0.2, t, t + dep, m), wbox(wall, b, b + t, -0.2, H + 0.2, t, t + dep, m),
      wbox(wall, a - t, b + t, -0.2, H + 0.2, t + dep, t + dep + t, m)]) both(p, (x) => { x.userData.wall = 'H'; });   // 내려다볼 때는 숨긴다
  }

  function addDoor(wall, o, tw = t, inner = false) {
    const mFrame = mat(o.frame ?? '@trim'), mLeaf = mat(o.leaf ?? '@trim');
    const fw = 0.045, back = inner ? tw + 0.012 : tw;
    // 문틀(방 안쪽으로 살짝 나온 몰딩. 방 사이 벽은 양쪽으로)
    wbox(wall, o.a - fw, o.a, 0, o.top + fw, -0.012, back, mFrame, { cast: false });
    wbox(wall, o.b, o.b + fw, 0, o.top + fw, -0.012, back, mFrame, { cast: false });
    wbox(wall, o.a - fw, o.b + fw, o.top, o.top + fw, -0.012, back, mFrame, { cast: false });
    const hingeEnd = o.hinge === 'end', sw = o.swing === 'out' ? -1 : 1;
    const ang = (Math.min(1, Math.max(0, o.open ?? 0)) * Math.PI) / 2;
    const dir = along[wall].clone().multiplyScalar(hingeEnd ? -1 : 1);
    const v = dir.clone().multiplyScalar(Math.cos(ang)).add(inward[wall].clone().multiplyScalar(Math.sin(ang) * sw));
    const pivot = new THREE.Group(); pivot.userData.wall = wall;
    pivot.position.copy(at(wall, hingeEnd ? o.b : o.a, 0, sw > 0 ? 0.02 : tw - 0.02));
    pivot.rotation.y = Math.atan2(-v.z, v.x);
    const lw = o.width - 0.006, lh = o.top - 0.008;
    const leafPart = (y0, y1, upper) => {
      const leaf = new THREE.Mesh(worldUV(new THREE.BoxGeometry(lw, y1 - y0, 0.038).translate(lw / 2, (y0 + y1) / 2 + 0.004, 0)), mLeaf);
      leaf.castShadow = leaf.receiveShadow = true; if (upper) leaf.userData.upper = true; pivot.add(leaf);
    };
    if (CUT != null && lh > CUT) { leafPart(0, CUT, false); leafPart(CUT, lh, true); } else leafPart(0, lh, false);
    for (const z of [-0.0205, 0.0205]) for (const [y0, y1] of [[0.16, lh * 0.44], [lh * 0.5, lh - 0.16]]) {     // 문짝의 얕은 패널 테두리
      const x0 = 0.13, x1 = lw - 0.13, b = 0.014;
      for (const [ax, ay, aw, ah] of [[x0, y0, x1 - x0, b], [x0, y1 - b, x1 - x0, b], [x0, y0, b, y1 - y0], [x1 - b, y0, b, y1 - y0]]) {
        const st = new THREE.Mesh(new THREE.BoxGeometry(aw, ah, 0.005), mLeaf); st.position.set(ax + aw / 2, ay + ah / 2, z); st.receiveShadow = true;
        if (CUT != null && ay + ah > CUT) st.userData.upper = true;
        pivot.add(st);
      }
    }
    const hm = mat('brushed-steel');
    for (const z of [-0.045, 0.045]) {
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.02, 0.022), hm); h.position.set(lw - 0.11, 1.0, z); pivot.add(h);
      const st = new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.05, 12), hm); st.rotation.x = Math.PI / 2; st.position.set(lw - 0.055, 1.0, z * 0.6); pivot.add(st);
    }
    g.add(pivot);
  }

  return { group: g, ceiling, windows, blocks, W, D, H, t, solids, outs, cut: CUT };
}
