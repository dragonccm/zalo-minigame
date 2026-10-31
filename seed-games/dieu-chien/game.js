/* Diều Chiến 2.0 — bay lượn tự do kiểu .io cho GameHub.
 * Lái diều theo con trỏ, ăn vàng, nhặt phép (kiếm, lá chắn, tăng tốc, tàng hình, nam châm, x2 vàng),
 * dùng kiếm hạ diều khác; gom đủ ngọc skill thì cổng mở -> bay vào để sang map mới.
 */
(() => {
'use strict';
const GH = window.GameHub, ic = window.ic;
const $ = id => document.getElementById(id);
const cv = $('cv'), ctx = cv.getContext('2d'), mini = $('mini'), mctx = mini.getContext('2d');
const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const angDiff = (a, b) => { let d = (b - a) % TAU; if (d > Math.PI) d -= TAU; if (d < -Math.PI) d += TAU; return d; };
document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = ic(el.dataset.ic); });

// ---------- cân chỉnh ----------
const WW = 3600, WH = 2400;                        // kích thước thế giới
const VIEW = 1500;                                 // chiều rộng thế giới nhìn thấy (desktop)
const BASE_SPEED = 205, BOOST = 1.5, TURN = 3.4, HIT_R = 30, SPEED_PW = 1.35;
const DUEL_R = 120, DUEL_TIME = 8, DUEL_STEP = 7, SWORD_TAP = 1.8;   // đấu tay đôi: bấm nhanh để kéo thanh lực
const LIVES = 3, RESPAWN = 2, SPAWN_SAFE = 3;
const POWERS = {
  sword: { name: 'Kiếm (đấu x1.8)', icon: 'sword', col: '#ff6b6b', time: 12 },
  shield: { name: 'Lá chắn', icon: 'shield', col: '#6ee7b7', time: 14 },
  speed: { name: 'Tăng tốc', icon: 'zap', col: '#ffd166', time: 8 },
  ghost: { name: 'Tàng hình', icon: 'ghost', col: '#c4b5fd', time: 8 },
  magnet: { name: 'Nam châm', icon: 'magnet', col: '#7dd3fc', time: 12 },
  x2: { name: 'x2 vàng', icon: 'coins', col: '#fbbf24', time: 12 },
};
const POWER_KEYS = Object.keys(POWERS);
const UP_COST = [60, 120, 220, 360, 550];
const UPGRADES = [
  { id: 'speed', name: 'Cánh nhẹ', icon: 'zap', desc: 'Bay nhanh hơn, thể lực hồi nhanh hơn' },
  { id: 'magnet', name: 'Túi hút vàng', icon: 'magnet', desc: 'Tự hút vàng ở gần (kể cả khi không có nam châm)' },
  { id: 'duration', name: 'Phép bền lâu', icon: 'timer', desc: 'Mọi phép bổ trợ kéo dài thêm' },
];
const SKINS = [
  { id: 'classic', name: 'Đỏ truyền thống', price: 0, a: '#e63946', b: '#ffd166', pat: 'split' },
  { id: 'sea', name: 'Biển xanh', price: 150, a: '#1d8cf0', b: '#bdefff', pat: 'stripe' },
  { id: 'lotus', name: 'Hoa sen', price: 200, a: '#ff6fae', b: '#fff4f8', pat: 'circle' },
  { id: 'jade', name: 'Ngọc bích', price: 250, a: '#13a37a', b: '#e9ffb8', pat: 'cross' },
  { id: 'rainbow', name: 'Cầu vồng', price: 320, a: '#ff595e', b: '#8ac926', pat: 'rainbow' },
  { id: 'night', name: 'Đêm sao', price: 380, a: '#26286b', b: '#ffd84a', pat: 'star' },
  { id: 'phoenix', name: 'Phượng lửa', price: 480, a: '#ff7a1a', b: '#5a0f0f', pat: 'fire' },
];
const BOT_STYLES = [['#8e44ad', '#f5d0ff', 'stripe'], ['#2a9d8f', '#e9f5db', 'split'], ['#f4a261', '#264653', 'cross'], ['#5e60ce', '#c7f9cc', 'circle'],
  ['#d62828', '#fcbf49', 'stripe'], ['#3a86ff', '#ffbe0b', 'split'], ['#6d6875', '#ffcdb2', 'cross'], ['#06d6a0', '#073b4c', 'circle']];
const BOT_NAMES = ['Tí Tửng', 'Diều Hâu', 'Gió Bấc', 'Cô Bé Mây', 'Chú Tư', 'Bạch Hạc', 'Sấm Sét', 'Mèo Mun', 'Ông Năm', 'Đại Bàng', 'Bé Na', 'Chim Sẻ'];
const MAPS = [   // bối cảnh: bầu trời, mây, mặt đất trang trí
  { name: 'Cánh đồng lúa', sky: ['#7ec8ff', '#e3f6ff'], cloud: '#ffffff', ground: ['#9bd36b', '#6fae4a'], sun: '#fff3b0' },
  { name: 'Biển mây', sky: ['#5fa8ff', '#cfe8ff'], cloud: '#ffffff', ground: ['#f5fbff', '#d6e8fb'], sun: '#ffffff' },
  { name: 'Hoàng hôn phố cổ', sky: ['#ff8a5c', '#ffd29a'], cloud: '#ffd7c2', ground: ['#c0563c', '#8e3b2d'], sun: '#fff0b8' },
  { name: 'Núi tuyết', sky: ['#7aa7d6', '#e8f1ff'], cloud: '#f2f7ff', ground: ['#eef4fb', '#b8c7d9'], sun: '#ffffff' },
  { name: 'Đêm sao', sky: ['#0d1440', '#2e3b80'], cloud: '#5d6aa8', ground: ['#1d2656', '#141b40'], sun: '#eef2ff' },
];

// ---------- lưu trữ ----------
let save = { coins: 0, best: 0, maxMap: 1, ups: { speed: 0, magnet: 0, duration: 0 }, skins: ['classic'], skin: 'classic', sound: true };
let saveTimer = 0;
const persist = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => GH.save(save).catch(() => {}), 400); };
const achieve = k => GH.unlockAchievement(k).catch(() => {});

// ---------- âm thanh ----------
let ac = null, muted = false;
function audio() { if (!ac && save.sound) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { ac = null; } } return ac; }
function tone(freq, dur, type = 'sine', vol = 0.1, when = 0, slide = 0) {
  if (muted || !save.sound || !audio()) return;
  const t = ac.currentTime + when, o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur);
}
function noise(dur, vol = 0.08, freq = 2400) {
  if (muted || !save.sound || !audio()) return;
  const len = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
  s.connect(f).connect(g).connect(ac.destination); s.start();
}
let coinT = 0;
const sfx = {
  coin: () => { if (time - coinT < 0.05) return; coinT = time; tone(1300 + Math.random() * 200, 0.07, 'square', 0.025); },
  orb: () => { tone(660, 0.12, 'sine', 0.1); tone(990, 0.18, 'sine', 0.09, 0.08); tone(1320, 0.25, 'sine', 0.07, 0.16); },
  power: () => { tone(520, 0.1, 'triangle', 0.1, 0, 400); tone(880, 0.15, 'triangle', 0.08, 0.08); },
  hit: () => { noise(0.25, 0.2, 1500); tone(300, 0.25, 'sawtooth', 0.06, 0, -200); },
  block: () => { tone(1500, 0.08, 'square', 0.06); noise(0.1, 0.1, 4000); },
  die: () => { tone(400, 0.4, 'triangle', 0.12, 0, -300); noise(0.4, 0.12, 800); },
  portal: () => [392, 523, 659, 784, 1046].forEach((f, i) => tone(f, 0.3, 'triangle', 0.08, i * 0.08)),
  zap: () => { noise(0.35, 0.22, 3000); tone(120, 0.3, 'sawtooth', 0.08); },
  buy: () => tone(1200, 0.1, 'square', 0.04),
};

// ---------- màn hình & camera ----------
let dpr = 1, cw = 1, ch = 1, zoom = 1, baseZoom = 1, zoomFx = 1, cam = { x: WW / 2, y: WH / 2 };
let shake = 0, airs = [];
const addShake = v => { shake = Math.max(shake, v); };
function resize() {
  dpr = Math.min(2, window.devicePixelRatio || 1); cw = window.innerWidth; ch = window.innerHeight;
  cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
  zoom = Math.max(cw / VIEW, ch / (VIEW * 0.62));       // điện thoại dọc cũng thấy đủ rộng
  if (cw < 700) zoom = Math.max(cw / 900, ch / 1100);
  baseZoom = zoom;
  skyCache = null;
}
const toWorld = (x, y) => ({ x: (x - cw / 2) / zoom + cam.x, y: (y - ch / 2) / zoom + cam.y });

// ---------- trạng thái ----------
let duels = [];
let run = null, map = null, kites = [], coins = [], orbs = [], items = [], parts = [], texts = [], birds = [], storms = [], winds = [], portal = null;
let time = 0, paused = false, running = false, me = null, clouds = [], stars = [], skyCache = null;
const input = { x: 0, y: 0, has: false, boost: false, keys: new Set() };
const joy = { on: false, ox: 0, oy: 0, dx: 0, dy: 0 };   // joystick ảo cảm ứng: gốc = điểm chạm, kéo để lái

class Kite {
  constructor(o) {
    Object.assign(this, { x: 0, y: 0, ang: 0, vx: 0, vy: 0, alive: true, respawnAt: 0, inv: 0, stamina: 1, boosting: false,
      pw: {}, gold: 0, orbs: 0, kills: 0, streak: 0, think: 0, goal: null, wob: Math.random() * TAU, stun: 0 }, o);
    this.tail = Array.from({ length: 10 }, () => ({ x: this.x, y: this.y, px: this.x, py: this.y }));
  }
  has(p) { return (this.pw[p] || 0) > 0; }
  get visible() { return !this.has('ghost'); }
  resetTail() { this.tail.forEach(t => { t.x = t.px = this.x; t.y = t.py = this.y; }); }
}

// ---------- thế giới ----------
function mapConfig(n) {
  return {
    n, theme: MAPS[(n - 1) % MAPS.length],
    need: Math.min(4 + n, 12), bots: Math.min(3 + n, 11), skill: clamp(0.25 + n * 0.08, 0.25, 1),
    coins: 170, orbsOut: 3, items: 5 + Math.min(n, 4),
    birds: n >= 2, storms: n >= 3 ? Math.min(n - 2, 4) : 0, winds: n >= 4 ? Math.min(n - 3, 4) : 0,
  };
}
function freeSpot(minDist = 350) {
  for (let i = 0; i < 30; i++) {
    const p = { x: rand(150, WW - 150), y: rand(150, WH - 250) };
    if (kites.every(k => !k.alive || dist(k, p) > minDist) && storms.every(s => dist(s, p) > s.r + 80)) return p;
  }
  return { x: rand(150, WW - 150), y: rand(150, WH - 250) };
}
function spawnCoin(x, y, v = Math.random() < 0.08 ? 5 : 1, scatter = false) {
  const c = { x: x ?? rand(80, WW - 80), y: y ?? rand(80, WH - 200), v, ph: rand(0, TAU), vx: 0, vy: 0 };
  if (scatter) { const a = rand(0, TAU), s = rand(80, 260); c.vx = Math.cos(a) * s; c.vy = Math.sin(a) * s; }
  coins.push(c);
}
function spawnOrb(x, y, scatter) {
  const p = x === undefined ? freeSpot(250) : { x, y };
  const o = { x: p.x, y: p.y, ph: rand(0, TAU), vx: 0, vy: 0 };
  if (scatter) { const a = rand(0, TAU); o.vx = Math.cos(a) * 160; o.vy = Math.sin(a) * 160; }
  orbs.push(o);
}
function spawnItem() { const p = freeSpot(200); items.push({ x: p.x, y: p.y, type: POWER_KEYS[(Math.random() * POWER_KEYS.length) | 0], ph: rand(0, TAU) }); }
function newKite(o) { const p = freeSpot(); const k = new Kite({ ...o, x: p.x, y: p.y, ang: rand(0, TAU) }); k.resetTail(); k.inv = SPAWN_SAFE; return k; }

function startRun() {
  run = { map: 1, score: 0, lives: LIVES, kills: 0, goldTotal: 0, revived: 0 };
  GH.gameStart().catch(() => {});
  startMap();
}
function startMap() {
  map = mapConfig(run.map); map.t = 0; map.gold = 0; map.kills = 0; map.nextItem = 4; map.nextBirds = rand(8, 14);
  kites = []; coins = []; orbs = []; items = []; parts = []; texts = []; birds = []; storms = []; winds = []; portal = null; skyCache = null; duels = [];
  for (let i = 0; i < map.storms; i++) storms.push({ x: rand(500, WW - 500), y: rand(300, WH - 600), r: rand(170, 230), next: rand(2, 5), warn: 0, vx: rand(-30, 30), vy: rand(-20, 20) });
  for (let i = 0; i < map.winds; i++) { const a = rand(0, TAU); winds.push({ x: rand(400, WW - 400), y: rand(300, WH - 500), r: rand(260, 380), fx: Math.cos(a) * 170, fy: Math.sin(a) * 120 }); }
  const skin = SKINS.find(s => s.id === save.skin) || SKINS[0];
  me = newKite({ id: 'me', player: true, name: GH.player && !GH.player.guest ? GH.player.displayName : 'Bạn', a: skin.a, b: skin.b, pat: skin.pat });
  kites.push(me);
  const names = BOT_NAMES.slice().sort(() => Math.random() - 0.5);
  for (let i = 0; i < map.bots; i++) {
    const st = BOT_STYLES[(i + run.map) % BOT_STYLES.length];
    kites.push(newKite({ id: 'b' + i, player: false, name: names[i % names.length], a: st[0], b: st[1], pat: st[2], skill: clamp(map.skill + rand(-0.15, 0.1), 0.15, 1) }));
  }
  for (let i = 0; i < map.coins; i++) spawnCoin();
  for (let i = 0; i < map.orbsOut; i++) spawnOrb();
  for (let i = 0; i < map.items; i++) spawnItem();
  cam.x = me.x; cam.y = me.y;
  hideAll(); $('hud').classList.remove('hidden'); mini.classList.remove('hidden');
  $('boostBtn').classList.toggle('hidden', !('ontouchstart' in window));
  showIntro();
  running = true; paused = false; last = performance.now(); hudKey = '';
  if (run.map >= 3) achieve('map_3');
  if (run.map >= 5) achieve('map_5');
}
function showIntro() {
  $('iSmall').textContent = 'MAP ' + run.map; $('iTitle').textContent = map.theme.name;
  const extra = [map.birds && 'đàn chim', map.storms && 'mây giông', map.winds && 'luồng gió'].filter(Boolean);
  $('iText').textContent = net ? `Online · gom ${map.need} ngọc rồi bay vào cổng trước mọi người${extra.length ? ' · ' + extra.join(', ') : ''}`
    : `Gom ${map.need} ngọc để mở cổng · ${map.bots} đối thủ${extra.length ? ' · ' + extra.join(', ') : ''}`;
  $('intro').classList.remove('hidden');
  clearTimeout(showIntro.t); showIntro.t = setTimeout(() => $('intro').classList.add('hidden'), 2600);
}

// ---------- di chuyển ----------
function steer(k, dt, targetAng, boost) {
  if (k.stun > 0) { k.stun -= dt; k.ang += 7 * dt; }
  else k.ang += clamp(angDiff(k.ang, targetAng), -TURN * dt, TURN * dt);
  const upg = k.player ? 1 + save.ups.speed * 0.06 : 1 + (k.skill || 0) * 0.08;
  k.boosting = boost && k.stamina > 0.05 && k.stun <= 0;
  k.stamina = clamp(k.stamina + (k.boosting ? -0.45 : 0.2 * upg) * dt, 0, 1);
  const sp = BASE_SPEED * upg * (k.has('speed') ? SPEED_PW : 1) * (k.boosting ? BOOST : 1) * (k.stun > 0 ? 0.4 : 1);
  let vx = Math.cos(k.ang) * sp, vy = Math.sin(k.ang) * sp;
  for (const w of winds) { const d = dist(k, w); if (d < w.r) { const f = 1 - d / w.r; vx += w.fx * f; vy += w.fy * f; } }
  k.vx += (vx - k.vx) * Math.min(1, dt * 6); k.vy += (vy - k.vy) * Math.min(1, dt * 6);
  k.x += k.vx * dt; k.y += k.vy * dt;
  // biên thế giới: bật lại nhẹ
  if (k.x < 40) { k.x = 40; k.ang = Math.PI - k.ang; } else if (k.x > WW - 40) { k.x = WW - 40; k.ang = Math.PI - k.ang; }
  if (k.y < 40) { k.y = 40; k.ang = -k.ang; } else if (k.y > WH - 140) { k.y = WH - 140; k.ang = -k.ang; }
  for (const p in k.pw) if (k.pw[p] > 0) k.pw[p] -= dt;
  if (k.inv > 0) k.inv -= dt;
}
// đuôi bị luồng gió thổi ra phía sau (không có trọng lực), đầu đuôi phấp phới mạnh dần
function stepTail(k) {
  const fx = Math.cos(k.ang), fy = Math.sin(k.ang), nx = -fy, ny = fx;
  k.tail[0].x = k.x - fx * 26; k.tail[0].y = k.y - fy * 26;
  const sp = Math.min(1, Math.hypot(k.vx, k.vy) / BASE_SPEED), flap = time * (9 + sp * 6) + (k.id ? String(k.id).length : 0);
  for (let i = 1; i < k.tail.length; i++) {
    const t = k.tail[i], p = k.tail[i - 1];
    const vx = (t.x - t.px) * 0.82, vy = (t.y - t.py) * 0.82;
    t.px = t.x; t.py = t.y;
    const w = Math.sin(flap - i * 0.8) * (0.6 + i * 0.35) * (0.4 + sp * 0.8);    // sóng ngang thân đuôi
    t.x += vx - fx * (0.9 + sp * 1.4) + nx * w; t.y += vy - fy * (0.9 + sp * 1.4) + ny * w;
    const dx = t.x - p.x, dy = t.y - p.y, d = Math.hypot(dx, dy) || 1;
    t.x = p.x + dx / d * 11; t.y = p.y + dy / d * 11;
  }
}

// ---------- bot ----------
function thinkBot(k) {
  k.think = rand(0.12, 0.25) + (1 - k.skill) * 0.25;
  const seen = o => o !== k && o.alive && o.visible && o.inv <= 0;
  // 1) có kiếm: săn diều gần nhất nhìn thấy được
  if (k.has('sword')) {
    let best = null, bd = 650 + k.skill * 350;
    for (const o of kites) if (seen(o) && !o.has('shield') && dist(k, o) < bd) { bd = dist(k, o); best = o; }
    if (!best) for (const o of kites) if (seen(o) && dist(k, o) < 500) { best = o; break; }
    if (best) { const lead = bd / 400; k.goal = { x: best.x + best.vx * lead * k.skill, y: best.y + best.vy * lead * k.skill }; k.wantBoost = bd < 380; return; }
  }
  // 2) có diều cầm kiếm đến gần: chạy (bot giỏi mới phản ứng kịp)
  if (!k.has('shield')) {
    for (const o of kites) {
      if (!seen(o) || !o.has('sword') || dist(k, o) > 260 + k.skill * 260 || Math.random() > 0.35 + k.skill * 0.6) continue;
      const a = Math.atan2(k.y - o.y, k.x - o.x) + rand(-0.5, 0.5);
      k.goal = { x: k.x + Math.cos(a) * 500, y: k.y + Math.sin(a) * 500 }; k.wantBoost = true; return;
    }
  }
  k.wantBoost = false;
  // 3) gom: ngọc > phép > vàng
  const near = (list, r) => { let b = null, bd = r; for (const o of list) { const d = dist(k, o); if (d < bd) { bd = d; b = o; } } return b; };
  const t = near(orbs, 500 + k.skill * 400) || near(items, 420) || near(coins, 380);
  if (t) { k.goal = { x: t.x, y: t.y }; return; }
  if (!k.goal || dist(k, k.goal) < 80) k.goal = { x: rand(200, WW - 200), y: rand(200, WH - 300) };
}
function avoidStorm(k, ang) {
  for (const s of storms) {
    if (s.warn <= 0) continue;
    const d = dist(k, s);
    if (d < s.r + 90 && Math.random() < k.skill) return Math.atan2(k.y - s.y, k.x - s.x);
  }
  return ang;
}

// ---------- va chạm & chiến đấu ----------
function hurt(k, by, why) {
  if (!k.alive || k.inv > 0 || (k.duel && why !== 'duel')) return false;
  if (k.has('shield')) {                           // lá chắn đỡ 1 đòn rồi vỡ
    k.pw.shield = 0; k.inv = 1;
    burst(k.x, k.y, POWERS.shield.col, 18); if (k.player || (by && by.player)) sfx.block();
    if (k.player) floatText(k.x, k.y - 40, 'Lá chắn vỡ!', POWERS.shield.col);
    return false;
  }
  kill(k, by, why); return true;
}
function kill(k, by, why) {
  k.alive = false; k.respawnAt = time + RESPAWN; k.pw = {};
  burst(k.x, k.y, k.a, 30); burst(k.x, k.y, '#fff', 12);
  // rơi vàng & ngọc
  const drop = Math.min(40, Math.floor(k.gold * 0.5) + 4);
  for (let i = 0; i < drop; i++) spawnCoin(k.x, k.y, 1, true);
  for (let i = 0; i < k.orbs; i++) spawnOrb(k.x, k.y, true);
  if (!k.player) k.orbs = 0;
  k.gold = Math.floor(k.gold * 0.5);
  if (by && by !== k) { by.kills++; by.streak++; }
  if (k.player) {
    sfx.die(); k.streak = 0;
    run.lives--; me.orbs = 0;
    floatText(k.x, k.y - 40, why === 'storm' ? 'Bị sét đánh!' : by ? `${by.name} đã hạ bạn!` : 'Bị hạ!', '#ff6176');
    if (run.lives <= 0) return gameOver(by, why);
    tip(`Còn ${run.lives} mạng — ngọc đã rơi, nhặt lại nhanh!`);
    return;
  }
  if (by && by.player) {
    sfx.hit();
    const pts = 100 * run.map; run.score += pts; run.kills++; map.kills++;
    floatText(k.x, k.y - 30, `Hạ ${k.name}! +${pts}`, '#ffd166');
    achieve('first_kill'); if (me.streak >= 3) achieve('sword_master');
  }
}
// ---------- đấu tay đôi ----------
// Hai diều chạm nhau -> vào vòng đấu: ai bấm (chuột / Space / chạm) nhanh hơn kéo thanh lực về phía mình.
// Kéo hết thanh (hoặc dẫn trước khi hết giờ) là thắng, bên kia bị hạ. Người ngoài không thể xen vào vòng đấu.
function canDuel(k) { return k.alive && !k.duel && k.inv <= 0 && !k.has('ghost') && !k.ghostTask; }
function startDuel(a, b) {
  const d = { a, b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, bar: 0, t: DUEL_TIME, spin: Math.atan2(b.y - a.y, b.x - a.x), pulse: 0 };
  a.duel = b.duel = d; a.vx = a.vy = b.vx = b.vy = 0; a.boosting = b.boosting = false;
  duels.push(d);
  if (a.player || b.player) { tone(300, 0.2, 'square', 0.08, 0, 300); tone(600, 0.2, 'square', 0.06, 0.12); addShake(4); duelUi(d); }
}
function duelTap(k) {
  const d = k.duel; if (!d || d.done) return;
  d.bar = clamp(d.bar + (k === d.a ? 1 : -1) * DUEL_STEP * (k.has('sword') ? SWORD_TAP : 1), -100, 100);
  if (k.player) { tone(700 + Math.random() * 200, 0.04, 'square', 0.03); d.pulse = 0.12; addShake(1.8); }
}
function stepDuels(dt) {
  for (const d of duels) {
    d.t -= dt; d.spin += dt * 1.1; if (d.pulse > 0) d.pulse -= dt;
    for (const k of [d.a, d.b]) {
      if (k.player) continue;
      k.tapAcc = (k.tapAcc || 0) + dt * (4 + (k.skill || 0.4) * 5) * rand(0.6, 1.4);
      while (k.tapAcc >= 1) { k.tapAcc--; duelTap(k); }
    }
    // hai diều xoay quanh tâm vòng đấu, mặt hướng vào nhau
    const ca = Math.cos(d.spin), sa = Math.sin(d.spin);
    d.a.x = d.x - ca * 46; d.a.y = d.y - sa * 46; d.a.ang = d.spin;
    d.b.x = d.x + ca * 46; d.b.y = d.y + sa * 46; d.b.ang = d.spin + Math.PI;
    if (Math.abs(d.bar) >= 100 || d.t <= 0) endDuel(d);
  }
  duels = duels.filter(d => !d.done);
  // người ngoài bị đẩy ra khỏi vòng đấu
  for (const d of duels) for (const k of kites) {
    if (!k.alive || k.duel === d) continue;
    const dd = dist(k, d);
    if (dd < DUEL_R + 20) { const nx = (k.x - d.x) / (dd || 1), ny = (k.y - d.y) / (dd || 1); k.x = d.x + nx * (DUEL_R + 20); k.y = d.y + ny * (DUEL_R + 20); k.ang = Math.atan2(ny, nx); }
  }
  if (me) duelUi(me.duel);
}
function endDuel(d) {
  d.done = true; d.a.duel = d.b.duel = null;
  if (d.a.player || d.b.player) addShake(6);
  const w = d.bar > 0 ? d.a : d.bar < 0 ? d.b : null;
  if (!w) {                                         // hòa: văng ra hai phía
    for (const [k, s] of [[d.a, -1], [d.b, 1]]) { k.inv = 1.5; k.ang = d.spin + (s < 0 ? Math.PI : 0); }
    if (d.a.player || d.b.player) floatText(d.x, d.y - 60, 'Hòa!', '#fff');
    return;
  }
  const l = w === d.a ? d.b : d.a;
  w.inv = 1.5; l.inv = 0;
  const shielded = l.has('shield');
  hurt(l, w, 'duel');
  if (shielded) { l.inv = 1.5; l.ang = d.spin + (l === d.a ? Math.PI : 0); }
  if (w.player) floatText(d.x, d.y - 70, shielded ? 'Thắng! (đối thủ vỡ khiên)' : 'Thắng đấu!', '#ffd166');
}
function collisions() {
  const live = kites.filter(k => k.alive && !k.duel);
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
    const a = live[i], b = live[j];
    if (a.duel || b.duel || dist(a, b) > HIT_R * 2) continue;
    if (canDuel(a) && canDuel(b)) { startDuel(a, b); continue; }
    const d = dist(a, b), nx = (b.x - a.x) / (d || 1), ny = (b.y - a.y) / (d || 1);   // không đấu được (tàng hình / vừa hồi sinh): nảy ra
    a.x -= nx * 6; a.y -= ny * 6; b.x += nx * 6; b.y += ny * 6;
  }
}
// thanh lực trên màn hình khi bạn đang đấu
let duelShown = null;
function duelUi(d) {
  const box = $('duel');
  if (!d || !me || (d.a !== me && d.b !== me)) { if (duelShown) { box.classList.add('hidden'); duelShown = null; } return; }
  const mine = d.a === me ? 1 : -1, opp = d.a === me ? d.b : d.a, v = d.bar * mine;
  if (duelShown !== d) {
    duelShown = d; box.classList.remove('hidden'); $('intro').classList.add('hidden');   // không che vòng đấu
    $('duelOpp').textContent = opp.name; $('duelOppC').style.background = opp.a; $('duelMeC').style.background = me.a;
  }
  $('duelFill').style.width = (50 + v / 2) + '%';
  $('duelTime').textContent = Math.max(0, Math.ceil(d.t));
  box.classList.toggle('win', v > 30); box.classList.toggle('lose', v < -30);
}
function pickups(dt) {
  const magBase = 40 + save.ups.magnet * 35;
  for (const k of kites) {
    if (!k.alive || k.duel) continue;
    const mag = k.has('magnet') ? 260 : k.player ? magBase : 40;
    for (const c of coins) {
      if (c.taken) continue;
      const d = dist(k, c);
      if (d < mag && d > 20) { const s = (mag - d) / mag * 600 + 120; c.x += (k.x - c.x) / d * s * dt; c.y += (k.y - c.y) / d * s * dt; }
      if (d < 34) {
        c.taken = true; const v = c.v * (k.has('x2') ? 2 : 1); k.gold += v;
        if (k.player) { map.gold += v; run.goldTotal += v; run.score += v * 10; sfx.coin(); if (run.goldTotal >= 500) achieve('collector'); }
      }
    }
    for (const o of orbs) {
      if (o.taken || dist(k, o) > 40) continue;
      o.taken = true; k.orbs++;
      if (k.player) {
        sfx.orb(); floatText(o.x, o.y - 30, `Ngọc ${me.orbs}/${map.need}`, '#d8b4fe');
        if (me.orbs >= map.need && !portal) openPortal();
      }
    }
    for (const it of items) {
      if (it.taken || dist(k, it) > 42) continue;
      it.taken = true; const P = POWERS[it.type];
      k.pw[it.type] = P.time * (k.player ? 1 + save.ups.duration * 0.15 : 1);
      if (k.player) {
        sfx.power(); floatText(it.x, it.y - 30, P.name + '!', P.col);
        if (POWER_KEYS.filter(p => me.has(p)).length >= 3) achieve('full_power');
        if (it.type === 'ghost') achieve('ghost');
      }
    }
  }
  coins = coins.filter(c => !c.taken); orbs = orbs.filter(o => !o.taken); items = items.filter(i => !i.taken);
}
function openPortal() {
  const p = freeSpot(500); portal = { x: p.x, y: p.y, r: 70, t: 0 };
  sfx.portal(); tip('Cổng đã mở! Bay theo mũi tên để sang map mới', 3500);
}

// ---------- chướng ngại ----------
function hazards(dt) {
  if (map.birds && (map.nextBirds -= dt) <= 0) {
    map.nextBirds = rand(9, 15);
    const y = rand(200, WH - 400), dir = Math.random() < 0.5 ? 1 : -1, n = 4 + ((Math.random() * 4) | 0);
    for (let i = 0; i < n; i++) birds.push({ x: dir > 0 ? -80 - i * 50 : WW + 80 + i * 50, y: y + rand(-60, 60), vx: dir * rand(220, 300), ph: rand(0, TAU) });
  }
  for (const b of birds) {
    b.x += b.vx * dt; b.ph += dt * 12;
    for (const k of kites) if (k.alive && k.inv <= 0 && k.stun <= 0 && Math.hypot(k.x - b.x, k.y - b.y) < 32) { k.stun = 0.8; if (k.player) { floatText(k.x, k.y - 40, 'Va phải chim!', '#fff'); noise(0.1, 0.06, 2000); } }
  }
  birds = birds.filter(b => b.x > -400 && b.x < WW + 400);
  for (const s of storms) {
    s.x = clamp(s.x + s.vx * dt, 300, WW - 300); s.y = clamp(s.y + s.vy * dt, 250, WH - 500);
    if (s.warn > 0) {
      s.warn -= dt;
      if (s.warn <= 0) {                          // sét đánh
        s.flash = 0.25; s.next = rand(3, 6);
        if (dist(me, s) < 1100) sfx.zap();
        for (const k of kites) if (k.alive && dist(k, s) < s.r) { if (k.player) hurt(k, null, 'storm'); else hurt(k, null, 'storm'); }
      }
    } else if ((s.next -= dt) <= 0) s.warn = 1.4;
    if (s.flash > 0) s.flash -= dt;
  }
}

// ---------- hiệu ứng ----------
function burst(x, y, col, n) { for (let i = 0; i < n; i++) { const a = rand(0, TAU), s = rand(80, 320); parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.8), col, r: rand(2, 4.5) }); } }
function floatText(x, y, t, col) { texts.push({ x, y, t, col, life: 1.5 }); }
// luồng khí khi bay nhanh: vệt khí từ hai đầu cánh + sợi gió đứng yên trong không khí để diều lướt qua
function stepAir(dt) {
  for (const k of kites) {
    if (!k.alive) { k.wake = null; continue; }
    const fast = k.boosting || k.has('speed');
    const fx = Math.cos(k.ang), fy = Math.sin(k.ang), nx = -fy, ny = fx, L = k.player ? 62 : 54;
    k.wake = k.wake || [[], []];
    k.wake.forEach((w, side) => {
      for (const p of w) p.a -= dt * 2.2;
      while (w.length && w[0].a <= 0) w.shift();
      if (fast && !k.duel) { const s = side ? 1 : -1; w.push({ x: k.x + fx * L * 0.12 + nx * s * L * 0.39, y: k.y + fy * L * 0.12 + ny * s * L * 0.39, a: 1 }); }
      if (w.length > 24) w.shift();
    });
    const seen = k === me || (Math.abs(k.x - cam.x) < cw / zoom && Math.abs(k.y - cam.y) < ch / zoom);
    if (fast && !k.duel && seen && Math.random() < dt * (k === me ? 46 : 14)) {
      const d = rand(60, 220), off = rand(-90, 90);
      airs.push({ x: k.x + fx * d + nx * off, y: k.y + fy * d + ny * off, dx: fx, dy: fy, len: rand(26, 70), life: rand(0.25, 0.45), max: 0.45 });
    }
  }
  for (const a of airs) a.life -= dt;
  airs = airs.filter(a => a.life > 0);
  // camera lùi ra một chút khi bạn tăng tốc; rung nhẹ khi đang đấu
  zoom = baseZoom;
  shake = Math.max(0, shake - dt * 24);
}
// camera: bám theo diều mượt, không lắc theo vận tốc; đang đấu tay đôi thì giữ yên ở tâm vòng đấu (diều xoay, thế giới không xoay)
function followCam(dt) {
  if (!me) return;
  const t = me.duel ? me.duel : me, k = Math.min(1, dt * (me.duel ? 5 : 7));
  cam.x += (t.x - cam.x) * k; cam.y += (t.y - cam.y) * k;
}
function stepFx(dt) {
  stepAir(dt);
  for (const p of parts) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy = p.vy * 0.96 + 140 * dt; }
  parts = parts.filter(p => p.life > 0);
  for (const t of texts) { t.life -= dt; t.y -= 40 * dt; }
  texts = texts.filter(t => t.life > 0);
}

// ---------- vòng cập nhật ----------
function update(dt) {
  time += dt;
  stepFx(dt);
  if (!running) { idle(dt); return; }
  map.t += dt;
  if (net) { netUpdate(dt); return; }
  // người chơi
  if (me.alive && !me.duel) {
    let target = me.ang;
    const turnKey = (input.keys.has('ArrowRight') || input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('ArrowLeft') || input.keys.has('KeyA') ? 1 : 0);
    const upKey = (input.keys.has('ArrowDown') || input.keys.has('KeyS') ? 1 : 0) - (input.keys.has('ArrowUp') || input.keys.has('KeyW') ? 1 : 0);
    if (turnKey || upKey) target = Math.atan2(upKey, turnKey);
    else if (joy.on && Math.hypot(joy.dx, joy.dy) > 14) target = Math.atan2(joy.dy, joy.dx);
    else if (input.has) { const w = toWorld(input.x, input.y); if (Math.hypot(w.x - me.x, w.y - me.y) > 20) target = Math.atan2(w.y - me.y, w.x - me.x); }
    steer(me, dt, target, input.boost || input.keys.has('Space'));
  } else if (!me.alive && time >= me.respawnAt && run.lives > 0) {
    const p = freeSpot(500); Object.assign(me, { x: p.x, y: p.y, alive: true, inv: SPAWN_SAFE, stamina: 1, stun: 0 }); me.resetTail();
  }
  // bot
  for (const k of kites) {
    if (k.player) continue;
    if (!k.alive) { if (time >= k.respawnAt) { const p = freeSpot(); Object.assign(k, { x: p.x, y: p.y, alive: true, inv: SPAWN_SAFE, gold: 0, stun: 0 }); k.resetTail(); } continue; }
    if (k.duel) continue;
    if ((k.think -= dt) <= 0) thinkBot(k);
    const g = k.goal || k;
    steer(k, dt, avoidStorm(k, Math.atan2(g.y - k.y, g.x - k.x) + Math.sin(time * 2 + k.wob) * 0.15), k.wantBoost);
  }
  for (const k of kites) if (k.alive) stepTail(k);
  collisions();
  stepDuels(dt);
  pickups(dt);
  hazards(dt);
  // đồ rơi văng ra rồi dừng
  for (const c of coins) if (c.vx || c.vy) { c.x += c.vx * dt; c.y += c.vy * dt; c.vx *= 0.92; c.vy *= 0.92; if (Math.abs(c.vx) + Math.abs(c.vy) < 5) c.vx = c.vy = 0; }
  for (const o of orbs) if (o.vx || o.vy) { o.x = clamp(o.x + o.vx * dt, 60, WW - 60); o.y = clamp(o.y + o.vy * dt, 60, WH - 200); o.vx *= 0.93; o.vy *= 0.93; if (Math.abs(o.vx) + Math.abs(o.vy) < 5) o.vx = o.vy = 0; }
  // bổ sung vàng / ngọc / phép
  while (coins.length < map.coins * 0.75) spawnCoin();
  if (orbs.length < map.orbsOut && !portal) spawnOrb();
  if ((map.nextItem -= dt) <= 0) { map.nextItem = rand(3, 6); if (items.length < map.items) spawnItem(); }
  // cổng
  if (portal) {
    portal.t += dt;
    if (me.alive && dist(me, portal) < portal.r) return mapCleared();
  }
  // camera
  followCam(dt);
  renderHud();
}
function idle(dt) {                                  // menu / giữa map: cảnh vẫn chuyển động nhẹ
  for (const k of kites) {
    if (!k.alive) continue;
    if ((k.think -= dt) <= 0) { k.think = rand(1, 2.5); k.goal = { x: rand(200, WW - 200), y: rand(200, WH - 300) }; }
    const g = k.goal || k; steer(k, dt, Math.atan2(g.y - k.y, g.x - k.x), false); stepTail(k);
  }
  if (kites[0]) { cam.x += (kites[0].x - cam.x) * Math.min(1, dt * 1.5); cam.y += (kites[0].y - cam.y) * Math.min(1, dt * 1.5); }
}

// ---------- hết map / hết mạng ----------
function mapCleared() {
  running = false; sfx.portal();
  const n = run.map, clear = 500 * n, timeBonus = Math.max(0, Math.round(150 - map.t)) * 5, earned = map.gold + 20 * n;
  run.score += clear + timeBonus;
  save.coins += earned; save.maxMap = Math.max(save.maxMap, n + 1); if (run.score > save.best) save.best = run.score; persist();
  $('wTitle').textContent = `Qua map ${n}!`;
  $('wLines').innerHTML = [['Vàng nhặt được', map.gold], ['Hạ đối thủ', map.kills], ['Qua map', '+' + clear], ['Thưởng thời gian', '+' + timeBonus],
    ['Tổng điểm', run.score.toLocaleString('vi-VN')], ['Xu nhận được', '+' + earned]].map(([a, b]) => `<div><span>${a}</span><b>${b}</b></div>`).join('');
  $('hud').classList.add('hidden'); mini.classList.add('hidden'); $('boostBtn').classList.add('hidden'); $('powers').innerHTML = '';
  $('won').classList.remove('hidden');
}
function gameOver(by, why) {
  running = false;
  if (run.score > save.best) save.best = run.score;
  save.coins += Math.floor(map.gold / 2); persist();
  setTimeout(() => {
    $('lTitle').textContent = 'Hết mạng!';
    $('lText').textContent = why === 'storm' ? `Bị sét đánh ở map ${run.map}.` : `${by ? by.name : 'Đối thủ'} đã hạ bạn ở map ${run.map}.`;
    $('lScore').textContent = run.score.toLocaleString('vi-VN'); $('lRank').textContent = '';
    $('lRevive').classList.toggle('hidden', run.revived >= 2); $('lRevive').disabled = false;
    $('hud').classList.add('hidden'); mini.classList.add('hidden'); $('boostBtn').classList.add('hidden'); $('powers').innerHTML = '';
    $('lost').classList.remove('hidden');
    GH.gameOver({ score: run.score, meta: { map: run.map, kills: run.kills, gold: run.goldTotal } }).then(r => {
      const s = r && r.score;
      if (s && s.saved) $('lRank').textContent = `Hạng #${s.rank}${s.isNewBest ? ' · kỷ lục mới!' : ''}`;
      else if (GH.player && GH.player.guest && run.score > 0) $('lRank').textContent = 'Đăng nhập GameHub để lưu điểm';
    }).catch(() => {});
  }, 1200);
}

// ---------- vẽ ----------
function drawKite(g, k, x, y, size, ang, alpha = 1) {
  g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2); g.globalAlpha = alpha;
  const L = size, Wd = size * 0.78, top = -L * 0.55, bot = L * 0.45, mid = -L * 0.12;
  const pts = [[0, top], [Wd / 2, mid], [0, bot], [-Wd / 2, mid]];
  const tri = (i, col) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, mid); g.lineTo(...pts[i]); g.lineTo(...pts[(i + 1) % 4]); g.closePath(); g.fill(); };
  const A = k.a, B = k.b;
  if (k.pat === 'rainbow') ['#ff595e', '#ffca3a', '#8ac926', '#1982c4'].forEach((c, i) => tri(i, c));
  else if (k.pat === 'split') { tri(0, A); tri(1, B); tri(2, A); tri(3, B); }
  else if (k.pat === 'fire') { tri(0, A); tri(1, A); tri(2, B); tri(3, B); }
  else { [0, 1, 2, 3].forEach(i => tri(i, A)); }
  g.save(); g.beginPath(); g.moveTo(...pts[0]); pts.slice(1).forEach(p => g.lineTo(...p)); g.closePath(); g.clip();
  g.fillStyle = B;
  if (k.pat === 'stripe') for (let s = -L; s < L; s += L * 0.28) g.fillRect(-Wd, s, Wd * 2, L * 0.12);
  if (k.pat === 'circle') { g.beginPath(); g.arc(0, mid, L * 0.2, 0, TAU); g.fill(); }
  if (k.pat === 'cross') { g.fillRect(-Wd, mid - L * 0.06, Wd * 2, L * 0.12); g.fillRect(-L * 0.06, top, L * 0.12, L); }
  if (k.pat === 'star') { for (let i = 0; i < 9; i++) { const sx = Math.sin(i * 7.3) * Wd * 0.4, sy = top + ((i * 0.37) % 1) * L; g.beginPath(); g.arc(sx, sy, L * 0.035, 0, TAU); g.fill(); } }
  if (k.pat === 'fire') { g.beginPath(); g.moveTo(-Wd * 0.3, bot * 0.6); g.quadraticCurveTo(0, mid - L * 0.2, Wd * 0.3, bot * 0.6); g.fill(); }
  g.restore();
  g.strokeStyle = 'rgba(40,24,10,0.85)'; g.lineWidth = Math.max(1.5, size * 0.045);
  g.beginPath(); g.moveTo(0, top); g.lineTo(0, bot); g.moveTo(-Wd / 2, mid); g.lineTo(Wd / 2, mid); g.stroke();
  g.lineWidth = Math.max(1, size * 0.03); g.strokeStyle = 'rgba(30,20,10,0.55)';
  g.beginPath(); g.moveTo(...pts[0]); pts.slice(1).forEach(p => g.lineTo(...p)); g.closePath(); g.stroke();
  g.restore();
}
const iconCache = {};
function iconImg(name, col, bg) {
  const key = name + col + bg; if (iconCache[key]) return iconCache[key];
  const c = document.createElement('canvas'); c.width = c.height = 64; const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.beginPath(); g.arc(32, 32, 30, 0, TAU); g.fill(); g.strokeStyle = col; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 28, 0, TAU); g.stroke(); }
  ic.draw(g, name, 14, 14, 36, col, 2.6);
  return (iconCache[key] = c);
}
function buildSky() {
  const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
  const g = c.getContext('2d'), th = (map || { theme: MAPS[0] }).theme;
  const grd = g.createLinearGradient(0, 0, 0, c.height); grd.addColorStop(0, th.sky[0]); grd.addColorStop(1, th.sky[1]);
  g.fillStyle = grd; g.fillRect(0, 0, c.width, c.height);
  if (th === MAPS[4]) for (const s of stars) { g.fillStyle = `rgba(255,255,255,${s.a})`; g.fillRect(s.x * c.width, s.y * c.height, 2 * dpr, 2 * dpr); }
  const sx = c.width * 0.8, sy = c.height * 0.18, sr = 50 * dpr;
  const glow = g.createRadialGradient(sx, sy, sr * 0.3, sx, sy, sr * 4); glow.addColorStop(0, th.sun); glow.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = glow; g.beginPath(); g.arc(sx, sy, sr * 4, 0, TAU); g.fill();
  g.fillStyle = th.sun; g.beginPath(); g.arc(sx, sy, sr, 0, TAU); g.fill();
  skyCache = c;
}
function render() {
  const g = ctx, th = (map || { theme: MAPS[0] }).theme;
  if (!skyCache) buildSky();
  g.setTransform(1, 0, 0, 1, 0, 0); g.drawImage(skyCache, 0, 0);
  // mây xa (thị sai)
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  for (const c of clouds) {
    const x = ((c.x * cw * 1.4 - cam.x * zoom * c.p) % (cw * 1.4) + cw * 1.4) % (cw * 1.4) - cw * 0.2, y = c.y * ch - (cam.y - WH / 2) * zoom * c.p * 0.5;
    g.fillStyle = th.cloud; g.globalAlpha = c.a;
    for (const b of c.blobs) { g.beginPath(); g.arc(x + b[0] * c.s, y + b[1] * c.s, b[2] * c.s, 0, TAU); g.fill(); }
  }
  g.globalAlpha = 1;
  // thế giới
  const shx = shake ? rand(-shake, shake) : 0, shy = shake ? rand(-shake, shake) : 0;
  g.setTransform(zoom * dpr, 0, 0, zoom * dpr, (cw / 2 - cam.x * zoom + shx) * dpr, (ch / 2 - cam.y * zoom + shy) * dpr);
  const vx0 = cam.x - cw / 2 / zoom - 80, vx1 = cam.x + cw / 2 / zoom + 80, vy0 = cam.y - ch / 2 / zoom - 80, vy1 = cam.y + ch / 2 / zoom + 80;
  const inView = o => o.x > vx0 && o.x < vx1 && o.y > vy0 && o.y < vy1;
  // mặt đất trang trí + biên
  const gg = g.createLinearGradient(0, WH - 120, 0, WH + 200); gg.addColorStop(0, th.ground[0]); gg.addColorStop(1, th.ground[1]);
  g.fillStyle = gg; g.beginPath(); g.moveTo(-400, WH + 400);
  for (let x = -400; x <= WW + 400; x += 60) g.lineTo(x, WH - 90 - Math.sin(x * 0.006) * 30 - Math.sin(x * 0.017) * 14);
  g.lineTo(WW + 400, WH + 400); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 6; g.setLineDash([24, 18]); g.strokeRect(20, 20, WW - 40, WH - 40); g.setLineDash([]);
  // luồng gió
  for (const w of winds) {
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.arc(w.x, w.y, w.r, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.45)'; g.lineWidth = 4;
    const a = Math.atan2(w.fy, w.fx);
    for (let i = 0; i < 5; i++) {
      const o = ((time * 120 + i * w.r * 0.4) % (w.r * 1.6)) - w.r * 0.8, sx = w.x + Math.cos(a) * o + Math.cos(a + 1.57) * (i - 2) * 50, sy = w.y + Math.sin(a) * o + Math.sin(a + 1.57) * (i - 2) * 50;
      g.beginPath(); g.moveTo(sx, sy); g.lineTo(sx + Math.cos(a) * 60, sy + Math.sin(a) * 60); g.stroke();
    }
  }
  // mây giông
  for (const s of storms) {
    if (s.warn > 0) { g.fillStyle = `rgba(255,60,80,${0.15 + 0.15 * Math.sin(time * 18)})`; g.beginPath(); g.arc(s.x, s.y, s.r, 0, TAU); g.fill(); }
    g.fillStyle = s.flash > 0 ? '#fff' : 'rgba(70,72,100,0.85)';
    for (let i = 0; i < 6; i++) { g.beginPath(); g.arc(s.x + Math.cos(i) * s.r * 0.45, s.y - s.r * 0.6 + Math.sin(i * 2) * 20, s.r * 0.32, 0, TAU); g.fill(); }
    if (s.flash > 0) {
      g.strokeStyle = '#fff6a8'; g.lineWidth = 6; g.beginPath(); let lx = s.x, ly = s.y - s.r * 0.5; g.moveTo(lx, ly);
      for (let i = 0; i < 6; i++) { lx += rand(-40, 40); ly += s.r * 0.22; g.lineTo(lx, ly); } g.stroke();
    }
  }
  // cổng
  if (portal) {
    const r = portal.r + Math.sin(time * 4) * 6;
    for (let i = 0; i < 3; i++) { g.strokeStyle = `rgba(196,181,253,${0.8 - i * 0.22})`; g.lineWidth = 8 - i * 2; g.beginPath(); g.arc(portal.x, portal.y, r + i * 14, time * (2 + i), time * (2 + i) + 4.6); g.stroke(); }
    const pg = g.createRadialGradient(portal.x, portal.y, 4, portal.x, portal.y, r); pg.addColorStop(0, '#ffffff'); pg.addColorStop(0.4, '#c4b5fd'); pg.addColorStop(1, 'rgba(124,58,237,0.15)');
    g.fillStyle = pg; g.beginPath(); g.arc(portal.x, portal.y, r, 0, TAU); g.fill();
  }
  // vàng, ngọc, phép
  for (const c of coins) {
    if (!inView(c)) continue;
    const r = c.v > 1 ? 15 : 10, sx = Math.abs(Math.cos(time * 3 + c.ph));
    g.fillStyle = c.v > 1 ? '#ffb703' : '#ffd166'; g.beginPath(); g.ellipse(c.x, c.y, r * Math.max(0.25, sx), r, 0, 0, TAU); g.fill();
    g.strokeStyle = '#c98a00'; g.lineWidth = 2; g.stroke();
  }
  for (const o of orbs) {
    if (!inView(o)) continue;
    const y = o.y + Math.sin(time * 3 + o.ph) * 6;
    const og = g.createRadialGradient(o.x, y, 2, o.x, y, 34); og.addColorStop(0, 'rgba(216,180,254,0.9)'); og.addColorStop(1, 'rgba(168,85,247,0)');
    g.fillStyle = og; g.beginPath(); g.arc(o.x, y, 34, 0, TAU); g.fill();
    g.drawImage(iconImg('gem', '#f5e9ff', 'rgba(126,34,206,0.85)'), o.x - 20, y - 20, 40, 40);
  }
  for (const it of items) {
    if (!inView(it)) continue;
    const P = POWERS[it.type], y = it.y + Math.sin(time * 2.5 + it.ph) * 8, s = 46 + Math.sin(time * 5 + it.ph) * 3;
    g.drawImage(iconImg(P.icon, P.col, 'rgba(12,18,44,0.7)'), it.x - s / 2, y - s / 2, s, s);
  }
  // chim
  g.strokeStyle = th === MAPS[4] ? '#dfe6ff' : '#2b2d42'; g.lineWidth = 4; g.lineCap = 'round';
  for (const b of birds) { if (!inView(b)) continue; const f = Math.sin(b.ph) * 10; g.beginPath(); g.moveTo(b.x - 18, b.y - f); g.quadraticCurveTo(b.x - 6, b.y - 5, b.x, b.y); g.quadraticCurveTo(b.x + 6, b.y - 5, b.x + 18, b.y - f); g.stroke(); }
  // vòng đấu tay đôi
  for (const d of duels) {
    if (!inView(d)) continue;
    g.fillStyle = 'rgba(12,18,44,0.25)'; g.beginPath(); g.arc(d.x, d.y, DUEL_R, 0, TAU); g.fill();
    g.lineWidth = 5; g.strokeStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(d.x, d.y, DUEL_R, 0, TAU); g.stroke();
    g.strokeStyle = '#ffd166'; g.beginPath(); g.arc(d.x, d.y, DUEL_R, -Math.PI / 2, -Math.PI / 2 + TAU * Math.max(0, d.t) / DUEL_TIME); g.stroke();
    const share = (d.bar + 100) / 200;                // phần màu của mỗi bên trên vòng trong
    g.lineWidth = 8; g.strokeStyle = d.a.a; g.beginPath(); g.arc(d.x, d.y, DUEL_R - 12, Math.PI / 2, Math.PI / 2 + TAU * share); g.stroke();
    g.strokeStyle = d.b.a; g.beginPath(); g.arc(d.x, d.y, DUEL_R - 12, Math.PI / 2 + TAU * share, Math.PI / 2 + TAU); g.stroke();
    if (Math.random() < 0.5) parts.push({ x: d.x + rand(-20, 20), y: d.y + rand(-20, 20), vx: rand(-120, 120), vy: rand(-160, 40), life: 0.3, col: '#fff6b0', r: 2 });
  }
  // luồng khí
  g.lineCap = 'round';
  for (const a of airs) {
    if (!inView(a)) continue;
    const t = a.life / a.max;
    g.strokeStyle = `rgba(70,130,200,${0.22 * t})`; g.lineWidth = 4.5; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(a.x - a.dx * a.len, a.y - a.dy * a.len); g.stroke();
    g.strokeStyle = `rgba(255,255,255,${0.85 * t})`; g.lineWidth = 2; g.beginPath(); g.moveTo(a.x, a.y); g.lineTo(a.x - a.dx * a.len, a.y - a.dy * a.len); g.stroke();
  }
  for (const k of kites) {
    if (!k.wake || !k.alive || (k.has('ghost') && !k.player)) continue;
    for (const w of k.wake) for (let i = 1; i < w.length; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.8 * w[i].a * (i / w.length)})`; g.lineWidth = 1.2 + 2.8 * (i / w.length);
      g.beginPath(); g.moveTo(w[i - 1].x, w[i - 1].y); g.lineTo(w[i].x, w[i].y); g.stroke();
    }
  }
  // diều
  for (const k of kites) {
    if (!k.alive || !inView(k)) continue;

    const ghost = k.has('ghost');
    if (ghost && !k.player) continue;               // đối thủ tàng hình: không thấy
    const alpha = ghost ? 0.35 : k.inv > 0 ? 0.5 + 0.4 * Math.sin(time * 20) : 1;
    g.globalAlpha = alpha;
    g.strokeStyle = k.b; g.lineWidth = 3; g.beginPath(); g.moveTo(k.tail[0].x, k.tail[0].y); for (const t of k.tail) g.lineTo(t.x, t.y); g.stroke();
    g.fillStyle = k.a; for (let i = 2; i < k.tail.length; i += 2) { const t = k.tail[i]; g.beginPath(); g.ellipse(t.x, t.y, 7, 3.5, i, 0, TAU); g.fill(); }
    g.globalAlpha = 1;
    if (k.has('sword')) {                           // kiếm xoay quanh diều
      g.save(); g.translate(k.x, k.y); g.rotate(time * 7);
      g.fillStyle = '#e5e7eb'; g.strokeStyle = '#6b7280'; g.lineWidth = 2;
      for (let i = 0; i < 2; i++) { g.rotate(Math.PI); g.beginPath(); g.moveTo(26, -4); g.lineTo(62, 0); g.lineTo(26, 4); g.closePath(); g.fill(); g.stroke(); g.fillStyle = '#b45309'; g.fillRect(18, -7, 8, 14); g.fillStyle = '#e5e7eb'; }
      g.restore();
    }
    drawKite(g, k, k.x, k.y, k.player ? 62 : 54, k.ang, alpha);
    if (k.has('shield')) { g.strokeStyle = `rgba(110,231,183,${0.6 + 0.2 * Math.sin(time * 8)})`; g.lineWidth = 4; g.beginPath(); g.arc(k.x, k.y, 46, 0, TAU); g.stroke(); }
    if (running) {
      g.font = '800 17px system-ui, sans-serif'; g.textAlign = 'center'; g.lineWidth = 4; g.strokeStyle = 'rgba(0,0,0,0.35)';
      const label = k.player ? 'Bạn' : k.name;
      g.strokeText(label, k.x, k.y - 50); g.fillStyle = k.player ? '#ffd166' : '#fff'; g.fillText(label, k.x, k.y - 50);
    }
  }
  for (const p of parts) { if (!inView(p)) continue; g.globalAlpha = Math.min(1, p.life * 3); g.fillStyle = p.col; g.beginPath(); g.arc(p.x, p.y, p.r, 0, TAU); g.fill(); }
  g.globalAlpha = 1; g.textAlign = 'center'; g.font = '900 26px system-ui, sans-serif';
  for (const t of texts) { g.globalAlpha = Math.min(1, t.life * 2); g.lineWidth = 5; g.strokeStyle = 'rgba(0,0,0,0.45)'; g.strokeText(t.t, t.x, t.y); g.fillStyle = t.col; g.fillText(t.t, t.x, t.y); }
  g.globalAlpha = 1;
  // mũi tên chỉ cổng (khi cổng ngoài màn hình)
  if (running && portal && !inView(portal)) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const a = Math.atan2(portal.y - cam.y, portal.x - cam.x), r = Math.min(cw, ch) / 2 - 60;
    const ax = cw / 2 + Math.cos(a) * r, ay = ch / 2 + Math.sin(a) * r;
    g.save(); g.translate(ax, ay); g.rotate(a); g.fillStyle = '#c4b5fd'; g.strokeStyle = '#4c1d95'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(26, 0); g.lineTo(-14, -18); g.lineTo(-6, 0); g.lineTo(-14, 18); g.closePath(); g.fill(); g.stroke(); g.restore();
  }
  if (running) drawMini();
  // joystick ảo cảm ứng
  if (joy.on) {
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const R = 52, mag = Math.hypot(joy.dx, joy.dy), K = Math.min(R - 10, mag), a = Math.atan2(joy.dy, joy.dx);
    g.beginPath(); g.arc(joy.ox, joy.oy, R, 0, TAU); g.fillStyle = 'rgba(12,18,44,0.30)'; g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(255,255,255,0.55)'; g.stroke();
    g.beginPath(); g.arc(joy.ox + Math.cos(a) * K, joy.oy + Math.sin(a) * K, 23, 0, TAU);
    g.fillStyle = mag > 14 ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.55)'; g.fill();
    g.lineWidth = 2.5; g.strokeStyle = 'rgba(12,18,44,0.5)'; g.stroke();
  }
}
function drawMini() {
  const w = mini.width, h = mini.height, sx = w / WW, sy = h / WH;
  mctx.clearRect(0, 0, w, h);
  mctx.fillStyle = 'rgba(196,181,253,0.9)'; for (const o of orbs) mctx.fillRect(o.x * sx - 2, o.y * sy - 2, 4, 4);
  for (const k of kites) {
    if (!k.alive || (k.has('ghost') && !k.player)) continue;
    mctx.fillStyle = k.player ? '#ffd166' : k.has('sword') ? '#ff4d6d' : 'rgba(255,255,255,0.7)';
    const r = k.player ? 4 : 2.5; mctx.beginPath(); mctx.arc(k.x * sx, k.y * sy, r, 0, TAU); mctx.fill();
  }
  if (portal) { mctx.strokeStyle = '#c4b5fd'; mctx.lineWidth = 2; mctx.beginPath(); mctx.arc(portal.x * sx, portal.y * sy, 6 + Math.sin(time * 6) * 2, 0, TAU); mctx.stroke(); }
  mctx.strokeStyle = 'rgba(255,255,255,0.5)'; mctx.lineWidth = 1;
  mctx.strokeRect((cam.x - cw / 2 / zoom) * sx, (cam.y - ch / 2 / zoom) * sy, cw / zoom * sx, ch / zoom * sy);
}

// ---------- HUD ----------
let hudKey = '';
function renderHud() {
  if (net) return renderNetHud();
  const pw = POWER_KEYS.filter(p => me.has(p));
  const key = [run.map, run.score, map.gold, me.orbs, run.lives, pw.map(p => p + Math.ceil(me.pw[p])).join(','), Math.round(me.stamina * 20)].join('|');
  if (key === hudKey) return; hudKey = key;
  $('hMap').textContent = 'Map ' + run.map; $('hScore').textContent = run.score.toLocaleString('vi-VN');
  $('hGold').textContent = map.gold;
  $('hOrbs').textContent = `${Math.min(me.orbs, map.need)}/${map.need}`;
  $('hOrbs').parentElement.classList.toggle('ready', !!portal);
  $('hLives').innerHTML = Array.from({ length: Math.max(LIVES, run.lives) }, (_, i) => ic('heart', i < run.lives ? '' : 'off')).join('');
  $('powers').innerHTML = pw.map(p => { const P = POWERS[p], t = me.pw[p], max = P.time * (1 + save.ups.duration * 0.15);
    return `<div style="color:${P.col}"><span class="pi" style="background:${P.col}33">${ic(P.icon)}</span><span class="pt"><span style="color:#fff">${P.name} ${Math.ceil(t)}s</span><div class="pb" style="width:${Math.max(4, t / max * 100)}%"></div></span></div>`; }).join('');
  $('stamina').style.width = me.stamina * 100 + '%';
}
function tip(text, ms = 3000) { const t = $('tip'); t.textContent = text; t.classList.remove('hidden'); clearTimeout(tip.t); tip.t = setTimeout(() => t.classList.add('hidden'), ms); }

// ---------- vòng lặp ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (!paused) update(dt);
  render();
  requestAnimationFrame(frame);
}

// ---------- điều khiển ----------
cv.addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') {
    if (joy.on) { joy.dx = e.clientX - joy.ox; joy.dy = e.clientY - joy.oy; }
    return;                                                  // cảm ứng lái bằng joystick, không dùng điểm tuyệt đối
  }
  input.x = e.clientX; input.y = e.clientY; input.has = true;
});
cv.addEventListener('pointerdown', e => {
  audio();
  if (me && me.duel && running) { tapDuel(); return; }
  if (e.pointerType === 'touch') { joy.on = true; joy.ox = e.clientX; joy.oy = e.clientY; joy.dx = joy.dy = 0; return; }
  input.x = e.clientX; input.y = e.clientY; input.has = true;
  if (e.pointerType === 'mouse') input.boost = true;       // chuột: giữ để tăng tốc; cảm ứng: joystick lái, nút riêng để tăng tốc
});
const up = e => {
  if (!e || e.pointerType === 'mouse') input.boost = false;
  if (!e || e.pointerType === 'touch') { joy.on = false; joy.dx = joy.dy = 0; }
};
cv.addEventListener('pointerup', up); cv.addEventListener('pointercancel', up);
const bb = $('boostBtn');
bb.addEventListener('pointerdown', e => { e.stopPropagation(); if (me && me.duel) { tapDuel(); return; } input.boost = true; bb.setPointerCapture(e.pointerId); });
bb.addEventListener('pointerup', () => { input.boost = false; }); bb.addEventListener('pointercancel', () => { input.boost = false; });
window.addEventListener('keydown', e => {
  if (e.key === 'Escape') { togglePause(); return; }
  if (e.code === 'Space' && !e.repeat && me && me.duel && running) { e.preventDefault(); tapDuel(); return; }
  input.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
});
window.addEventListener('keyup', e => input.keys.delete(e.code));
window.addEventListener('blur', () => { input.keys.clear(); input.boost = false; });

function tapDuel() { if (net) { net.room.send('tap'); addShake(1.8); tone(700 + Math.random() * 200, 0.04, 'square', 0.03); } else duelTap(me); }

// ---------- overlay & menu ----------
const OVS = ['menu', 'how', 'shop', 'won', 'lost', 'pause'];
function hideAll() { OVS.forEach(id => $(id).classList.add('hidden')); }
function showMenu() {
  hideAll(); running = false; paused = false; run = null; map = null; portal = null; skyCache = null;
  $('hud').classList.add('hidden'); mini.classList.add('hidden'); $('boostBtn').classList.add('hidden'); $('powers').innerHTML = ''; $('lb').classList.add('hidden');
  $('hLives').classList.remove('hidden');
  $('mBest').textContent = save.best.toLocaleString('vi-VN'); $('mMax').textContent = save.maxMap; $('mCoins').textContent = save.coins.toLocaleString('vi-VN');
  $('optSound').checked = save.sound;
  // vài cánh diều bay làm nền
  coins = []; orbs = []; items = []; birds = []; storms = []; winds = [];
  kites = [0, 1, 2, 3].map(i => { const s = i === 0 ? (SKINS.find(x => x.id === save.skin) || SKINS[0]) : { a: BOT_STYLES[i][0], b: BOT_STYLES[i][1], pat: BOT_STYLES[i][2] };
    const k = new Kite({ id: 'm' + i, player: false, name: '', a: s.a, b: s.b, pat: s.pat, x: WW / 2 + rand(-500, 500), y: WH / 2 + rand(-300, 300), ang: rand(0, TAU), skill: 0 }); k.resetTail(); return k; });
  for (let i = 0; i < 60; i++) spawnCoin(WW / 2 + rand(-900, 900), WH / 2 + rand(-600, 600));
  $('menu').classList.remove('hidden');
}
function togglePause(force) {
  if (!running) return;
  if (net) {                                          // online: thế giới không dừng, chỉ mở bảng
    const show = force !== undefined ? force : $('pause').classList.contains('hidden');
    $('pause').classList.toggle('hidden', !show);
    $('pCode').classList.toggle('hidden', !net.code); $('pCode').textContent = net.code ? `Mã phòng: ${net.code} — gửi cho bạn bè` : '';
    $('pQuit').innerHTML = ic('house') + ' Rời phòng';
    return;
  }
  $('pQuit').innerHTML = ic('house') + ' Bỏ cuộc';
  paused = force !== undefined ? force : !paused;
  $('pause').classList.toggle('hidden', !paused);
  input.keys.clear(); input.boost = false;
  if (!paused) last = performance.now();
}
$('hPause').onclick = () => togglePause(true);
$('pGo').onclick = () => (net ? $('pause').classList.add('hidden') : togglePause(false));
$('pQuit').onclick = () => { if (net) { leaveOnline(); showMenu(); return; } if (run && run.score > 0) GH.gameOver({ score: run.score, meta: { map: run.map, kills: run.kills, quit: true } }).catch(() => {}); showMenu(); };
$('bPlay').onclick = () => { audio(); startRun(); };
$('bHow').onclick = () => $('how').classList.remove('hidden');
$('bShop').onclick = () => openShop();
$('wShop').onclick = () => openShop();
$('wNext').onclick = () => { run.map++; startMap(); };
$('lAgain').onclick = () => startRun();
$('lMenu').onclick = () => showMenu();
$('optSound').onchange = e => { save.sound = e.target.checked; persist(); };
document.querySelectorAll('[data-close]').forEach(b => { b.onclick = () => { b.closest('.ov').classList.add('hidden'); $('mCoins').textContent = save.coins.toLocaleString('vi-VN'); }; });

// nhiệm vụ GameHub
async function reward(placement, btn) {
  const label = btn.innerHTML; btn.disabled = true;
  const r = await GH.requestReward(placement).catch(() => null);
  btn.disabled = false;
  if (r && r.rewarded) return r;
  if (r && r.reason && r.reason !== 'closed') {
    const why = { cooldown: `Thử lại sau ${r.retryAfterSec || ''} giây`, limit: 'Hết lượt hôm nay', tasks_done: 'Đã làm hết nhiệm vụ hôm nay', no_tasks: 'Chưa có nhiệm vụ', login: 'Đăng nhập GameHub để làm nhiệm vụ', disabled: 'Nhiệm vụ đang tắt' }[r.reason] || 'Chưa nhận được thưởng';
    btn.innerHTML = ic('triangle-alert') + ' ' + why; setTimeout(() => { btn.innerHTML = label; }, 2200);
  }
  return null;
}
$('bCoins').onclick = async () => {
  const r = await reward('coins', $('bCoins'));
  if (r) { save.coins += (r.reward && r.reward.amount) || 100; persist(); sfx.buy(); $('mCoins').textContent = save.coins.toLocaleString('vi-VN'); }
};
$('lRevive').onclick = async () => {
  const r = await reward('revive', $('lRevive'));
  if (!r) return;
  run.revived++; run.lives = (r.reward && r.reward.amount) || 1;
  const p = freeSpot(500); Object.assign(me, { x: p.x, y: p.y, alive: true, inv: SPAWN_SAFE, stamina: 1, stun: 0 }); me.resetTail();
  hideAll(); $('hud').classList.remove('hidden'); mini.classList.remove('hidden'); $('boostBtn').classList.toggle('hidden', !('ontouchstart' in window));
  running = true; paused = false; last = performance.now(); hudKey = '';
  tip('Hồi sinh! Chơi tiếp map này');
};

// cửa hàng
function openShop() {
  $('sCoins').textContent = save.coins.toLocaleString('vi-VN');
  $('ups').innerHTML = UPGRADES.map(u => {
    const lv = save.ups[u.id] || 0, cost = UP_COST[lv];
    return `<div class="up"><div class="t">${ic(u.icon)} ${u.name}</div><p>${u.desc}</p>
      <div class="pips">${[0, 1, 2, 3, 4].map(i => `<i class="${i < lv ? 'on' : ''}"></i>`).join('')}</div>
      <button class="buy" data-up="${u.id}" ${lv >= 5 || save.coins < cost ? 'disabled' : ''}>${lv >= 5 ? 'Tối đa' : `${ic('coins')} ${cost}`}</button></div>`;
  }).join('');
  $('skins').innerHTML = SKINS.map(s => {
    const own = save.skins.includes(s.id);
    return `<button class="skin ${save.skin === s.id ? 'on' : ''}" data-skin="${s.id}"><canvas width="128" height="128" data-prev="${s.id}"></canvas><b>${s.name}</b>
      <small>${save.skin === s.id ? 'Đang dùng' : own ? 'Bấm để dùng' : `${ic('coins')} ${s.price}`}</small></button>`;
  }).join('');
  document.querySelectorAll('[data-prev]').forEach(c => drawKite(c.getContext('2d'), SKINS.find(x => x.id === c.dataset.prev), 64, 70, 92, -Math.PI / 2));
  $('shop').classList.remove('hidden');
}
$('ups').onclick = e => {
  const b = e.target.closest('[data-up]'); if (!b || b.disabled) return;
  const id = b.dataset.up, cost = UP_COST[save.ups[id] || 0];
  if (save.coins < cost) return;
  save.coins -= cost; save.ups[id] = (save.ups[id] || 0) + 1; persist(); sfx.buy(); achieve('upgrade'); openShop();
};
$('skins').onclick = e => {
  const b = e.target.closest('[data-skin]'); if (!b) return;
  const s = SKINS.find(x => x.id === b.dataset.skin);
  if (!save.skins.includes(s.id)) { if (save.coins < s.price) { tip('Chưa đủ xu — chơi thêm vài map nhé!'); return; } save.coins -= s.price; save.skins.push(s.id); achieve('new_skin'); sfx.buy(); }
  save.skin = s.id; persist(); openShop();
};


// ---------- ONLINE (máy chủ chạy logic, client vẽ lại theo snapshot) ----------
const NET_DELAY = 0.1;
let net = null;
const setNet = (text, icon) => { const el = $('netMsg'); el.innerHTML = icon ? ic(icon) + ' ' : ''; el.append(text || ''); };
async function goOnline(opts) {
  if (net) return;
  audio();
  setNet('Đang kết nối máy chủ...', 'loader-circle');
  let room;
  try { room = await GH.multiplayer.join(opts); }
  catch (e) { setNet(e.code === 'offline' ? 'Chơi online cần mở game trên GameHub' : e.message, 'triangle-alert'); return; }
  net = { room, code: room.code, id: null, byId: new Map(), buf: [], latest: null, sentAt: 0, lastA: null, lastB: null, lb: [], stats: null, need: 5, n: 1, streak: 0 };
  room.on('map', onNetMap);
  room.on('snap', onSnap);
  room.on('round', m => {
    const mine = m.id === net.id;
    floatBanner(mine ? 'Bạn thắng vòng!' : `${m.winner} thắng vòng!`, `+${m.bonus} điểm · sang map ${m.next} sau 3 giây`);
    if (mine) { sfx.portal(); if (m.next >= 3) achieve('map_3'); if (m.next >= 5) achieve('map_5'); }
  });
  room.on('dead', m => { tip(m.why === 'storm' ? 'Bị sét đánh! Hồi sinh sau 2 giây' : `${m.by || 'Đối thủ'} đã hạ bạn — hồi sinh sau 2 giây`); sfx.die(); });
  room.on('saved', m => { const r = m.result; if (r && r.saved) tip(`Đã lưu ${r.score ? r.score.toLocaleString('vi-VN') : ''} điểm · hạng #${r.rank}`); });
  room.on('close', () => { if (net && net.room === room) { net = null; if (running) { tip('Mất kết nối máy chủ'); showMenu(); } } });
  room.on('error', e => tip(e.message));
  const skin = SKINS.find(x => x.id === save.skin) ? save.skin : 'classic';
  room.send('spawn', { name: GH.player && !GH.player.guest ? GH.player.displayName : 'Khách', skin });
  const you = await new Promise(res => { const t = setTimeout(() => res(null), 6000); room.on('you', m => { clearTimeout(t); res(m); }); });
  if (!you || !net) { setNet('Máy chủ không phản hồi, thử lại nhé', 'triangle-alert'); leaveOnline(); return; }
  net.id = you.id;
  setNet('');
  run = { online: true, map: net.n, score: 0, lives: 1, kills: 0, goldTotal: 0, revived: 0 };
  GH.gameStart().catch(() => {});
  hideAll(); $('hud').classList.remove('hidden'); mini.classList.remove('hidden'); $('lb').classList.remove('hidden'); $('hLives').classList.add('hidden');
  $('boostBtn').classList.toggle('hidden', !('ontouchstart' in window));
  running = true; paused = false; last = performance.now(); hudKey = '';
  showIntro();
  if (net.code) tip(`Phòng riêng ${net.code} — gửi mã cho bạn bè để cùng chơi`, 5000);
}
function leaveOnline() {
  if (!net) return;
  const n = net; net = null;
  try { n.room.leave(); } catch { /* */ }
  GH.gameOver({}).catch(() => {});                    // điểm online do máy chủ ghi
}
function onNetMap(m) {
  net.n = m.n; net.need = m.need;
  map = mapConfig(m.n); map.need = m.need; map.t = 0; map.gold = 0; map.kills = 0;
  map.birds = m.hazards.birds; map.storms = m.hazards.storms; map.winds = m.hazards.winds;
  if (run) run.map = m.n;
  coins = m.coins.map(([id, v, x, y]) => ({ id, v, x, y, ph: Math.random() * TAU, vx: 0, vy: 0 }));
  winds = m.winds.map(([x, y, r, fx, fy]) => ({ x, y, r, fx, fy }));
  portal = null; skyCache = null; parts = []; texts = [];
  if (running) showIntro();
}
function netKite(id) { return net.byId.get(id); }
function onSnap(m) {
  const t = performance.now() / 1000;
  if (m.m) for (const [id, name, a, b, pat, bot] of m.m) {
    let k = netKite(id);
    if (!k) { k = new Kite({ id, player: id === net.id, name, a, b, pat, bot: !!bot, alive: false }); net.byId.set(id, k); }
    Object.assign(k, { name, a, b, pat });
  }
  const pos = new Map();
  for (const [id, x, y, a, fl] of m.s) pos.set(id, [x, y, a / 1000, fl]);
  net.buf.push({ t, pos }); if (net.buf.length > 20) net.buf.shift();
  net.latest = { t, pos };
  for (const [id, P] of pos) {
    const k = netKite(id); if (!k) continue;
    if (!k.alive || Math.hypot(P[0] - k.x, P[1] - k.y) > 400) { k.x = P[0]; k.y = P[1]; k.ang = P[2]; k.resetTail(); }
    k.alive = true; k.seen = t; k.flags = P[3];
    if (!k.player) { k.pw = {}; ['boost', 'sword', 'shield', 'speed', 'ghost', 'magnet', 'x2'].forEach((p, i) => { if (p !== 'boost' && (P[3] >> i) & 1) k.pw[p] = 1; }); k.boosting = !!(P[3] & 1); k.inv = P[3] & 128 ? 1 : 0; }
  }
  for (const k of net.byId.values()) if (k.seen !== t) k.alive = false;
  orbs = m.o.map(([id, x, y]) => { const old = orbs.find(o => o.id === id); return { id, x, y, ph: old ? old.ph : Math.random() * TAU, vx: 0, vy: 0 }; });
  items = m.i.map(([id, x, y, type]) => { const old = items.find(o => o.id === id); return { id, x, y, type, ph: old ? old.ph : Math.random() * TAU }; });
  storms = m.st.map(([x, y, r, w, f]) => ({ x, y, r, warn: w, flash: f ? 0.2 : 0 }));
  birds = m.bd.map(([x, y, vx], i) => ({ x, y, vx, ph: (birds[i] && birds[i].ph) || Math.random() * TAU }));
  portal = m.pt ? { x: m.pt[0], y: m.pt[1], r: m.pt[2] } : null;
  for (const k of net.byId.values()) k.duel = null;
  duels = (m.du || []).map(([ia, ib, x, y, bar, t, spin]) => {
    const A = netKite(ia), B = netKite(ib); if (!A || !B) return null;
    const d = { a: A, b: B, x, y, bar, t: t / 10, spin: spin / 1000 }; A.duel = B.duel = d; return d;
  }).filter(Boolean);
  if (m.cm) for (const [id, x, y] of m.cm) { const c = coins.find(q => q.id === id); if (c) { c.x = x; c.y = y; } }
  for (const e of m.ev) netEvent(e);
  if (m.lb) { net.lb = m.lb; renderLb(); }
  if (m.me) {
    const s = m.me; net.stats = s;
    if (me) {
      me.gold = s[0]; me.orbs = s[1]; me.stamina = s[4] / 100; me.ghostTask = !!s[12];
      me.pw = {}; POWER_KEYS.forEach((p, i) => { if (s[5 + i] > 0) me.pw[p] = s[5 + i] / 10; });
      me.kills = s[3];
      if (run) { run.score = s[2]; run.kills = s[3]; }
    }
  }
  me = netKite(net.id) || me;
}
function netEvent(e) {
  switch (e[0]) {
    case 'c+': coins.push({ id: e[1], v: e[2], x: e[3], y: e[4], ph: Math.random() * TAU, vx: 0, vy: 0 }); break;
    case 'c-': { const i = coins.findIndex(c => c.id === e[1]); if (i >= 0) coins.splice(i, 1); if (e[2] === net.id) { sfx.coin(); map.gold++; } break; }
    case 'k': {
      const v = netKite(e[1]), by = netKite(e[2]);
      if (v) { burst(v.x, v.y, v.a, 30); burst(v.x, v.y, '#fff', 12); }
      if (by && by.id === net.id && v) { floatText(v.x, v.y - 30, `Hạ ${v.name}!`, '#ffd166'); sfx.hit(); achieve('first_kill'); map.kills++; if (++net.streak >= 3) achieve('sword_master'); }
      if (v && v.id === net.id) net.streak = 0;
      break;
    }
    case 'b': { const k = netKite(e[1]); if (k) { burst(k.x, k.y, POWERS.shield.col, 18); if (k.id === net.id) { sfx.block(); floatText(k.x, k.y - 40, 'Lá chắn vỡ!', POWERS.shield.col); } } break; }
    case 'p': { const k = netKite(e[1]); if (k && k.id === net.id) { const Pw = POWERS[e[2]]; sfx.power(); floatText(k.x, k.y - 30, Pw.name + '!', Pw.col); if (e[2] === 'ghost') achieve('ghost'); } break; }
    case 'o': { const k = netKite(e[1]); if (k && k.id === net.id) { sfx.orb(); floatText(k.x, k.y - 30, `Ngọc ${Math.min(net.stats ? net.stats[1] + 1 : 1, net.need)}/${net.need}`, '#d8b4fe'); } break; }
    case 'pt': { const k = netKite(e[1]); tip(k && k.id === net.id ? 'Cổng đã mở! Bay vào cổng trước khi bị ai cướp' : `${k ? k.name : 'Ai đó'} đã đủ ngọc — cổng mở, mau ngăn họ lại!`, 3500); sfx.portal(); break; }
    case 'z': if (storms[e[1]] && me && dist(me, storms[e[1]]) < 1100) sfx.zap(); break;
    case 'x': net.byId.delete(e[1]); break;
    case 'd+': if (e[1] === net.id || e[2] === net.id) { tone(300, 0.2, 'square', 0.08, 0, 300); tone(600, 0.2, 'square', 0.06, 0.12); addShake(4); } break;
    case 'd-': { if ([e[1], e[2], e[3]].includes(net.id)) addShake(6); if (e[1] === net.id) { const k = netKite(net.id); if (k) floatText(k.x, k.y - 70, 'Thắng đấu!', '#ffd166'); } else if (!e[1] && (e[2] === net.id || e[3] === net.id)) { const k = netKite(net.id); if (k) floatText(k.x, k.y - 60, 'Hòa!', '#fff'); } break; }
  }
}
// gửi điều khiển (tối đa 20 lần/giây) + nội suy diều khác + dự đoán diều mình
function netUpdate(dt) {
  const now = performance.now() / 1000;
  let a = me ? me.ang : 0;
  const turnKey = (input.keys.has('ArrowRight') || input.keys.has('KeyD') ? 1 : 0) - (input.keys.has('ArrowLeft') || input.keys.has('KeyA') ? 1 : 0);
  const upKey = (input.keys.has('ArrowDown') || input.keys.has('KeyS') ? 1 : 0) - (input.keys.has('ArrowUp') || input.keys.has('KeyW') ? 1 : 0);
  if (me && me.alive) {
    if (turnKey || upKey) a = Math.atan2(upKey, turnKey);
    else if (joy.on && Math.hypot(joy.dx, joy.dy) > 14) a = Math.atan2(joy.dy, joy.dx);
    else if (input.has) { const w = toWorld(input.x, input.y); if (Math.hypot(w.x - me.x, w.y - me.y) > 20) a = Math.atan2(w.y - me.y, w.x - me.x); }
    const b = input.boost || input.keys.has('Space') ? 1 : 0;
    if (now - net.sentAt > 0.05 && (net.lastA === null || Math.abs(angDiff(net.lastA, a)) > 0.02 || b !== net.lastB || now - net.sentAt > 0.5)) {
      net.room.send('in', { a, b }); net.sentAt = now; net.lastA = a; net.lastB = b;
    }
  }
  const rt = now - NET_DELAY, buf = net.buf;
  let A = buf[0], B = buf[0];
  for (let i = buf.length - 1; i >= 0; i--) if (buf[i].t <= rt) { A = buf[i]; B = buf[i + 1] || buf[i]; break; }
  for (const k of net.byId.values()) {
    if (!k.alive) continue;
    if (k.id === net.id && !k.duel) {                 // diều mình: vị trí mới nhất + đoán trước theo hướng đang bay
      const L = net.latest && net.latest.pos.get(k.id); if (!L) continue;
      const ex = Math.min(0.15, now - net.latest.t), sp = k.duel ? 0 : BASE_SPEED * (k.has('speed') ? SPEED_PW : 1) * (L[3] & 1 ? BOOST : 1);
      const tx = L[0] + Math.cos(L[2]) * sp * ex, ty = L[1] + Math.sin(L[2]) * sp * ex, f = Math.min(1, dt * 14);
      k.vx = (tx - k.x) / Math.max(dt, 0.001) * 0.2 + k.vx * 0.8; k.vy = (ty - k.y) / Math.max(dt, 0.001) * 0.2 + k.vy * 0.8;
      k.x += (tx - k.x) * f; k.y += (ty - k.y) * f; k.ang += angDiff(k.ang, L[2]) * f; k.boosting = !!(L[3] & 1); k.inv = L[3] & 128 ? 1 : 0;
    } else if (A) {
      const pa = A.pos.get(k.id), pb = B.pos.get(k.id), Pp = pb || pa; if (!Pp) continue;
      let x = Pp[0], y = Pp[1], an = Pp[2];
      if (pa && pb && B !== A) { const q = clamp((rt - A.t) / (B.t - A.t), 0, 1); x = pa[0] + (pb[0] - pa[0]) * q; y = pa[1] + (pb[1] - pa[1]) * q; an = pa[2] + angDiff(pa[2], pb[2]) * q; }
      k.vx = (x - k.x) / Math.max(dt, 0.001); k.vy = (y - k.y) / Math.max(dt, 0.001); k.x = x; k.y = y; k.ang = an;
    }
    stepTail(k);
  }
  for (const b of birds) { b.x += b.vx * dt; b.ph += dt * 12; }
  followCam(dt);
  kites = [...net.byId.values()];
  duelUi(me && me.duel);
  renderHud();
}
function renderNetHud() {
  const s = net.stats; if (!s || !me) return;
  const pw = POWER_KEYS.filter(p => me.has(p));
  const key = [net.n, s[2], s[0], s[1], pw.map(p => p + Math.ceil(me.pw[p])).join(','), Math.round(me.stamina * 20)].join('|');
  if (key === hudKey) return; hudKey = key;
  $('hMap').textContent = 'Map ' + net.n; $('hScore').textContent = s[2].toLocaleString('vi-VN');
  $('hGold').textContent = s[0]; $('hOrbs').textContent = `${Math.min(s[1], net.need)}/${net.need}`;
  $('hOrbs').parentElement.classList.toggle('ready', !!portal && s[1] >= net.need);
  $('powers').innerHTML = pw.map(p => { const Pw = POWERS[p], t = me.pw[p];
    return `<div style="color:${Pw.col}"><span class="pi" style="background:${Pw.col}33">${ic(Pw.icon)}</span><span class="pt"><span style="color:#fff">${Pw.name} ${Math.ceil(t)}s</span><div class="pb" style="width:${Math.max(4, t / Pw.time * 100)}%"></div></span></div>`; }).join('');
  $('stamina').style.width = me.stamina * 100 + '%';
}
function renderLb() {
  $('lbTitle').textContent = net.code ? `Phòng ${net.code}` : 'Bảng xếp hạng';
  $('lbList').innerHTML = '';
  net.lb.forEach(([id, name, pts, bot], i) => {
    const li = document.createElement('li'); if (id === net.id) li.className = 'me';
    li.innerHTML = `<span class="r">${i + 1}</span><span class="n"></span><span class="p">${pts.toLocaleString('vi-VN')}</span>`;
    li.querySelector('.n').textContent = name + (bot ? '' : ' ★');
    $('lbList').appendChild(li);
  });
}
function floatBanner(title, text) {
  $('iSmall').textContent = 'KẾT THÚC VÒNG'; $('iTitle').textContent = title; $('iText').textContent = text;
  $('intro').classList.remove('hidden'); clearTimeout(showIntro.t); showIntro.t = setTimeout(() => $('intro').classList.add('hidden'), 3000);
}
$('bOnline').onclick = () => goOnline({});
$('bCreate').onclick = () => goOnline({ create: true });
$('bJoin').onclick = () => { const c = $('roomCode').value.trim().toUpperCase(); if (c.length < 4) { setNet('Nhập mã phòng 6 ký tự', 'triangle-alert'); return; } goOnline({ code: c }); };
$('roomCode').onkeydown = e => { if (e.key === 'Enter') $('bJoin').click(); };
// đang làm nhiệm vụ thưởng: máy chủ cho diều tàng hình + bất tử
GH.on('task', d => { if (net && me) net.room.send('ghost', { on: !!(d && d.open) }); });

// ---------- GameHub ----------
GH.on('pause', () => { if (!net) togglePause(true); });
GH.on('mute', d => { muted = !!(d && d.muted); });
window.addEventListener('resize', resize);
for (let i = 0; i < 12; i++) clouds.push({ x: Math.random(), y: rand(0.05, 0.85), s: rand(0.6, 1.4), a: rand(0.35, 0.8), p: rand(0.03, 0.08), blobs: Array.from({ length: 5 }, (_, j) => [j * 34 - 70, rand(-14, 10), rand(28, 46)]) });
for (let i = 0; i < 120; i++) stars.push({ x: Math.random(), y: Math.random() * 0.8, a: rand(0.3, 0.9) });
resize();
drawKite($('logoKite').getContext('2d'), SKINS[0], 60, 66, 92, -Math.PI / 2 - 0.25);
GH.init().then(() => GH.load().catch(() => null)).then(data => {
  if (data && typeof data === 'object') {
    save = Object.assign(save, data);
    save.ups = { speed: (data.ups && data.ups.speed) || 0, magnet: (data.ups && data.ups.magnet) || 0, duration: (data.ups && data.ups.duration) || 0 };
    save.skins = Array.isArray(data.skins) && data.skins.length ? data.skins : ['classic'];
    save.maxMap = data.maxMap || 1;
  }
  showMenu();
  requestAnimationFrame(frame);
  GH.ready();
});
window.__kite = { get net() { return net; }, goOnline, get run() { return run; }, get map() { return map; }, get kites() { return kites; }, get me() { return me; }, get portal() { return portal; },
  get orbs() { return orbs; }, get items() { return items; }, get running() { return running; }, startRun, startMap, input, save: () => save };
})();
