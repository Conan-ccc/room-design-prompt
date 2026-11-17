// 방 사양(room.json) 하나를 읽어 그린다. 그림·모델 파일 없이 전부 코드.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { STYLES, FURNITURE, FLAT_TYPES, MATERIALS, footprint } from './catalog.js';
import { buildRoom } from './room.js';
import { buildFurniture } from './furniture.js';
import { resolveMaterial, clearMaterials, setAnisotropy } from './textures.js';

const Q = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

// ── 해: 시각과 계절로 방위·고도를 구하고, 고도에 따라 빛 색과 세기를 정한다 ──
// 계절: [해 뜨는 시각, 지는 시각, 뜨는 방위, 지는 방위, 한낮 고도]. 서울 근처 값을 어림한 것(방위는 북=0, 시계 방향).
const SEASONS = {
  spring: { label: '봄·가을', rise: 6.5, set: 18.5, az0: 90, az1: 270, peak: 52 },
  summer: { label: '여름', rise: 5.25, set: 19.9, az0: 62, az1: 298, peak: 76 },
  winter: { label: '겨울', rise: 7.7, set: 17.3, az0: 119, az1: 241, peak: 29 },
};
// 해 고도(el)별 빛. 사이 값은 섞는다. el 이 0 아래면 달빛으로 넘어간다.
const KEYS = [
  { el: -6, sun: [0.50, 0.62, 1.0], sunI: 0.22, zenith: '#04060d', horizon: '#141a2e', sky: 0.10, fill: [0.45, 0.55, 0.9], fillI: 0.5, amb: 0.05, exp: 1.05, clouds: 0.3 },
  { el: 0,  sun: [1.0, 0.42, 0.20], sunI: 0.0,  zenith: '#2b2f60', horizon: '#e07f58', sky: 0.55, fill: [0.62, 0.56, 0.86], fillI: 1.6, amb: 0.16, exp: 1.08, clouds: 0.7 },
  { el: 8,  sun: [1.0, 0.52, 0.24], sunI: 11.0, zenith: '#473f7d', horizon: '#ff9958', sky: 1.1, fill: [1.0, 0.70, 0.62], fillI: 4.5, amb: 0.42, exp: 1.0, clouds: 0.75 },
  { el: 20, sun: [1.0, 0.80, 0.58], sunI: 7.5,  zenith: '#5f93cf', horizon: '#f2d6b3', sky: 1.5, fill: [0.75, 0.86, 1.0], fillI: 5.0, amb: 0.40, exp: 0.95, clouds: 0.5 },
  { el: 50, sun: [1.0, 0.95, 0.88], sunI: 8.5,  zenith: '#3b78c8', horizon: '#cfe1f1', sky: 1.9, fill: [0.80, 0.90, 1.0], fillI: 7.0, amb: 0.55, exp: 0.85, clouds: 0.4 },
];
const PRESET = { morning: 8, noon: 12.5, sunset: 17.75, night: 21.5 };
const mix = (a, b, t) => a + (b - a) * t;

function sunState(hours, seasonName, north = 0) {      // north: 도면 위쪽(z=0 쪽)이 실제로 향하는 방위각(0=북). 해 방향을 그만큼 돌린다
  const S = SEASONS[seasonName] || SEASONS.spring, f = (hours - S.rise) / (S.set - S.rise);
  const ff = Math.min(1.35, Math.max(-0.35, f));
  const el = Math.max(-12, S.peak * Math.sin(Math.PI * ff)), az = mix(S.az0, S.az1, Math.min(1, Math.max(0, f)));
  let i = 0; while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1], t = Math.min(1, Math.max(0, (el - a.el) / (b.el - a.el)));
  const T = { el, az, night: Math.min(1, Math.max(0, -el / 6)), lamps: el < 4 };
  for (const k of ['sunI', 'sky', 'fillI', 'amb', 'exp', 'clouds']) T[k] = mix(a[k], b[k], t);
  for (const k of ['sun', 'fill']) T[k] = a[k].map((v, n) => mix(v, b[k][n], t));
  for (const k of ['zenith', 'horizon']) T[k] = new THREE.Color(a[k]).lerp(new THREE.Color(b[k]), t);
  // 빛이 오는 방향: 해가 떠 있으면 해, 졌으면 달(남동쪽 하늘에 고정)
  const dirOf = (azD, elD) => { const A = (azD * Math.PI) / 180, E = (elD * Math.PI) / 180; return new THREE.Vector3(Math.sin(A) * Math.cos(E), Math.sin(E), -Math.cos(A) * Math.cos(E)); };
  T.dir = el > 0 ? dirOf(az - north, Math.max(el, 1.5)) : dirOf(150 - north, 40);
  if (el > 0) T.sunI *= Math.min(1, el / 3);            // 지평선 근처에서는 해가 약해진다
  return T;
}
const parseTime = (v) => {          // "17:30" | "1730" | "morning" → 시(소수)
  if (v == null) return null;
  if (PRESET[v] != null) return PRESET[v];
  const m = String(v).trim().match(/^(\d{1,2})[:시.\s]?(\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]) + Number(m[2] || 0) / 60;
  return h >= 0 && h <= 24 ? h : null;
};
const fmtTime = (h) => `${String(Math.floor(h + 1e-6) % 24).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`;

const QUALITY = { low: { pr: 1, shadow: 1024, post: false, ao: false }, mid: { pr: 1.25, shadow: 2048, post: true, ao: 8 }, high: { pr: 2, shadow: 4096, post: true, ao: 16 } };

const kelvin = (k) => {            // 색온도 → 대략의 색
  const t = k / 100, c = new THREE.Color();
  const r = t <= 66 ? 1 : Math.min(1, 1.2929 * Math.pow(t - 60, -0.1332));
  const g = t <= 66 ? Math.min(1, Math.max(0, 0.3901 * Math.log(t) - 0.6318)) : Math.min(1, 1.1299 * Math.pow(t - 60, -0.0755));
  const b = t >= 66 ? 1 : t <= 19 ? 0 : Math.min(1, Math.max(0, 0.5432 * Math.log(t - 10) - 1.1963));
  return c.setRGB(r, g, b, THREE.SRGBColorSpace).lerp(new THREE.Color(1, 1, 1), 0.38);   // 등 색이 방 전체를 물들이지 않게 덜어 낸다
};
// 루멘 → 화면 밝기. 3000lm 천장등 하나가 작은 방을 보통 밝기로 채우도록 맞춘 값(정밀한 조도 계산은 아니다).
const LM = 0.075 / (4 * Math.PI);

// ── 렌더러 ────────────────────────────────────────────────────────────────
let quality = Q.get('q') || store.get('room-q') || 'mid';
if (!QUALITY[quality]) quality = 'mid';
const shotName = Q.get('shot');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: !!shotName, powerPreference: 'high-performance' });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.prepend(renderer.domElement);
setAnisotropy(renderer.capabilities.getMaxAnisotropy());
RectAreaLightUniformsLib.init();
const pmrem = new THREE.PMREMGenerator(renderer);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, 1, 0.05, 3000);
scene.add(camera);

// ── 하늘(코드로 그린 그라데이션·해·구름) ──────────────────────────────────
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { zenith: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, sunCol: { value: new THREE.Color() }, sunDir: { value: new THREE.Vector3() }, level: { value: 1 }, clouds: { value: 0.5 }, night: { value: 0 }, disc: { value: 1 } },
  vertexShader: 'varying vec3 vD; void main(){ vD = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    varying vec3 vD; uniform vec3 zenith, horizon, sunCol, sunDir; uniform float level, clouds, night, disc;
    float h2(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.-2.*f); return mix(mix(h2(i),h2(i+vec2(1,0)),f.x), mix(h2(i+vec2(0,1)),h2(i+vec2(1,1)),f.x), f.y); }
    float fbm(vec2 p){ float s=0., a=.5; for(int i=0;i<5;i++){ s+=a*vn(p); p=p*2.03+7.1; a*=.5; } return s; }
    void main(){
      vec3 d = normalize(vD); float up = max(d.y, 0.0);
      vec3 col = mix(horizon, zenith, pow(up, 0.42));
      col = mix(col, horizon * 0.75, smoothstep(0.0, -0.25, d.y));
      float sd = max(dot(d, sunDir), 0.0);
      col += sunCol * (pow(sd, 6.0) * 0.14 + pow(sd, 48.0) * 0.5 + pow(sd, 600.0) * 2.5) * (1.0 - night * 0.8);
      col += sunCol * smoothstep(0.9993, 0.9997, sd) * mix(30.0, 3.0, night) * disc;
      vec2 uv = d.xz / (d.y + 0.22) * 1.1;
      float n = fbm(uv + vec2(3.1, 1.7));
      float cl = smoothstep(0.48, 0.82, n) * smoothstep(0.015, 0.22, d.y) * clouds;
      vec3 cc = mix(horizon * 1.08 + 0.04, sunCol * 1.25, pow(sd, 2.5) * 0.7);
      col = mix(col, cc, cl * 0.8);
      float st = step(0.9985, h2(floor(d.xz / (abs(d.y) + 0.3) * 260.0))) * smoothstep(0.05, 0.4, d.y) * night;
      col += vec3(st) * 1.2 * (1.0 - cl);
      gl_FragColor = vec4(col * level, 1.0);
    }` });
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 32, 16), skyMat);
sky.frustumCulled = false; scene.add(sky);

// ── 창밖: 먼 건물 실루엣(코드로 만든 상자와 창 불빛) ───────────────────────
const outside = new THREE.Group(); scene.add(outside);
const cityMat = new THREE.MeshStandardMaterial({ roughness: 0.9, emissive: 0xffc27a, emissiveIntensity: 0, envMapIntensity: 0 });
const cityMats = [cityMat];
function buildOutside(view, elevation, W, D) {
  outside.traverse((o) => { if (o.isMesh && o.geometry) o.geometry.dispose(); }); outside.clear(); outside.userData.unlit = [];
  if (view === 'none') return;
  const unlit = (mesh) => { mesh.userData.base = mesh.material.color.clone(); outside.userData.unlit.push(mesh); outside.add(mesh); };
  const ground = new THREE.Mesh(new THREE.CircleGeometry(1400, 48), new THREE.MeshBasicMaterial({ color: view === 'garden' ? 0x566a40 : 0x77736a }));   // 방 안 조명에 물들지 않게 빛 계산에서 뺀다
  ground.rotation.x = -Math.PI / 2; ground.position.set(W / 2, -elevation, D / 2); unlit(ground);
  // 먼 산 능선
  const hg = new THREE.CylinderGeometry(1250, 1250, 1, 120, 1, true), hp = hg.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const a = Math.atan2(hp.getZ(i), hp.getX(i));
    hp.setY(i, hp.getY(i) > 0 ? -elevation + 55 + 60 * Math.sin(a * 3 + 1) + 38 * Math.sin(a * 7 + 2.3) + 22 * Math.sin(a * 17 + 0.7) + 12 * Math.sin(a * 41) : -elevation - 2);
  }
  const hills = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({ color: view === 'garden' ? 0x4d6247 : 0x5d6b66, side: THREE.BackSide }));
  hills.position.set(W / 2, 0, D / 2); unlit(hills);
  if (view !== 'city') return;
  if (!cityMat.emissiveMap) {      // 건물 겉면(층 띠와 창)과 밤 불빛을 캔버스에 그린다
    const cw = 256, ch = 512, cols = 12, rowsN = 24, mk = () => { const c = document.createElement('canvas'); c.width = cw; c.height = ch; return c; };
    const day = mk(), lit = mk(), gd = day.getContext('2d'), gl = lit.getContext('2d');
    let k = 7; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;
    gd.fillStyle = '#e9e6df'; gd.fillRect(0, 0, cw, ch); gl.fillStyle = '#000'; gl.fillRect(0, 0, cw, ch);
    const fw = cw / cols, fh = ch / rowsN;
    for (let y = 0; y < rowsN; y++) {
      gd.fillStyle = 'rgba(120,118,112,0.55)'; gd.fillRect(0, y * fh, cw, 2.5);            // 층 띠
      for (let x = 0; x < cols; x++) {
        const wide = x % 3 !== 2, wx = x * fw + 3, ww = wide ? fw - 5 : fw - 10, wy = y * fh + 6, wh = fh - 10;
        gd.fillStyle = `rgba(${48 + r() * 30 | 0},${62 + r() * 30 | 0},${80 + r() * 30 | 0},0.92)`; gd.fillRect(wx, wy, ww, wh);
        gd.fillStyle = 'rgba(255,255,255,0.18)'; gd.fillRect(wx, wy, ww, 2);
        if (r() < 0.26) { gl.fillStyle = `rgba(255,${185 + r() * 55 | 0},${110 + r() * 90 | 0},${0.45 + r() * 0.55})`; gl.fillRect(wx, wy, ww, wh); }
      }
    }
    cityMat.map = new THREE.CanvasTexture(day); cityMat.map.colorSpace = THREE.SRGBColorSpace; cityMat.map.anisotropy = 8;
    cityMat.emissiveMap = new THREE.CanvasTexture(lit);
    const low = cityMat.clone();           // 낮은 건물: 같은 그림을 몇 층만큼만 쓴다
    for (const key of ['map', 'emissiveMap']) { low[key] = cityMat[key].clone(); low[key].repeat.set(0.42, 0.17); low[key].needsUpdate = true; }
    cityMats.push(low);
  }
  const mtx = new THREE.Matrix4(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  let k = 99; const r = () => (k = (k * 16807) % 2147483647) / 2147483647;
  const put = (inst, i, a, dist, w, h, d, rot, light) => {
    mtx.compose(new THREE.Vector3(W / 2 + Math.cos(a) * dist, -elevation + h / 2, D / 2 + Math.sin(a) * dist), new THREE.Quaternion().setFromAxisAngle(up, rot), new THREE.Vector3(w, h, d));
    inst.setMatrixAt(i, mtx); inst.setColorAt(i, col.setHSL(0.08 + r() * 0.05, 0.05 + r() * 0.05, light));
  };
  const nA = 90, apt = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMats[0], nA);      // 판 모양 아파트: 단지별로 같은 방향
  for (let i = 0; i < nA;) {
    const a = r() * Math.PI * 2, dist = 190 + r() * 620, rot = (r() < 0.5 ? 0 : Math.PI / 2) + (r() - 0.5) * 0.5, n = 2 + Math.floor(r() * 4), h = 40 + r() * 42, light = 0.58 + r() * 0.2;
    for (let j = 0; j < n && i < nA; j++, i++) put(apt, i, a + (j * 62) / dist * (r() < 0.5 ? 1 : 0.6), dist + (j % 2) * 34, 44 + r() * 20, h * (0.85 + r() * 0.2), 12 + r() * 2, rot, light);
  }
  const nL = 320, low = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), cityMats[1], nL);
  for (let i = 0; i < nL; i++) put(low, i, r() * Math.PI * 2, 110 + r() * 850, 10 + r() * 18, 6 + r() * r() * 14, 9 + r() * 14, r() * 1.57, 0.4 + r() * 0.3);
  outside.add(apt, low);
}

// ── 후처리 ────────────────────────────────────────────────────────────────
const GradeShader = {
  uniforms: { tDiffuse: { value: null }, warmth: { value: 0 }, contrast: { value: 1 }, saturation: { value: 1 }, vignette: { value: 0.32 }, grain: { value: 0.022 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    varying vec2 vUv; uniform sampler2D tDiffuse; uniform float warmth, contrast, saturation, vignette, grain;
    float h(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec3 c = texture2D(tDiffuse, vUv).rgb;
      c = (c - 0.5) * contrast + 0.5;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, saturation);
      c += warmth * vec3(0.9, 0.25, -0.8) * smoothstep(0.25, 0.95, l) * 0.5;      // 밝은 곳은 따뜻하게
      c += vec3(-0.012, 0.0, 0.02) * (1.0 - smoothstep(0.0, 0.45, l));             // 어두운 곳은 살짝 차게
      c *= 1.0 - vignette * pow(length(vUv - 0.5) * 1.3, 2.6);
      c += (h(vUv * 917.0) - 0.5) * grain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }` };
let composer = null, grade = null, gtao = null;
function setupPost() {
  const q = QUALITY[quality];
  renderer.setPixelRatio(shotName ? 1 : Math.min(window.devicePixelRatio || 1, q.pr));
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  composer = null; gtao = null;
  if (!q.post) return;
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 }));
  composer.addPass(new RenderPass(scene, camera));
  if (q.ao) {
    gtao = new GTAOPass(scene, camera, size.x, size.y);
    gtao.updateGtaoMaterial({ radius: 0.32, distanceExponent: 1.2, thickness: 1.2, scale: 1.15, samples: q.ao });
    gtao.blendIntensity = 0.9; composer.addPass(gtao);
  }
  composer.addPass(new UnrealBloomPass(size.clone().multiplyScalar(0.5), 0.14, 0.7, 1.0));
  composer.addPass(new OutputPass());
  grade = new ShaderPass(GradeShader); composer.addPass(grade);
  applyGrade();
}
function applyGrade() {
  if (!grade || !T) return;
  const g = (STYLES[styleName] || STYLES['wood-minimal']).grade;
  grade.uniforms.warmth.value = g.warmth + (T.el > 0 && T.el < 14 ? 0.03 : 0);
  grade.uniforms.contrast.value = g.contrast; grade.uniforms.saturation.value = g.saturation;
}

// ── 장면 만들기 ───────────────────────────────────────────────────────────
let spec = null, specText = '', roomName = Q.get('room') || '';
let hours = 12.5, season = 'spring', styleName = 'wood-minimal';
let world = null, room = null, fur = null, colliders = [], lightGroup = null, fixtures = null, T = null, litState = null;
const sun = new THREE.DirectionalLight(); sun.castShadow = true; scene.add(sun, sun.target);
const ambient = new THREE.HemisphereLight(); scene.add(ambient);
const SHADE = 0.6;          // 갓이 있는 스탠드는 갓이 빛을 가린다. 같은 루멘의 맨 전구보다 어둡게(가까운 책상이 하얗게 날아가지 않게)
const isOn = (l) => (l.on === true || l.on === 'always' ? true : l.on === false || l.on === 'never' ? false : T.lamps);
const lumensOf = (l) => l.lumens ?? (l.power ?? 1) * 3000;
const colorOf = (l) => (l.color ? new THREE.Color(l.color) : kelvin(l.temp ?? 3500));

// 방과 가구(도형)를 다시 만든다. 사양·스타일이 바뀌었을 때만.
function buildGeometry() {
  T = sunState(hours, season, +spec.environment?.north || 0);
  if (world) { scene.remove(world); world.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
  clearMaterials();
  world = new THREE.Group(); scene.add(world);
  room = buildRoom(spec, styleName);
  fur = buildFurniture(spec, styleName, T.lamps); litState = T.lamps;
  fur.group.children.forEach((g, i) => { g.userData.drag = { kind: 'f', i }; });
  room.blocks.children.forEach((g, i) => { g.userData.drag = { kind: 'b', i }; });
  fixtures = new THREE.Group(); room.group.add(fixtures);
  world.add(room.group, fur.group);
  colliders = fur.colliders.concat((spec.room.blocks || []).map((b) => ({ x0: b.x, x1: b.x + b.w, z0: b.z, z1: b.z + b.d })), room.solids, room.outs);
  const env = spec.environment || {};
  buildOutside(env.view ?? 'city', env.elevation ?? 12, room.W, room.D);
  relight(); updateCutaway(true); showSelection();
}

// 빛만 다시 계산한다. 시각·계절·조명을 바꿀 때마다(가볍다).
function relight() {
  T = sunState(hours, season, +spec.environment?.north || 0);
  if (T.lamps !== litState) return buildGeometry();          // 모니터 화면처럼 밤에만 켜지는 것이 있어 다시 만든다
  const q = QUALITY[quality], { W, D, H } = room, env = spec.environment || {};
  const center = new THREE.Vector3(W / 2, H / 2, D / 2);

  const sunCol = new THREE.Color().setRGB(...T.sun);
  sun.color.copy(sunCol); sun.intensity = T.sunI;
  sun.position.copy(center).addScaledVector(T.dir, 30); sun.target.position.copy(center);
  const rad = Math.hypot(W, D, H) / 2 + 2.2, sc = sun.shadow.camera;
  sc.left = sc.bottom = -rad; sc.right = sc.top = rad; sc.near = 1; sc.far = 60; sc.updateProjectionMatrix();
  if (sun.shadow.mapSize.x !== q.shadow) { sun.shadow.mapSize.setScalar(q.shadow); sun.shadow.map?.dispose(); sun.shadow.map = null; }
  sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.02; sun.shadow.radius = 2.5;

  skyMat.uniforms.zenith.value.copy(T.zenith); skyMat.uniforms.horizon.value.copy(T.horizon);
  skyMat.uniforms.sunCol.value.copy(sunCol); skyMat.uniforms.sunDir.value.copy(T.dir);
  skyMat.uniforms.level.value = T.sky; skyMat.uniforms.clouds.value = T.clouds; skyMat.uniforms.night.value = T.night;
  sky.position.copy(center);
  scene.fog = new THREE.FogExp2(T.horizon.clone().multiplyScalar(T.sky * 0.8), 0.0009);
  for (const cm2 of cityMats) cm2.emissiveIntensity = 1.2 * T.night;
  for (const o of outside.userData.unlit || []) o.material.color.copy(o.userData.base).multiply(T.horizon.clone().lerp(new THREE.Color(1, 1, 1), 0.45)).multiplyScalar(Math.min(1, T.sky) * mix(1.25, 0.08, T.night));   // 땅과 산은 하늘 밝기를 따라간다
  renderer.toneMappingExposure = T.exp * (env.exposure ?? 1);

  if (lightGroup) { lightGroup.traverse((o) => { if (o.isLight) o.dispose(); }); scene.remove(lightGroup); }
  lightGroup = new THREE.Group(); scene.add(lightGroup);
  fixtures.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); }); fixtures.clear();

  const wallCol = new THREE.Color(resolveMaterial(spec.room.wall ?? '@wall', spec, styleName).color);
  const floorCol = new THREE.Color(resolveMaterial(spec.room.floor ?? '@floor', spec, styleName).color);
  const fillCol = new THREE.Color().setRGB(...T.fill);
  // 켜진 등이 방 전체에 보태는 간접광(루멘 합에 비례, 방 넓이로 나눈다)
  const lampLm = (spec.lights || []).filter(isOn).reduce((s, l) => s + lumensOf(l), 0)
    + fur.lights.filter((l) => l.lamp && (l.always || T.lamps)).reduce((s, l) => s + l.lumens, 0);
  const inside = Math.min(0.5, (lampLm / 3000) * 0.085 * (8 / (W * D)));
  ambient.color.copy(fillCol).lerp(wallCol, 0.5); ambient.groundColor.copy(floorCol).lerp(wallCol, 0.7).lerp(fillCol, 0.25);
  ambient.intensity = T.amb * 1.5 + inside * 1.4;

  const envScene = new THREE.Scene();     // 반사·간접광용 작은 방(창 쪽이 밝다)
  const ambK = T.amb + inside;
  envScene.add(new THREE.Mesh(new THREE.BoxGeometry(W, H, D), new THREE.MeshBasicMaterial({ color: wallCol.clone().multiplyScalar(ambK * 0.55), side: THREE.BackSide })));
  const envFloor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshBasicMaterial({ color: floorCol.clone().multiplyScalar(ambK * 0.5) }));
  envFloor.rotation.x = -Math.PI / 2; envFloor.position.y = -H / 2 + 0.01; envScene.add(envFloor);
  const envGlow = (c, k, x, y, z) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), new THREE.MeshBasicMaterial({ color: c.clone().multiplyScalar(k) })); m.position.set(x - W / 2, y - H / 2, z - D / 2); envScene.add(m); };

  // 창으로 들어오는 하늘빛과, 햇빛이 닿은 자리에서 되비치는 빛
  const curtainOpen = (w) => { const o = (spec.openings || []).find((o) => o.type === 'window' && o.wall === w.wall && Math.abs(o.offset - w.a) < 1e-6) || (/^P/.test(w.wall) ? w.spec : null);
    return !o || !o.curtain || o.curtain === 'none' ? 1 : o.curtain === 'sheer' ? 0.6 + 0.4 * (o.curtainOpen ?? 0.5) : Math.max(0.03, o.curtainOpen ?? 0.5); };
  // 집 전체는 창이 많다. 면 조명은 비싸서 큰 창 몇 개에만 쓰고(밤에는 하나), 나머지 창은 낮에만 싼 점 조명으로 대신한다
  const rectMax = room.cut == null ? Infinity : T.fillI < 1 ? 1 : 3;
  const rectWin = new Set([...room.windows].sort((a, b) => b.width * b.height * curtainOpen(b) - a.width * a.height * curtainOpen(a)).slice(0, rectMax));
  for (const w of room.windows) {
    const open = curtainOpen(w);
    if (rectWin.has(w)) {
      const ra = new THREE.RectAreaLight(fillCol, T.fillI * 0.45 * open, w.width, w.height);
      ra.position.copy(w.center).addScaledVector(w.inward, 0.12); ra.lookAt(w.center.clone().addScaledVector(w.inward, 2)); lightGroup.add(ra);
    } else if (T.fillI >= 1) {
      const pl = new THREE.PointLight(fillCol, T.fillI * 0.45 * open * w.width * w.height * 0.5, 0, 2);
      pl.position.copy(w.center).addScaledVector(w.inward, 0.9); lightGroup.add(pl);
    }
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w.width * open, w.height), new THREE.MeshBasicMaterial({ color: fillCol.clone().multiplyScalar(T.sky * 0.7), side: THREE.DoubleSide }));
    pane.position.copy(w.center).sub(center).addScaledVector(w.inward, 0.2); pane.lookAt(pane.position.clone().add(w.inward)); envScene.add(pane);
    const dir = T.dir.clone().negate();
    if (T.el > 0 && dir.dot(w.inward) > 0.05) {
      let t = Infinity, surf = floorCol;
      const hit = (tt, c) => { if (tt > 0.05 && tt < t) { t = tt; surf = c; } };
      hit(-w.center.y / dir.y, floorCol);
      if (dir.x) { hit((0 - w.center.x) / dir.x, wallCol); hit((W - w.center.x) / dir.x, wallCol); }
      if (dir.z) { hit((0 - w.center.z) / dir.z, wallCol); hit((D - w.center.z) / dir.z, wallCol); }
      if (room.cut != null) t = Math.min(t, 3.2);
      const p = w.center.clone().addScaledVector(dir, Math.max(0.2, t - 0.3));
      p.x = Math.min(W - 0.25, Math.max(0.25, p.x)); p.z = Math.min(D - 0.25, Math.max(0.25, p.z)); p.y = Math.min(H - 0.3, Math.max(0.3, p.y));
      const b = new THREE.PointLight(sunCol.clone().multiply(surf), T.sunI * 0.11 * w.width * w.height * open * dir.dot(w.inward), 0, 2);
      b.position.copy(p); lightGroup.add(b);
    }
  }

  // 설치한 조명(spec.lights). 루멘과 색온도(또는 색)로 밝기와 색이 정해진다.
  let shadows = 0;
  (spec.lights || []).forEach((l, i) => {
    const on = isOn(l), c = colorOf(l), I = lumensOf(l) * LM, type = l.type || 'ceiling';
    const fx = new THREE.Group(); fx.position.set(l.x, 0, l.z); fx.userData.drag = { kind: 'l', i }; fixtures.add(fx);
    const glowMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8, emissive: c, emissiveIntensity: on ? Math.min(3, 0.7 + I / 9) : 0, roughness: 0.6 });
    const add = (geo, m, y, tag) => { const mesh = new THREE.Mesh(geo, m); mesh.position.y = y; mesh.castShadow = false; fx.add(mesh); return mesh; };
    const body = new THREE.MeshStandardMaterial({ color: 0x232427, roughness: 0.5, metalness: 0.4 });
    if (type === 'stand') {                       // 바닥 스탠드
      add(new THREE.CylinderGeometry(0.13, 0.14, 0.02, 32), body, 0.01); add(new THREE.CylinderGeometry(0.011, 0.011, 1.25, 10), body, 0.64);
      glowMat.side = THREE.DoubleSide; glowMat.color.set(0xe9dfcc);
      add(new THREE.CylinderGeometry(0.12, 0.17, 0.26, 32, 1, true), glowMat, 1.37);
      if (on) { const p = new THREE.PointLight(c, I * SHADE, 0, 2); p.position.set(l.x, 1.36, l.z); lightGroup.add(p); envGlow(c, I * SHADE * 0.25, l.x, 1.36, l.z); }
    } else if (type === 'point') {                // 높이를 정해 다는 전구(벽등·책상등 대신)
      const y = Math.min(H - 0.08, Math.max(0.1, l.y ?? 1.2));
      add(new THREE.SphereGeometry(0.045, 20, 14), glowMat, y); add(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 12), body, y + 0.055);
      if (on) { const p = new THREE.PointLight(c, I, 0, 2); p.position.set(l.x, y, l.z); lightGroup.add(p); envGlow(c, I * 0.25, l.x, y, l.z); }
    } else {                                      // 천장등
      add(new THREE.CylinderGeometry(0.17, 0.17, 0.035, 40), glowMat, H - 0.018, 'C');
      add(new THREE.CylinderGeometry(0.185, 0.185, 0.02, 40), new THREE.MeshStandardMaterial({ color: 0xdedbd4, roughness: 0.5 }), H - 0.01, 'C');
      if (on) {
        const sp = new THREE.SpotLight(c, I * 0.84, 0, 1.32, 1, 2);
        sp.position.set(l.x, H - 0.06, l.z); sp.target.position.set(l.x, 0, l.z);
        sp.castShadow = quality !== 'low' && shadows++ < 2; sp.shadow.mapSize.setScalar(1024); sp.shadow.bias = -0.0006; sp.shadow.radius = 4; sp.shadow.camera.near = 0.1;
        const p = new THREE.PointLight(c, I * 0.18, 0, 2); p.position.set(l.x, H - 0.4, l.z);
        lightGroup.add(sp, sp.target, p); envGlow(c, I * 0.33, l.x, H - 0.2, l.z);
      }
    }
  });
  // 가구로 놓은 스탠드와 모니터 불빛
  for (const l of fur.lights) {
    const on = !l.lamp || l.always || T.lamps;
    if (l.shade) l.shade.emissiveIntensity = on ? 1.5 : 0;
    if (!on) continue;
    const p = new THREE.PointLight(l.color ?? kelvin(l.temp ?? 2700), l.lamp ? l.lumens * LM * SHADE : 4.5 * l.power, l.range ?? 0, 2);
    p.position.copy(l.position); lightGroup.add(p);
  }
  scene.environment?.dispose();
  scene.environment = pmrem.fromScene(envScene, 0.03).texture; scene.environmentIntensity = 1;
  envScene.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  ambBase = ambient.intensity;
  applyGrade(); updateCutaway(true); syncUI();
  clearTimeout(probeTimer);
  if (shotName) refreshProbe(); else probeTimer = setTimeout(refreshProbe, 170);     // 게이지를 끄는 동안은 가벼운 근사, 멈추면 정밀하게
}
// 방 한가운데에서 사방을 찍어 환경맵으로 쓴다. 창으로 든 햇빛이 바닥·벽에 닿아 방 전체로 번지는 것과 바닥·책상의 비침이 여기서 나온다.
const probeRT = new THREE.WebGLCubeRenderTarget(128, { type: THREE.HalfFloatType });
const probeCam = new THREE.CubeCamera(0.05, 3000, probeRT);
let probeTimer = 0, ambBase = 0;
function refreshProbe() {
  if (!room || quality === 'low') return;
  const { W, D, H } = room, y = Math.min(H - 0.35, 1.3);
  let px = W / 2, pz = D / 2;                       // 가구 속이면 옆으로 비킨다
  for (const [dx, dz] of [[0, 0], [0.5, 0], [-0.5, 0], [0, 0.5], [0, -0.5], [0.5, 0.5], [-0.5, -0.5]]) {
    const x = W / 2 + dx, z = D / 2 + dz;
    if (x > 0.3 && x < W - 0.3 && z > 0.3 && z < D - 0.3 && !colliders.some((c) => x > c.x0 - 0.1 && x < c.x1 + 0.1 && z > c.z0 - 0.1 && z < c.z1 + 0.1)) { px = x; pz = z; break; }
  }
  updateCutaway(true, true); if (selBox) selBox.visible = false; skyMat.uniforms.disc.value = 0;
  ambient.intensity = ambBase;
  probeCam.position.set(px, y, pz); probeCam.update(renderer, scene);
  skyMat.uniforms.disc.value = 1; if (selBox) selBox.visible = true;
  const tex = pmrem.fromCubemap(probeRT.texture).texture;
  scene.environment?.dispose(); scene.environment = tex; scene.environmentIntensity = 0.8;
  ambient.intensity = ambBase * 0.45;               // 바운스 빛을 환경맵이 맡으므로 고른 보조광은 줄인다
  updateCutaway(true);
}
let relightQueued = false;
const relightSoon = () => { if (relightQueued) return; relightQueued = true; requestAnimationFrame(() => { relightQueued = false; relight(); }); };

// ── 시점: 걸어 다니기 / 내려다보기 ────────────────────────────────────────
const view = { mode: 'walk', x: 1, z: 1, y: 1.5, yaw: 180, pitch: 0, oAz: 35, oEl: 52, oDist: 0 };
function setView(name) {
  const { W, D } = room;
  view.goal = null;
  if (name === 'overview') { view.mode = 'overview'; view.oDist = Math.max(W, D) * 1.55 + 2.2; return; }
  view.mode = 'walk';
  const v = (spec.views || []).find((v) => v.name === name) || (spec.views || [])[Number(name)] || spec.start || { x: W / 2, z: D / 2, yaw: 180 };
  Object.assign(view, { x: v.x, z: v.z, y: v.y ?? 1.5, yaw: v.yaw ?? 180, pitch: v.pitch ?? 0 });
}
function goArea(a) {            // 그 구역 안의 빈자리에 서서 안에서 본다
  const cx = a.x + (a.w || 0) / 2, cz = a.z + (a.d || 0) / 2, r = 0.3;
  const free = (x, z) => x > r && x < room.W - r && z > r && z < room.D - r && !colliders.some((c) => x > c.x0 - r && x < c.x1 + r && z > c.z0 - r && z < c.z1 + r);
  // 가구·벽에서 넉넉히 떨어진 자리 가운데, 보는 방향(yaw)의 반대쪽으로 물러선 곳을 고른다(방이 한눈에 들어오게)
  const yaw = (a.yaw ?? view.yaw) * Math.PI / 180, fx = Math.sin(yaw), fz = -Math.cos(yaw);
  const clear = (x, z) => { let m = Math.min(x - a.x, a.x + a.w - x, z - a.z, a.z + a.d - z); for (const c of colliders) m = Math.min(m, Math.hypot(Math.max(c.x0 - x, 0, x - c.x1), Math.max(c.z0 - z, 0, z - c.z1))); return m; };
  let best = [cx, cz], bs = -1e9;
  for (let x = a.x + 0.35; x <= a.x + (a.w || 0) - 0.35; x += 0.15) for (let z = a.z + 0.35; z <= a.z + (a.d || 0) - 0.35; z += 0.15) {
    if (!free(x, z)) continue;
    const s = Math.min(clear(x, z), 0.7) * 3 - ((x - cx) * fx + (z - cz) * fz) * 0.8 - Math.hypot(x - cx, z - cz) * 0.2;
    if (s > bs) { bs = s; best = [x, z]; }
  }
  view.mode = 'walk'; view.goal = null; Object.assign(view, { x: best[0], z: best[1], y: 1.5, pitch: -8, yaw: a.yaw ?? view.yaw });
}
// 그리는 데 걸리는 시간 재기(개발용): 콘솔에서 __bench() → 한 장당 ms
window.__bench = (n = 20) => { const gl = renderer.getContext(), px = new Uint8Array(4); const t0 = performance.now(); for (let i = 0; i < n; i++) { placeCamera(); if (composer) composer.render(); else renderer.render(scene, camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return +((performance.now() - t0) / n).toFixed(1); };
const hiddenMat = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, shadowSide: THREE.DoubleSide });   // 걷어낸 벽도 그림자는 양면으로(안 그러면 벽에 붙은 면에 해가 샌다)
let cutKey = '';
function updateCutaway(force, none) {    // 내려다볼 때 천장과 카메라 쪽 벽을 걷어낸다(그림자는 그대로). none 이면 전부 보이게
  const hide = new Set();
  if (!none && view.mode === 'overview') {
    hide.add('C'); hide.add('H'); const a = (view.oAz * Math.PI) / 180, cx = Math.sin(a), cz = Math.cos(a);
    if (cz > 0.3) hide.add('S'); if (cz < -0.3) hide.add('N'); if (cx > 0.3) hide.add('E'); if (cx < -0.3) hide.add('W');
  }
  const cut = !none && view.mode === 'overview' && room.cut != null;      // 집 전체: 남은 벽도 허리 높이에서 잘라 방 안이 다 보이게
  const key = [...hide].join('') + (cut ? '+cut' : '');
  if (key === cutKey && !force) return;
  cutKey = key;
  room.group.traverse((o) => {
    const w = o.userData.wall, up = o.userData.upper;
    if (o.userData.cutCap) { o.visible = cut && !hide.has(w); return; }
    if (!w && !up) return;
    const gone = (w && hide.has(w)) || (up && cut);
    if (o.isMesh) { o.userData.mat ??= o.material; o.material = gone ? hiddenMat : o.userData.mat; }
    else o.visible = !gone;
  });
}
function placeCamera() {
  const { W, D, H } = room;
  if (view.mode === 'overview') {
    const a = (view.oAz * Math.PI) / 180, e = (view.oEl * Math.PI) / 180, c = new THREE.Vector3(W / 2, H * 0.35, D / 2);
    camera.position.set(c.x + Math.sin(a) * Math.cos(e) * view.oDist, c.y + Math.sin(e) * view.oDist, c.z + Math.cos(a) * Math.cos(e) * view.oDist);
    camera.fov = 40; camera.lookAt(c);
  } else {
    camera.position.set(view.x, view.y, view.z); camera.fov = 68;
    camera.rotation.set((view.pitch * Math.PI) / 180, (-view.yaw * Math.PI) / 180, 0, 'YXZ');
  }
  camera.updateProjectionMatrix(); updateCutaway();
}

// ── 저장: 화면에서 바꾼 것(조명, 가구 위치, 커튼)을 room.json 에 적는다 ──────
let saveTimer = 0;
function save() {
  if (shotName) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = 0;
    const text = JSON.stringify(spec, null, 2) + '\n';
    try {
      const cur = await loadSpec();                 // AI 가 그 사이 파일을 고쳤으면 덮어쓰지 않고 그쪽을 따른다
      if (cur !== specText) return adoptExternal(cur, 'AI가 먼저 고친 내용을 반영했어 · 방금 바꾼 건 다시 해 줘', 4200);
      const r = await fetch(`/__save?room=${encodeURIComponent(roomName)}`, { method: 'POST', body: text }); if (!r.ok) throw new Error(await r.text());
      specText = text; $('msg').hidden = true; flash('저장됨');
    } catch (e) { fail(new Error('저장 실패: ' + offline(e))); }
  }, 500);
}
const offline = (e) => (e instanceof TypeError ? '미리보기 서버가 꺼져 있어. "방 열기"를 다시 실행해 줘.' : e.message || String(e));
function adoptExternal(t, note, ms) {      // 바깥(AI)에서 바뀐 room.json 을 받아들인다. 고른 것과 되돌리기 기록은 옛 내용 기준이라 비운다
  applySpec(t); selected = null; undoStack.length = 0;
  buildGeometry(); renderPanels(); syncUI(); $('msg').hidden = true; flash(note, ms);
}

// ── 내려다보기에서 가구·조명을 끌어 옮기기 ────────────────────────────────
const ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
let selected = null, selBox = null, dragging = null, editing = false;
const undoStack = [];
const pushUndo = (snap) => { undoStack.push(snap ?? JSON.stringify(spec)); if (undoStack.length > 40) undoStack.shift(); };
function undo() {
  const snap = undoStack.pop(); if (!snap) return;
  spec = JSON.parse(snap); selected = null; if (!Q.get('style') && STYLES[spec.style]) styleName = spec.style;
  buildGeometry(); renderPanels(); syncUI(); save();
}
function setEditing(on) {
  editing = on; document.body.classList.toggle('editing', on);
  if (!on) { select(null); cv.style.cursor = ''; }
  syncChrome(); if (on && tab === 'room') drawPlan();
}
const targetOf = (d) => (d ? (d.kind === 'f' ? fur.group.children[d.i] : d.kind === 'b' ? room.blocks.children[d.i] : fixtures.children[d.i]) : null);
function showSelection() {
  if (selBox) { scene.remove(selBox); selBox.geometry.dispose(); selBox = null; }
  const obj = targetOf(selected); if (!obj) { selected = null; return; }
  selBox = new THREE.BoxHelper(obj, 0xffffff); selBox.material.transparent = true; selBox.material.opacity = 0.75; scene.add(selBox);
}
function select(d) {
  selected = d; if (room) showSelection();
  if (d && spec) { tab = TAB_OF[d.kind]; if (!editing) { editing = true; document.body.classList.add('editing'); } }
  if (spec) { renderFurnTab(); markLights(); drawPlan(); }
  syncChrome();
}
function pick(e) {
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ptr, camera);
  for (const h of ray.intersectObjects([fur.group, fixtures, room.blocks], true)) {
    for (let o = h.object; o; o = o.parent) if (o.userData.drag) return { data: o.userData.drag, obj: o, point: h.point };
  }
  return null;
}
function dragMove(e) {
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ptr, camera);
  const p = ray.ray.intersectPlane(dragging.plane, new THREE.Vector3()); if (!p) return;
  const { W, D } = room, d = dragging.data;
  let x = Math.round((p.x + dragging.off.x) * 100) / 100, z = Math.round((p.z + dragging.off.z) * 100) / 100;
  if (d.kind === 'b') {              // 벽 덩어리: 벽 가까이 가면 붙는다
    const b = spec.room.blocks[d.i];
    let bx = Math.min(W - b.w, Math.max(0, x - b.w / 2)), bz = Math.min(D - b.d, Math.max(0, z - b.d / 2));
    if (bx < 0.06) bx = 0; if (W - b.w - bx < 0.06) bx = W - b.w; if (bz < 0.06) bz = 0; if (D - b.d - bz < 0.06) bz = D - b.d;
    dragging.obj.position.x = bx + b.w / 2; dragging.obj.position.z = bz + b.d / 2;
    dragging.x = bx; dragging.z = bz; dragging.moved = true; selBox?.update(); return;
  }
  if (d.kind === 'f') {
    const fp = footprint(spec.furniture[d.i]);
    x = Math.min(W - fp.sx / 2 - 0.005, Math.max(fp.sx / 2 + 0.005, x)); z = Math.min(D - fp.sz / 2 - 0.005, Math.max(fp.sz / 2 + 0.005, z));
    dragging.obj.position.x = x; dragging.obj.position.z = z;
  } else {
    x = Math.min(W - 0.1, Math.max(0.1, x)); z = Math.min(D - 0.1, Math.max(0.1, z));
    Object.assign(spec.lights[d.i], { x, z }); relightSoon();
  }
  dragging.x = x; dragging.z = z; dragging.moved = true; selBox?.update();
}
function dragEnd() {
  const d = dragging; dragging = null; renderer.domElement.style.cursor = '';
  if (!d || !d.moved) return;
  pushUndo(d.snap);
  if (d.data.kind === 'f') { Object.assign(spec.furniture[d.data.i], { x: +d.x.toFixed(3), z: +d.z.toFixed(3) }); buildGeometry(); }
  if (d.data.kind === 'b') { Object.assign(spec.room.blocks[d.data.i], { x: +d.x.toFixed(3), z: +d.z.toFixed(3) }); buildGeometry(); renderRoomPanel(); }
  if (d.data.kind === 'l') showSelection();
  drawPlan(); syncChrome(); save();
}
function rotateSelected() {
  if (!selected || selected.kind !== 'f') return;
  pushUndo();
  const f = spec.furniture[selected.i]; f.facing = { N: 'E', E: 'S', S: 'W', W: 'N' }[f.facing || 'S'];
  const fp = footprint(f), { W, D } = room;
  f.x = +Math.min(W - fp.sx / 2 - 0.005, Math.max(fp.sx / 2 + 0.005, f.x)).toFixed(3); f.z = +Math.min(D - fp.sz / 2 - 0.005, Math.max(fp.sz / 2 + 0.005, f.z)).toFixed(3);
  buildGeometry(); save();
}

function nudge(dx, dz, dy = 0) {          // 방향키: 1cm(Shift 는 10cm). PageUp/Down 은 높이
  if (!selected) return;
  pushUndo();
  const { W, D, H } = room;
  if (selected.kind === 'b') {
    const b = spec.room.blocks[selected.i];
    b.x = +Math.min(W - b.w, Math.max(0, b.x + dx)).toFixed(3); b.z = +Math.min(D - b.d, Math.max(0, b.z + dz)).toFixed(3);
    buildGeometry(); renderRoomPanel(); save(); return;
  }
  if (selected.kind === 'f') {
    const f = spec.furniture[selected.i], fp = footprint(f);
    f.x = +Math.min(W - fp.sx / 2 - 0.005, Math.max(fp.sx / 2 + 0.005, f.x + dx)).toFixed(3);
    f.z = +Math.min(D - fp.sz / 2 - 0.005, Math.max(fp.sz / 2 + 0.005, f.z + dz)).toFixed(3);
    if (dy) f.y = +Math.min(H - fp.h, Math.max(0, (f.y ?? 0) + dy)).toFixed(3);
    buildGeometry();
  } else {
    const l = spec.lights[selected.i];
    l.x = +Math.min(W - 0.1, Math.max(0.1, l.x + dx)).toFixed(3); l.z = +Math.min(D - 0.1, Math.max(0.1, l.z + dz)).toFixed(3);
    if (dy && l.type === 'point') l.y = +Math.min(H - 0.08, Math.max(0.1, (l.y ?? 1.2) + dy)).toFixed(3);
    relight(); showSelection();
  }
  save(); syncChrome();
}
function removeSelected() {
  if (!selected) return;
  if (selected.kind === 'l') return removeLight(selected.i);
  if (selected.kind === 'b') { pushUndo(); spec.room.blocks.splice(selected.i, 1); selected = null; buildGeometry(); renderPanels(); return save(); }
  pushUndo(); spec.furniture.splice(selected.i, 1); selected = null; buildGeometry(); renderPanels(); save();
}

const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.code === 'Escape' && document.body.classList.contains('bare')) { document.body.classList.remove('bare'); return; }
  if (e.code === 'Escape' && (!$('help').hidden || !$('roomMenu').hidden)) { showHelp(false); $('roomMenu').hidden = true; return; }
  if (!room) return;
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
  if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') { e.preventDefault(); return undo(); }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (editing && selected) {
    const step = e.shiftKey ? 0.1 : 0.01;
    const mv = { ArrowLeft: [-step, 0, 0], ArrowRight: [step, 0, 0], ArrowUp: [0, -step, 0], ArrowDown: [0, step, 0], PageUp: [0, 0, step], PageDown: [0, 0, -step] }[e.code];
    if (mv) { e.preventDefault(); return nudge(...mv); }
    if (e.code === 'Delete' || e.code === 'Backspace') { e.preventDefault(); return removeSelected(); }
  }
  keys.add(e.code);
  const n = ['Digit1', 'Digit2', 'Digit3', 'Digit4'].indexOf(e.code);
  if (n >= 0) setTime(Object.values(PRESET)[n]);
  if (e.code === 'KeyO') toggleMode();
  if (e.code === 'KeyE') setEditing(!editing);
  if (e.code === 'KeyR') rotateSelected();
  if (e.code === 'Escape') { if (selected) select(null); else if (editing) setEditing(false); }
  if (e.code === 'KeyH') document.body.classList.toggle('bare');
});
addEventListener('keyup', (e) => keys.delete(e.code));
let drag = null;
const cv = renderer.domElement;
cv.addEventListener('pointerdown', (e) => {
  cv.setPointerCapture(e.pointerId); $('roomMenu').hidden = true; document.activeElement?.blur?.();
  if (editing) {
    const hit = pick(e);
    if (hit) {
      select(hit.data);
      dragging = { snap: JSON.stringify(spec), data: hit.data, obj: hit.obj, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -hit.point.y), off: new THREE.Vector3(hit.obj.position.x - hit.point.x, 0, hit.obj.position.z - hit.point.z) };
      cv.style.cursor = 'move'; return;
    }
    select(null);
  }
  drag = { x: e.clientX, y: e.clientY };
});
cv.addEventListener('pointerup', () => { drag = null; dragEnd(); });
cv.addEventListener('pointermove', (e) => {
  if (dragging) return dragMove(e);
  if (!drag) { if (editing && e.buttons === 0) cv.style.cursor = pick(e) ? 'move' : ''; return; }
  const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  if (view.mode === 'overview') { view.oAz -= dx * 0.3; view.oEl = Math.min(88, Math.max(15, view.oEl + dy * 0.25)); }
  else { view.yaw -= dx * 0.16; view.pitch = Math.min(80, Math.max(-80, view.pitch + dy * 0.16)); }
});
const goTo = (x, z) => { view.goal = { x: Math.min(room.W - 0.25, Math.max(0.25, x)), z: Math.min(room.D - 0.25, Math.max(0.25, z)) }; };
cv.addEventListener('wheel', (e) => {
  if (!room) return;
  if (view.mode === 'overview') { view.oDist = Math.min(30, Math.max(2.5, view.oDist * (1 + e.deltaY * 0.001))); return; }
  const a = (view.yaw * Math.PI) / 180, k = e.deltaY < 0 ? 0.45 : -0.45, g = view.goal || view;      // 안에서 볼 때 휠은 앞뒤로 걷기
  goTo(g.x + Math.sin(a) * k, g.z - Math.cos(a) * k);
}, { passive: true });
const floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
cv.addEventListener('dblclick', (e) => {             // 바닥을 더블클릭하면 그 자리로 걸어간다
  if (view.mode !== 'walk' || !room || (editing && pick(e))) return;
  ptr.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ptr, camera);
  const p = ray.ray.intersectPlane(floorPlane, new THREE.Vector3());
  if (p && p.distanceTo(camera.position) < 14) goTo(p.x, p.z);
});

function walk(dt) {
  if (view.mode !== 'walk' || !room) return;
  const f = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  const s = (keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0);
  if (keys.has('ArrowLeft')) view.yaw -= 70 * dt; if (keys.has('ArrowRight')) view.yaw += 70 * dt;
  const a = (view.yaw * Math.PI) / 180, sp = 1.6 * dt, r = 0.22;
  let nx, nz, want = 0;
  if (f || s) { view.goal = null; nx = view.x + (Math.sin(a) * f + Math.cos(a) * s) * sp; nz = view.z + (-Math.cos(a) * f + Math.sin(a) * s) * sp; }
  else if (view.goal) {
    const dx = view.goal.x - view.x, dz = view.goal.z - view.z, dist = Math.hypot(dx, dz);
    if (dist < 0.03) { view.goal = null; return; }
    want = Math.min(dist, 2.4 * dt); nx = view.x + (dx / dist) * want; nz = view.z + (dz / dist) * want;
  } else return;
  nx = Math.min(room.W - r, Math.max(r, nx)); nz = Math.min(room.D - r, Math.max(r, nz));
  for (const c of colliders) {
    if (nx > c.x0 - r && nx < c.x1 + r && nz > c.z0 - r && nz < c.z1 + r) {
      const px = Math.min(nx - (c.x0 - r), c.x1 + r - nx), pz = Math.min(nz - (c.z0 - r), c.z1 + r - nz);
      if (px < pz) nx = nx - (c.x0 - r) < c.x1 + r - nx ? c.x0 - r : c.x1 + r; else nz = nz - (c.z0 - r) < c.z1 + r - nz ? c.z0 - r : c.z1 + r;
    }
  }
  if (want && Math.hypot(nx - view.x, nz - view.z) < want * 0.25) view.goal = null;     // 가구에 막히면 멈춘다
  view.x = nx; view.z = nz;
}

// ── 화면: 위(방 이름) · 아래(시간, 보기, 꾸미기) · 오른쪽(꾸미기 패널) ─────────
const curtained = () => (spec.openings || []).filter((o) => o.type === 'window' && o.curtain && o.curtain !== 'none');
const KO = { desk: '책상', 'office-chair': '사무용 의자', monitor: '모니터', 'pc-case': 'PC 본체', keyboard: '키보드', 'air-purifier': '공기청정기', 'drawer-unit': '서랍장', nightstand: '협탁',
  bookcase: '책장', 'shelf-rack': '철제 선반', wardrobe: '옷장', bed: '침대', sofa: '소파', armchair: '1인 소파', 'coffee-table': '소파 테이블', table: '테이블', chair: '의자', tv: 'TV', 'tv-stand': 'TV장',
  rug: '러그', plant: '화분', 'floor-lamp': '스탠드(가구)', 'table-lamp': '탁상 스탠드', 'wall-art': '액자', mirror: '거울', box: '상자(직접 치수)' };
const TYPE_LABEL = { ceiling: '천장등', stand: '스탠드', point: '전구' };
const TAB_OF = { f: 'furn', l: 'light', b: 'room' };
const cm = (m) => Math.round(m * 100), clampN = (v, a, b) => Math.min(b, Math.max(a, v));
const furnName = (f) => f.name || KO[f.type] || f.type;
let tab = 'furn';

function selLabel() {
  if (!selected) return '';
  if (selected.kind === 'f') { const f = spec.furniture[selected.i]; if (!f) return ''; const fp = footprint(f); return `${furnName(f)} · ${cm(fp.w)}×${cm(fp.d)}×${cm(fp.h)}cm`; }
  if (selected.kind === 'l') { const l = spec.lights[selected.i]; return l ? `${TYPE_LABEL[l.type || 'ceiling']} · ${Math.round(lumensOf(l))}lm` : ''; }
  const b = spec.room.blocks?.[selected.i]; return b ? `기둥·벽 · ${cm(b.w)}×${cm(b.d)}cm` : '';
}
function syncChrome() {          // 패널·버튼·안내 문장을 지금 상태에 맞춘다
  if (!spec) return;
  $('panel').hidden = !editing; $('decor').classList.toggle('on', editing);
  $('decor').textContent = editing ? '꾸미기 끝내기' : '꾸미기';
  for (const b of $('tabs').querySelectorAll('[data-tab]')) { b.classList.toggle('on', b.dataset.tab === tab); $('tab-' + b.dataset.tab).hidden = b.dataset.tab !== tab; }
  for (const b of $('views').children) b.classList.toggle('on', (b.dataset.v === 'overview') === (view.mode === 'overview'));
  $('areaRow').hidden = !(spec.areas || []).some((a) => !a.outside); document.body.classList.toggle('areas', !$('areaRow').hidden);
  let t;
  if (editing && selected) t = `끌어서 옮기기 · 방향키 1cm <kbd>Shift</kbd> 10cm${selected.kind === 'f' ? ' · <kbd>R</kbd> 돌리기' : ''} · <kbd>Delete</kbd> 지우기`;
  else if (editing) t = '가구나 조명을 눌러서 고르고, 끌어서 옮겨 · 빈 곳을 끌면 둘러보기';
  else if (view.mode === 'overview') t = '끌어서 돌려 보기 · 휠로 확대';
  else t = '끌어서 둘러보기 · <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> 걷기 · 바닥을 더블클릭하면 그 자리로';
  $('hint').innerHTML = t;
  $('selInfo').textContent = selLabel();
  $('undo').disabled = !undoStack.length; $('undo').style.opacity = undoStack.length ? '' : '0.35';
}
function syncUI() {              // 시간·계절·커튼·조명 켜짐처럼 빛이 바뀔 때마다 맞출 것
  $('name').textContent = spec.name || roomName;
  if (document.activeElement !== $('time')) $('time').value = fmtTime(hours);
  if (document.activeElement !== $('timeSlider')) $('timeSlider').value = hours;
  for (const b of $('chips').children) b.classList.toggle('on', Math.abs(Number(b.dataset.h) - hours) < 0.26);
  for (const b of $('seasons').children) b.classList.toggle('on', b.dataset.s === season);
  for (const b of $('styles').children) b.classList.toggle('on', b.dataset.k === styleName);
  for (const b of $('qualities').children) b.classList.toggle('on', b.dataset.q === quality);
  const cw = curtained();
  $('curtainRow').hidden = !cw.length;
  $('curtainAdd').hidden = !!cw.length || !(spec.openings || []).some((o) => o.type === 'window');
  if (cw.length && document.activeElement !== $('curtain')) { $('curtain').value = cw[0].curtainOpen ?? 0.5; $('curtainOut').textContent = Math.round($('curtain').value * 100); }
  markLights(); syncChrome();
}
function markLights() {          // 자동일 때 지금 켜졌는지, 어느 것이 골라졌는지
  for (const row of $('lightList').children) {
    const l = (spec.lights || [])[row.dataset.i]; if (!l) continue;
    row.classList.toggle('off', !isOn(l)); row.classList.toggle('sel', selected?.kind === 'l' && selected.i === Number(row.dataset.i));
  }
}
let flashTimer = 0;
function flash(text, ms = 1400) { const s = $('saved'); s.textContent = text; s.classList.add('show'); clearTimeout(flashTimer); flashTimer = setTimeout(() => s.classList.remove('show'), ms); }
function openTab(name) { tab = name; if (!editing) setEditing(true); else syncChrome(); if (name === 'room') drawPlan(); }

// cm 숫자 칸 하나
function numField(parent, label, get, set, min, max, onChange = roomChanged) {
  const wrap = document.createElement('label'); wrap.className = 'nf';
  wrap.innerHTML = `<span>${label}</span><input type="number" min="${min}" max="${max}" step="1">`;
  const inp = wrap.querySelector('input'); inp.value = cm(get());
  let snap = null;
  inp.onfocus = () => { snap = JSON.stringify(spec); };
  inp.oninput = () => { const v = Number(inp.value); if (inp.value === '' || !Number.isFinite(v) || v < min || v > max) return; if (snap) { pushUndo(snap); snap = null; } set(v / 100); onChange(); };
  inp.onblur = () => { inp.value = cm(get()); };
  inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
  parent.append(wrap); return wrap;
}

// ── 가구 탭 ──
const MATS = [['', '기본'], ['oak-solid', '밝은 나무'], ['walnut-solid', '짙은 나무'], ['plywood', '합판'], ['white-laminate', '흰색'], ['black-laminate', '검정'],
  ['linen-beige', '베이지 천'], ['linen-gray', '회색 천'], ['navy-fabric', '네이비 천'], ['charcoal-fabric', '짙은 회색 천'], ['black-steel', '검정 철'], ['white-steel', '흰 철'], ['brushed-steel', '스테인리스'], ['#', '직접 색 고르기']];
const clampFurn = (f) => { const fp = footprint(f), { w: W, d: D } = spec.room, H = spec.room.h ?? 2.4;
  if (fp.h > H) f.h = +H.toFixed(3); if ((f.y ?? 0) + Math.min(fp.h, H) > H) f.y = +Math.max(0, H - Math.min(fp.h, H)).toFixed(3);
  if (fp.sx < W && fp.sz < D) { f.x = +clampN(f.x, fp.sx / 2 + 0.005, W - fp.sx / 2 - 0.005).toFixed(3); f.z = +clampN(f.z, fp.sz / 2 + 0.005, D - fp.sz / 2 - 0.005).toFixed(3); } };
let furnTimer = 0;
function furnChanged() { const f = spec.furniture[selected?.i]; if (f) clampFurn(f); clearTimeout(furnTimer); furnTimer = setTimeout(() => { buildGeometry(); renderFurnList(); syncChrome(); save(); }, 120); }
function renderFurnList() {
  const list = $('furnList'); list.textContent = '';
  (spec.furniture || []).forEach((f, i) => {
    const fp = footprint(f), b = document.createElement('button');
    const a = document.createElement('span'), c = document.createElement('span');
    a.textContent = furnName(f); c.textContent = `${cm(fp.w)}×${cm(fp.d)}×${cm(fp.h)}`; b.append(a, c);
    b.classList.toggle('on', selected?.kind === 'f' && selected.i === i);
    b.onclick = () => select({ kind: 'f', i });
    list.append(b);
  });
  if (!(spec.furniture || []).length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '아직 가구가 없어. 위에서 골라 추가해.'; list.append(p); }
}
function renderFurnTab() {
  const box = $('furnSel'); box.textContent = '';
  const f = selected?.kind === 'f' ? spec.furniture[selected.i] : null;
  if (f) {
    const fp = footprint(f), def = FURNITURE[f.type] || FURNITURE.box;
    const h = document.createElement('h2'); h.textContent = furnName(f); box.append(h);
    const cap = document.createElement('div'); cap.className = 'cap'; cap.innerHTML = '크기 <em>단위 cm · 바닥에서 = 띄운 높이</em>'; box.append(cap);
    const g = document.createElement('div'); g.className = 'grid4';
    numField(g, '폭', () => footprint(f).w, (v) => { f.w = v; }, 3, 600, furnChanged);
    numField(g, '깊이', () => footprint(f).d, (v) => { f.d = v; }, 1, 600, furnChanged);
    numField(g, '높이', () => footprint(f).h, (v) => { f.h = v; }, 1, 300, furnChanged);
    numField(g, '바닥에서', () => f.y ?? 0, (v) => { f.y = v; }, 0, 300, furnChanged);
    box.append(g);
    if (f.type === 'floor-lamp' || f.type === 'table-lamp') {          // 가구로 놓은 스탠드: 밝기와 색온도
      const lg = document.createElement('div'); lg.className = 'grid4';
      const raw = (label, key, def, min, max, step) => {
        const wrap = document.createElement('label'); wrap.className = 'nf'; wrap.innerHTML = `<span>${label}</span><input type="number" min="${min}" max="${max}" step="${step}">`;
        const inp = wrap.querySelector('input'); inp.value = f.options?.[key] ?? def; let snap = null;
        inp.onfocus = () => { snap = JSON.stringify(spec); };
        inp.oninput = () => { const v = Number(inp.value); if (inp.value === '' || v < min || v > max) return; if (snap) { pushUndo(snap); snap = null; } (f.options ??= {})[key] = v; furnChanged(); };
        inp.onkeydown = (e) => { if (e.key === 'Enter') inp.blur(); };
        lg.append(wrap);
      };
      raw('밝기 lm', 'lumens', f.type === 'floor-lamp' ? 900 : 450, 0, 20000, 50); raw('색온도 K', 'temp', 2700, 1800, 8000, 100);
      box.append(lg);
    }
    const row = document.createElement('label'); row.className = 'nf'; row.innerHTML = '<span>색·재질</span>';
    const sel = document.createElement('select'), col = document.createElement('input'); col.type = 'color'; col.className = 'col';
    const cur = typeof f.material === 'object' && f.material ? '#' : f.material ?? '';
    const opts = MATS.some(([v]) => v === cur) ? MATS : [...MATS, [cur, cur]];
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = v; o.textContent = t; o.selected = v === cur; sel.append(o); }
    const baseType = () => (MATERIALS[typeof f.material === 'string' ? f.material : '']?.type) || (typeof f.material === 'object' && f.material?.type) || (/fabric|rug/i.test(def.mat) ? 'fabric' : 'laminate');
    sel.onchange = () => {
      pushUndo();
      if (sel.value === '') delete f.material; else if (sel.value === '#') f.material = { type: baseType(), color: col.value || '#b8a58c' }; else f.material = sel.value;
      col.hidden = sel.value !== '#'; furnChanged();
    };
    col.value = cur === '#' && /^#[0-9a-f]{6}$/i.test(f.material.color || '') ? f.material.color : '#b8a58c'; col.hidden = cur !== '#';
    let csnap = null; col.onfocus = () => { csnap = JSON.stringify(spec); };
    col.oninput = () => { if (csnap) { pushUndo(csnap); csnap = null; } f.material = { type: baseType(), color: col.value }; furnChanged(); };
    const line = document.createElement('div'); line.style.cssText = 'display:grid;grid-template-columns:1fr auto;gap:12px;align-items:center'; line.append(sel, col); row.append(line); box.append(row);
    const acts = document.createElement('div'); acts.className = 'acts';
    for (const [t, fn, tip] of [['돌리기', rotateSelected, '90도 돌리기 (R)'], ['복제', duplicateSelected, '옆에 하나 더'], ['지우기', removeSelected, 'Delete']]) { const b = document.createElement('button'); b.textContent = t; b.title = tip; b.onclick = fn; acts.append(b); }
    box.append(acts);
    if (f.note) { const p = document.createElement('p'); p.className = 'note'; p.textContent = f.note; box.append(p); }
    void fp;
  }
  renderFurnList();
}
function freeSpot(f) {            // 방 가운데에서 가까운 빈자리
  const fp = footprint(f), { w: W, d: D } = spec.room, flat = FLAT_TYPES.has(f.type);
  const boxes = (spec.furniture || []).filter((o) => !FLAT_TYPES.has(o.type) && (o.y ?? 0) < 0.05).map((o) => { const p = footprint(o); return [o.x - p.sx / 2, o.x + p.sx / 2, o.z - p.sz / 2, o.z + p.sz / 2]; })
    .concat((spec.room.blocks || []).map((b) => [b.x, b.x + b.w, b.z, b.z + b.d]), (room?.solids || []).concat(room?.outs || []).map((c) => [c.x0, c.x1, c.z0, c.z1]));
  let best = null, bd = 1e9;
  for (let x = fp.sx / 2 + 0.02; x <= W - fp.sx / 2 - 0.02; x += 0.1) for (let z = fp.sz / 2 + 0.02; z <= D - fp.sz / 2 - 0.02; z += 0.1) {
    if (!flat && boxes.some(([x0, x1, z0, z1]) => x + fp.sx / 2 > x0 - 0.03 && x - fp.sx / 2 < x1 + 0.03 && z + fp.sz / 2 > z0 - 0.03 && z - fp.sz / 2 < z1 + 0.03)) continue;
    const d = Math.hypot(x - W / 2, z - D / 2); if (d < bd) { bd = d; best = [x, z]; }
  }
  if (best) return best;
  const n = (spec.furniture || []).length;          // 빈자리가 없으면 가운데 근처에 조금씩 어긋나게
  return [clampN(W / 2 + ((n % 3) - 1) * 0.25, fp.sx / 2, Math.max(fp.sx / 2, W - fp.sx / 2)), clampN(D / 2 + (((n / 3) | 0) % 3 - 1) * 0.25, fp.sz / 2, Math.max(fp.sz / 2, D - fp.sz / 2))];
}
function addFurniture(type) {
  if (!FURNITURE[type]) return;
  pushUndo(); spec.furniture ??= [];
  const f = { type, x: 0, z: 0, facing: 'S' }; const [x, z] = freeSpot(f); f.x = +x.toFixed(2); f.z = +z.toFixed(2);
  if (type === 'wall-art' || type === 'mirror') f.y = 1.0;
  spec.furniture.push(f); buildGeometry();
  if (view.mode !== 'overview') setView('overview');
  select({ kind: 'f', i: spec.furniture.length - 1 }); save();
}
function duplicateSelected() {
  if (selected?.kind !== 'f') return;
  pushUndo();
  const f = JSON.parse(JSON.stringify(spec.furniture[selected.i])); delete f.assumed; delete f.note;
  const [x, z] = (f.y ?? 0) > 0.05 ? [f.x + 0.2, f.z + 0.2] : freeSpot(f); f.x = +x.toFixed(2); f.z = +z.toFixed(2); clampFurn(f);
  spec.furniture.push(f); buildGeometry(); select({ kind: 'f', i: spec.furniture.length - 1 }); save();
}
{
  const sel = $('addType');
  for (const k of Object.keys(FURNITURE)) { const o = document.createElement('option'); o.value = k; o.textContent = KO[k] || k; sel.append(o); }
  $('addFurn').onclick = () => addFurniture(sel.value);
}

// ── 조명 탭 ──
const stateLabel = (l) => (l.on === true || l.on === 'always' ? '켬' : l.on === false || l.on === 'never' ? '끔' : '자동');
function renderLights() {                // 조명 목록: 루멘·색온도를 고치면 바로 반영된다
  const list = $('lightList'); list.textContent = '';
  const count = {};
  (spec.lights || []).forEach((l, i) => {
    const type = l.type || 'ceiling'; count[type] = (count[type] || 0) + 1;
    const row = document.createElement('div'); row.className = 'light'; row.dataset.i = i;
    row.innerHTML = `<button class="nm" title="눌러서 고르기. 고른 뒤 끌어서 옮겨">${TYPE_LABEL[type] || type} ${count[type]}</button>
      <input class="lm" type="number" min="0" max="20000" step="100" title="밝기(루멘)"><em>lm</em>
      <input class="k" type="number" min="1800" max="8000" step="100" title="색온도(K). 낮을수록 노랗다"><em>K</em>
      <input class="col" type="color" title="색을 직접 고르기">
      <button class="st" title="자동은 해가 지면 켜짐. 누르면 자동 → 켬 → 끔"></button><button class="rm" title="지우기">×</button>`;
    const lm = row.querySelector('.lm'), k = row.querySelector('.k'), col = row.querySelector('.col'), st = row.querySelector('.st');
    lm.value = Math.round(lumensOf(l)); k.value = l.temp ?? 3500; col.value = '#' + colorOf(l).getHexString(); st.textContent = stateLabel(l);
    let snap = null; const once = () => { if (snap) { pushUndo(snap); snap = null; } };
    lm.onfocus = k.onfocus = col.onfocus = () => { snap = JSON.stringify(spec); };
    lm.oninput = () => { once(); l.lumens = clampN(Number(lm.value) || 0, 0, 20000); delete l.power; relightSoon(); save(); syncChrome(); };
    lm.onblur = () => { lm.value = Math.round(lumensOf(l)); };
    k.oninput = () => { const v = Number(k.value); if (v < 1500 || v > 9000) return; once(); l.temp = v; delete l.color; col.value = '#' + colorOf(l).getHexString(); relightSoon(); save(); };
    col.oninput = () => { once(); l.color = col.value; relightSoon(); save(); };
    st.onclick = () => { pushUndo(); l.on = stateLabel(l) === '자동' ? true : stateLabel(l) === '켬' ? false : 'auto'; st.textContent = stateLabel(l); relight(); save(); };
    row.querySelector('.rm').onclick = () => removeLight(i);
    row.querySelector('.nm').onclick = () => { if (view.mode !== 'overview') setView('overview'); select({ kind: 'l', i }); };
    list.append(row);
  });
  if (!(spec.lights || []).length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '조명이 없어. 아래에서 추가해.'; list.append(p); }
  markLights();
}
function addLight(type) {
  const { W, D } = room; pushUndo(); spec.lights ??= [];
  const n = spec.lights.length;
  spec.lights.push({ type, x: +(W / 2 + ((n % 3) - 1) * 0.3).toFixed(2), z: +(D / 2 + (((n / 3) | 0) % 3 - 1) * 0.3).toFixed(2),
    ...(type === 'point' ? { y: 1.2 } : {}), lumens: type === 'ceiling' ? 3000 : type === 'stand' ? 900 : 500, temp: type === 'ceiling' ? 4000 : 2700, on: true });
  renderLights(); relight(); save();
  if (view.mode !== 'overview') setView('overview');
  select({ kind: 'l', i: n });
}
function removeLight(i) { pushUndo(); spec.lights.splice(i, 1); selected = null; showSelection(); renderPanels(); relight(); save(); }

function setTime(h) { if (h == null) return; hours = Math.min(24, Math.max(0, h)); relight(); }
function toggleMode() { setView(view.mode === 'overview' ? 'start' : 'overview'); syncUI(); }
function setStyle(k) { if (!STYLES[k] || k === styleName) return; pushUndo(); styleName = k; spec.style = k; buildGeometry(); save(); }
function setQuality(q) { quality = q; store.set('room-q', q); setupPost(); buildGeometry(); }
$('timeSlider').oninput = (e) => { hours = Number(e.target.value); $('time').value = fmtTime(hours); relightSoon(); };
$('time').onchange = (e) => { const h = parseTime(e.target.value); if (h == null) e.target.value = fmtTime(hours); else setTime(h); e.target.blur(); };
$('time').onkeydown = (e) => { if (e.key === 'Enter') e.target.blur(); };
$('time').onfocus = (e) => e.target.select();
for (const b of $('chips').children) b.onclick = () => setTime(Number(b.dataset.h));
for (const b of $('seasons').children) b.onclick = () => { season = b.dataset.s; relight(); };
for (const b of $('views').children) b.onclick = () => { if ((b.dataset.v === 'overview') !== (view.mode === 'overview')) toggleMode(); };
for (const b of $('qualities').children) b.onclick = () => setQuality(b.dataset.q);
for (const [k, s] of Object.entries(STYLES)) { const b = document.createElement('button'); b.dataset.k = k; b.textContent = s.label || k; b.onclick = () => setStyle(k); $('styles').append(b); }
$('decor').onclick = () => setEditing(!editing);
$('closePanel').onclick = () => setEditing(false);
$('undo').onclick = undo;
for (const b of $('tabs').querySelectorAll('[data-tab]')) b.onclick = () => openTab(b.dataset.tab);
let curtainTimer = 0;
$('curtain').onpointerdown = () => pushUndo();
$('curtain').oninput = (e) => {
  const v = Number(e.target.value); $('curtainOut').textContent = Math.round(v * 100);
  for (const o of curtained()) o.curtainOpen = v;
  clearTimeout(curtainTimer); curtainTimer = setTimeout(() => { buildGeometry(); save(); }, 60);
};
$('curtainAdd').onclick = () => {          // 화면에서 만든 창에는 커튼이 없다. 얇은 커튼을 단다
  pushUndo(); for (const o of spec.openings || []) if (o.type === 'window') Object.assign(o, { curtain: 'sheer', curtainOpen: o.curtainOpen ?? 0.5 });
  buildGeometry(); syncUI(); save();
};
$('curtainOff').onclick = (e) => { e.preventDefault(); pushUndo(); for (const o of curtained()) o.curtain = 'none'; buildGeometry(); syncUI(); save(); };
for (const b of document.querySelectorAll('[data-add]')) b.onclick = () => addLight(b.dataset.add);

// ── 방 탭: 실측 치수로 방 크기·문·창·기둥을 적는다(단위 cm) ─────────────────
const WALL_KO = { N: '북', E: '동', S: '남', W: '서' }, WALL_NEXT = { N: 'E', E: 'S', S: 'W', W: 'N' };
const wallLen = (w) => (w === 'N' || w === 'S' ? spec.room.w : spec.room.d);
function fitContents() {          // 방 크기가 바뀌면 문·창·가구·조명·시점을 방 안으로 당긴다
  const R = spec.room, H = R.h ?? 2.4;
  for (const o of spec.openings || []) {
    const L = wallLen(o.wall); o.width = +clampN(o.width, 0.3, L - 0.1).toFixed(3); o.offset = +clampN(o.offset, 0.05, L - o.width - 0.05).toFixed(3);
    let sill = o.sill ?? (o.type === 'window' ? 0.9 : 0);
    if (o.type === 'window' && sill > H - 0.35) { sill = +(H - 0.35).toFixed(3); o.sill = sill; }
    o.height = +clampN(o.height ?? (o.type === 'window' ? 1.2 : 2.1), 0.3, H - sill - 0.02).toFixed(3);
  }
  for (const b of R.blocks || []) { b.w = +clampN(b.w, 0.05, R.w - 0.3).toFixed(3); b.d = +clampN(b.d, 0.05, R.d - 0.3).toFixed(3); b.x = +clampN(b.x, 0, R.w - b.w).toFixed(3); b.z = +clampN(b.z, 0, R.d - b.d).toFixed(3); }
  for (const f of spec.furniture || []) clampFurn(f);
  for (const l of spec.lights || []) { l.x = +clampN(l.x, 0.1, R.w - 0.1).toFixed(3); l.z = +clampN(l.z, 0.1, R.d - 0.1).toFixed(3); }
  for (const v of [spec.start, ...(spec.views || [])].filter(Boolean)) { v.x = +clampN(v.x, 0.3, R.w - 0.3).toFixed(2); v.z = +clampN(v.z, 0.3, R.d - 0.3).toFixed(2); }
  if (view.mode === 'walk') { view.x = clampN(view.x, 0.25, R.w - 0.25); view.z = clampN(view.z, 0.25, R.d - 0.25); } else view.oDist = Math.max(R.w, R.d) * 1.55 + 2.2;
}
let roomTimer = 0;
function roomChanged() { fitContents(); drawPlan(); clearTimeout(roomTimer); roomTimer = setTimeout(() => { buildGeometry(); renderAI(); syncUI(); save(); }, 120); }
function renderRoomPanel() {
  const R = spec.room, box = $('roomFields'); box.textContent = '';
  const dims = document.createElement('div'); dims.className = 'grid3';
  numField(dims, '가로 (동↔서)', () => R.w, (v) => { R.w = v; }, 100, 1500);
  numField(dims, '세로 (남↔북)', () => R.d, (v) => { R.d = v; }, 100, 1500);
  numField(dims, '천장 높이', () => R.h ?? 2.4, (v) => { R.h = v; }, 200, 400);
  box.append(dims);
  const head = (t, sub) => { const h = document.createElement('div'); h.className = 'cap'; h.textContent = t; if (sub) { const e = document.createElement('em'); e.textContent = sub; h.append(e); } box.append(h); };
  if ((spec.openings || []).length) head('문·창', '거리는 그 벽의 서쪽(또는 북쪽) 끝에서');
  (spec.openings || []).forEach((o, i) => {
    const row = document.createElement('div'); row.className = 'op';
    const kind = document.createElement('span'); kind.className = 'nm'; kind.textContent = o.type === 'window' ? '창' : o.type === 'door' ? '문' : '입구';
    const wall = document.createElement('button'); wall.textContent = WALL_KO[o.wall]; wall.title = '붙는 벽 바꾸기(북 → 동 → 남 → 서)';
    wall.onclick = () => { pushUndo(); o.wall = WALL_NEXT[o.wall]; roomChanged(); renderRoomPanel(); };
    row.append(kind, wall);
    numField(row, '거리', () => o.offset, (v) => { o.offset = v; }, 0, 1500);
    numField(row, '폭', () => o.width, (v) => { o.width = v; }, 30, 800);
    numField(row, '높이', () => o.height ?? (o.type === 'window' ? 1.2 : 2.1), (v) => { o.height = v; }, 30, 400);
    if (o.type === 'window') numField(row, '바닥에서', () => o.sill ?? 0.9, (v) => { o.sill = v; }, 0, 250); else row.append(document.createElement('span'));
    const rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '×'; rm.title = '지우기'; rm.onclick = () => { pushUndo(); spec.openings.splice(i, 1); roomChanged(); renderRoomPanel(); syncUI(); };
    row.append(rm); box.append(row);
  });
  if ((spec.partitions || []).length) { const p = document.createElement('p'); p.className = 'note'; p.textContent = `방 사이 벽 ${spec.partitions.length}개는 여기서 못 고쳐. 내 AI에게 말해 줘(예: "안방 문을 거실 쪽으로 옮겨 줘").`; box.append(p); }
  if ((R.blocks || []).length) head('기둥·꺾인 벽', '서쪽·북쪽 벽에서 잰 거리와 크기');
  (R.blocks || []).forEach((b, i) => {
    const row = document.createElement('div'); row.className = 'op blk';
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = `기둥 ${i + 1}`; row.append(nm);
    numField(row, '서쪽에서', () => b.x, (v) => { b.x = v; }, 0, 1500);
    numField(row, '북쪽에서', () => b.z, (v) => { b.z = v; }, 0, 1500);
    numField(row, '가로', () => b.w, (v) => { b.w = v; }, 5, 1000);
    numField(row, '세로', () => b.d, (v) => { b.d = v; }, 5, 1000);
    const rm = document.createElement('button'); rm.className = 'rm'; rm.textContent = '×'; rm.title = '지우기'; rm.onclick = () => { pushUndo(); R.blocks.splice(i, 1); selected = null; roomChanged(); renderRoomPanel(); };
    row.append(rm); box.append(row);
  });
  drawPlan();
}
function drawPlan() {              // 위에서 본 작은 평면도(위가 북쪽)
  const c = $('plan'), g = c.getContext('2d'), R = spec.room, dpr = Math.min(2, devicePixelRatio || 1);
  const cw = 316, ch = 150; c.width = cw * dpr; c.height = ch * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, cw, ch);
  const s = Math.min((cw - 60) / R.w, (ch - 34) / R.d), ox = (cw - R.w * s) / 2, oz = (ch - R.d * s) / 2 + 3;
  const X = (x) => ox + x * s, Z = (z) => oz + z * s;
  (spec.furniture || []).forEach((f, i) => {
    const fp = footprint(f); if ((f.y ?? 0) > 0.05) return;
    g.fillStyle = selected?.kind === 'f' && selected.i === i ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.10)';
    g.fillRect(X(f.x - fp.sx / 2), Z(f.z - fp.sz / 2), fp.sx * s, fp.sz * s);
  });
  g.fillStyle = 'rgba(255,255,255,0.55)';
  for (const b of R.blocks || []) g.fillRect(X(b.x), Z(b.z), b.w * s, b.d * s);
  g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 1.5; g.strokeRect(X(0), Z(0), R.w * s, R.d * s);
  g.fillStyle = 'rgba(0,0,0,0.55)'; for (const c of room?.outs || []) g.fillRect(X(c.x0), Z(c.z0), (c.x1 - c.x0) * s, (c.z1 - c.z0) * s);        // 집 밖 빈 곳
  g.fillStyle = 'rgba(255,255,255,0.7)'; for (const c of room?.solids || []) g.fillRect(X(c.x0), Z(c.z0), Math.max(1.5, (c.x1 - c.x0) * s), Math.max(1.5, (c.z1 - c.z0) * s));        // 방 사이 벽
  for (const o of spec.openings || []) {
    const a = o.offset, b = o.offset + o.width, h = o.wall === 'N' || o.wall === 'S';
    const p = (t) => (h ? [X(t), Z(o.wall === 'N' ? 0 : R.d)] : [X(o.wall === 'W' ? 0 : R.w), Z(t)]);
    const [x0, y0] = p(a), [x1, y1] = p(b);
    g.lineWidth = 5; g.strokeStyle = '#151517'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();     // 벽을 끊고
    g.lineWidth = o.type === 'window' ? 3 : 1; g.strokeStyle = o.type === 'window' ? 'rgba(170,205,255,0.95)' : 'rgba(255,220,170,0.95)';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.font = '300 10px "Malgun Gothic", system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('북', cw / 2, Z(0) - 9); g.fillText('남', cw / 2, Z(R.d) + 9); g.fillText('서', X(0) - 11, ch / 2 + 3); g.fillText('동', X(R.w) + 11, ch / 2 + 3);
  g.fillText(`${cm(R.w)} × ${cm(R.d)} cm`, cw / 2, ch / 2 + 3);
}
function freeGap(wall, width) {          // 그 벽에서 문·창·기둥이 없는 가장 넓은 구간. 없으면 null
  const L = wallLen(wall), R = spec.room, used = (spec.openings || []).filter((o) => o.wall === wall).map((o) => [o.offset - 0.1, o.offset + o.width + 0.1]);
  for (const b of R.blocks || []) {
    const touch = wall === 'N' ? b.z < 0.02 : wall === 'S' ? b.z + b.d > R.d - 0.02 : wall === 'W' ? b.x < 0.02 : b.x + b.w > R.w - 0.02;
    if (touch) used.push(wall === 'N' || wall === 'S' ? [b.x - 0.05, b.x + b.w + 0.05] : [b.z - 0.05, b.z + b.d + 0.05]);
  }
  used.sort((p, q) => p[0] - q[0]);
  let best = null, at = 0.1;
  for (const [u0, u1] of [...used, [L - 0.1, L]]) { if (u0 - at >= width && (!best || u0 - at > best[1] - best[0])) best = [at, u0]; at = Math.max(at, u1); }
  return best;
}
function addOpening(type) {
  spec.openings ??= [];
  let found = null;
  for (const width of [type === 'window' ? 1.4 : 0.9, 0.7]) {
    for (const wall of ['S', 'E', 'W', 'N']) { const g = freeGap(wall, width); if (g && (!found || g[1] - g[0] > found.g[1] - found.g[0])) found = { wall, g, width }; }
    if (found) break;
  }
  if (!found) return flash(type === 'window' ? '창을 낼 빈 벽이 없어' : '문을 낼 빈 벽이 없어', 2600);
  pushUndo();
  const { wall, g, width } = found, offset = +((g[0] + g[1] - width) / 2).toFixed(2), H = spec.room.h ?? 2.4;
  spec.openings.push(type === 'window' ? { type, wall, offset, width, height: +Math.min(1.2, H - 0.92).toFixed(2), sill: 0.9, curtain: 'none' }
    : { type, wall, offset, width, height: +Math.min(2.1, H - 0.05).toFixed(2), hinge: 'start', swing: 'in', open: 0 });
  roomChanged(); renderRoomPanel();
}
function addBlock() {             // 문·창을 가리지 않는 모서리에 놓는다. 다 막혀 있으면 방 가운데(기둥)
  const R = spec.room, sz = 0.6; R.blocks ??= [];
  const hit = (wall, a0, a1) => (spec.openings || []).some((o) => o.wall === wall && o.offset < a1 + 0.05 && o.offset + o.width > a0 - 0.05);
  const taken = (x, z, s = sz) => R.blocks.some((b) => x < b.x + b.w && x + s > b.x && z < b.z + b.d && z + s > b.z)
    || (spec.furniture || []).some((f) => { const fp = footprint(f); return !FLAT_TYPES.has(f.type) && x < f.x + fp.sx / 2 && x + s > f.x - fp.sx / 2 && z < f.z + fp.sz / 2 && z + s > f.z - fp.sz / 2; });
  const corners = [[R.w - sz, 0, 'N', 'E'], [0, 0, 'N', 'W'], [R.w - sz, R.d - sz, 'S', 'E'], [0, R.d - sz, 'S', 'W']];
  const c = corners.find(([x, z, ns, ew]) => !hit(ns, x, x + sz) && !hit(ew, z, z + sz) && !taken(x, z));
  let spot = c ? { x: c[0], z: c[1], w: sz, d: sz } : null;
  const doorway = (x, z, s) => (spec.openings || []).some((o) => {        // 문 앞 1m 는 비워 둔다
    if (o.type === 'window') return false;
    const a = o.offset - 0.1, b = o.offset + o.width + 0.1, ns = o.wall === 'N' || o.wall === 'S', p = ns ? x : z, q = ns ? z : x, far = ns ? R.d : R.w;
    return p < b && p + s > a && (o.wall === 'N' || o.wall === 'W' ? q < 1.0 : q + s > far - 1.0);
  });
  for (let x = 0.3; !spot && x <= R.w - 0.7; x += 0.1) for (let z = 0.3; !spot && z <= R.d - 0.7; z += 0.1) if (!taken(x, z, 0.4) && !doorway(x, z, 0.4)) spot = { x, z, w: 0.4, d: 0.4 };
  if (!spot) return flash('기둥을 놓을 빈자리가 없어', 2600);
  pushUndo();
  R.blocks.push({ x: +spot.x.toFixed(2), z: +spot.z.toFixed(2), w: spot.w, d: spot.d });
  roomChanged(); renderRoomPanel();
}
$('addDoor').onclick = () => addOpening('door'); $('addWin').onclick = () => addOpening('window'); $('addBlock').onclick = addBlock;

// ── AI 탭: 내 AI에게 보낼 문장 ──
function renderAI() {
  const R = spec.room, list = $('aiList'); list.textContent = '';
  const says = [
    ['설명과 사진으로 새 방 만들기', 'input 폴더의 설명과 사진으로 방 만들어 줘'],
    ['가로·세로와 방 사진만 있을 때', `가로 ${cm(R.w)}cm, 세로 ${cm(R.d)}cm 방이야. input/사진에 넣은 사진대로 나머지를 채워서 방 만들어 줘`],
    ['제품 링크로 가구 놓기', `rooms/${roomName} 방 창가에 이 제품 놔 줘: (여기에 링크 붙여넣기)`],
    ['제품 사진과 치수로 가구 놓기', `rooms/${roomName} 방에 input/사진의 소파를 문 옆 벽에 놔 줘. 폭 180cm야`],
    ['조명 달기', `rooms/${roomName} 방 책상 위에 800루멘 전구색 스탠드 달아 줘`],
    ['집 전체 만들기', 'input/사진에 넣은 평면도대로 우리 집 전체를 만들어 줘'],
  ];
  for (const [cap, text] of says) {
    const d = document.createElement('div'); d.className = 'say';
    const c = document.createElement('span'); c.className = 'cap'; c.textContent = cap;
    const p = document.createElement('p'); p.textContent = text;
    const b = document.createElement('button'); b.textContent = '복사';
    b.onclick = async () => {
      try { await navigator.clipboard.writeText(text); }
      catch { const r = document.createRange(); r.selectNodeContents(p); const s = getSelection(); s.removeAllRanges(); s.addRange(r); try { document.execCommand('copy'); } catch {} }
      b.textContent = '복사됨'; setTimeout(() => { b.textContent = '복사'; }, 1300);
    };
    d.append(c, p, b); list.append(d);
  }
}
function renderAreas() {          // 집 전체: 방 이름을 누르면 그 방으로 간다
  const box = $('areas'); box.textContent = '';
  for (const a of (spec.areas || []).filter((a) => !a.outside)) { const b = document.createElement('button'); b.textContent = a.name; b.title = a.name + '(으)로 가기'; b.onclick = () => { goArea(a); syncUI(); }; box.append(b); }
}
function renderPanels() {
  renderAreas();
  if (selected) { const arr = selected.kind === 'f' ? spec.furniture : selected.kind === 'l' ? spec.lights : spec.room.blocks; if (!arr?.[selected.i]) { selected = null; if (room) showSelection(); } }
  renderFurnTab(); renderLights(); renderRoomPanel(); renderAI(); syncChrome();
}

// ── 방 이름: 방 바꾸기·새 방 ──
async function loadRoomList(fresh = []) {
  const list = await (await fetch('/__rooms')).json(), box = $('roomList'); box.textContent = '';
  for (const n of list) {
    const b = document.createElement('button'); b.textContent = n + (fresh.includes(n) ? '  · 새 방' : ''); b.classList.toggle('on', n === roomName);
    b.onclick = () => { if (n !== roomName) location.search = '?room=' + encodeURIComponent(n); else $('roomMenu').hidden = true; };
    box.append(b);
  }
  if (!list.length) { const p = document.createElement('p'); p.className = 'empty'; p.textContent = '아직 방이 없어. 아래에서 하나 만들어.'; box.append(p); }
}
$('name').onclick = () => { const m = $('roomMenu'); m.hidden = !m.hidden; if (!m.hidden) loadRoomList().catch(fail); };
async function createRoom() {       // 이름과 가로·세로(cm)만으로 새 방을 만든다
  $('msg').hidden = true;
  const name = $('newRoom').value.trim().replace(/\s+/g, '-'); if (!name) return $('newRoom').focus();
  if (!/^[\w가-힣-]+$/.test(name)) return fail(new Error('방 이름은 한글·영문·숫자·하이픈(-)만 쓸 수 있어.'));
  const w = Number($('newW').value) / 100, d = Number($('newD').value) / 100, any = $('newW').value !== '' || $('newD').value !== '';
  if (any && !(w >= 1 && w <= 15 && d >= 1 && d <= 15)) { fail(new Error('가로·세로는 둘 다 100~1500cm 사이로 적어 줘. 둘 다 비우면 300×350으로 만들어.')); return $(w >= 1 && w <= 15 ? 'newD' : 'newW').focus(); }
  const q = '?room=' + encodeURIComponent(name) + (any ? `&w=${w}&d=${d}` : '');
  const r = await fetch('/__new' + q, { method: 'POST' });
  if (r.ok) location.search = '?room=' + encodeURIComponent(name) + '&tab=room&view=overview'; else fail(new Error(await r.text()));
}
$('newGo').onclick = createRoom;
for (const id of ['newRoom', 'newW', 'newD']) $(id).onkeydown = (e) => { if (e.key === 'Enter') createRoom(); };

// ── 처음 안내 ──
function showHelp(on) { $('help').hidden = !on; if (!on) store.set('room-help-seen', '1'); }
$('helpBtn').onclick = () => showHelp(true);
$('helpGo').onclick = () => showHelp(false);
$('help').onclick = (e) => { if (e.target === $('help')) showHelp(false); };

// ── 시작 ──────────────────────────────────────────────────────────────────
async function loadSpec() {
  if (!roomName) { const list = await (await fetch('/__rooms')).json(); roomName = list[0] || ''; }
  if (!roomName) throw new Error('아직 방이 없어. 왼쪽 위에서 이름과 가로·세로를 적고 만들기를 눌러.');
  const res = await fetch(`rooms/${encodeURIComponent(roomName)}/room.json`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`rooms/${roomName}/room.json 을 못 읽었어. 왼쪽 위 방 이름을 눌러 다른 방을 골라.`);
  return res.text();
}
function applySpec(text, first) {
  const next = JSON.parse(text);
  if (!next.room) throw new Error('room.json 에 room 이 없어.');
  const prev = spec?.environment || {}; specText = text; spec = next;
  if (!first) {
    const env = spec.environment || {};
    if (!Q.get('style') && STYLES[spec.style]) styleName = spec.style;
    if (env.time !== prev.time && parseTime(env.time) != null) hours = parseTime(env.time);
    if (env.season !== prev.season && SEASONS[env.season]) season = env.season;
    return;
  }
  hours = parseTime(Q.get('time')) ?? parseTime(spec.environment?.time) ?? hours;
  season = SEASONS[Q.get('season')] ? Q.get('season') : SEASONS[spec.environment?.season] ? spec.environment.season : 'spring';
  styleName = STYLES[Q.get('style')] ? Q.get('style') : STYLES[spec.style] ? spec.style : 'wood-minimal';
}
const fail = (e) => { $('msg').textContent = String(e.message || e); $('msg').hidden = false; console.error(e); };

let last = performance.now(), frames = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (!room) return;
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  walk(dt); placeCamera();
  if (composer) composer.render(); else renderer.render(scene, camera);
  if (shotName && ++frames === 5) {
    fetch(`/__shot?name=${encodeURIComponent(shotName)}`, { method: 'POST', body: renderer.domElement.toDataURL('image/png') })
      .then(() => { document.title = 'shot-done'; });
  }
}
addEventListener('resize', () => { setupPost(); });

(async () => {
  try {
    applySpec(await loadSpec(), true); setupPost(); buildGeometry(); renderPanels();
    setView(Q.get('view') || 'start');
    if (Q.get('cam')) { const [x, z, yaw, pitch] = Q.get('cam').split(',').map(Number); Object.assign(view, { mode: 'walk', x, z, yaw: yaw || 0, pitch: pitch || 0 }); }
    const t = Q.get('tab') || (Q.get('panel') ? 'light' : Q.get('roompanel') ? 'room' : Q.get('edit') ? 'furn' : '');
    if (['furn', 'light', 'room', 'ai'].includes(t)) openTab(t);
    syncUI(); if (shotName && !Q.get('ui')) document.body.classList.add('bare');
    if (!shotName && !store.get('room-help-seen')) showHelp(true);
    requestAnimationFrame(frame);
    if (!shotName) {
      const known = new Set(await (await fetch('/__rooms')).json()); let tick = 0, wasOffline = false;
      setInterval(async () => {      // room.json 이 바뀌면(AI 가 고치면) 바로 다시 그린다
        if (dragging || saveTimer || document.activeElement?.matches?.('input:not([type=range]):not([type=color]), select, textarea')) return;
        try {
          const t = await loadSpec(); if (t !== specText) adoptExternal(t, 'AI가 고친 내용을 반영했어', 2600);
          if (wasOffline) { wasOffline = false; $('msg').hidden = true; }
          if (++tick % 3 === 0) {              // AI 가 새 방을 만들었으면 알린다
            const fresh = (await (await fetch('/__rooms')).json()).filter((n) => !known.has(n));
            if (fresh.length) { for (const n of fresh) known.add(n); await loadRoomList(fresh); $('roomMenu').hidden = false; flash(`새 방이 생겼어: ${fresh.join(', ')} · 목록에서 눌러 열기`, 6000); }
          }
        } catch (e) { wasOffline = true; fail(new Error(offline(e))); }
      }, 1500);
    }
  } catch (e) { fail(e); $('hint').textContent = ''; document.body.classList.add('noroom'); if (!roomName) { $('name').textContent = '방 만들기'; $('roomMenu').hidden = false; loadRoomList().catch(() => {}); } }
})();
