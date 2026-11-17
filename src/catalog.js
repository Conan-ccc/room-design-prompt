// 가구 종류별 기본 치수와 스타일 프리셋. 렌더(브라우저)와 검사 도구(node)가 같이 읽는다.
// 치수는 [w(정면 좌우), d(앞뒤), h(높이)] 미터.

export const FURNITURE = {
  'desk':         { size: [1.4, 0.7, 0.73], mat: '@wood',   mat2: '@metal' },
  'office-chair': { size: [0.62, 0.62, 1.1], mat: '@fabricDark', mat2: '@metal' },
  'monitor':      { size: [0.61, 0.2, 0.45], mat: '@metal' },
  'pc-case':      { size: [0.22, 0.45, 0.47], mat: '@metal' },
  'keyboard':     { size: [0.44, 0.14, 0.03], mat: '@metal' },
  'air-purifier': { size: [0.3, 0.3, 0.6],  mat: 'white-laminate' },
  'drawer-unit':  { size: [0.8, 0.45, 0.8], mat: '@wood' },
  'bookcase':     { size: [0.8, 0.3, 1.8],  mat: '@wood' },
  'shelf-rack':   { size: [0.7, 0.3, 1.5],  mat: '@metal', mat2: 'plywood' },
  'wardrobe':     { size: [1.6, 0.6, 2.1],  mat: '@wood' },
  'bed':          { size: [1.5, 2.05, 0.45], mat: '@fabric', mat2: '@wood' },
  'nightstand':   { size: [0.45, 0.4, 0.5], mat: '@wood' },
  'sofa':         { size: [1.9, 0.88, 0.78], mat: '@fabric', mat2: '@wood' },
  'armchair':     { size: [0.8, 0.82, 0.78], mat: '@fabric', mat2: '@wood' },
  'coffee-table': { size: [1.0, 0.55, 0.38], mat: '@wood',  mat2: '@metal' },
  'table':        { size: [1.4, 0.8, 0.74], mat: '@wood',   mat2: '@metal' },
  'chair':        { size: [0.45, 0.5, 0.82], mat: '@wood',  mat2: '@fabric' },
  'tv':           { size: [1.23, 0.05, 0.71], mat: '@metal' },
  'tv-stand':     { size: [1.6, 0.4, 0.45], mat: '@wood' },
  'rug':          { size: [2.0, 1.4, 0.012], mat: '@rug' },
  'plant':        { size: [0.45, 0.45, 1.2], mat: 'white-laminate' },
  'floor-lamp':   { size: [0.32, 0.32, 1.5], mat: '@metal' },
  'table-lamp':   { size: [0.22, 0.22, 0.4], mat: '@metal' },
  'wall-art':     { size: [0.7, 0.03, 0.5], mat: '@wood' },
  'mirror':       { size: [0.5, 0.03, 1.5], mat: '@wood' },
  'box':          { size: [0.5, 0.5, 0.5],  mat: '@wood' },
};

// 서로 겹쳐도 되는 것(바닥에 깔리거나 벽에 걸리는 것)
export const FLAT_TYPES = new Set(['rug', 'wall-art', 'mirror', 'tv']);

// 질감 종류: type 과 기본값. 전부 코드로 그린다.
export const MATERIALS = {
  'oak-plank':      { type: 'wood-plank', color: '#b88a5b', scale: 0.12, roughness: 0.4 },
  'walnut-plank':   { type: 'wood-plank', color: '#6e4a33', scale: 0.12, roughness: 0.36 },
  'gray-plank':     { type: 'wood-plank', color: '#9a9288', scale: 0.14, roughness: 0.42 },
  'oak-solid':      { type: 'wood-solid', color: '#c09a6b', roughness: 0.6 },
  'walnut-solid':   { type: 'wood-solid', color: '#5f4030', roughness: 0.55 },
  'plywood':        { type: 'wood-solid', color: '#d2b48a', roughness: 0.7 },
  'white-laminate': { type: 'laminate',   color: '#e9e6df', roughness: 0.45 },
  'black-laminate': { type: 'laminate',   color: '#1d1d1f', roughness: 0.4 },
  'white-plaster':  { type: 'plaster',    color: '#e6e1d8' },
  'warm-plaster':   { type: 'plaster',    color: '#dccfbd' },
  'white-wallpaper':{ type: 'wallpaper',  color: '#e4dfd6' },
  'concrete':       { type: 'concrete',   color: '#9c9a96' },
  'white-tile':     { type: 'tile',       color: '#e3e1dc', color2: '#b9b6b0', scale: 0.3, roughness: 0.25 },
  'linen-beige':    { type: 'fabric',     color: '#c9bba3' },
  'linen-gray':     { type: 'fabric',     color: '#8d8e90' },
  'navy-fabric':    { type: 'fabric',     color: '#1f2a44' },
  'charcoal-fabric':{ type: 'fabric',     color: '#3b3c42' },
  'ivory-carpet':   { type: 'carpet',     color: '#cfc6b6' },
  'gray-carpet':    { type: 'carpet',     color: '#77787c' },
  'black-steel':    { type: 'metal',      color: '#232427', roughness: 0.55, metalness: 0.5 },
  'brushed-steel':  { type: 'metal',      color: '#b4b6b8', roughness: 0.35, metalness: 1 },
  'white-steel':    { type: 'metal',      color: '#e4e3df', roughness: 0.5, metalness: 0.2 },
};

export const MATERIAL_TYPES = ['wood-plank', 'wood-solid', 'laminate', 'plaster', 'wallpaper', 'concrete', 'tile', 'fabric', 'carpet', 'metal'];

// 스타일 프리셋: "@역할" 이 가리키는 재질과 색 보정.
export const STYLES = {
  'wood-minimal': {
    label: '우드 미니멀',
    roles: { floor: 'oak-plank', wall: 'white-wallpaper', ceiling: 'white-plaster', trim: 'white-laminate',
      wood: 'oak-solid', woodDark: 'walnut-solid', fabric: 'linen-beige', fabricDark: 'charcoal-fabric',
      metal: 'black-steel', rug: 'ivory-carpet', curtain: 'linen-beige' },
    grade: { warmth: 0.04, contrast: 1.04, saturation: 1.0 },
  },
  'modern-mono': {
    label: '모던 모노',
    roles: { floor: 'gray-plank', wall: 'white-plaster', ceiling: 'white-plaster', trim: 'white-laminate',
      wood: 'white-laminate', woodDark: 'black-laminate', fabric: 'linen-gray', fabricDark: 'charcoal-fabric',
      metal: 'black-steel', rug: 'gray-carpet', curtain: 'linen-gray' },
    grade: { warmth: -0.03, contrast: 1.08, saturation: 0.88 },
  },
  'warm-vintage': {
    label: '웜 빈티지',
    roles: { floor: 'walnut-plank', wall: 'warm-plaster', ceiling: 'white-plaster', trim: 'walnut-solid',
      wood: 'walnut-solid', woodDark: 'walnut-solid', fabric: 'linen-beige', fabricDark: 'navy-fabric',
      metal: 'black-steel', rug: 'ivory-carpet', curtain: 'linen-beige' },
    grade: { warmth: 0.09, contrast: 1.06, saturation: 1.05 },
  },
};

export const TIMES = ['morning', 'noon', 'sunset', 'night'];
export const WALLS = ['N', 'E', 'S', 'W'];

// facing 에 따라 평면에서 차지하는 크기(x 방향, z 방향)
export function footprint(f) {
  const def = FURNITURE[f.type] || FURNITURE.box;
  const w = f.w ?? def.size[0], d = f.d ?? def.size[1], h = f.h ?? def.size[2];
  const side = f.facing === 'E' || f.facing === 'W';
  return { w, d, h, sx: side ? d : w, sz: side ? w : d };
}
