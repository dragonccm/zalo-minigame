'use strict';
// Phòng Cubes 2048 chạy logic trên máy chủ (authoritative):
// máy chủ mô phỏng toàn bộ đấu trường 20 lần/giây, client chỉ gửi hướng lái + tăng tốc và vẽ lại theo snapshot.
// Điểm do máy chủ tính và tự ghi vào bảng xếp hạng -> không gian lận điểm được.
//
// Giao thức (JSON):
//  client -> server: {t:'in', a:gócLái, b:0|1} | {t:'spawn', name, skin, reward?:{placement, runId, token}} | {t:'reward', placement, runId, token} | {t:'ghost', on}
//  server -> client: {t:'welcome', ...} | {t:'snap', k, s, c?, m?, ev, me?} | {t:'you', id} | {t:'dead', ...} | {t:'reward', ...} | {t:'ghost', on} | {t:'error', error}
//  Tàng hình: client gửi {t:'ghost', on:true} khi portal báo đang làm nhiệm vụ; máy chủ chỉ chấp nhận nếu phiên nhiệm vụ có thật (flag 16 trong snapshot = đang tàng hình).
//  Tọa độ gửi dạng số nguyên x100, góc x1000 để gọn.

module.exports = ({ Room, services }) => {
  const HALF = 48, SP = 1.08, STEP = 0.12, TURN = 4.2, BASE_SPEED = 6.6, BOOST_MULT = 1.75, BOOST_TIME = 2, BOOST_CD = 6;
  const FREE_TARGET = 230, FREE_MAX = 340, DIV_COUNT = 12, POWER_COUNT = 6, SHIELD_TIME = 6, MAGNET_TIME = 9, SPAWN_SHIELD = 3;
  const TICK_MS = 50, DT = TICK_MS / 1000;
  const BOT_TARGET = 12, MIN_BOTS = 3;
  const GHOST_GRACE = 4, GHOST_MAX_MS = 15 * 60e3;       // giây bảo vệ sau khi hiện lại / tối đa tàng hình liên tục
  const SNAKE_COLORS = ['#ff6b6b', '#4dabf7', '#51cf66', '#fcc419', '#cc5de8', '#ff922b', '#22b8cf', '#f06595', '#94d82d', '#748ffc', '#e8590c', '#12b886'];
  const BOT_NAMES = ['Mèo Béo', 'Rồng Lửa', 'Cún Con', 'Gấu Trúc', 'Sói Xám', 'Ninja', 'Tí Hon', 'Sao Băng', 'Bạch Tuộc', 'Hổ Con', 'Cá Mập', 'Đại Bàng', 'Thỏ Ngọc', 'Khủng Long', 'Kỳ Lân', 'Lão Ngộ'];
  const SKINS = ['classic', 'electric', 'medieval'];

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const pick = arr => arr[(Math.random() * arr.length) | 0];
  const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };
  const I = v => Math.round(v * 100);                        // tọa độ -> số nguyên
  const pow2 = n => 2 ** clamp(Math.round(Math.log2(n) || 1), 1, 17);

  class Snake {
    constructor(room, id, o) {
      this.room = room; this.id = id;
      this.name = o.name; this.color = o.color; this.skin = o.skin; this.bot = !!o.bot; this.client = o.client || null;
      this.alive = false; this.cubes = []; this.trail = [];
      this.x = 0; this.z = 0; this.angle = 0; this.target = 0;
      this.energy = 1; this.locked = false; this.boosting = false; this.wantBoost = false;
      this.shield = 0; this.magnet = 0; this.overdrive = 0;
      this.respawnAt = 0; this.thinkAt = 0; this.maxValue = 2; this.kills = 0; this.born = 0;
      this.ver = 0; this.metaVer = 0;
      this.ghost = false; this.ghostSince = 0;       // tàng hình khi đang làm nhiệm vụ: đứng yên, không va chạm, không ai thấy/nhắm tới
    }
    get head() { return this.cubes[0]; }
    get score() { let s = 0; for (const c of this.cubes) s += c.v; return s; }

    spawn(x, z, value) {
      this.alive = true; this.x = x; this.z = z;
      this.angle = this.target = rand(0, Math.PI * 2);
      this.energy = 1; this.locked = false; this.boosting = false; this.wantBoost = false;
      this.shield = SPAWN_SHIELD; this.magnet = 0; this.overdrive = 0;
      this.ghost = false;
      this.maxValue = value; this.kills = 0; this.born = Date.now();
      this.cubes = [{ v: value, x, z }];
      this.trail = [];
      for (let k = 24; k >= 0; k--) this.trail.push({ x: x - Math.cos(this.angle) * k * STEP, z: z - Math.sin(this.angle) * k * STEP });
      this.ver++;
      this.room.ev(['s', this.id]);
    }

    addValue(v, fx, fz) {
      let idx = this.cubes.findIndex(q => q.v <= v);
      if (idx < 0) idx = this.cubes.length;
      this.cubes.splice(idx, 0, { v, x: fx, z: fz });
      this.merge();
      if (this.cubes[0].v > this.maxValue) this.maxValue = this.cubes[0].v;
      this.ver++;
    }
    merge() {
      for (let again = true; again;) {
        again = false;
        for (let i = 0; i < this.cubes.length - 1; i++) {
          const a = this.cubes[i], b = this.cubes[i + 1];
          if (a.v === b.v) {
            a.v *= 2;
            this.cubes.splice(i + 1, 1);
            this.room.ev(['m', this.id, a.v, I(a.x), I(a.z)]);
            again = true;
            break;
          }
        }
      }
    }

    step(dt) {
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
      if (this.shield > 0) this.shield -= dt;
      if (this.magnet > 0) this.magnet -= dt;

      const hv = this.cubes[0].v;
      const speed = (BASE_SPEED - Math.min(1.8, Math.log2(hv) * 0.11)) * (this.boosting ? BOOST_MULT : 1);
      const d = angDiff(this.angle, this.target), mt = TURN * dt;
      this.angle += clamp(d, -mt, mt);
      if (this.angle > Math.PI) this.angle -= 2 * Math.PI; else if (this.angle < -Math.PI) this.angle += 2 * Math.PI;
      this.x = clamp(this.x + Math.cos(this.angle) * speed * dt, -HALF + 0.7, HALF - 0.7);
      this.z = clamp(this.z + Math.sin(this.angle) * speed * dt, -HALF + 0.7, HALF - 0.7);
      const tr = this.trail, n = tr.length;
      tr[n - 1].x = this.x; tr[n - 1].z = this.z;
      const p = tr[n - 2];
      if (Math.hypot(this.x - p.x, this.z - p.z) >= STEP) tr.push({ x: this.x, z: this.z });
    }

    // xếp các khối thân theo vết đường đi của đầu
    layout() {
      const cubes = this.cubes, tr = this.trail;
      cubes[0].x = this.x; cubes[0].z = this.z;
      let ci = 1, acc = 0, next = SP, cut = -1;
      const need = cubes.length * SP + 2;
      for (let i = tr.length - 1; i > 0; i--) {
        const a = tr[i], b = tr[i - 1];
        const seg = Math.hypot(a.x - b.x, a.z - b.z);
        if (seg < 1e-6) continue;
        while (ci < cubes.length && acc + seg >= next) {
          const t = (next - acc) / seg;
          cubes[ci].x = a.x + (b.x - a.x) * t; cubes[ci].z = a.z + (b.z - a.z) * t;
          ci++; next = ci * SP;
        }
        acc += seg;
        if (acc > need) { cut = i - 1; break; }
      }
      for (; ci < cubes.length; ci++) { cubes[ci].x = tr[0].x; cubes[ci].z = tr[0].z; }
      if (cut > 30) tr.splice(0, cut - 2);
    }
  }

  return class CubesRoom extends Room {
    constructor(opts) {
      super(opts);
      this.snakes = new Map();
      this.frees = new Map();
      this.divs = []; this.pows = [];
      this.events = [];
      this.seq = 0; this.freeSeq = 0; this.tickNo = 0; this.time = 0;
      for (let i = 0; i < DIV_COUNT; i++) this.divs.push(this.randPos(4));
      for (let i = 0; i < POWER_COUNT; i++) this.pows.push({ type: Math.random() < 0.5 ? 'shield' : 'magnet', ...this.randPos(4) });
      while (this.frees.size < FREE_TARGET) { const p = this.randPos(1.5); this.spawnFree(this.spawnValue(), p.x, p.z, false); }
      this.syncBots();
      for (let i = 0; i < 200; i++) this.simulate(DT);          // khởi động nhanh để bot có kích thước
      this.events = [];
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    ev(e) { this.events.push(e); }
    randPos(m = 3) { return { x: rand(-HALF + m, HALF - m), z: rand(-HALF + m, HALF - m) }; }
    spawnValue() {
      let maxLog = 1;
      for (const s of this.snakes.values()) if (s.alive) maxLog = Math.max(maxLog, Math.log2(s.head.v));
      const tier = clamp(Math.floor(maxLog) - 3, 4, 10);
      let total = 0; const w = [];
      for (let e = 1; e <= tier; e++) { const x = Math.pow(0.55, e - 1); w.push(x); total += x; }
      let r = Math.random() * total;
      for (let e = 1; e <= tier; e++) { r -= w[e - 1]; if (r <= 0) return 1 << e; }
      return 2;
    }
    spawnFree(v, x, z, scatter) {
      const id = ++this.freeSeq;
      let tx = x, tz = z;
      if (scatter) {                                          // văng ra rồi dừng: tính luôn điểm dừng
        const a = rand(0, Math.PI * 2), d = rand(3, 9) / 3.5;
        tx = clamp(x + Math.cos(a) * d, -HALF + 0.6, HALF - 0.6);
        tz = clamp(z + Math.sin(a) * d, -HALF + 0.6, HALF - 0.6);
      }
      this.frees.set(id, { id, v, x: tx, z: tz });
      this.ev(['f', id, v, I(x), I(z), I(tx), I(tz)]);
    }
    safeSpawn() {
      let best = null, bestD = -1;
      for (let i = 0; i < 14; i++) {
        const p = this.randPos(10);
        let md = 1e9;
        for (const s of this.snakes.values()) if (s.alive) for (const c of s.cubes) md = Math.min(md, Math.hypot(c.x - p.x, c.z - p.z));
        if (md > bestD) { bestD = md; best = p; }
      }
      return best;
    }

    // ---------- bot ----------
    syncBots() {
      const want = Math.max(MIN_BOTS, BOT_TARGET - this.clients.size);
      const bots = [...this.snakes.values()].filter(s => s.bot);
      for (let i = bots.length; i < want; i++) {
        const id = ++this.seq;
        const used = new Set([...this.snakes.values()].map(s => s.name));
        const s = new Snake(this, id, { name: pick(BOT_NAMES.filter(n => !used.has(n))) || pick(BOT_NAMES), color: SNAKE_COLORS[id % SNAKE_COLORS.length], skin: pick(SKINS), bot: true });
        this.snakes.set(id, s);
        this.spawnBot(s);
      }
      if (bots.length > want) {
        bots.sort((a, b) => (a.alive ? a.score : -1) - (b.alive ? b.score : -1));
        for (const s of bots.slice(0, bots.length - want)) { this.snakes.delete(s.id); this.ev(['x', s.id]); }
      }
    }
    spawnBot(s) {
      const p = this.safeSpawn();
      const r = Math.random();
      s.skin = pick(SKINS); s.metaVer++;
      s.spawn(p.x, p.z, r < 0.45 ? 2 : r < 0.75 ? 4 : r < 0.92 ? 8 : 16);
      s.thinkAt = this.time + rand(0, 0.3);
    }
    thinkBot(s) {
      const hv = s.head.v;
      const have = new Set(s.cubes.map(c => c.v));
      let best = -1e9, tx = 0, tz = 0, hasTarget = false, preyClose = false;
      let fx = 0, fz = 0, threat = 0, nearestThreat = 1e9;
      for (const o of this.snakes.values()) {
        if (o === s || !o.alive || o.ghost) continue;
        const oh = o.head, dh = Math.hypot(oh.x - s.x, oh.z - s.z);
        if (oh.v > hv && dh < 15) { const w = (15 - dh) / 15; fx += (s.x - oh.x) / dh * w; fz += (s.z - oh.z) / dh * w; threat++; nearestThreat = Math.min(nearestThreat, dh); }
        for (let i = 0; i < o.cubes.length; i++) {
          const c = o.cubes[i], d = Math.hypot(c.x - s.x, c.z - s.z);
          if (d > 20) continue;
          if (c.v < hv) {
            if (o.shield > 0) continue;
            const sc = 30 - d + Math.log2(c.v) * 2 + (i === 0 ? 8 : 0);
            if (sc > best) { best = sc; tx = c.x; tz = c.z; hasTarget = true; preyClose = d < 9; }
          } else if (c.v > hv && d < 5 && d > 0.01) {
            fx += (s.x - c.x) / d * (5 - d) / 5 * 1.5; fz += (s.z - c.z) / d * (5 - d) / 5 * 1.5; threat++;
          }
        }
      }
      for (const f of this.frees.values()) {
        const d = Math.hypot(f.x - s.x, f.z - s.z);
        if (d > 22) continue;
        const sc = 24 - d + Math.log2(f.v) * 1.5 + (have.has(f.v) ? 4 : 0);
        if (sc > best) { best = sc; tx = f.x; tz = f.z; hasTarget = true; preyClose = false; }
      }
      for (const pw of this.pows) {
        const d = Math.hypot(pw.x - s.x, pw.z - s.z);
        if (d < 22 && 26 - d > best) { best = 26 - d; tx = pw.x; tz = pw.z; hasTarget = true; preyClose = false; }
      }
      for (const dv of this.divs) {
        const dx = s.x - dv.x, dz = s.z - dv.z, d = Math.hypot(dx, dz);
        if (d < 4.5 && d > 0.01 && hv > 2) { fx += dx / d * 1.6; fz += dz / d * 1.6; }
      }
      let vx = 0, vz = 0;
      if (hasTarget) { const dx = tx - s.x, dz = tz - s.z, d = Math.hypot(dx, dz) || 1; vx += dx / d; vz += dz / d; }
      else { vx += Math.cos(s.angle) * 0.6; vz += Math.sin(s.angle) * 0.6; }
      vx += fx * 2.5; vz += fz * 2.5;
      const m = 7;
      if (s.x > HALF - m) vx -= (s.x - (HALF - m)) / m * 3;
      if (s.x < -HALF + m) vx += (-HALF + m - s.x) / m * 3;
      if (s.z > HALF - m) vz -= (s.z - (HALF - m)) / m * 3;
      if (s.z < -HALF + m) vz += (-HALF + m - s.z) / m * 3;
      s.target = Math.atan2(vz, vx);
      s.wantBoost = (threat > 0 && nearestThreat < 8) || (preyClose && Math.random() < 0.7);
    }

    // ---------- luật chơi ----------
    kill(s, killer) {
      if (!s.alive || s.ghost) return;
      const score = s.score;
      const rank = 1 + [...this.snakes.values()].filter(o => o.alive && o !== s && o.score > score).length;
      s.alive = false;
      for (const c of s.cubes) this.spawnFree(c.v, c.x + rand(-0.3, 0.3), c.z + rand(-0.3, 0.3), true);
      s.cubes = [];
      s.ver++;
      this.ev(['d', s.id, killer ? killer.id : 0]);
      if (s.bot) s.respawnAt = this.time + 3;
      else if (s.client) this.playerDied(s, { score, rank, killer, reason: 'death' });
    }
    eatCube(a, b, idx) {
      const c = b.cubes[idx];
      this.ev(['e', a.id, b.id, c.v, I(c.x), I(c.z), idx === 0 ? 1 : 0]);
      a.addValue(c.v, c.x, c.z);
      b.cubes.splice(idx, 1);
      b.ver++;
      if (idx === 0) { a.kills++; this.kill(b, a); }
    }
    hitDivider(s) {
      const old = s.cubes[0];
      if (old.v <= 2) return;
      s.cubes.splice(0, 1);
      s.addValue(old.v / 2, old.x, old.z);
    }

    collisions() {
      for (const a of this.snakes.values()) {
        if (!a.alive || a.ghost) continue;
        for (const f of this.frees.values()) {
          const dx = f.x - a.x, dz = f.z - a.z;
          if (dx * dx + dz * dz < 1.0) { a.addValue(f.v, f.x, f.z); this.frees.delete(f.id); this.ev(['p', a.id, f.id]); }
        }
        this.divs.forEach((d, i) => {
          const dx = d.x - a.x, dz = d.z - a.z;
          if (dx * dx + dz * dz < 1.3 && a.shield <= 0) {
            this.hitDivider(a);
            Object.assign(d, this.randPos(4));
            this.ev(['dv', a.id, i, I(d.x), I(d.z)]);
          }
        });
        this.pows.forEach((pw, i) => {
          const dx = pw.x - a.x, dz = pw.z - a.z;
          if (dx * dx + dz * dz < 2.0) {
            const type = pw.type;
            if (type === 'shield') a.shield = SHIELD_TIME; else a.magnet = MAGNET_TIME;
            Object.assign(pw, { type: Math.random() < 0.5 ? 'shield' : 'magnet', ...this.randPos(4) });
            this.ev(['pw', a.id, i, type, pw.type, I(pw.x), I(pw.z)]);
          }
        });
      }
      // giao tranh: đầu chạm khối nhỏ hơn -> nuốt; chạm khối lớn hơn -> chết (có khiên thì bật lại)
      const doomed = [];
      for (const a of this.snakes.values()) {
        if (!a.alive || a.ghost) continue;
        let hitBy = null;
        for (const b of this.snakes.values()) {
          if (b === a || !b.alive || b.ghost || !a.alive) continue;
          const bh = b.cubes[0], reach = b.cubes.length * SP + 2;
          if (Math.abs(bh.x - a.x) > reach + 2 || Math.abs(bh.z - a.z) > reach + 2) continue;
          for (let i = b.cubes.length - 1; i >= 0; i--) {
            const c = b.cubes[i];
            if (!c) continue;
            const dx = c.x - a.x, dz = c.z - a.z;
            if (dx * dx + dz * dz > 1.1) continue;
            const hv = a.cubes[0].v;
            if (hv > c.v) { if (b.shield <= 0) this.eatCube(a, b, i); }
            else if (hv < c.v) hitBy = b;
            if (!b.alive) break;
          }
        }
        if (hitBy && a.alive) doomed.push([a, hitBy]);
      }
      for (const [a, b] of doomed) {
        if (!a.alive) continue;
        if (a.shield > 0) {
          const h = b.cubes[0];
          if (!h) continue;
          const dx = a.x - h.x, dz = a.z - h.z, d = Math.hypot(dx, dz) || 1;
          a.x = clamp(a.x + dx / d * 0.35, -HALF + 0.7, HALF - 0.7);
          a.z = clamp(a.z + dz / d * 0.35, -HALF + 0.7, HALF - 0.7);
          this.ev(['b', a.id]);
        } else { b.kills++; this.kill(a, b); }
      }
    }

    simulate(dt) {
      this.time += dt;
      for (const s of this.snakes.values()) {
        if (!s.alive) { if (s.bot && this.time >= s.respawnAt) this.spawnBot(s); continue; }
        if (s.ghost) continue;
        if (s.bot && this.time >= s.thinkAt) { this.thinkBot(s); s.thinkAt = this.time + 0.12 + Math.random() * 0.1; }
        s.step(dt);
      }
      this.collisions();
      for (const s of this.snakes.values()) {                // nam châm: client cũng tự mô phỏng phần này
        if (!s.alive || s.ghost || s.magnet <= 0) continue;
        for (const f of this.frees.values()) {
          const dx = s.x - f.x, dz = s.z - f.z, d = Math.hypot(dx, dz);
          if (d < 8 && d > 0.01) { f.x += dx / d * 11 * dt; f.z += dz / d * 11 * dt; }
        }
      }
      for (let n = 0; n < 4 && this.frees.size < FREE_TARGET; n++) { const p = this.randPos(1.5); this.spawnFree(this.spawnValue(), p.x, p.z, false); }
      while (this.frees.size > FREE_MAX) { const id = this.frees.keys().next().value; this.frees.delete(id); this.ev(['r', id]); }
      for (const s of this.snakes.values()) if (s.alive) s.layout();
    }

    tick() {
      if (this.closed) return;
      this.checkGhosts();
      this.simulate(DT);
      this.tickNo++;
      if (this.tickNo % 20 === 0) this.syncBots();
      this.broadcastSnapshot();
      this.events = [];
    }

    // ---------- tàng hình khi làm nhiệm vụ ----------
    // Chỉ bật được khi portal đã báo "đang làm nhiệm vụ" cho người này (services.taskActive); hết phiên là tự hiện lại.
    setGhost(c, on) {
      const s = c.snake;
      if (!s || !s.alive || s.bot) return;
      if (on) {
        if (s.ghost || !services.taskActive || !services.taskActive(this.game.slug, c.viewer)) return;
        s.ghost = true; s.ghostSince = Date.now(); s.boosting = false; s.wantBoost = false;
        this.send(c, { t: 'ghost', on: true });
      } else if (s.ghost) {
        s.ghost = false; s.shield = Math.max(s.shield, GHOST_GRACE);   // vài giây bảo vệ sau khi hiện lại
        this.send(c, { t: 'ghost', on: false });
      }
    }
    checkGhosts() {
      for (const c of this.clients.values()) {
        const s = c.snake;
        if (!s || !s.ghost) continue;
        if (!s.alive || Date.now() - s.ghostSince > GHOST_MAX_MS || !services.taskActive(this.game.slug, c.viewer)) this.setGhost(c, false);
      }
    }

    // snapshot riêng cho từng người: phần chung (vị trí rắn, sự kiện) + phần thay đổi người đó chưa biết
    broadcastSnapshot() {
      const alive = [...this.snakes.values()].filter(s => s.alive);
      const shared = `"k":${this.tickNo},"s":${JSON.stringify(alive.map(s => [s.id, I(s.x), I(s.z), Math.round(s.angle * 1000),
        (s.boosting ? 1 : 0) | (s.shield > 0 ? 2 : 0) | (s.magnet > 0 ? 4 : 0) | (s.overdrive > 0 ? 8 : 0) | (s.ghost ? 16 : 0)]))},"ev":${JSON.stringify(this.events)}`;
      for (const c of this.clients.values()) {
        let extra = '';
        const vals = {}, metas = [];
        for (const s of this.snakes.values()) {
          if (c.knownMeta.get(s.id) !== s.metaVer) { metas.push([s.id, s.name, s.color, s.skin, s.bot ? 1 : 0]); c.knownMeta.set(s.id, s.metaVer); }
          if (c.known.get(s.id) !== s.ver) { vals[s.id] = s.cubes.map(q => q.v); c.known.set(s.id, s.ver); }
        }
        if (metas.length) extra += `,"m":${JSON.stringify(metas)}`;
        if (Object.keys(vals).length) extra += `,"c":${JSON.stringify(vals)}`;
        const s = c.snake;
        if (s && s.alive) extra += `,"me":[${Math.round(s.energy * 100)},${s.locked ? 1 : 0},${Math.round(s.shield * 10)},${Math.round(s.magnet * 10)},${Math.round(s.overdrive * 10)},${s.kills},${s.ghost ? 1 : 0}]`;
        this.send(c, `{"t":"snap",${shared}${extra}}`);
      }
    }

    // ---------- người chơi ----------
    onJoin(c) {
      c.snake = null; c.known = new Map(); c.knownMeta = new Map(); c.lastMax = 2;
      this.send(c, {
        t: 'welcome', room: { id: this.id, code: this.code, kind: 'authoritative', maxPlayers: this.maxPlayers },
        you: { id: c.id, name: c.name }, arena: HALF, tickRate: 1000 / TICK_MS,
        frees: [...this.frees.values()].map(f => [f.id, f.v, I(f.x), I(f.z)]),
        divs: this.divs.map(d => [I(d.x), I(d.z)]), pows: this.pows.map(p => [p.type, I(p.x), I(p.z)]),
      });
      this.syncBots();
    }
    onLeave(c, reason) {
      const s = c.snake;
      if (s) {
        if (s.alive) {
          const score = s.score;
          for (const q of s.cubes) this.spawnFree(q.v, q.x, q.z, true);
          this.playerDied(s, { score, rank: null, killer: null, reason: reason === 'room_closed' ? 'room_closed' : 'left', silent: true });
        }
        this.snakes.delete(s.id);
        this.ev(['x', s.id]);
      }
      this.syncBots();
    }
    async onClose() {
      clearInterval(this.timer);
      for (const c of this.clients.values()) {
        const s = c.snake;
        if (s && s.alive) await this.playerDied(s, { score: s.score, rank: null, killer: null, reason: 'room_closed', silent: true });
      }
    }

    async playerDied(s, { score, rank, killer, reason, silent }) {
      const c = s.client;
      c.lastMax = Math.max(2, s.maxValue);
      const seconds = Math.round((Date.now() - s.born) / 1000);
      const killedBy = killer ? killer.name : null;
      const meta = { maxBlock: s.maxValue, kills: s.kills, seconds, mode: 'online', room: this.id };
      const jobs = [this.recordMatch({ client: c, score, kills: s.kills, maxValue: s.maxValue, rank, reason, killedBy, startedAt: s.born })];
      let result = null;
      if (c.userId && score > 0) {
        try { result = await services.recordScore(this.game.slug, c.userId, score, meta); } catch (e) { console.error('[cubes] lưu điểm:', e.message); }
      }
      await Promise.all(jobs);
      if (!silent) this.send(c, { t: 'dead', score, maxValue: s.maxValue, kills: s.kills, seconds, killer: killedBy, rank, result, guest: !c.userId });
    }

    async useReward(c, r, placement) {
      if (!r || typeof r !== 'object') return null;
      return services.consumeReward({ slug: this.game.slug, viewer: c.viewer, runId: Number(r.runId), token: String(r.token || ''), placement });
    }

    async onMessage(c, m) {
      const s = c.snake;
      if (m.t === 'in') {
        if (s && s.alive && Number.isFinite(m.a)) { s.target = clamp(m.a, -10, 10); s.wantBoost = !!m.b; }
      } else if (m.t === 'ghost') {
        this.setGhost(c, !!m.on);
      } else if (m.t === 'spawn') {
        if ((s && s.alive) || c.spawning) return;
        c.spawning = true;
        try {
          let value = 2, shield = SPAWN_SHIELD;
          if (m.revive) {
            const rw = await this.useReward(c, m.revive, 'revive');
            if (rw) { value = c.lastMax; shield = rw.amount; } else this.send(c, { t: 'error', error: 'Token hồi sinh không hợp lệ hoặc đã dùng' });
          } else if (m.reward) {
            const rw = await this.useReward(c, m.reward, 'start_boost');
            if (rw) { value = pow2(rw.amount); shield = 8; } else this.send(c, { t: 'error', error: 'Token phần thưởng không hợp lệ hoặc đã dùng' });
          }
          if (this.closed || !this.clients.has(c.id)) return;
          const name = String(m.name || c.name || 'Bạn').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 12) || 'Bạn';
          const skin = SKINS.includes(m.skin) ? m.skin : 'classic';
          let sn = c.snake;
          if (!sn) { sn = new Snake(this, ++this.seq, { name, color: SNAKE_COLORS[this.seq % SNAKE_COLORS.length], skin, client: c }); this.snakes.set(sn.id, sn); c.snake = sn; }
          if (sn.name !== name || sn.skin !== skin) { sn.name = name; sn.skin = skin; sn.metaVer++; }
          c.name = name;
          const p = this.safeSpawn();
          sn.spawn(p.x, p.z, value);
          sn.shield = shield;
          this.send(c, { t: 'you', id: sn.id, value, shield });
        } finally { c.spawning = false; }
      } else if (m.t === 'debug_kill' && process.env.GAMEHUB_TEST === '1') {   // chỉ dùng cho kiểm thử tự động
        if (s && s.alive) this.kill(s, null);
      } else if (m.t === 'reward' && m.placement === 'power_boost') {
        if (!s || !s.alive) return;
        const rw = await this.useReward(c, m, 'power_boost');
        if (!rw) return this.send(c, { t: 'error', error: 'Token phần thưởng không hợp lệ hoặc đã dùng' });
        if (!s.alive) return;
        const sec = rw.amount;
        s.shield = Math.max(s.shield, sec); s.magnet = Math.max(s.magnet, sec + 2); s.overdrive = Math.max(4, sec - 2);
        s.energy = 1; s.locked = false;
        this.send(c, { t: 'reward', placement: 'power_boost', amount: sec });
      }
    }
  };
};
