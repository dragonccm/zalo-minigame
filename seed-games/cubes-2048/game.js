(() => {
'use strict';

/* ============================================================
   Cubes 2048 Arena — rắn khối 3D kết hợp 2048
   ============================================================ */

// ---------- Cấu hình ----------
const HALF = 48;            // nửa cạnh đấu trường
const SP = 1.08;            // khoảng cách giữa các khối trong chuỗi
const STEP = 0.12;          // khoảng cách lấy mẫu vết di chuyển
const TURN = 4.2;           // tốc độ xoay (rad/s)
const BASE_SPEED = 6.6;
const BOOST_MULT = 1.75;
const BOOST_TIME = 2;       // giây tăng tốc tối đa
const BOOST_CD = 6;         // giây hồi
const FREE_TARGET = 230;
const FREE_MAX = 340;
const DIV_COUNT = 12;
const POWER_COUNT = 6;
const SHIELD_TIME = 6;
const MAGNET_TIME = 9;
const SPAWN_SHIELD = 3;

// ---------- Tiện ích ----------
const $ = id => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const angDiff = (a, b) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
};
const fmt = v => v >= 1048576 ? (v / 1048576) + 'M' : v >= 1024 ? (v / 1024) + 'K' : '' + v;
const pick = arr => arr[(Math.random() * arr.length) | 0];

// ---------- Lưu trữ qua GameHub (đồng bộ lên tài khoản người chơi) ----------
const GH = window.GameHub;
const SAVE = window.__save && typeof window.__save === 'object' ? window.__save : {};
let saveTimer = 0;
const store = {
  get: (k, d) => (k in SAVE ? SAVE[k] : d),
  set(k, v) {
    SAVE[k] = v;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => GH.save(SAVE).catch(() => { /* chưa đăng nhập: bỏ qua */ }), 1000);
  },
};

// ---------- Cài đặt ----------
const DEFAULTS = { vol: 100, fx: 2, shake: true, names: true, minimap: true, sens: 100, res: 1, bots: 11 };
const settings = Object.assign({}, DEFAULTS);
Object.assign(settings, store.get('settings', {}));
settings.bots = clamp(settings.bots | 0, 4, 18);
settings.fx = clamp(settings.fx | 0, 0, 2);
settings.res = clamp(settings.res | 0, 0, 2);
const saveSettings = () => store.set('settings', settings);

const PALETTE = ['#f5c542', '#f58f42', '#f2574d', '#e0489a', '#a65cf0', '#5a6cf5', '#3aa0f0',
  '#26c4c0', '#3fcf7a', '#9bd63a', '#ffd23f', '#ff7a59', '#c084fc', '#60a5fa', '#34d399', '#fb7185'];
const SNAKE_COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#22b8cf',
  '#f06595', '#94d82d', '#748ffc', '#e8590c', '#12b886'];
const BOT_NAMES = ['Mèo Béo', 'Rồng Lửa', 'Cún Con', 'Gấu Trúc', 'Sói Xám', 'Ninja', 'Tí Hon', 'Sao Băng',
  'Bạch Tuộc', 'Hổ Con', 'Cá Mập', 'Đại Bàng', 'Thỏ Ngọc', 'Khủng Long', 'Kỳ Lân', 'Lão Ngộ'];

// ---------- Three.js ----------
const canvas = $('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x120d2b);
scene.fog = new THREE.Fog(0x120d2b, 70, 170);
const camera = new THREE.PerspectiveCamera(50, 1, 0.5, 300);

scene.add(new THREE.AmbientLight(0xffffff, 0.85));
const sun = new THREE.DirectionalLight(0xffffff, 0.55);
sun.position.set(-10, 30, 14);
scene.add(sun);

function resize() {
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
function applyResolution() {
  const dpr = window.devicePixelRatio || 1;
  renderer.setPixelRatio([0.7, Math.min(dpr, 1.5), Math.min(dpr, 2)][settings.res]);
  resize();
}
applyResolution();

// Sàn + tường
(function buildArena() {
  const g = document.createElement('canvas');
  g.width = g.height = 128;
  const x = g.getContext('2d');
  x.fillStyle = '#1d1745'; x.fillRect(0, 0, 128, 128);
  x.strokeStyle = '#2d2566'; x.lineWidth = 3; x.strokeRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(g);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(HALF, HALF);
  tex.anisotropy = 4;
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, HALF * 2), new THREE.MeshBasicMaterial({ map: tex }));
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const outer = new THREE.Mesh(new THREE.PlaneGeometry(600, 600), new THREE.MeshBasicMaterial({ color: 0x0a0720 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.05;
  scene.add(outer);

  const wallMat = new THREE.MeshBasicMaterial({ color: 0x7c5cff });
  const L = HALF * 2 + 2;
  [[0, -HALF - 0.5, L, 1], [0, HALF + 0.5, L, 1], [-HALF - 0.5, 0, 1, L], [HALF + 0.5, 0, 1, L]].forEach(([px, pz, w, d]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 1.2, d), wallMat);
    m.position.set(px, 0.6, pz);
    scene.add(m);
  });
})();

// ---------- Vật liệu / texture số ----------
const boxGeo = new THREE.BoxGeometry(1, 1, 1);
const matCache = new Map();

function colorFor(v) {
  return PALETTE[(Math.round(Math.log2(v)) - 1 + PALETTE.length) % PALETTE.length];
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

const hexRgb = h => { const n = parseInt(h.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
const hexA = (h, a) => { const [r, g, b] = hexRgb(h); return `rgba(${r},${g},${b},${a})`; };
const mixHex = (h1, h2, t) => {
  const a = hexRgb(h1), b = hexRgb(h2);
  return '#' + a.map((v, i) => Math.round(v + (b[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const seeded = seed => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

// --- Skin cổ điển ---
function drawClassic(x, text, bg, border) {
  x.fillStyle = border; x.fillRect(0, 0, 128, 128);
  x.fillStyle = bg; roundRect(x, 8, 8, 112, 112, 18); x.fill();
  x.fillStyle = 'rgba(255,255,255,0.18)'; roundRect(x, 8, 8, 112, 50, 18); x.fill();
  const n = text.length;
  x.font = `800 ${n <= 1 ? 78 : n === 2 ? 66 : n === 3 ? 52 : 42}px "Segoe UI", Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 8; x.strokeStyle = 'rgba(0,0,0,0.35)'; x.strokeText(text, 64, 68);
  x.fillStyle = '#fff'; x.fillText(text, 64, 68);
}

function makeLabelTexture(text, bg, border) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  drawClassic(c.getContext('2d'), text, bg, border);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  return t;
}

// --- Skin Electric: khối kính trong suốt phát sáng, tia sét chạy bên trong ---
function drawElectric(x, text, col, v) {
  x.clearRect(0, 0, 128, 128);
  const g = x.createRadialGradient(64, 64, 6, 64, 64, 86);
  g.addColorStop(0, hexA(col, 0.34)); g.addColorStop(1, hexA(col, 0.07));
  x.fillStyle = g; roundRect(x, 7, 7, 114, 114, 16); x.fill();

  // tia sét zíc-zắc bên trong thân kính
  const rnd = seeded(v * 131 + 7);
  x.lineCap = x.lineJoin = 'round';
  x.shadowColor = col; x.shadowBlur = 6;
  x.strokeStyle = 'rgba(190,245,255,0.6)'; x.lineWidth = 1.7;
  for (let k = 0; k < 3; k++) {
    const horiz = k % 2 === 0;
    let a = 10 + rnd() * 20, b = 12 + rnd() * 104;
    x.beginPath();
    x.moveTo(horiz ? a : b, horiz ? b : a);
    for (let s = 1; s <= 6; s++) {
      const along = a + (108 / 6) * s + (rnd() - 0.5) * 8;
      b = clamp(b + (rnd() - 0.5) * 34, 10, 118);
      x.lineTo(horiz ? along : b, horiz ? b : along);
    }
    x.stroke();
  }

  // viền phát sáng
  x.shadowColor = col; x.shadowBlur = 14;
  x.strokeStyle = '#aef2ff'; x.lineWidth = 5;
  roundRect(x, 7, 7, 114, 114, 16); x.stroke();
  x.shadowBlur = 0;
  x.strokeStyle = '#ffffff'; x.lineWidth = 1.8;
  roundRect(x, 10, 10, 108, 108, 13); x.stroke();
  x.fillStyle = '#fff';
  for (const [px, py] of [[14, 14], [114, 14], [14, 114], [114, 114]]) { x.beginPath(); x.arc(px, py, 3, 0, 6.3); x.fill(); }

  // số neon
  const n = text.length;
  x.font = `800 ${n <= 1 ? 78 : n === 2 ? 66 : n === 3 ? 52 : 42}px "Segoe UI", Arial, sans-serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = col; x.shadowBlur = 20;
  x.fillStyle = '#ffffff'; x.fillText(text, 64, 68);
  x.shadowBlur = 8; x.fillText(text, 64, 68);
  x.shadowBlur = 0;
}

// --- Skin Trung cổ: đá cũ bọc khung sắt, đinh tán, khiên da cừu ---
function drawMedieval(x, text, col, v) {
  const rnd = seeded(v * 211 + 3);
  x.fillStyle = mixHex(col, '#4a4038', 0.55); x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 280; i++) {
    x.fillStyle = rnd() < 0.5 ? 'rgba(0,0,0,0.10)' : 'rgba(255,255,255,0.07)';
    x.fillRect(rnd() * 128, rnd() * 128, 1 + rnd() * 3, 1 + rnd() * 3);
  }
  x.strokeStyle = 'rgba(0,0,0,0.28)'; x.lineWidth = 1.2;
  for (let k = 0; k < 3; k++) {
    let px = rnd() * 128, py = rnd() * 128;
    x.beginPath(); x.moveTo(px, py);
    for (let s = 0; s < 4; s++) { px += (rnd() - 0.5) * 30; py += (rnd() - 0.5) * 30; x.lineTo(px, py); }
    x.stroke();
  }
  // khung sắt
  const fg = x.createLinearGradient(0, 0, 128, 128);
  fg.addColorStop(0, '#7a828b'); fg.addColorStop(0.5, '#3a3e45'); fg.addColorStop(1, '#646b73');
  x.strokeStyle = fg; x.lineWidth = 12; x.strokeRect(6, 6, 116, 116);
  x.strokeStyle = 'rgba(255,255,255,0.3)'; x.lineWidth = 1.5; x.strokeRect(1, 1, 126, 126);
  x.strokeStyle = 'rgba(0,0,0,0.55)'; x.strokeRect(12.5, 12.5, 103, 103);
  // đinh tán
  for (const [px, py] of [[19, 19], [109, 19], [19, 109], [109, 109]]) {
    x.fillStyle = '#23262b'; x.beginPath(); x.arc(px, py, 6.5, 0, 6.3); x.fill();
    const rg = x.createRadialGradient(px - 1.5, py - 1.5, 0.5, px, py, 5);
    rg.addColorStop(0, '#e6eaee'); rg.addColorStop(1, '#6a7078');
    x.fillStyle = rg; x.beginPath(); x.arc(px, py, 5, 0, 6.3); x.fill();
  }
  // khiên da cừu
  const shield = () => {
    x.beginPath(); x.moveTo(33, 29); x.lineTo(95, 29); x.lineTo(95, 70);
    x.quadraticCurveTo(95, 100, 64, 111); x.quadraticCurveTo(33, 100, 33, 70); x.closePath();
  };
  shield(); x.fillStyle = mixHex('#ead9a6', col, 0.16); x.fill();
  x.strokeStyle = '#2b1d0e'; x.lineWidth = 3.5; x.stroke();
  x.save(); x.translate(64, 70); x.scale(0.88, 0.88); x.translate(-64, -70);
  shield(); x.strokeStyle = '#b8913f'; x.lineWidth = 1.6; x.stroke(); x.restore();
  const n = text.length;
  x.font = `800 ${n <= 1 ? 54 : n === 2 ? 44 : n === 3 ? 31 : 25}px Georgia, "Times New Roman", serif`;
  x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 3; x.strokeStyle = 'rgba(255,245,210,0.55)'; x.strokeText(text, 64, 66);
  x.fillStyle = '#3a2411'; x.fillText(text, 64, 66);
}

const SKINS = {
  classic: {
    name: 'Cổ điển', accent: null, trail2: '#ffffff',
    draw: (x, t, c) => drawClassic(x, t, c, '#00000055'),
    material: map => new THREE.MeshLambertMaterial({ map }),
  },
  electric: {
    name: 'Electric', accent: '#7ae7ff', trail2: '#ffffff',
    draw: drawElectric,
    material: map => new THREE.MeshBasicMaterial({ map, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  },
  medieval: {
    name: 'Trung cổ', accent: '#e0b04a', trail2: '#8a6a3f',
    draw: drawMedieval,
    material: map => new THREE.MeshLambertMaterial({ map }),
  },
};
const SKIN_IDS = Object.keys(SKINS);

function drawSkinCanvas(skin, v) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  SKINS[skin].draw(c.getContext('2d'), fmt(v), colorFor(v), v);
  return c;
}

function matFor(v, skin = 'classic') {
  const key = skin + ':' + v;
  let m = matCache.get(key);
  if (!m) {
    const tex = new THREE.CanvasTexture(drawSkinCanvas(skin, v));
    tex.anisotropy = 4;
    m = SKINS[skin].material(tex);
    matCache.set(key, m);
  }
  return m;
}

const dividerMat = new THREE.MeshLambertMaterial({ map: makeLabelTexture('÷2', '#e03131', '#5c0a0a') });

// icon Lucide vẽ lên canvas (viền tối để nổi trên nền đấu trường)
function iconTexture(name, color) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  ic.draw(x, name, 16, 16, 96, 'rgba(8,5,24,0.75)', 4.6);
  ic.draw(x, name, 16, 16, 96, color, 2.6);
  return new THREE.CanvasTexture(c);
}
const POWER_TYPES = {
  shield: { icon: 'shield', color: 0x4dabf7 },
  magnet: { icon: 'magnet', color: 0xff6b6b },
};
for (const k in POWER_TYPES) POWER_TYPES[k].tex = iconTexture(POWER_TYPES[k].icon, '#' + POWER_TYPES[k].color.toString(16).padStart(6, '0'));

// ---------- Âm thanh ----------
let actx = null, muted = false, lastPick = 0;
function initAudio() {
  if (actx) return;
  try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
}
function tone(freq, dur, type = 'sine', vol = 0.08, slide = 0, delay = 0) {
  if (!actx || muted || settings.vol <= 0) return;
  vol *= settings.vol / 100;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  o.connect(g); g.connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function sfx(name) {
  const now = performance.now();
  switch (name) {
    case 'pick': if (now - lastPick < 60) return; lastPick = now; tone(620 + Math.random() * 120, 0.07, 'sine', 0.05); break;
    case 'merge': tone(440, 0.12, 'triangle', 0.09); tone(660, 0.12, 'triangle', 0.09, 0, 0.07); tone(880, 0.16, 'triangle', 0.09, 0, 0.14); break;
    case 'eat': tone(300, 0.14, 'square', 0.06, 300); break;
    case 'die': tone(300, 0.6, 'sawtooth', 0.1, -230); break;
    case 'bad': tone(180, 0.25, 'square', 0.08, -90); break;
    case 'power': tone(520, 0.1, 'sine', 0.09); tone(780, 0.18, 'sine', 0.09, 0, 0.08); break;
    case 'dash': tone(180, 0.28, 'sawtooth', 0.045, 700); break;
    case 'ad': tone(523, 0.12, 'triangle', 0.09); tone(659, 0.12, 'triangle', 0.09, 0, 0.09); tone(784, 0.12, 'triangle', 0.09, 0, 0.18); tone(1047, 0.25, 'triangle', 0.09, 0, 0.27); break;
  }
}

// ---------- Hiệu ứng: hạt, sóng xung kích, chữ nổi, rung, nháy màn hình ----------
const fxMul = () => [0, 0.5, 1][settings.fx];
const PMAX = 700;
const pMesh = new THREE.InstancedMesh(boxGeo, new THREE.MeshBasicMaterial(), PMAX);
pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
pMesh.frustumCulled = false;
scene.add(pMesh);
const P = [];
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
for (let i = 0; i < PMAX; i++) {
  P.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, max: 1, size: 0.2, g: 0, rx: 0, ry: 0 });
  pMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
  pMesh.setColorAt(i, _c.set('#ffffff'));
}
let pCursor = 0, pDirty = false;

function emit(x, y, z, vx, vy, vz, color, size, life, g) {
  if (!settings.fx) return;
  for (let k = 0; k < PMAX; k++) {
    const i = (pCursor + k) % PMAX, p = P[i];
    if (p.on) continue;
    p.on = true; p.x = x; p.y = y; p.z = z; p.vx = vx; p.vy = vy; p.vz = vz;
    p.t = 0; p.max = life; p.size = size; p.g = g;
    p.rx = rand(0, 6.28); p.ry = rand(0, 6.28);
    pMesh.setColorAt(i, _c.set(color));
    pCursor = i + 1; pDirty = true;
    return;
  }
}

function burst(x, z, color, n, speed, size = 0.22, up = 1) {
  n = Math.round(n * fxMul());
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(0.4, 1) * speed;
    emit(x, 0.6, z, Math.cos(a) * sp, rand(2, 6) * up, Math.sin(a) * sp, color, size * rand(0.6, 1.2), rand(0.5, 0.9), 14);
  }
}

function updateParticles(dt) {
  let any = false;
  for (let i = 0; i < PMAX; i++) {
    const p = P[i];
    if (!p.on) continue;
    any = true;
    p.t += dt;
    if (p.t >= p.max) {
      p.on = false;
      pMesh.setMatrixAt(i, _m.makeScale(0, 0, 0));
      continue;
    }
    p.vy -= p.g * dt;
    p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    if (p.y < 0.05) { p.y = 0.05; p.vy *= -0.35; p.vx *= 0.8; p.vz *= 0.8; }
    const s = p.size * (0.3 + 0.7 * (1 - p.t / p.max));
    _e.set(p.rx + p.t * 6, p.ry + p.t * 5, 0);
    _q.setFromEuler(_e);
    _p.set(p.x, p.y, p.z); _s.set(s, s, s);
    pMesh.setMatrixAt(i, _m.compose(_p, _q, _s));
  }
  if (any || pDirty) {
    pMesh.instanceMatrix.needsUpdate = true;
    pMesh.instanceColor.needsUpdate = true;
    pDirty = false;
  }
}

// sóng xung kích trên sàn
const RINGS = [];
const unitRing = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
for (let i = 0; i < 16; i++) {
  const mesh = new THREE.Mesh(unitRing, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false }));
  mesh.visible = false;
  scene.add(mesh);
  RINGS.push({ mesh, on: false, t: 0, max: 1, r0: 1, r1: 3 });
}
function shock(x, z, color, r1 = 4, dur = 0.45, r0 = 0.6) {
  if (!settings.fx) return;
  const r = RINGS.find(q => !q.on);
  if (!r) return;
  r.on = true; r.t = 0; r.max = dur; r.r0 = r0; r.r1 = r1;
  r.mesh.material.color.set(color);
  r.mesh.position.set(x, 0.08, z);
  r.mesh.visible = true;
}
function updateRings(dt) {
  for (const r of RINGS) {
    if (!r.on) continue;
    r.t += dt;
    const k = r.t / r.max;
    if (k >= 1) { r.on = false; r.mesh.visible = false; continue; }
    const s = r.r0 + (r.r1 - r.r0) * (1 - (1 - k) * (1 - k));
    r.mesh.scale.set(s, 1, s);
    r.mesh.material.opacity = 0.9 * (1 - k);
  }
}

// chữ nổi (+giá trị, hợp nhất...)
const floats = [];
function floatText(x, z, text, color, big) {
  if (settings.fx === 0) return;
  if (floats.length >= 14) floats.shift().el.remove();
  const el = document.createElement('div');
  el.className = 'float' + (big ? ' big' : '');
  el.textContent = text;
  el.style.color = color;
  $('labels').appendChild(el);
  floats.push({ el, x, z, y: 1.6, t: 0, max: 1.1 });
}
function updateFloats(dt) {
  const w = window.innerWidth, h = window.innerHeight;
  for (let i = floats.length - 1; i >= 0; i--) {
    const f = floats[i];
    f.t += dt;
    if (f.t >= f.max) { f.el.remove(); floats.splice(i, 1); continue; }
    f.y += dt * 2.4;
    tmpV.set(f.x, f.y, f.z).project(camera);
    const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
    f.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
    f.el.style.opacity = String(1 - Math.max(0, (f.t / f.max - 0.55) / 0.45));
  }
}

let shakeAmt = 0;
function addShake(a) { if (settings.shake) shakeAmt = Math.min(1.4, shakeAmt + a); }
const flashEl = $('flash');
function flash(color, alpha) {
  if (!settings.fx) return;
  flashEl.style.transition = 'none';
  flashEl.style.background = color;
  flashEl.style.opacity = String(alpha);
  void flashEl.offsetWidth;
  flashEl.style.transition = 'opacity .6s ease-out';
  flashEl.style.opacity = '0';
}

// ---------- Thực thể ----------
const snakes = [];
const frees = [];
const dividers = [];
const powers = [];
let time = 0;

// vật liệu "ma": bản sao trong suốt của vật liệu khối (dùng khi nhân vật tàng hình lúc làm nhiệm vụ)
const ghostMats = new Map();
function ghostMatOf(m) {
  let g = ghostMats.get(m);
  if (!g) { g = m.clone(); g.transparent = true; g.opacity = 0.3; g.depthWrite = false; ghostMats.set(m, g); }
  return g;
}

class Cube {
  constructor(value, skin = 'classic') {
    this.value = value;
    this.skin = skin;
    this.ghost = false;
    this.mesh = new THREE.Mesh(boxGeo, matFor(value, skin));
    this.x = 0; this.z = 0;
    this.pop = 0;
    scene.add(this.mesh);
  }
  applyMat() { const m = matFor(this.value, this.skin); this.mesh.material = this.ghost ? ghostMatOf(m) : m; }
  setValue(v) { this.value = v; this.applyMat(); }
  setSkin(s) { this.skin = s; this.applyMat(); }
  dispose() { scene.remove(this.mesh); }
}

// ---------- Trang trí theo skin ----------
const addMat = color => new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });

function buildHalo() {
  const g = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.035, 8, 36), addMat(0x7ae7ff));
  ring.rotation.x = Math.PI / 2;
  const ring2 = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.025, 8, 28), addMat(0xffffff));
  ring2.rotation.set(Math.PI / 2 + 0.6, 0, 0);
  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.15), addMat(0xffffff));
  g.add(ring, ring2, core);
  return g;
}

function buildCrown() {
  const g = new THREE.Group();
  const gold = new THREE.MeshLambertMaterial({ color: 0xe0b04a, emissive: 0x3a2a05, side: THREE.DoubleSide });
  const ruby = new THREE.MeshLambertMaterial({ color: 0xd02a3a, emissive: 0x500810 });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.31, 0.17, 16, 1, true), gold));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.085, 0.26, 6), gold);
    cone.position.set(Math.cos(a) * 0.33, 0.2, Math.sin(a) * 0.33);
    const gem = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), ruby);
    gem.position.set(Math.cos(a) * 0.33, 0.35, Math.sin(a) * 0.33);
    g.add(cone, gem);
  }
  return g;
}

const BOLT_MAX = 64 * 8;
function buildBolt() {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(BOLT_MAX * 6), 3));
  geo.setDrawRange(0, 0);
  const line = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({
    color: 0xaef2ff, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  line.frustumCulled = false;
  return line;
}

const ringGeo = new THREE.RingGeometry(0.85, 1.12, 40).rotateX(-Math.PI / 2);
const shieldGeo = new THREE.SphereGeometry(1.35, 24, 16);

class Snake {
  constructor(name, isPlayer, color) {
    this.name = name;
    this.isPlayer = isPlayer;
    this.color = color;
    this.alive = false;
    this.cubes = [];
    this.trail = [];
    this.x = 0; this.z = 0; this.angle = 0; this.target = 0;
    this.energy = 1; this.locked = false; this.boosting = false; this.wantBoost = false;
    this.shield = 0; this.magnet = 0;
    this.respawnAt = 0; this.thinkAt = 0;
    this.maxValue = 2;
    this.overdrive = 0; this.fxAcc = 0; this.wasBoosting = false;

    this.ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
    this.ring.position.y = 0.03;
    this.bubble = new THREE.Mesh(shieldGeo, new THREE.MeshBasicMaterial({ color: 0x74c0fc, transparent: true, opacity: 0.28, depthWrite: false }));
    this.ring.visible = this.bubble.visible = false;
    scene.add(this.ring, this.bubble);

    this.kills = 0; this.born = 0;
    this.skin = 'classic'; this.fxCol = color; this.trail2 = '#ffffff';
    this.deco = null; this.bolt = null; this.sparkAcc = 0;

    this.label = document.createElement('div');
    this.label.className = 'label';
    this.label.style.color = color;
    this.nameEl = document.createElement('span');
    this.valEl = document.createElement('span');
    this.valEl.className = 'val';
    this.label.append(this.nameEl, this.valEl);
    this.nameEl.textContent = name;
    this.label.style.display = 'none';
    $('labels').appendChild(this.label);
  }

  setName(n) { this.name = n; this.nameEl.textContent = n; }

  setSkin(id) {
    if (!SKINS[id]) id = 'classic';
    if (this.skin === id) return;
    this.skin = id;
    const def = SKINS[id];
    this.fxCol = def.accent || this.color;
    this.trail2 = def.trail2;
    this.ring.material.color.set(this.fxCol);
    if (this.deco) { scene.remove(this.deco); this.deco = null; }
    if (this.bolt) { scene.remove(this.bolt); this.bolt.geometry.dispose(); this.bolt = null; }
    if (id === 'electric') { this.deco = buildHalo(); this.bolt = buildBolt(); }
    else if (id === 'medieval') this.deco = buildCrown();
    if (this.deco) { scene.add(this.deco); this.deco.visible = this.alive; }
    if (this.bolt) { scene.add(this.bolt); this.bolt.visible = this.alive; }
    for (const c of this.cubes) c.setSkin(id);
  }

  // tia sét nối các khối trong chuỗi (skin Electric)
  updateBolt(dt) {
    const attr = this.bolt.geometry.attributes.position, pos = attr.array;
    const cs = this.cubes, links = Math.min(cs.length - 1, 63);
    let n = 0;
    for (let i = 0; i < links; i++) {
      const a = cs[i], b = cs[i + 1];
      for (let rep = 0; rep < 2; rep++) {   // 2 tia mỗi mắt xích cho dày hơn
        if (Math.random() < 0.2) continue;
        let px = a.x, py = 0.55, pz = a.z;
        for (let s = 1; s <= 4; s++) {
          const t = s / 4, last = s === 4;
          const qx = a.x + (b.x - a.x) * t + (last ? 0 : rand(-0.3, 0.3));
          const qz = a.z + (b.z - a.z) * t + (last ? 0 : rand(-0.3, 0.3));
          const qy = 0.55 + (last ? 0 : rand(-0.25, 0.25));
          const o = n * 6;
          pos[o] = px; pos[o + 1] = py; pos[o + 2] = pz; pos[o + 3] = qx; pos[o + 4] = qy; pos[o + 5] = qz;
          px = qx; py = qy; pz = qz; n++;
        }
      }
    }
    attr.needsUpdate = true;
    this.bolt.geometry.setDrawRange(0, n * 2);
    // tia lửa bắn ra từ các khối
    this.sparkAcc += dt;
    while (this.sparkAcc > 0.12) {
      this.sparkAcc -= 0.12;
      const c = cs[(Math.random() * cs.length) | 0];
      emit(c.x, 0.6, c.z, rand(-3, 3), rand(1, 4), rand(-3, 3), '#9be8ff', 0.12, 0.35, 6);
    }
  }

  get head() { return this.cubes[0]; }
  get score() { let s = 0; for (const c of this.cubes) s += c.value; return s; }

  spawn(x, z, value) {
    this.alive = true;
    this.x = x; this.z = z;
    this.angle = this.target = rand(0, Math.PI * 2);
    this.energy = 1; this.locked = false; this.boosting = false;
    this.shield = SPAWN_SHIELD; this.magnet = 0; this.overdrive = 0;
    this.maxValue = value;
    this.ghost = false; this.ghostHidden = false;
    for (const c of this.cubes) c.dispose();
    this.cubes = [];
    const c = new Cube(value, this.skin);
    c.x = x; c.z = z;
    this.cubes.push(c);
    this.trail = [];
    for (let k = 24; k >= 0; k--) {
      this.trail.push({ x: x - Math.cos(this.angle) * k * STEP, z: z - Math.sin(this.angle) * k * STEP });
    }
    this.ring.visible = true;
    this.label.style.display = '';
    if (this.deco) this.deco.visible = true;
    if (this.bolt) this.bolt.visible = true;
    shock(x, z, this.fxCol, 4.5, 0.7, 0.8);
    burst(x, z, this.fxCol, 14, 4);
  }

  dispose() {
    for (const c of this.cubes) c.dispose();
    this.cubes = [];
    if (this.deco) scene.remove(this.deco);
    if (this.bolt) { scene.remove(this.bolt); this.bolt.geometry.dispose(); }
    scene.remove(this.ring, this.bubble);
    this.label.remove();
  }

  addValue(v, fx, fz) {
    const c = new Cube(v, this.skin);
    if (this.ghost) { c.ghost = this.isPlayer; c.applyMat(); c.mesh.visible = !this.ghostHidden; }
    c.x = fx; c.z = fz;
    let idx = this.cubes.findIndex(q => q.value <= v);
    if (idx < 0) idx = this.cubes.length;
    this.cubes.splice(idx, 0, c);
    this.merge();
    const hv = this.cubes[0].value;
    if (hv > this.maxValue) this.maxValue = hv;
  }

  merge() {
    let merged = false, again = true, last = null;
    while (again) {
      again = false;
      for (let i = 0; i < this.cubes.length - 1; i++) {
        const a = this.cubes[i], b = this.cubes[i + 1];
        if (a.value === b.value) {
          a.setValue(a.value * 2);
          a.pop = 1;
          last = a;
          b.dispose();
          this.cubes.splice(i + 1, 1);
          again = merged = true;
          break;
        }
      }
    }
    if (merged) {
      fxMerge(this, last);
      if (this.isPlayer) sfx('merge');
    }
  }

  step(dt) {
    // tăng tốc: tối đa 2s, sau đó hồi 6s
    if (this.overdrive > 0) { this.overdrive -= dt; this.locked = false; this.energy = 1; }
    if (this.locked) {
      this.boosting = false;
      this.energy += dt / BOOST_CD;
      if (this.energy >= 1) { this.energy = 1; this.locked = false; }
    } else if (this.wantBoost && this.energy > 0) {
      this.boosting = true;
      this.energy -= dt / BOOST_TIME;
      if (this.energy <= 0) { this.energy = 0; this.locked = true; this.boosting = false; }
    } else {
      this.boosting = false;
      this.energy = Math.min(1, this.energy + dt / BOOST_CD);
    }
    if (this.boosting && !this.wasBoosting) fxDashStart(this);
    this.wasBoosting = this.boosting;
    if (this.shield > 0) this.shield -= dt;
    if (this.magnet > 0) this.magnet -= dt;

    const hv = this.cubes[0].value;
    const speed = (BASE_SPEED - Math.min(1.8, Math.log2(hv) * 0.11)) * (this.boosting ? BOOST_MULT : 1);
    const d = angDiff(this.angle, this.target);
    const mt = TURN * (this.isPlayer ? settings.sens / 100 : 1) * dt;
    this.angle += clamp(d, -mt, mt);
    this.x += Math.cos(this.angle) * speed * dt;
    this.z += Math.sin(this.angle) * speed * dt;
    if (this.boosting) {
      this.fxAcc += dt;
      while (this.fxAcc > 0.03) { this.fxAcc -= 0.03; fxDashTrail(this); }
    } else this.fxAcc = 0;
    const lim = HALF - 0.7;
    this.x = clamp(this.x, -lim, lim);
    this.z = clamp(this.z, -lim, lim);

    const tr = this.trail, n = tr.length;
    tr[n - 1].x = this.x; tr[n - 1].z = this.z;
    const p = tr[n - 2];
    if (Math.hypot(this.x - p.x, this.z - p.z) >= STEP) tr.push({ x: this.x, z: this.z });
  }

  layout(dt) {
    const cubes = this.cubes, tr = this.trail;
    const head = cubes[0];
    head.x = this.x; head.z = this.z;
    const k = 1 - Math.exp(-16 * dt);
    let ci = 1, acc = 0, next = SP, cut = -1;
    const need = cubes.length * SP + 2;
    for (let i = tr.length - 1; i > 0; i--) {
      const a = tr[i], b = tr[i - 1];
      const seg = Math.hypot(a.x - b.x, a.z - b.z);
      if (seg < 1e-6) continue;
      while (ci < cubes.length && acc + seg >= next) {
        const t = (next - acc) / seg;
        const c = cubes[ci];
        c.x += (a.x + (b.x - a.x) * t - c.x) * k;
        c.z += (a.z + (b.z - a.z) * t - c.z) * k;
        ci++; next = ci * SP;
      }
      acc += seg;
      if (acc > need) { cut = i - 1; break; }
    }
    for (; ci < cubes.length; ci++) {
      const c = cubes[ci], last = tr[0];
      c.x += (last.x - c.x) * k; c.z += (last.z - c.z) * k;
    }
    if (cut > 30) tr.splice(0, cut - 2);

    for (let i = 0; i < cubes.length; i++) {
      const c = cubes[i];
      c.pop = Math.max(0, c.pop - dt * 3);
      const s = (i === 0 ? 1.18 : 0.96) * (1 + 0.4 * Math.sin(c.pop * Math.PI));
      c.mesh.scale.setScalar(s);
      c.mesh.position.set(c.x, s * 0.5, c.z);
    }
    this.ring.position.x = this.x; this.ring.position.z = this.z;
    const rs = 1 + 0.06 * Math.sin(time * 5);
    this.ring.scale.set(rs, 1, rs);
    this.bubble.visible = !this.ghostHidden && this.shield > 0 && (this.shield > 1.2 || Math.floor(time * 8) % 2 === 0);
    this.bubble.position.set(this.x, 0.7, this.z);
    if (this.deco) {
      const electric = this.skin === 'electric';
      this.deco.position.set(this.x, head.mesh.scale.x + (electric ? 0.45 + Math.sin(time * 4) * 0.06 : 0.1), this.z);
      this.deco.rotation.y = time * (electric ? 2.5 : 0.9);
    }
    if (this.bolt) this.updateBolt(dt);
  }

  // Tàng hình khi làm nhiệm vụ: nhân vật của mình mờ đi, rắn của người khác thì biến mất hẳn
  setGhost(on) {
    on = !!on;
    if (!!this.ghost === on || !this.alive) return;
    this.ghost = on;
    this.ghostHidden = on && !this.isPlayer;
    for (const c of this.cubes) { c.ghost = on && this.isPlayer; c.applyMat(); c.mesh.visible = !this.ghostHidden; }
    if (this.deco) this.deco.visible = !this.ghostHidden;
    if (this.bolt) this.bolt.visible = !this.ghostHidden;
    this.ring.visible = !this.ghostHidden;
    this.label.style.display = this.ghostHidden ? 'none' : '';
    if (on && this.isPlayer) { shock(this.x, this.z, '#9ad7ff', 5, 0.8, 0.8); }
  }

  hide() {
    this.ring.visible = this.bubble.visible = false;
    if (this.deco) this.deco.visible = false;
    if (this.bolt) this.bolt.visible = false;
    this.label.style.display = 'none';
  }
}

// ---------- Vật thể tự do ----------
function spawnValue() {
  let maxLog = 1;
  for (const s of snakes) if (s.alive) maxLog = Math.max(maxLog, Math.log2(s.head.value));
  const tier = clamp(Math.floor(maxLog) - 3, 4, 10);
  let total = 0;
  const w = [];
  for (let e = 1; e <= tier; e++) { const x = Math.pow(0.55, e - 1); w.push(x); total += x; }
  let r = Math.random() * total;
  for (let e = 1; e <= tier; e++) { r -= w[e - 1]; if (r <= 0) return 1 << e; }
  return 2;
}

function spawnFree(v, x, z, scatter) {
  const mesh = new THREE.Mesh(boxGeo, matFor(v));
  mesh.scale.setScalar(0.72);
  scene.add(mesh);
  const f = { v, x, z, vx: 0, vz: 0, mesh, phase: Math.random() * 6.28 };
  if (scatter) {
    const a = rand(0, Math.PI * 2), sp = rand(3, 9);
    f.vx = Math.cos(a) * sp; f.vz = Math.sin(a) * sp;
  }
  frees.push(f);
}
function removeFree(i) {
  scene.remove(frees[i].mesh);
  frees[i] = frees[frees.length - 1];
  frees.pop();
}

function randPos(margin = 3) {
  return { x: rand(-HALF + margin, HALF - margin), z: rand(-HALF + margin, HALF - margin) };
}

function spawnDivider() {
  const mesh = new THREE.Mesh(boxGeo, dividerMat);
  mesh.scale.setScalar(1.1);
  scene.add(mesh);
  const p = randPos(4);
  dividers.push({ x: p.x, z: p.z, mesh, phase: Math.random() * 6.28 });
}
function respawnDivider(d) {
  const p = randPos(4);
  d.x = p.x; d.z = p.z;
}

function spawnPower() {
  const type = Math.random() < 0.5 ? 'shield' : 'magnet';
  const def = POWER_TYPES[type];
  const group = new THREE.Group();
  const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.75), new THREE.MeshBasicMaterial({ color: def.color, transparent: true, opacity: 0.55 }));
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: def.tex, depthWrite: false }));
  sprite.scale.set(1.4, 1.4, 1);
  sprite.position.y = 0.1;
  group.add(gem, sprite);
  scene.add(group);
  const p = randPos(4);
  powers.push({ type, x: p.x, z: p.z, group, gem, phase: Math.random() * 6.28 });
}
function respawnPower(pw) {
  const p = randPos(4);
  pw.x = p.x; pw.z = p.z;
}

// ---------- Sự kiện trong game ----------
let state = 'menu';           // menu | playing | dead
let player = null;
let focus = { x: 0, z: 0, d: 30 };
let best = 0;
best = Number(store.get('best', 0)) || 0;

// đặt nội dung = icon SVG + chữ (chữ là text node nên tên người chơi không thể chèn HTML)
function setIc(el, icon, text) {
  el.innerHTML = icon ? ic(icon) : '';
  if (text) el.append((icon ? ' ' : '') + text);
}

function feed(msg, cls, icon) {
  const box = $('feed');
  const el = document.createElement('div');
  setIc(el, icon, msg);
  if (cls) el.className = cls;
  box.appendChild(el);
  while (box.children.length > 4) box.removeChild(box.firstChild);
  setTimeout(() => el.remove(), 4000);
}

// --- hiệu ứng gắn với sự kiện ---
function fxMerge(s, c) {
  const col = colorFor(c.value);
  burst(c.x, c.z, col, s.isPlayer ? 18 : 8, 5, 0.2);
  shock(c.x, c.z, col, s.isPlayer ? 3.2 : 2.2, 0.4, 0.5);
  if (s.isPlayer) {
    floatText(c.x, c.z, fmt(c.value) + '!', '#ffd23f', true);
    if (c.value >= 64) { addShake(0.15); flash('#ffffff', 0.12); }
  }
}
function fxDashStart(s) {
  shock(s.x, s.z, s.fxCol, 5.5, 0.5, 1);
  burst(s.x, s.z, s.fxCol, 14, 6, 0.2, 0.4);
  if (s.isPlayer) { sfx('dash'); addShake(0.25); }
}
function fxDashTrail(s) {
  if (settings.fx === 1 && Math.random() < 0.5) return;
  const bx = -Math.cos(s.angle), bz = -Math.sin(s.angle);
  emit(s.x + bx * 0.6 + rand(-0.3, 0.3), 0.4 + rand(0, 0.5), s.z + bz * 0.6 + rand(-0.3, 0.3),
    bx * rand(2, 5) + rand(-1, 1), rand(0.3, 2), bz * rand(2, 5) + rand(-1, 1), s.fxCol, rand(0.15, 0.3), rand(0.3, 0.5), 3);
  if (settings.fx > 1) {
    emit(s.x + bx * 0.9, 0.55, s.z + bz * 0.9, bx * 6, 0.3, bz * 6, s.trail2, 0.12, 0.25, 0);
  }
}
function fxEat(a, b, c, isHead) {
  const col = colorFor(c.value);
  burst(c.x, c.z, col, isHead ? 30 : 16, 8, 0.26);
  shock(c.x, c.z, col, isHead ? 5.5 : 3.2, 0.45);
  if (a.isPlayer) {
    floatText(c.x, c.z, '+' + fmt(c.value), '#7dffb0', true);
    addShake(isHead ? 0.45 : 0.22);
  } else if (b.isPlayer) {
    addShake(0.4);
    flash('#ff3b3b', 0.18);
  }
}
function fxDivider(s, d) {
  burst(d.x, d.z, '#ff4d4d', 22, 7, 0.25);
  shock(d.x, d.z, '#ff4d4d', 4, 0.5);
  if (s.isPlayer) { addShake(0.5); flash('#ff3b3b', 0.3); }
}
function fxPower(s, pw) {
  const col = '#' + POWER_TYPES[pw.type].color.toString(16).padStart(6, '0');
  burst(pw.x, pw.z, col, 18, 6, 0.22);
  shock(pw.x, pw.z, col, 4.5, 0.55);
  if (s.isPlayer) flash(col, 0.2);
}

function killSnake(s, killer) {
  if (!s.alive || s.ghost) return;
  s.alive = false;
  if (s.isPlayer) s.deadScore = Math.max(s.lastScore || 0, s.score);
  shock(s.x, s.z, s.fxCol, 7, 0.8, 1);
  for (let i = 0; i < s.cubes.length; i++) {
    const c = s.cubes[i];
    if (i < 8) burst(c.x, c.z, colorFor(c.value), 7, 8, 0.28);
    spawnFree(c.value, c.x + rand(-0.3, 0.3), c.z + rand(-0.3, 0.3), true);
    c.dispose();
  }
  s.cubes = [];
  if (s.isPlayer) { addShake(1.1); flash('#ff1f1f', 0.5); }
  s.hide();
  if (s.isPlayer) {
    sfx('die');
    onPlayerDead(killer);
  } else {
    s.respawnAt = time + 3;
    if (killer && killer.isPlayer) feed(`Bạn đã nuốt ${s.name}!`, 'good');
  }
}

function eatCube(a, b, idx) {
  const c = b.cubes[idx];
  fxEat(a, b, c, idx === 0);
  a.addValue(c.value, c.x, c.z);
  b.cubes.splice(idx, 1);
  c.dispose();
  if (a.isPlayer) sfx('eat');
  if (idx === 0) { a.kills++; killSnake(b, a); }
  else if (b.isPlayer) { sfx('bad'); feed(`${a.name} cắn khối ${fmt(c.value)} của bạn`, 'bad'); }
}

function hitDivider(s) {
  const old = s.cubes[0];
  if (old.value <= 2) return;
  s.cubes.splice(0, 1);
  old.dispose();
  s.addValue(old.value / 2, old.x, old.z);
  if (s.isPlayer) { sfx('bad'); feed(`Số của bạn bị chia đôi: ${fmt(old.value)} → ${fmt(old.value / 2)}`, 'bad', 'divide'); }
}

function applyPower(s, type) {
  if (type === 'shield') s.shield = SHIELD_TIME;
  else s.magnet = MAGNET_TIME;
  if (s.isPlayer) { sfx('power'); feed(type === 'shield' ? 'Khiên bảo vệ!' : 'Nam châm hút khối!', 'good', type); }
}

function collisions() {
  // vật tự do, hố chia, power-up
  for (const a of snakes) {
    if (!a.alive || a.ghost) continue;
    for (let i = frees.length - 1; i >= 0; i--) {
      const f = frees[i];
      const dx = f.x - a.x, dz = f.z - a.z;
      if (dx * dx + dz * dz < 1.0) {
        a.addValue(f.v, f.x, f.z);
        removeFree(i);
        if (a.isPlayer) {
          sfx('pick');
          burst(f.x, f.z, colorFor(f.v), 5, 3, 0.16);
          floatText(f.x, f.z, '+' + fmt(f.v), '#ffffff', false);
        }
      }
    }
    for (const d of dividers) {
      const dx = d.x - a.x, dz = d.z - a.z;
      if (dx * dx + dz * dz < 1.3 && a.shield <= 0) {
        hitDivider(a);
        fxDivider(a, d);
        respawnDivider(d);
      }
    }
    for (const pw of powers) {
      const dx = pw.x - a.x, dz = pw.z - a.z;
      if (dx * dx + dz * dz < 2.0) {
        applyPower(a, pw.type);
        fxPower(a, pw);
        respawnPower(pw);
      }
    }
  }

  // giao tranh giữa các rắn: nuốt khối nhỏ hơn, chết nếu chạm khối lớn hơn
  const doomed = [];
  for (const a of snakes) {
    if (!a.alive || a.ghost) continue;
    let hitBy = null;
    for (const b of snakes) {
      if (b === a || !b.alive || b.ghost || !a.alive) continue;
      const bh = b.cubes[0];
      const reach = b.cubes.length * SP + 2;
      if (Math.abs(bh.x - a.x) > reach + 2 || Math.abs(bh.z - a.z) > reach + 2) continue;
      for (let i = b.cubes.length - 1; i >= 0; i--) {
        const c = b.cubes[i];
        if (!c) continue;
        const dx = c.x - a.x, dz = c.z - a.z;
        if (dx * dx + dz * dz > 1.1) continue;
        const hv = a.cubes[0].value;
        if (hv > c.value) {
          if (b.shield <= 0) eatCube(a, b, i);
        } else if (hv < c.value) {
          hitBy = b;
        }
        if (!b.alive) break;
      }
    }
    if (hitBy && a.alive) doomed.push([a, hitBy]);
  }
  for (const [a, b] of doomed) {
    if (!a.alive) continue;
    if (a.shield > 0) {
      const h = b.cubes[0];
      const dx = a.x - h.x, dz = a.z - h.z, d = Math.hypot(dx, dz) || 1;
      a.x = clamp(a.x + dx / d * 0.35, -HALF + 0.7, HALF - 0.7);
      a.z = clamp(a.z + dz / d * 0.35, -HALF + 0.7, HALF - 0.7);
      burst(a.x, a.z, '#74c0fc', 6, 5, 0.16);
      shock(a.x, a.z, '#74c0fc', 2.8, 0.3);
      if (a.isPlayer) addShake(0.15);
    } else {
      if (b.isPlayer) feed(`Bạn đã nuốt ${a.name}!`, 'good');
      b.kills++;
      killSnake(a, b);
    }
  }
}

function updateFrees(dt) {
  for (const f of frees) {
    if (f.vx || f.vz) {
      f.x = clamp(f.x + f.vx * dt, -HALF + 0.6, HALF - 0.6);
      f.z = clamp(f.z + f.vz * dt, -HALF + 0.6, HALF - 0.6);
      const damp = Math.exp(-3.5 * dt);
      f.vx *= damp; f.vz *= damp;
      if (Math.abs(f.vx) + Math.abs(f.vz) < 0.05) f.vx = f.vz = 0;
    }
  }
  for (const s of snakes) {
    if (!s.alive || s.magnet <= 0) continue;
    for (const f of frees) {
      const dx = s.x - f.x, dz = s.z - f.z, d = Math.hypot(dx, dz);
      if (d < 8 && d > 0.01) {
        const sp = 11 * dt;
        f.x += dx / d * sp; f.z += dz / d * sp;
      }
    }
  }
  for (let n = 0; n < 4 && frees.length < FREE_TARGET; n++) {
    const p = randPos(1.5);
    spawnFree(spawnValue(), p.x, p.z, false);
  }
  while (frees.length > FREE_MAX) removeFree(0);
  for (const f of frees) {
    f.mesh.position.set(f.x, 0.42 + Math.sin(time * 3 + f.phase) * 0.08, f.z);
  }
}

// ---------- Bot AI ----------
function thinkBot(s) {
  const hv = s.cubes[0].value;
  const have = new Set(s.cubes.map(c => c.value));
  let best = -1e9, tx = 0, tz = 0, hasTarget = false, preyClose = false;
  let fx = 0, fz = 0, threat = 0, nearestThreat = 1e9;

  for (const o of snakes) {
    if (o === s || !o.alive || o.ghost) continue;
    const oh = o.cubes[0];
    const dh = Math.hypot(oh.x - s.x, oh.z - s.z);
    if (oh.value > hv && dh < 15) {
      const w = (15 - dh) / 15;
      fx += (s.x - oh.x) / dh * w; fz += (s.z - oh.z) / dh * w;
      threat++; nearestThreat = Math.min(nearestThreat, dh);
    }
    for (let i = 0; i < o.cubes.length; i++) {
      const c = o.cubes[i];
      const dx = c.x - s.x, dz = c.z - s.z, d = Math.hypot(dx, dz);
      if (d > 20) continue;
      if (c.value < hv) {
        if (o.shield > 0) continue;
        const sc = 30 - d + Math.log2(c.value) * 2 + (i === 0 ? 8 : 0);
        if (sc > best) { best = sc; tx = c.x; tz = c.z; hasTarget = true; preyClose = d < 9; }
      } else if (c.value > hv && d < 5) {
        fx += (s.x - c.x) / d * (5 - d) / 5 * 1.5; fz += (s.z - c.z) / d * (5 - d) / 5 * 1.5;
        threat++;
      }
    }
  }
  for (const f of frees) {
    const dx = f.x - s.x, dz = f.z - s.z, d = Math.hypot(dx, dz);
    if (d > 22) continue;
    const sc = 24 - d + Math.log2(f.v) * 1.5 + (have.has(f.v) ? 4 : 0);
    if (sc > best) { best = sc; tx = f.x; tz = f.z; hasTarget = true; preyClose = false; }
  }
  for (const pw of powers) {
    const d = Math.hypot(pw.x - s.x, pw.z - s.z);
    if (d < 22) {
      const sc = 26 - d;
      if (sc > best) { best = sc; tx = pw.x; tz = pw.z; hasTarget = true; preyClose = false; }
    }
  }
  for (const dv of dividers) {
    const dx = s.x - dv.x, dz = s.z - dv.z, d = Math.hypot(dx, dz);
    if (d < 4.5 && d > 0.01 && hv > 2) { fx += dx / d * 1.6; fz += dz / d * 1.6; }
  }

  let vx = 0, vz = 0;
  if (hasTarget) {
    const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz) || 1;
    vx += dx / d; vz += dz / d;
  } else {
    vx += Math.cos(s.angle) * 0.6; vz += Math.sin(s.angle) * 0.6;
  }
  vx += fx * 2.5; vz += fz * 2.5;
  const m = 7;
  if (s.x > HALF - m) vx -= (s.x - (HALF - m)) / m * 3;
  if (s.x < -HALF + m) vx += (-HALF + m - s.x) / m * 3;
  if (s.z > HALF - m) vz -= (s.z - (HALF - m)) / m * 3;
  if (s.z < -HALF + m) vz += (-HALF + m - s.z) / m * 3;
  s.target = Math.atan2(vz, vx);
  s.wantBoost = (threat > 0 && nearestThreat < 8) || (preyClose && Math.random() < 0.7);
}

// ---------- Điều khiển ----------
const input = { x: 0, y: 0, has: false, touchOrigin: null, mouse: false, key: false, btn: false, tap: false, keys: {} };
// joystick ảo: vòng tròn hiển thị tại điểm chạm, núm theo ngón (chỉ hình ảnh — logic lái đã có sẵn)
const joyEl = document.createElement('div'); joyEl.id = 'joy'; joyEl.innerHTML = '<i></i>'; document.body.appendChild(joyEl);
const joyKnob = joyEl.firstChild;
const JOY_R = 44;
function joyShow(ox, oy) { joyEl.style.display = 'block'; joyEl.style.left = ox + 'px'; joyEl.style.top = oy + 'px'; joyKnob.style.transform = 'translate(0,0)'; }
function joyMove(dx, dy) { const m = Math.hypot(dx, dy), k = m > JOY_R ? JOY_R / m : 1; joyKnob.style.transform = `translate(${dx * k}px,${dy * k}px)`; }
function joyHide() { joyEl.style.display = 'none'; }
let lastTap = 0;
const isInteractive = e => e.target && e.target.closest && e.target.closest('button, input, select, .overlay');

window.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') {
    if (input.touchOrigin) {
      input.x = e.clientX - input.touchOrigin.x; input.y = e.clientY - input.touchOrigin.y;
      input.has = Math.hypot(input.x, input.y) > 8;
      joyMove(input.x, input.y);
    }
  } else {
    input.x = e.clientX - window.innerWidth / 2; input.y = e.clientY - window.innerHeight / 2;
    input.has = true;
  }
});
window.addEventListener('pointerdown', e => {
  initAudio();
  if (isInteractive(e)) return;
  if (e.pointerType === 'touch') {
    input.touchOrigin = { x: e.clientX, y: e.clientY };
    input.x = input.y = 0; input.has = false;
    joyShow(e.clientX, e.clientY);
    const now = performance.now();
    if (now - lastTap < 320) input.tap = true;
    lastTap = now;
  } else if (e.button === 0) {
    input.mouse = true;
  }
});
const release = e => {
  if (e.pointerType === 'touch') { input.touchOrigin = null; input.tap = false; input.has = false; joyHide(); }
  else input.mouse = false;
};
window.addEventListener('pointerup', release);
window.addEventListener('pointercancel', release);
window.addEventListener('blur', () => { input.mouse = input.key = input.btn = input.tap = false; input.keys = {}; });
window.addEventListener('contextmenu', e => e.preventDefault());
window.addEventListener('keydown', e => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
  if (e.code === 'Space') { input.key = true; e.preventDefault(); }
  input.keys[e.code] = true;
});
window.addEventListener('keyup', e => {
  if (e.code === 'Space') input.key = false;
  input.keys[e.code] = false;
});

const boostBtn = $('boostBtn');
boostBtn.addEventListener('pointerdown', e => { e.stopPropagation(); input.btn = true; });
boostBtn.addEventListener('pointerup', () => { input.btn = false; });
boostBtn.addEventListener('pointerleave', () => { input.btn = false; });
if ('ontouchstart' in window || navigator.maxTouchPoints > 0) boostBtn.classList.remove('hidden');

function playerControl() {
  const k = input.keys;
  const kx = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
  const kz = (k.KeyS || k.ArrowDown ? 1 : 0) - (k.KeyW || k.ArrowUp ? 1 : 0);
  if (kx || kz) player.target = Math.atan2(kz, kx);
  else if (input.has) player.target = Math.atan2(input.y, input.x);   // màn hình xuống = +z
  player.wantBoost = input.mouse || input.key || input.btn || input.tap;
}

// ---------- Vòng đời game ----------
function safeSpawn() {
  let bestP = null, bestD = -1;
  for (let i = 0; i < 14; i++) {
    const p = randPos(10);
    let md = 1e9;
    for (const s of snakes) {
      if (!s.alive) continue;
      for (const c of s.cubes) md = Math.min(md, Math.hypot(c.x - p.x, c.z - p.z));
    }
    if (md > bestD) { bestD = md; bestP = p; }
  }
  return bestP;
}

function botStartValue() {
  const r = Math.random();
  return r < 0.45 ? 2 : r < 0.75 ? 4 : r < 0.92 ? 8 : 16;
}

function spawnBot(s) {
  const p = safeSpawn();
  s.setSkin(pick(SKIN_IDS));
  s.spawn(p.x, p.z, botStartValue());
  if (Math.random() < 0.5) {
    const used = new Set(snakes.map(o => o.name));
    const free = BOT_NAMES.filter(n => !used.has(n));
    if (free.length) s.setName(pick(free));
  }
  s.thinkAt = time + rand(0, 0.3);
}

// đảm bảo số bot đúng với cài đặt (thêm hoặc bớt bot yếu nhất)
function syncBots() {
  const want = settings.bots;
  let have = snakes.length - 1;
  while (have < want) {
    const i = have;
    const nm = BOT_NAMES[i % BOT_NAMES.length] + (i >= BOT_NAMES.length ? ` ${i}` : '');
    const s = new Snake(nm, false, SNAKE_COLORS[i % SNAKE_COLORS.length]);
    snakes.push(s);
    spawnBot(s);
    have++;
  }
  while (have > want) {
    let idx = -1, bs = 1e9;
    for (let i = 1; i < snakes.length; i++) {
      const sc = snakes[i].alive ? snakes[i].score : -1;
      if (sc < bs) { bs = sc; idx = i; }
    }
    snakes[idx].dispose();
    snakes.splice(idx, 1);
    have--;
  }
}

// ---------- "Xem quảng cáo" nhận sức mạnh (không có quảng cáo thật, bấm là nhận) ----------
// ---------- Nhiệm vụ nhận thưởng (GameHub requestReward) ----------
// Phần thưởng & giới hạn khai báo trong gamehub.json ("rewards"); người chơi làm nhiệm vụ (xem live TikTok,
// đọc bài Facebook...) do admin GameHub cấu hình, xong thì game mới trao thưởng.
const rewardAmount = (placement, def) => (GH.rewards && GH.rewards[placement] ? GH.rewards[placement].reward.amount : def);
const rewardCooldown = (placement, def) => (GH.rewards && GH.rewards[placement] ? GH.rewards[placement].cooldownSec : def);
const pow2 = n => 2 ** clamp(Math.round(Math.log2(n) || 1), 1, 17);
// lý do chưa nhận được thưởng -> [icon, chữ]
const REWARD_REASONS = {
  cooldown: r => ['hourglass', `Thử lại sau ${r.retryAfterSec || ''} giây`], limit: () => ['ban', 'Hết lượt nhận thưởng hôm nay'],
  no_tasks: () => ['inbox', 'Hiện chưa có nhiệm vụ nào'], tasks_done: () => ['circle-check', 'Bạn đã làm hết nhiệm vụ hôm nay'],
  disabled: () => ['lock', 'Nhiệm vụ thưởng đang tắt'], login: () => ['lock', 'Đăng nhập GameHub để làm nhiệm vụ'],
  busy: () => ['hourglass', 'Đang mở nhiệm vụ khác'],
};
let adCd = 0, adStart = false, adStartValue = 16, paused = false, rewardBusy = false;
const START_LABEL = () => `Nhiệm vụ: Khởi đầu với khối ${fmt(pow2(rewardAmount('start_boost', 16)))}`;

// Gọi GameHub; trả về kết quả nếu được thưởng, nếu không thì hiện lý do trên nút (hoặc thông báo trong game)
async function earnReward(placement, btn) {
  if (rewardBusy) return null;
  rewardBusy = true;
  const label = btn.innerHTML;
  btn.disabled = true;
  setIc(btn, 'hourglass', 'Đang mở nhiệm vụ...');
  try {
    const r = await GH.requestReward(placement);
    if (r && r.rewarded) return r;
    const why = r && REWARD_REASONS[r.reason] ? REWARD_REASONS[r.reason](r) : (r && r.reason === 'closed' ? null : ['triangle-alert', 'Chưa nhận được thưởng']);
    if (why) {
      if (state === 'playing') feed(why[1], 'bad', why[0]);
      else { setIc(btn, why[0], why[1]); await new Promise(res => setTimeout(res, 2200)); }
    }
    return null;
  } catch (e) {
    feed('Không mở được nhiệm vụ', 'bad', 'triangle-alert');
    return null;
  } finally {
    rewardBusy = false;
    if (btn.innerHTML !== label) btn.innerHTML = label;
    btn.disabled = false;
  }
}

async function grantAdPower() {
  if (state !== 'playing' || !player.alive || adCd > 0) return;
  const r = await earnReward('power_boost', $('adBtn'));
  if (!r || state !== 'playing' || !player.alive) return;
  adCd = rewardCooldown('power_boost', 40);
  if (net) { net.room.send('reward', { placement: 'power_boost', runId: r.runId, token: r.token }); return; }   // máy chủ xác minh rồi áp dụng
  const sec = r.reward.amount;                 // khiên = amount giây, nam châm +2, tăng tốc vô hạn -2
  player.shield = Math.max(player.shield, sec);
  player.magnet = Math.max(player.magnet, sec + 2);
  player.overdrive = Math.max(4, sec - 2);
  player.energy = 1; player.locked = false;
  sfx('ad');
  shock(player.x, player.z, '#ffd23f', 7, 0.7, 1);
  burst(player.x, player.z, '#ffd23f', 26, 7, 0.24);
  flash('#ffd23f', 0.3);
  addShake(0.3);
  feed('Hoàn thành nhiệm vụ: khiên · nam châm · tăng tốc vô hạn', 'good', 'gift');
}

async function grantAdStart() {
  if (state !== 'menu' || adStart) return;
  const b = $('adStart');
  const r = await earnReward('start_boost', b);
  if (!r || state !== 'menu') return;
  adStart = true;
  adStartReward = r;
  adStartValue = pow2(r.reward.amount);
  sfx('ad');
  setIc(b, 'circle-check', `Đã nhận: khối ${fmt(adStartValue)} + khiên 8 giây`);
  b.disabled = true;
}

async function revive() {
  if (state !== 'dead') return;
  const r = await earnReward('revive', $('adRevive'));
  if (!r || state !== 'dead') return;
  if (net) {                                    // online: máy chủ xác minh token rồi cho hồi sinh
    net.room.send('spawn', { name: player.name, skin: skinId, revive: { runId: r.runId, token: r.token } });
    const you = await waitNet('you', 6000);
    if (!you || !net) return;
    bindMe(you.id);
    player.born = time;
    state = 'playing';
    adCd = Math.max(adCd, 10);
    $('over').classList.add('hidden');
    $('hud').classList.remove('hidden');
    sfx('ad'); flash('#ffd23f', 0.35);
    feed(`Hồi sinh với khối ${fmt(you.value)} + khiên ${you.shield} giây`, 'good', 'gift');
    return;
  }
  const v = Math.max(2, player.maxValue);
  const shieldSec = r.reward.amount;
  const p = safeSpawn();
  player.spawn(p.x, p.z, v);
  player.shield = shieldSec;
  focus.x = p.x; focus.z = p.z;
  state = 'playing';
  adCd = Math.max(adCd, 10);
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  sfx('ad');
  flash('#ffd23f', 0.35);
  feed(`Hồi sinh với khối ${fmt(v)} + khiên ${shieldSec} giây`, 'good', 'gift');
}

function startGame() {
  initAudio();
  let name = $('nameInput').value.trim() || 'Bạn';
  store.set('name', name);
  player.setName(name);
  player.setSkin(skinId);
  if (net) return startOnline(name);
  GH.gameStart().catch(() => {});
  syncBots();
  const p = safeSpawn();
  player.setSkin(skinId);
  player.spawn(p.x, p.z, adStart ? adStartValue : 2);
  player.kills = 0; player.born = time;
  bestAtStart = best;
  shownScore = 0;
  if (adStart) {
    player.shield = 8;
    adStart = false;
    const b = $('adStart');
    setIc(b, 'gift', START_LABEL());
    b.disabled = false;
  }
  adCd = 0;
  focus.x = p.x; focus.z = p.z; focus.d = 22;
  state = 'playing';
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('bestVal').textContent = best;
  feed('Nhặt khối cùng số để hợp nhất. Chúc may mắn!');
}

let bestAtStart = 0, shownScore = 0;
function onPlayerDead(killer) {
  state = 'dead';
  const score = player.deadScore || 0;
  if (score > best) best = score;
  store.set('best', best);
  $('overScore').textContent = score;
  $('overNew').classList.toggle('hidden', !(score > bestAtStart && score > 0));
  $('overMax').textContent = fmt(player.maxValue);
  $('overKills').textContent = player.kills;
  const secs = Math.max(0, Math.round(time - player.born));
  $('overTime').textContent = secs >= 60 ? `${Math.floor(secs / 60)}p${String(secs % 60).padStart(2, '0')}` : secs + 's';
  $('overBest').textContent = best;
  $('menuBest').textContent = best;
  $('overRank').textContent = '';
  GH.gameOver({ score, meta: { maxBlock: player.maxValue, kills: player.kills, seconds: secs } }).then(r => {
    const s = r && r.score;
    if (!s) return;
    if (s.saved) setIc($('overRank'), 'medal', `Hạng #${s.rank} trên bảng xếp hạng${s.isNewBest ? ' · kỷ lục cá nhân mới!' : ''}`);
    else setIc($('overRank'), 'lock', 'Đăng nhập GameHub để lưu điểm lên bảng xếp hạng');
  }).catch(() => { /* bỏ qua */ });
  $('overBy').textContent = killer && killer !== player ? `${killer.name} đã nuốt bạn` : 'Bạn đã đâm vào khối lớn hơn';
  setTimeout(() => {
    if (state === 'dead') {
      $('over').classList.remove('hidden');
      $('hud').classList.add('hidden');
    }
  }, 900);
}

// ---------- Thành tựu (khai báo trong gamehub.json) ----------
const unlocked = new Set();
function unlock(key) {
  if (unlocked.has(key)) return;
  unlocked.add(key);
  GH.unlockAchievement(key).catch(() => { /* chưa đăng nhập: bỏ qua */ });
}
function checkAchievements() {
  const hv = player.head.value, sc = player.score;
  if (hv >= 64) unlock('merge_64');
  if (hv >= 256) unlock('merge_256');
  if (hv >= 1024) unlock('merge_1024');
  if (hv >= 2048) unlock('merge_2048');
  if (player.kills >= 1) unlock('first_blood');
  if (player.kills >= 5) unlock('hunter_5');
  if (time - player.born >= 300) unlock('survivor_5m');
  if (sc >= 1000) unlock('score_1000');
  if (sc >= 5000) unlock('score_5000');
}

// ---------- HUD ----------
const lbList = $('lbList');
let hudTimer = 0;
function updateHud() {
  const alive = snakes.filter(s => s.alive).sort((a, b) => b.score - a.score);
  const topScore = alive.length ? alive[0].score : 1;
  const frag = document.createDocumentFragment();
  const addRow = (rank, s, cls) => {
    const li = document.createElement('li');
    li.className = (cls || '') + (rank <= 3 ? ' top' + rank : '');
    li.style.setProperty('--w', Math.max(4, s.score / topScore * 100).toFixed(0) + '%');
    const rk = document.createElement('span'); rk.className = 'rk'; if (rank <= 3) rk.innerHTML = ic('medal', 'rank' + rank); else rk.textContent = rank;
    const dot = document.createElement('span'); dot.className = 'dot'; dot.style.background = dot.style.color = s.color;
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = s.name;
    const sc = document.createElement('span'); sc.className = 'sc'; sc.textContent = s.score;
    li.append(rk, dot, nm, sc);
    frag.appendChild(li);
  };
  alive.slice(0, 7).forEach((s, i) => addRow(i + 1, s, s === player ? 'me' : ''));
  const myRank = alive.indexOf(player);
  if (myRank >= 7) {
    const gap = document.createElement('li'); gap.className = 'gap'; gap.textContent = '⋯'; frag.appendChild(gap);
    addRow(myRank + 1, player, 'me');
  }
  lbList.replaceChildren(frag);

  // cảnh báo khi có đầu rắn lớn hơn ở gần
  let danger = false;
  if (state === 'playing' && player.alive && player.shield <= 0) {
    const ph = player.head.value;
    for (const o of snakes) {
      if (o === player || !o.alive) continue;
      const h = o.head;
      if (h.value > ph && Math.hypot(h.x - player.x, h.z - player.z) < 11) { danger = true; break; }
    }
  }
  $('danger').classList.toggle('on', danger);

  const nb = $('netBadge');
  nb.classList.toggle('hidden', !net);
  if (net) {
    const humans = [...net.byId.values()].filter(x => !x.isBot && x !== player).length + (player.alive ? 1 : 0);
    const nbt = `${net.room.code ? 'Phòng ' + net.room.code : 'Online'} · ${humans} người · ${net.ping}ms`;
  if (nb.dataset.t !== nbt) { nb.dataset.t = nbt; setIc(nb, 'globe', nbt); }
  }
  if (player.alive) {
    const sc = player.score;
    checkAchievements();
    const sv = $('scoreVal');
    sv.textContent = sc;
    if (sc > shownScore) { sv.classList.remove('pop'); void sv.offsetWidth; sv.classList.add('pop'); }
    shownScore = sc;
    $('chipHead').textContent = fmt(player.head.value);
    $('chipRank').textContent = '#' + (myRank + 1);
    if (sc > best) { best = sc; }
    $('bestVal').textContent = best;
    let fx = '';
    if (player.shield > 0) fx += `<span>${ic('shield')} ${Math.ceil(player.shield)}s</span>`;
    if (player.magnet > 0) fx += `<span>${ic('magnet')} ${Math.ceil(player.magnet)}s</span>`;
    if (player.overdrive > 0) fx += `<span>${ic('zap')} ${Math.ceil(player.overdrive)}s</span>`;
    if ($('fx').dataset.v !== fx) { $('fx').dataset.v = fx; $('fx').innerHTML = fx; }
    const ad = $('adBtn');
    ad.disabled = adCd > 0 || rewardBusy;
    const adt = adCd > 0 ? `Chờ ${Math.ceil(adCd)}s` : 'Nhiệm vụ: Siêu sức mạnh';
    if (!rewardBusy && ad.dataset.t !== adt) { ad.dataset.t = adt; setIc(ad, 'gift', adt); }
  }
}

// nhãn: hiện giá trị khối đầu, đỏ = lớn hơn bạn (nguy hiểm), xanh = nhỏ hơn (ăn được)
function updateLabelInfo() {
  const ph = player.alive ? player.head.value : 0;
  for (const s of snakes) {
    if (!s.alive) continue;
    const v = s.head.value, t = fmt(v);
    if (s.valEl.textContent !== t) s.valEl.textContent = t;
    const cls = s.isPlayer ? 'label me' : !ph || v === ph ? 'label' : v > ph ? 'label threat' : 'label prey';
    if (s.label.className !== cls) s.label.className = cls;
  }
}

const mini = $('mini'), mctx = mini.getContext('2d');
function drawMini() {
  const W = mini.width, k = W / (HALF * 2);
  mctx.clearRect(0, 0, W, W);
  mctx.strokeStyle = 'rgba(255,255,255,0.07)'; mctx.lineWidth = 1;
  mctx.beginPath();
  for (let i = 1; i < 4; i++) {
    mctx.moveTo(W * i / 4, 0); mctx.lineTo(W * i / 4, W);
    mctx.moveTo(0, W * i / 4); mctx.lineTo(W, W * i / 4);
  }
  mctx.stroke();
  // vùng đang nhìn thấy
  if (player.alive) {
    const hh = focus.d * 0.55, hw = hh * (window.innerWidth / window.innerHeight);
    mctx.strokeStyle = 'rgba(255,255,255,0.35)';
    mctx.strokeRect((focus.x - hw + HALF) * k, (focus.z - hh + HALF) * k, hw * 2 * k, hh * 2 * k);
  }
  mctx.fillStyle = '#ff4d4d';
  for (const d of dividers) mctx.fillRect((d.x + HALF) * k - 1, (d.z + HALF) * k - 1, 3, 3);
  for (const pw of powers) {
    mctx.fillStyle = pw.type === 'shield' ? '#74c0fc' : '#ff9f9f';
    mctx.fillRect((pw.x + HALF) * k - 1.5, (pw.z + HALF) * k - 1.5, 3, 3);
  }
  const ph = player.alive ? player.head.value : 0;
  for (const s of snakes) {
    if (!s.alive) continue;
    const px = (s.x + HALF) * k, pz = (s.z + HALF) * k, v = s.head.value;
    mctx.beginPath();
    if (s.isPlayer) {
      mctx.fillStyle = '#ffffff';
      mctx.arc(px, pz, 5, 0, Math.PI * 2); mctx.fill();
      mctx.strokeStyle = 'rgba(255,210,63,0.9)'; mctx.lineWidth = 2;
      mctx.beginPath(); mctx.arc(px, pz, 8, 0, Math.PI * 2); mctx.stroke();
    } else {
      mctx.fillStyle = !ph || v === ph ? '#cfc8f5' : v > ph ? '#ff5470' : '#6dffa8';
      mctx.arc(px, pz, 2.5 + Math.min(3, Math.log2(v) * 0.25), 0, Math.PI * 2); mctx.fill();
    }
  }
}

const tmpV = new THREE.Vector3();
function updateLabels() {
  const w = window.innerWidth, h = window.innerHeight;
  for (const s of snakes) {
    if (!s.alive || s.ghostHidden) continue;
    tmpV.set(s.x, 2.4, s.z).project(camera);
    const el = s.label;
    if (tmpV.z > 1 || Math.abs(tmpV.x) > 1.1 || Math.abs(tmpV.y) > 1.1) { el.style.visibility = 'hidden'; continue; }
    el.style.visibility = 'visible';
    const x = (tmpV.x * 0.5 + 0.5) * w, y = (-tmpV.y * 0.5 + 0.5) * h;
    el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
  }
}

// ---------- Camera ----------
let fov = 50;
function updateCamera(dt) {
  let tgt = null;
  if (player.alive) tgt = player;
  else if (state === 'menu') {
    let bs = -1;
    for (const s of snakes) if (s.alive && s.score > bs) { bs = s.score; tgt = s; }
  }
  if (tgt) {
    const k = 1 - Math.exp(-6 * dt);
    focus.x += (tgt.x - focus.x) * k;
    focus.z += (tgt.z - focus.z) * k;
    const D = clamp(16 + tgt.cubes.length * 0.75 + Math.log2(tgt.head.value) * 0.55, 18, 44);
    focus.d += (D - focus.d) * (1 - Math.exp(-1.5 * dt));
    const wantFov = tgt.boosting ? 60 : 50;
    fov += (wantFov - fov) * (1 - Math.exp(-6 * dt));
  }
  if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
  camera.position.set(focus.x, focus.d * 0.84, focus.z + focus.d * 0.54);
  if (shakeAmt > 0.01) {
    const off = shakeAmt * 0.5 * focus.d / 25;
    camera.position.x += rand(-1, 1) * off;
    camera.position.y += rand(-1, 1) * off * 0.5;
    camera.position.z += rand(-1, 1) * off;
    shakeAmt *= Math.exp(-7 * dt);
  } else shakeAmt = 0;
  camera.lookAt(focus.x, 0, focus.z);
}

// ======================= CHƠI ONLINE (máy chủ GameHub chạy logic đấu trường) =======================
// Máy chủ mô phỏng toàn bộ trận (va chạm, điểm, bot) 20 lần/giây; client gửi hướng lái + tăng tốc,
// vẽ lại theo snapshot: rắn người khác hiển thị trễ 100ms để nội suy mượt, rắn của mình được dự đoán trước.
const NET_DELAY = 0.1;
let net = null;
let adStartReward = null;

const setNetStatus = (msg, icon) => { const el = $('netStatus'); if (el) setIc(el, msg ? icon : null, msg || ''); };
const P100 = v => v / 100;
const snakeSpeed = s => (BASE_SPEED - Math.min(1.8, Math.log2(s.cubes.length ? s.cubes[0].value : 2) * 0.11)) * (s.boosting ? BOOST_MULT : 1);

function setPowerType(pw, type) {
  pw.type = type;
  pw.gem.material.color.set(POWER_TYPES[type].color);
  pw.group.children[1].material.map = POWER_TYPES[type].tex;
  pw.group.children[1].material.needsUpdate = true;
}

// xóa thế giới offline (bot, khối) — giữ lại khối ÷2 / power-up để dùng lại mesh
function clearWorld() {
  for (const s of snakes) if (s !== player) s.dispose();
  snakes.length = 0;
  snakes.push(player);
  for (const c of player.cubes) c.dispose();
  player.cubes = [];
  player.alive = false;
  player.hide();
  while (frees.length) removeFree(frees.length - 1);
}

// quay lại chơi với bot
function resetOffline() {
  clearWorld();
  syncBots();
  dividers.forEach(respawnDivider);
  powers.forEach(pw => { respawnPower(pw); setPowerType(pw, Math.random() < 0.5 ? 'shield' : 'magnet'); });
  while (frees.length < FREE_TARGET) { const p = randPos(1.5); spawnFree(spawnValue(), p.x, p.z, false); }
  for (let i = 0; i < 150; i++) update(1 / 30);
}

function waitNet(type, ms) {
  return new Promise(resolve => {
    const room = net && net.room;
    if (!room) return resolve(null);
    let done = false;
    const fn = m => { if (done) return; done = true; room.off(type, fn); resolve(m); };
    room.on(type, fn);
    setTimeout(() => { if (!done) { done = true; room.off(type, fn); resolve(null); } }, ms);
  });
}

async function goOnline(opts) {
  if (net) return true;
  setNetStatus('Đang kết nối máy chủ...', 'loader-circle');
  let room;
  try { room = await GH.multiplayer.join(opts || {}); }
  catch (e) { setNetStatus(e.message, 'triangle-alert'); return false; }
  clearWorld();
  net = { room, byId: new Map(), frees: new Map(), myId: null, buf: [], latest: null, ping: 0, sentAt: 0, lastA: null, lastB: null, leaving: false };
  const w = room.welcome;
  for (const [id, v, x, z] of w.frees) addNetFree(id, v, P100(x), P100(z), P100(x), P100(z));
  w.divs.forEach(([x, z], i) => { if (dividers[i]) { dividers[i].x = P100(x); dividers[i].z = P100(z); } });
  w.pows.forEach(([type, x, z], i) => { if (powers[i]) { powers[i].x = P100(x); powers[i].z = P100(z); setPowerType(powers[i], type); } });
  room.on('snap', onSnap);
  room.on('dead', onNetDead);
  room.on('reward', m => {
    if (!player.alive) return;
    sfx('ad'); shock(player.x, player.z, '#ffd23f', 7, 0.7, 1); burst(player.x, player.z, '#ffd23f', 26, 7, 0.24);
    flash('#ffd23f', 0.3); addShake(0.3);
    feed(`Hoàn thành nhiệm vụ: khiên ${m.amount}s · nam châm · tăng tốc vô hạn`, 'good', 'gift');
  });
  room.on('error', e => feed(e.message, 'bad', 'triangle-alert'));
  room.on('close', () => {
    if (!net || net.room !== room || net.leaving) return;
    leaveOnline();
    setNetStatus('Mất kết nối máy chủ — đang chơi với bot', 'wifi-off');
  });
  net.pingTimer = setInterval(() => { if (net && net.room === room) room.ping().then(ms => { if (net) net.ping = ms; }); }, 2000);
  room.ping().then(ms => { if (net) net.ping = ms; });
  setNetStatus(room.code ? `Phòng riêng ${room.code} — gửi mã này cho bạn bè` : '', 'users');
  $('leaveBtn').classList.remove('hidden');
  return true;
}

function leaveOnline() {
  if (!net) return;
  net.leaving = true;
  clearInterval(net.pingTimer);
  try { net.room.leave(); } catch (e) { /* đã đóng */ }
  net = null;
  resetOffline();
  state = 'menu';
  $('over').classList.add('hidden');
  $('hud').classList.add('hidden');
  $('menu').classList.remove('hidden');
  $('leaveBtn').classList.add('hidden');
  $('netBadge').classList.add('hidden');
  setNetStatus('');
}

function netSnake(id) {
  if (id === net.myId) return player;
  return net.byId.get(id) || null;
}
function bindMe(id) {
  const other = net.byId.get(id);
  if (other && other !== player) { other.dispose(); const i = snakes.indexOf(other); if (i >= 0) snakes.splice(i, 1); }
  net.myId = id;
  net.byId.set(id, player);
}

function addNetFree(id, v, x, z, tx, tz) {
  spawnFree(v, x, z, false);
  const f = frees[frees.length - 1];
  f.id = id; f.sx = x; f.sz = z; f.tx = tx; f.tz = tz; f.anim = (tx !== x || tz !== z) ? 0 : 1;
  net.frees.set(id, f);
  return f;
}
function dropNetFree(id) {
  const f = net.frees.get(id);
  if (!f) return null;
  net.frees.delete(id);
  const i = frees.indexOf(f);
  if (i >= 0) removeFree(i);
  return f;
}

function netSetCubes(s, vals) {
  const old = s.cubes;
  for (let i = 0; i < vals.length; i++) {
    if (i < old.length) { if (old[i].value !== vals[i]) old[i].setValue(vals[i]); }
    else {
      const c = new Cube(vals[i], s.skin);
      const prev = old[i - 1] || { x: s.x, z: s.z };
      c.x = prev.x; c.z = prev.z;
      old.push(c);
    }
  }
  while (old.length > vals.length) old.pop().dispose();
  if (vals.length && vals[0] > s.maxValue) s.maxValue = vals[0];
}

function netShow(s, x, z, angle) {
  s.alive = true; s.x = x; s.z = z; s.angle = angle; s.wasBoosting = false;
  s.trail = [];
  for (let k = 24; k >= 0; k--) s.trail.push({ x: x - Math.cos(angle) * k * STEP, z: z - Math.sin(angle) * k * STEP });
  s.ring.visible = true;
  s.label.style.display = '';
  if (s.deco) s.deco.visible = true;
  if (s.bolt) s.bolt.visible = true;
}

function applyNetPos(s, x, z, angle, flags, dt) {
  const tr = s.trail, n = tr.length;
  if (n < 2 || Math.hypot(x - tr[n - 1].x, z - tr[n - 1].z) > 6) { netShow(s, x, z, angle); }   // dịch chuyển xa (vừa hồi sinh) -> làm lại vết
  s.x = x; s.z = z; s.angle = angle;
  s.boosting = !!(flags & 1);
  if (s !== player) { s.shield = flags & 2 ? 1 : 0; s.magnet = flags & 4 ? 1 : 0; s.overdrive = flags & 8 ? 1 : 0; s.setGhost(flags & 16); }
  if (s.boosting && !s.wasBoosting) fxDashStart(s);
  s.wasBoosting = s.boosting;
  if (s.boosting) { s.fxAcc += dt; while (s.fxAcc > 0.03) { s.fxAcc -= 0.03; fxDashTrail(s); } } else s.fxAcc = 0;
  const t = s.trail, m = t.length;
  t[m - 1].x = x; t[m - 1].z = z;
  if (Math.hypot(x - t[m - 2].x, z - t[m - 2].z) >= STEP) t.push({ x, z });
}

function onSnap(m) {
  const t = performance.now() / 1000;
  // 1) thông tin rắn mới / đổi tên, skin
  if (m.m) for (const [id, name, color, skin, bot] of m.m) {
    let s = netSnake(id);
    if (!s) { s = new Snake(name, false, color); snakes.push(s); net.byId.set(id, s); }
    s.netId = id; s.isBot = !!bot;
    s.setName(name);
    s.setSkin(skin);
  }
  // 2) giá trị các khối
  if (m.c) for (const id in m.c) { const s = netSnake(Number(id)); if (s) netSetCubes(s, m.c[id]); }
  // 3) vị trí (đưa vào bộ đệm nội suy)
  const map = new Map();
  for (const [id, x, z, a, fl] of m.s) map.set(id, [P100(x), P100(z), a / 1000, fl]);
  const snap = { t, map };
  net.buf.push(snap);
  if (net.buf.length > 20) net.buf.shift();
  net.latest = snap;
  for (const [id, P] of map) {
    const s = netSnake(id);
    if (s && !s.alive && s.cubes.length) netShow(s, P[0], P[1], P[2]);
  }
  // 4) sự kiện
  for (const e of m.ev) netEvent(e, map);
  // 5) chỉ số riêng của mình
  if (m.me && player.alive) {
    player.energy = m.me[0] / 100; player.locked = !!m.me[1];
    player.shield = m.me[2] / 10; player.magnet = m.me[3] / 10; player.overdrive = m.me[4] / 10; player.kills = m.me[5];
    player.setGhost(m.me[6]);
  }
}

function netDeathFx(s) {
  shock(s.x, s.z, s.fxCol, 7, 0.8, 1);
  s.cubes.slice(0, 8).forEach(c => burst(c.x, c.z, colorFor(c.value), 7, 8, 0.28));
  if (s === player) { sfx('die'); addShake(1.1); flash('#ff1f1f', 0.5); }
}

function netEvent(e, map) {
  const S = id => netSnake(id);
  switch (e[0]) {
    case 's': { const s = S(e[1]), P = map.get(e[1]); if (s && P) { netShow(s, P[0], P[1], P[2]); shock(P[0], P[1], s.fxCol, 4.5, 0.7, 0.8); burst(P[0], P[1], s.fxCol, 14, 4); } break; }
    case 'm': { const s = S(e[1]); if (s) { fxMerge(s, { value: e[2], x: P100(e[3]), z: P100(e[4]) }); if (s === player) sfx('merge'); } break; }
    case 'e': {
      const a = S(e[1]), b = S(e[2]), c = { value: e[3], x: P100(e[4]), z: P100(e[5]) };
      if (!a || !b) break;
      fxEat(a, b, c, !!e[6]);
      if (a === player) sfx('eat');
      if (b === player && !e[6]) { sfx('bad'); feed(`${a.name} cắn khối ${fmt(c.value)} của bạn`, 'bad'); }
      break;
    }
    case 'd': {
      const s = S(e[1]), k = S(e[2]);
      if (!s) break;
      netDeathFx(s);
      if (k === player && s !== player) feed(`Bạn đã nuốt ${s.name}!`, 'good');
      s.alive = false; s.hide();
      break;
    }
    case 'p': { const f = dropNetFree(e[2]); const s = S(e[1]); if (f && s === player) { sfx('pick'); burst(f.x, f.z, colorFor(f.v), 5, 3, 0.16); floatText(f.x, f.z, '+' + fmt(f.v), '#ffffff', false); } break; }
    case 'f': addNetFree(e[1], e[2], P100(e[3]), P100(e[4]), P100(e[5]), P100(e[6])); break;
    case 'r': dropNetFree(e[1]); break;
    case 'dv': {
      const s = S(e[1]), d = dividers[e[2]];
      if (d && s) {
        fxDivider(s, { x: d.x, z: d.z });
        if (s === player) { sfx('bad'); feed('Số của bạn bị chia đôi!', 'bad', 'divide'); }
      }
      if (d) { d.x = P100(e[3]); d.z = P100(e[4]); }
      break;
    }
    case 'pw': {
      const s = S(e[1]), pw = powers[e[2]];
      if (pw && s) { fxPower(s, { type: e[3], x: pw.x, z: pw.z }); if (s === player) { sfx('power'); feed(e[3] === 'shield' ? 'Khiên bảo vệ!' : 'Nam châm hút khối!', 'good', e[3]); } }
      if (pw) { pw.x = P100(e[5]); pw.z = P100(e[6]); setPowerType(pw, e[4]); }
      break;
    }
    case 'b': { const s = S(e[1]); if (s) { burst(s.x, s.z, '#74c0fc', 6, 5, 0.16); shock(s.x, s.z, '#74c0fc', 2.8, 0.3); if (s === player) addShake(0.15); } break; }
    case 'x': {
      const s = net.byId.get(e[1]);
      if (s && s !== player) { s.dispose(); const i = snakes.indexOf(s); if (i >= 0) snakes.splice(i, 1); }
      net.byId.delete(e[1]);
      break;
    }
  }
}

function netUpdate(dt) {
  const now = performance.now() / 1000;
  // gửi điều khiển (tối đa 20 lần/giây, chỉ khi thay đổi hoặc mỗi 0.5 giây)
  if (state === 'playing' && player.alive) {
    playerControl();
    const a = player.target, b = player.wantBoost ? 1 : 0;
    if (now - net.sentAt > 0.05 && (net.lastA === null || Math.abs(angDiff(net.lastA, a)) > 0.01 || b !== net.lastB || now - net.sentAt > 0.5)) {
      net.room.send('in', { a, b });
      net.sentAt = now; net.lastA = a; net.lastB = b;
    }
  }
  // rắn người khác: nội suy giữa 2 snapshot quanh thời điểm (bây giờ - 100ms)
  const rt = now - NET_DELAY, buf = net.buf;
  let A = buf[0], B = buf[0];
  for (let i = buf.length - 1; i >= 0; i--) if (buf[i].t <= rt) { A = buf[i]; B = buf[i + 1] || buf[i]; break; }
  for (const [id, s] of net.byId) {
    if (s === player || !s.alive || !A) continue;
    const pa = A.map.get(id), pb = B.map.get(id), P = pb || pa;
    if (!P) continue;
    let x = P[0], z = P[1], ang = P[2];
    if (pa && pb && B !== A) {
      const k = clamp((rt - A.t) / (B.t - A.t), 0, 1);
      x = pa[0] + (pb[0] - pa[0]) * k; z = pa[1] + (pb[1] - pa[1]) * k; ang = pa[2] + angDiff(pa[2], pb[2]) * k;
    }
    applyNetPos(s, x, z, ang, P[3], dt);
  }
  // rắn của mình: vị trí mới nhất + dự đoán tiếp theo hướng đang đi (giảm cảm giác trễ)
  if (player.alive && net.latest && net.latest.map.has(net.myId)) {
    const P = net.latest.map.get(net.myId);
    player.boosting = !!(P[3] & 1);
    const ex = Math.min(0.15, now - net.latest.t), sp = snakeSpeed(player);
    const tx = clamp(P[0] + Math.cos(P[2]) * sp * ex, -HALF + 0.7, HALF - 0.7), tz = clamp(P[1] + Math.sin(P[2]) * sp * ex, -HALF + 0.7, HALF - 0.7);
    const k = Math.min(1, dt * 18);
    const far = Math.hypot(tx - player.x, tz - player.z) > 6;
    applyNetPos(player, far ? tx : player.x + (tx - player.x) * k, far ? tz : player.z + (tz - player.z) * k, P[2], P[3], dt);
  }
  // khối tự do: hoạt cảnh văng ra + nam châm (máy chủ cũng mô phỏng giống vậy)
  for (const f of net.frees.values()) {
    if (f.anim < 1) { f.anim = Math.min(1, f.anim + dt * 2); const e = 1 - (1 - f.anim) ** 3; f.x = f.sx + (f.tx - f.sx) * e; f.z = f.sz + (f.tz - f.sz) * e; }
  }
  for (const s of snakes) {
    if (!s.alive || s.magnet <= 0) continue;
    for (const f of net.frees.values()) {
      const dx = s.x - f.x, dz = s.z - f.z, d = Math.hypot(dx, dz);
      if (d < 8 && d > 0.01) { f.x += dx / d * 11 * dt; f.z += dz / d * 11 * dt; }
    }
  }
  for (const f of frees) f.mesh.position.set(f.x, 0.42 + Math.sin(time * 3 + f.phase) * 0.08, f.z);
  for (const s of snakes) if (s.alive && s.cubes.length) { s.layout(dt); if (s.isPlayer) s.lastScore = s.score; }
}

async function startOnline(name) {
  const reward = adStart && adStartReward ? { runId: adStartReward.runId, token: adStartReward.token } : undefined;
  setNetStatus('Đang vào trận...', 'loader-circle');
  net.room.send('spawn', { name, skin: skinId, reward });
  const you = await waitNet('you', 6000);
  if (!you || !net) { setNetStatus('Máy chủ không phản hồi, thử lại nhé', 'triangle-alert'); return; }
  bindMe(you.id);
  player.kills = 0; player.born = time; player.maxValue = you.value;
  bestAtStart = best;
  shownScore = 0;
  if (adStart) { adStart = false; adStartReward = null; const b = $('adStart'); setIc(b, 'gift', START_LABEL()); b.disabled = false; }
  adCd = 0;
  state = 'playing';
  setNetStatus(net.room.code ? `Phòng riêng ${net.room.code}` : '', 'users');
  $('menu').classList.add('hidden');
  $('over').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('bestVal').textContent = best;
  GH.gameStart().catch(() => {});
  feed(net.room.code ? `Phòng riêng ${net.room.code} — gửi mã cho bạn bè để cùng chơi` : 'Đang chơi online cùng mọi người!', '', net.room.code ? 'users' : 'globe');
}

function onNetDead(m) {
  state = 'dead';
  player.alive = false;
  if (m.score > best) best = m.score;
  store.set('best', best);
  $('overScore').textContent = m.score;
  $('overNew').classList.toggle('hidden', !(m.score > bestAtStart && m.score > 0));
  $('overMax').textContent = fmt(m.maxValue);
  $('overKills').textContent = m.kills;
  $('overTime').textContent = m.seconds >= 60 ? `${Math.floor(m.seconds / 60)}p${String(m.seconds % 60).padStart(2, '0')}` : m.seconds + 's';
  $('overBest').textContent = best;
  $('menuBest').textContent = best;
  const room = m.rank ? `Hạng ${m.rank} trong phòng` : '';
  if (m.result && m.result.saved) setIc($('overRank'), 'medal', `${room} · hạng #${m.result.rank} toàn server${m.result.isNewBest ? ' · kỷ lục cá nhân mới!' : ''} (máy chủ đã lưu điểm)`);
  else if (m.guest) setIc($('overRank'), 'lock', `${room} · Đăng nhập GameHub để lưu điểm`);
  else $('overRank').textContent = room;
  $('overBy').textContent = m.killer ? `${m.killer} đã nuốt bạn` : 'Bạn đã đâm vào khối lớn hơn';
  GH.gameOver({}).catch(() => {});       // điểm online do máy chủ ghi — chỉ kết thúc lượt chơi
  setTimeout(() => { if (state === 'dead') { $('over').classList.remove('hidden'); $('hud').classList.add('hidden'); } }, 900);
}

async function playOnline(opts) {
  initAudio();
  const ok = await goOnline(opts);
  if (ok) startGame();
}

// ---------- Vòng lặp chính ----------
function update(dt) {
  time += dt;

  if (net) netUpdate(dt);
  else {
    if (state === 'playing' && player.alive) playerControl();
    for (const s of snakes) {
      if (!s.alive) {
        if (!s.isPlayer && time >= s.respawnAt) spawnBot(s);
        continue;
      }
      if (s.ghost) continue;                       // đang tàng hình: đứng yên
      if (!s.isPlayer && time >= s.thinkAt) { thinkBot(s); s.thinkAt = time + 0.12 + Math.random() * 0.1; }
      s.step(dt);
    }
    collisions();
    updateFrees(dt);
    for (const s of snakes) {
      if (s.alive) { s.layout(dt); if (s.isPlayer) s.lastScore = s.score; }
    }
  }

  for (const d of dividers) {
    d.mesh.position.set(d.x, 0.7 + Math.sin(time * 2 + d.phase) * 0.12, d.z);
    d.mesh.rotation.y = time * 1.2 + d.phase;
  }
  for (const pw of powers) {
    pw.group.position.set(pw.x, 1.1 + Math.sin(time * 2.5 + pw.phase) * 0.2, pw.z);
    pw.gem.rotation.y = time * 2;
  }

  updateParticles(dt);
  updateRings(dt);
  if (adCd > 0 && state === 'playing') adCd = Math.max(0, adCd - dt);
  $('speed').classList.toggle('on', state === 'playing' && player.alive && player.boosting);

  hudTimer -= dt;
  if (hudTimer <= 0) { hudTimer = 0.2; updateLabelInfo(); if (state !== 'menu') updateHud(); }
  if (state !== 'menu') {
    drawMini();
    if (player.alive) {
      const f = $('boostFill');
      f.style.width = (player.energy * 100).toFixed(1) + '%';
      const ready = player.energy >= 0.999 && !player.locked;
      f.classList.toggle('locked', player.locked);
      f.classList.toggle('ready', ready);
      const txt = player.overdrive > 0 ? 'VÔ HẠN'
        : player.boosting ? 'ĐANG TĂNG TỐC'
        : player.locked ? `HỒI ${Math.ceil((1 - player.energy) * BOOST_CD)}s`
        : ready ? 'SẴN SÀNG' : 'ĐANG NẠP';
      const bt = $('boostText');
      if (bt.textContent !== txt) bt.textContent = txt;
    }
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) update(dt);
  updateCamera(dt);
  updateLabels();
  updateFloats(paused ? 0 : dt);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

// ---------- Chọn skin ----------
let skinId = 'classic';
{ const s = store.get('skin', 'classic'); if (SKINS[s]) skinId = s; }
const previewCache = {};
const skinPreview = (id, v) => previewCache[id + v] || (previewCache[id + v] = drawSkinCanvas(id, v).toDataURL());

function renderSkinPickers() {
  for (const host of [$('skinsMenu'), $('skinsOver')]) {
    host.replaceChildren();
    for (const id of SKIN_IDS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'skin' + (id === skinId ? ' sel' : '');
      const prev = document.createElement('div');
      prev.className = 'sk-prev';
      for (const v of [4, 32]) {
        const img = new Image();
        img.src = skinPreview(id, v);
        img.alt = '';
        prev.appendChild(img);
      }
      const nm = document.createElement('span');
      nm.className = 'sk-name';
      nm.textContent = SKINS[id].name;
      b.append(prev, nm);
      b.addEventListener('click', () => {
        skinId = id;
        store.set('skin', id);
        const tried = new Set(store.get('tried', []));
        tried.add(id);
        store.set('tried', [...tried]);
        if (tried.size >= SKIN_IDS.length) unlock('fashionista');
        renderSkinPickers();
        initAudio();
        sfx('power');
      });
      host.appendChild(b);
    }
  }
}

// ---------- Bảng cài đặt ----------
function applyUiSettings() {
  document.body.classList.toggle('no-mini', !settings.minimap);
  document.body.classList.toggle('no-names', !settings.names);
}

function setupSettings() {
  const el = {
    vol: $('sVol'), fx: $('sFx'), res: $('sRes'), sens: $('sSens'), bots: $('sBots'),
    shake: $('sShake'), names: $('sNames'), mini: $('sMini'),
  };
  const sync = () => {
    el.vol.value = settings.vol; $('sVolV').textContent = settings.vol + '%';
    el.fx.value = settings.fx;
    el.res.value = settings.res;
    el.sens.value = settings.sens; $('sSensV').textContent = settings.sens + '%';
    el.bots.value = settings.bots; $('sBotsV').textContent = settings.bots;
    el.shake.checked = settings.shake;
    el.names.checked = settings.names;
    el.mini.checked = settings.minimap;
    applyUiSettings();
  };
  const changed = () => { saveSettings(); sync(); };

  el.vol.addEventListener('input', () => { settings.vol = +el.vol.value; changed(); });
  el.vol.addEventListener('change', () => sfx('ad'));
  el.fx.addEventListener('change', () => { settings.fx = +el.fx.value; changed(); });
  el.res.addEventListener('change', () => { settings.res = +el.res.value; applyResolution(); changed(); });
  el.sens.addEventListener('input', () => { settings.sens = +el.sens.value; changed(); });
  el.bots.addEventListener('change', () => { settings.bots = +el.bots.value; syncBots(); changed(); });
  el.bots.addEventListener('input', () => { $('sBotsV').textContent = el.bots.value; });
  el.shake.addEventListener('change', () => { settings.shake = el.shake.checked; changed(); });
  el.names.addEventListener('change', () => { settings.names = el.names.checked; changed(); });
  el.mini.addEventListener('change', () => { settings.minimap = el.mini.checked; changed(); });
  $('sReset').addEventListener('click', () => {
    Object.assign(settings, DEFAULTS);
    applyResolution(); syncBots(); changed();
  });

  const open = () => {
    initAudio();
    $('settings').classList.remove('hidden');
    paused = state === 'playing';
  };
  const close = () => {
    $('settings').classList.add('hidden');
    paused = false;
    last = performance.now();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
  };
  $('gear').addEventListener('click', open);
  $('menuSettings').addEventListener('click', open);
  $('overSettings').addEventListener('click', open);
  $('sClose').addEventListener('click', close);
  window.addEventListener('keydown', e => {
    if (e.code !== 'Escape') return;
    if ($('settings').classList.contains('hidden')) { if (state === 'playing') open(); } else close();
  });
  sync();
}

// ---------- Khởi tạo ----------
function init() {
  player = new Snake('Bạn', true, '#ffffff');
  player.deadScore = 0; player.lastScore = 0;
  snakes.push(player);
  syncBots();
  for (let i = 0; i < DIV_COUNT; i++) spawnDivider();
  for (let i = 0; i < POWER_COUNT; i++) spawnPower();
  while (frees.length < FREE_TARGET) { const p = randPos(1.5); spawnFree(spawnValue(), p.x, p.z, false); }
  // khởi động nhanh để bot có thời gian phát triển ngay từ đầu
  for (let i = 0; i < 300; i++) update(1 / 30);

  const gp = GH.player;
  $('nameInput').value = store.get('name', '') || (gp && !gp.guest && !gp.mock ? gp.displayName : '');
  // Portal báo đang làm nhiệm vụ (xem live, đọc bài...): nhân vật tàng hình + bất tử cho đến khi xong
  GH.on('task', d => {
    const open = !!(d && d.open);
    if (net) { if (player.alive) net.room.send('ghost', { on: open }); }   // máy chủ xác nhận phiên nhiệm vụ rồi mới cho tàng hình
    else if (player.alive) {
      player.setGhost(open);
      if (!open) player.shield = Math.max(player.shield, 4);               // hiện lại có vài giây bảo vệ
    }
  });
  GH.on('pause', () => { if (state === 'playing' && $('settings').classList.contains('hidden')) paused = true; });
  GH.on('resume', () => { if ($('settings').classList.contains('hidden')) { paused = false; last = performance.now(); } });
  GH.on('mute', d => { muted = !!(d && d.muted); $('mute').innerHTML = ic(muted ? 'volume-x' : 'volume-2'); });
  if (GH.player && GH.player.guest) feed('Đăng nhập GameHub để lưu điểm & thành tựu');
  $('playBtn').addEventListener('click', () => { if (net) leaveOnline(); startGame(); });
  if (GH.mode === 'hosted') {                   // chơi online chỉ có khi game chạy trên GameHub
    $('playOnline').classList.remove('hidden');
    $('roomRow').classList.remove('hidden');
    $('playBtn').classList.replace('primary', 'ghost');
    setIc($('playBtn'), 'bot', 'Chơi với bot (offline)');
  }
  $('playOnline').addEventListener('click', () => playOnline({}));
  $('createRoom').addEventListener('click', () => playOnline({ create: true }));
  $('joinRoom').addEventListener('click', () => {
    const code = $('roomCode').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{6}$/.test(code)) { setNetStatus('Mã phòng gồm 6 ký tự'); return; }
    playOnline({ code });
  });
  $('roomCode').addEventListener('keydown', e => { if (e.key === 'Enter') $('joinRoom').click(); });
  $('leaveBtn').addEventListener('click', leaveOnline);
  $('againBtn').addEventListener('click', startGame);
  $('nameInput').addEventListener('keydown', e => { if (e.key === 'Enter') startGame(); });
  $('mute').addEventListener('click', () => {
    muted = !muted;
    $('mute').innerHTML = ic(muted ? 'volume-x' : 'volume-2');
    initAudio();
  });
  $('menuBest').textContent = best;
  renderSkinPickers();
  const fsBtn = $('fs');
  if (!document.documentElement.requestFullscreen) fsBtn.classList.add('hidden');
  fsBtn.addEventListener('click', () => {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen().catch(() => {});
    else document.exitFullscreen();
  });
  $('adBtn').addEventListener('click', grantAdPower);
  $('adStart').addEventListener('click', grantAdStart);
  setIc($('adStart'), 'gift', START_LABEL());
  $('adRevive').addEventListener('click', revive);
  // bỏ focus khỏi nút sau khi bấm để phím Space không kích hoạt lại nút
  window.addEventListener('click', e => { if (e.target && e.target.closest && e.target.closest('button')) e.target.closest('button').blur(); });

  setupSettings();
  requestAnimationFrame(frame);
  GH.ready().catch(() => { /* bỏ qua */ });
}

init();

// phục vụ kiểm thử
window.__game = { snakes, frees, dividers, powers, get player() { return player; }, get state() { return state; }, input,
  focus, settings, startGame, grantAdPower, grantAdStart, revive, update, killSnake, eatCube, hitDivider, fxDivider,
  get net() { return net; }, goOnline, leaveOnline, playOnline };
})();
