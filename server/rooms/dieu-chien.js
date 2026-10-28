'use strict';
// Phòng Diều Chiến online (authoritative): máy chủ mô phỏng cả đấu trường 20 lần/giây.
// Client chỉ gửi hướng bay + tăng tốc; vàng, ngọc, phép, hạ đối thủ, điểm đều do máy chủ quyết định.
// Mỗi vòng: ai gom đủ ngọc thì cổng mở, người đủ ngọc bay vào cổng đầu tiên thắng vòng -> cả phòng sang map mới.
//
// Giao thức (JSON):
//  client -> server: {t:'spawn', name, skin} | {t:'in', a:góc, b:0|1} | {t:'tap'} (bấm khi đấu tay đôi) | {t:'ghost', on} (tàng hình khi làm nhiệm vụ)
//  server -> client: {t:'welcome', ...} | {t:'map', n, need, coins, winds} | {t:'you', id} | {t:'snap', ...}
//                    {t:'round', winner, id, next} | {t:'dead', by, why}
//  Tọa độ gửi dạng số nguyên, góc x1000. Diều đang tàng hình không có trong snapshot của người khác.

module.exports = ({ Room, services }) => {
  const WW = 3600, WH = 2400, TICK_MS = 50, DT = TICK_MS / 1000;
  const BASE_SPEED = 205, BOOST = 1.5, TURN = 3.4, HIT_R = 30, RESPAWN = 2, SPAWN_SAFE = 3, SPEED_PW = 1.35;
  const DUEL_R = 120, DUEL_TIME = 8, DUEL_STEP = 7, SWORD_TAP = 1.8, MAX_TAPS = 14;   // đấu tay đôi (tối đa 14 lần bấm/giây)
  const POWERS = { sword: 12, shield: 14, speed: 8, ghost: 8, magnet: 12, x2: 12 };
  const PW = Object.keys(POWERS);
  const SKINS = {
    classic: ['#e63946', '#ffd166', 'split'], sea: ['#1d8cf0', '#bdefff', 'stripe'], lotus: ['#ff6fae', '#fff4f8', 'circle'],
    jade: ['#13a37a', '#e9ffb8', 'cross'], rainbow: ['#ff595e', '#8ac926', 'rainbow'], night: ['#26286b', '#ffd84a', 'star'], phoenix: ['#ff7a1a', '#5a0f0f', 'fire'],
  };
  const BOT_STYLES = [['#8e44ad', '#f5d0ff', 'stripe'], ['#2a9d8f', '#e9f5db', 'split'], ['#f4a261', '#264653', 'cross'], ['#5e60ce', '#c7f9cc', 'circle'],
    ['#d62828', '#fcbf49', 'stripe'], ['#3a86ff', '#ffbe0b', 'split'], ['#6d6875', '#ffcdb2', 'cross'], ['#06d6a0', '#073b4c', 'circle']];
  const BOT_NAMES = ['Tí Tửng', 'Diều Hâu', 'Gió Bấc', 'Cô Bé Mây', 'Chú Tư', 'Bạch Hạc', 'Sấm Sét', 'Mèo Mun', 'Ông Năm', 'Đại Bàng', 'Bé Na', 'Chim Sẻ'];
  const BOT_TARGET = 8;                                  // tổng số diều tối thiểu (thiếu người thì bot lấp)
  const GHOST_MAX_MS = 15 * 60e3;
  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  const angDiff = (a, b) => { let d = (b - a) % (2 * Math.PI); if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI; return d; };
  const I = Math.round;

  return class KiteRoom extends Room {
    constructor(opts) {
      super(opts);
      this.duels = [];
      this.kites = new Map(); this.seq = 0; this.tickNo = 0; this.time = 0; this.events = [];
      this.mapN = 0; this.newMap();
      this.syncBots();
      this.timer = setInterval(() => this.tick(), TICK_MS);
    }

    // ---------- map ----------
    newMap() {
      this.mapN++;
      const n = this.mapN;
      this.need = Math.min(3 + n, 10);
      this.coins = new Map(); this.coinSeq = 0; this.orbs = []; this.items = []; this.birds = []; this.storms = []; this.winds = [];
      this.portal = null; this.roundOver = 0; this.itemSeq = 0; this.orbSeq = 0;
      if (this.duels) for (const d of this.duels) { d.a.duel = d.b.duel = null; } this.duels = [];
      this.nextItem = 3; this.nextBirds = rand(8, 14);
      const stormN = n >= 3 ? Math.min(n - 2, 4) : 0, windN = n >= 4 ? Math.min(n - 3, 4) : 0;
      for (let i = 0; i < stormN; i++) this.storms.push({ x: rand(500, WW - 500), y: rand(300, WH - 600), r: rand(170, 230), next: rand(2, 5), warn: 0, flash: 0, vx: rand(-30, 30), vy: rand(-20, 20) });
      for (let i = 0; i < windN; i++) { const a = rand(0, 2 * Math.PI); this.winds.push({ x: rand(400, WW - 400), y: rand(300, WH - 500), r: rand(260, 380), fx: Math.cos(a) * 170, fy: Math.sin(a) * 120 }); }
      for (let i = 0; i < 170; i++) this.addCoin();
      for (let i = 0; i < 3; i++) this.addOrb();
      for (let i = 0; i < 7; i++) this.addItem();
      this.events = [];
      for (const k of this.kites.values()) {
        k.orbs = 0; k.pw = {}; k.goal = null;
        if (k.alive) { const p = this.freeSpot(); Object.assign(k, { x: p.x, y: p.y, inv: SPAWN_SAFE, vx: 0, vy: 0 }); }
      }
      if (this.clients) for (const c of this.clients.values()) this.sendMap(c);
    }
    sendMap(c) {
      this.send(c, { t: 'map', n: this.mapN, need: this.need, coins: [...this.coins.values()].map(o => [o.id, o.v, I(o.x), I(o.y)]),
        winds: this.winds.map(w => [I(w.x), I(w.y), I(w.r), I(w.fx), I(w.fy)]), hazards: { birds: this.mapN >= 2, storms: this.storms.length, winds: this.winds.length } });
    }
    freeSpot(minD = 350) {
      for (let i = 0; i < 30; i++) {
        const p = { x: rand(150, WW - 150), y: rand(150, WH - 250) };
        if ([...this.kites.values()].every(k => !k.alive || dist(k, p) > minD) && this.storms.every(s => dist(s, p) > s.r + 80)) return p;
      }
      return { x: rand(150, WW - 150), y: rand(150, WH - 250) };
    }
    addCoin(x, y, v) {
      const id = ++this.coinSeq;
      const o = { id, x: x ?? rand(80, WW - 80), y: y ?? rand(80, WH - 200), v: v || (Math.random() < 0.08 ? 5 : 1) };
      o.x = clamp(o.x, 40, WW - 40); o.y = clamp(o.y, 40, WH - 160);
      this.coins.set(id, o);
      this.events.push(['c+', id, o.v, I(o.x), I(o.y)]);
    }
    addOrb(x, y) { const p = x === undefined ? this.freeSpot(250) : { x: clamp(x, 60, WW - 60), y: clamp(y, 60, WH - 200) }; this.orbs.push({ id: ++this.orbSeq, x: p.x, y: p.y }); }
    addItem() { const p = this.freeSpot(200); this.items.push({ id: ++this.itemSeq, x: p.x, y: p.y, type: PW[(Math.random() * PW.length) | 0] }); }

    // ---------- diều ----------
    makeKite(o) {
      const p = this.freeSpot();
      return Object.assign({ id: ++this.seq, x: p.x, y: p.y, ang: rand(0, 6.28), vx: 0, vy: 0, alive: true, respawnAt: 0, inv: SPAWN_SAFE, stamina: 1,
        boosting: false, wantBoost: false, target: 0, pw: {}, gold: 0, orbs: 0, kills: 0, points: 0, streak: 0, stun: 0, think: 0, goal: null,
        ghostTask: false, ghostSince: 0, metaVer: 1, best: 0, startedAt: Date.now(), maxMap: this.mapN }, o);
    }
    syncBots() {
      const humans = [...this.kites.values()].filter(k => !k.bot).length;
      const want = Math.max(2, BOT_TARGET - humans);
      const bots = [...this.kites.values()].filter(k => k.bot);
      const used = new Set([...this.kites.values()].map(k => k.name));
      for (let i = bots.length; i < want; i++) {
        const st = BOT_STYLES[(this.seq + i) % BOT_STYLES.length];
        const name = BOT_NAMES.find(n => !used.has(n)) || 'Bot ' + this.seq; used.add(name);
        const k = this.makeKite({ bot: true, name, a: st[0], b: st[1], pat: st[2], skill: clamp(0.35 + this.mapN * 0.07 + rand(-0.15, 0.1), 0.2, 1) });
        this.kites.set(k.id, k);
      }
      if (bots.length > want) for (const k of bots.slice(0, bots.length - want)) { this.kites.delete(k.id); this.events.push(['x', k.id]); }
    }
    has(k, p) { return (k.pw[p] || 0) > 0; }
    hidden(k) { return this.has(k, 'ghost') || k.ghostTask; }

    steer(k, dt) {
      if (k.stun > 0) { k.stun -= dt; k.ang += 7 * dt; } else k.ang += clamp(angDiff(k.ang, k.target), -TURN * dt, TURN * dt);
      const upg = k.bot ? 1 + (k.skill || 0) * 0.08 : 1;
      k.boosting = k.wantBoost && k.stamina > 0.05 && k.stun <= 0;
      k.stamina = clamp(k.stamina + (k.boosting ? -0.45 : 0.2 * upg) * dt, 0, 1);
      const sp = BASE_SPEED * upg * (this.has(k, 'speed') ? SPEED_PW : 1) * (k.boosting ? BOOST : 1) * (k.stun > 0 ? 0.4 : 1);
      let vx = Math.cos(k.ang) * sp, vy = Math.sin(k.ang) * sp;
      for (const w of this.winds) { const d = dist(k, w); if (d < w.r) { const f = 1 - d / w.r; vx += w.fx * f; vy += w.fy * f; } }
      k.vx += (vx - k.vx) * Math.min(1, dt * 6); k.vy += (vy - k.vy) * Math.min(1, dt * 6);
      k.x += k.vx * dt; k.y += k.vy * dt;
      if (k.x < 40) { k.x = 40; k.ang = Math.PI - k.ang; } else if (k.x > WW - 40) { k.x = WW - 40; k.ang = Math.PI - k.ang; }
      if (k.y < 40) { k.y = 40; k.ang = -k.ang; } else if (k.y > WH - 140) { k.y = WH - 140; k.ang = -k.ang; }
      for (const p in k.pw) if (k.pw[p] > 0) k.pw[p] -= dt;
      if (k.inv > 0) k.inv -= dt;
    }

    // ---------- bot ----------
    thinkBot(k) {
      k.think = rand(0.12, 0.25) + (1 - k.skill) * 0.25;
      const seen = o => o !== k && o.alive && !this.hidden(o) && o.inv <= 0;
      const all = [...this.kites.values()];
      // đủ ngọc và cổng đang mở: lao về cổng
      if (this.portal && k.orbs >= this.need) { k.goal = this.portal; k.wantBoost = true; return; }
      if (this.has(k, 'sword')) {
        let best = null, bd = 650 + k.skill * 350;
        for (const o of all) if (seen(o) && !this.has(o, 'shield') && dist(k, o) < bd) { bd = dist(k, o); best = o; }
        if (best) { const lead = bd / 400 * k.skill; k.goal = { x: best.x + best.vx * lead, y: best.y + best.vy * lead }; k.wantBoost = bd < 380; return; }
      }
      if (!this.has(k, 'shield')) {
        for (const o of all) {
          if (!seen(o) || !this.has(o, 'sword') || dist(k, o) > 260 + k.skill * 260 || Math.random() > 0.35 + k.skill * 0.6) continue;
          const a = Math.atan2(k.y - o.y, k.x - o.x) + rand(-0.5, 0.5);
          k.goal = { x: k.x + Math.cos(a) * 500, y: k.y + Math.sin(a) * 500 }; k.wantBoost = true; return;
        }
      }
      k.wantBoost = false;
      const near = (list, r) => { let b = null, bd = r; for (const o of list) { const d = dist(k, o); if (d < bd) { bd = d; b = o; } } return b; };
      const t = near(this.orbs, 500 + k.skill * 400) || near(this.items, 420) || near(this.coins.values(), 380);
      if (t) { k.goal = { x: t.x, y: t.y }; return; }
      if (!k.goal || dist(k, k.goal) < 80) k.goal = { x: rand(200, WW - 200), y: rand(200, WH - 300) };
    }

    // ---------- chiến đấu ----------
    hurt(k, by, why) {
      if (!k.alive || k.inv > 0 || k.ghostTask || (k.duel && why !== 'duel')) return;
      if (this.has(k, 'shield')) { k.pw.shield = 0; k.inv = 1; this.events.push(['b', k.id]); return; }
      this.kill(k, by, why);
    }
    kill(k, by, why) {
      k.alive = false; k.respawnAt = this.time + RESPAWN; k.pw = {};
      const drop = Math.min(40, Math.floor(k.gold * 0.5) + 4);
      for (let i = 0; i < drop; i++) { const a = rand(0, 6.28), r = rand(20, 160); this.addCoin(k.x + Math.cos(a) * r, k.y + Math.sin(a) * r, 1); }
      for (let i = 0; i < k.orbs; i++) { const a = rand(0, 6.28); this.addOrb(k.x + Math.cos(a) * 60, k.y + Math.sin(a) * 60); }
      k.orbs = 0; k.gold = Math.floor(k.gold * 0.5); k.streak = 0;
      if (by && by !== k) { by.kills++; by.streak++; by.points += 100 * this.mapN; }
      this.events.push(['k', k.id, by ? by.id : 0, why === 'storm' ? 1 : 0]);
      if (k.client) this.send(k.client, { t: 'dead', by: by ? by.name : null, why: why || 'sword' });
    }
    // ---------- đấu tay đôi: chạm nhau -> ai bấm nhanh hơn thắng; người ngoài không xen vào được ----------
    canDuel(k) { return k.alive && !k.duel && k.inv <= 0 && !this.hidden(k); }
    startDuel(a, b) {
      const d = { a, b, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, bar: 0, t: DUEL_TIME, spin: Math.atan2(b.y - a.y, b.x - a.x) };
      a.duel = b.duel = d; a.vx = a.vy = b.vx = b.vy = 0; a.boosting = b.boosting = false; a.taps = b.taps = 0;
      this.duels.push(d); this.events.push(['d+', a.id, b.id]);
    }
    duelTap(k) {
      const d = k.duel; if (!d || d.done) return;
      d.bar = clamp(d.bar + (k === d.a ? 1 : -1) * DUEL_STEP * (this.has(k, 'sword') ? SWORD_TAP : 1), -100, 100);
    }
    stepDuels(dt) {
      for (const d of this.duels) {
        d.t -= dt; d.spin += dt * 1.1;
        for (const k of [d.a, d.b]) {
          if (!k.bot) { k.tapBudget = Math.min(MAX_TAPS, (k.tapBudget || 0) + MAX_TAPS * dt); continue; }
          k.tapAcc = (k.tapAcc || 0) + dt * (4 + (k.skill || 0.4) * 5) * rand(0.6, 1.4);
          while (k.tapAcc >= 1) { k.tapAcc--; this.duelTap(k); }
        }
        const ca = Math.cos(d.spin), sa = Math.sin(d.spin);
        d.a.x = d.x - ca * 46; d.a.y = d.y - sa * 46; d.a.ang = d.spin;
        d.b.x = d.x + ca * 46; d.b.y = d.y + sa * 46; d.b.ang = d.spin + Math.PI;
        if (Math.abs(d.bar) >= 100 || d.t <= 0 || !d.a.alive || !d.b.alive || !this.kites.has(d.a.id) || !this.kites.has(d.b.id)) this.endDuel(d);
      }
      this.duels = this.duels.filter(d => !d.done);
      for (const d of this.duels) for (const k of this.kites.values()) {
        if (!k.alive || k.duel === d) continue;
        const dd = dist(k, d);
        if (dd < DUEL_R + 20) { const nx = (k.x - d.x) / (dd || 1), ny = (k.y - d.y) / (dd || 1); k.x = d.x + nx * (DUEL_R + 20); k.y = d.y + ny * (DUEL_R + 20); k.ang = Math.atan2(ny, nx); }
      }
    }
    cancelDuel(d) { d.done = true; d.a.duel = d.b.duel = null; this.duels = this.duels.filter(x => x !== d); }   // chỉ dùng khi kiểm thử
    endDuel(d) {
      d.done = true; d.a.duel = d.b.duel = null;
      const gone = k => !k.alive || !this.kites.has(k.id);
      let w = d.bar > 0 ? d.a : d.bar < 0 ? d.b : null;
      if (gone(d.a) && !gone(d.b)) w = d.b; else if (gone(d.b) && !gone(d.a)) w = d.a;
      if (!w) { d.a.inv = d.b.inv = 1.5; d.a.ang = d.spin + Math.PI; d.b.ang = d.spin; this.events.push(['d-', 0, d.a.id, d.b.id]); return; }
      const l = w === d.a ? d.b : d.a;
      w.inv = 1.5;
      this.events.push(['d-', w.id, l.id]);
      if (gone(l)) return;
      l.inv = 0;
      const shielded = this.has(l, 'shield');
      this.hurt(l, w, 'duel');
      if (shielded) { l.inv = 1.5; l.ang = d.spin + (l === d.a ? Math.PI : 0); }
    }
    collisions() {
      const live = [...this.kites.values()].filter(k => k.alive && !k.duel && !k.ghostTask);
      for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) {
        const a = live[i], b = live[j];
        if (a.duel || b.duel || dist(a, b) > HIT_R * 2) continue;
        if (this.canDuel(a) && this.canDuel(b)) { this.startDuel(a, b); continue; }
        const d = dist(a, b) || 1, nx = (b.x - a.x) / d, ny = (b.y - a.y) / d;
        a.x -= nx * 6; a.y -= ny * 6; b.x += nx * 6; b.y += ny * 6;
      }
    }
    pickups(dt) {
      for (const k of this.kites.values()) {
        if (!k.alive || k.ghostTask || k.duel) continue;
        const mag = this.has(k, 'magnet') ? 260 : 40;
        for (const c of this.coins.values()) {
          const d = dist(k, c);
          if (d < mag && d > 20) { const s = (mag - d) / mag * 600 + 120; c.x += (k.x - c.x) / d * s * dt; c.y += (k.y - c.y) / d * s * dt; c.moved = true; }
          if (d < 34) {
            this.coins.delete(c.id);
            const v = c.v * (this.has(k, 'x2') ? 2 : 1); k.gold += v; k.points += v * 10;
            this.events.push(['c-', c.id, k.id]);
          }
        }
        for (let i = this.orbs.length - 1; i >= 0; i--) {
          if (dist(k, this.orbs[i]) > 40) continue;
          this.orbs.splice(i, 1); k.orbs++; this.events.push(['o', k.id]);
          if (k.orbs >= this.need && !this.portal && !this.roundOver) { const p = this.freeSpot(500); this.portal = { x: p.x, y: p.y, r: 70 }; this.events.push(['pt', k.id]); }
        }
        for (let i = this.items.length - 1; i >= 0; i--) {
          const it = this.items[i]; if (dist(k, it) > 42) continue;
          this.items.splice(i, 1); k.pw[it.type] = POWERS[it.type]; this.events.push(['p', k.id, it.type]);
        }
      }
    }
    hazards(dt) {
      if (this.mapN >= 2 && (this.nextBirds -= dt) <= 0) {
        this.nextBirds = rand(9, 15);
        const y = rand(200, WH - 400), dir = Math.random() < 0.5 ? 1 : -1, n = 4 + ((Math.random() * 4) | 0);
        for (let i = 0; i < n; i++) this.birds.push({ x: dir > 0 ? -80 - i * 50 : WW + 80 + i * 50, y: y + rand(-60, 60), vx: dir * rand(220, 300) });
      }
      for (const b of this.birds) {
        b.x += b.vx * dt;
        for (const k of this.kites.values()) if (k.alive && k.inv <= 0 && k.stun <= 0 && !k.ghostTask && Math.hypot(k.x - b.x, k.y - b.y) < 32) k.stun = 0.8;
      }
      this.birds = this.birds.filter(b => b.x > -400 && b.x < WW + 400);
      this.storms.forEach((s, idx) => {
        s.x = clamp(s.x + s.vx * dt, 300, WW - 300); s.y = clamp(s.y + s.vy * dt, 250, WH - 500);
        if (s.flash > 0) s.flash -= dt;
        if (s.warn > 0) {
          s.warn -= dt;
          if (s.warn <= 0) { s.flash = 0.25; s.next = rand(3, 6); this.events.push(['z', idx]); for (const k of this.kites.values()) if (k.alive && dist(k, s) < s.r) this.hurt(k, null, 'storm'); }
        } else if ((s.next -= dt) <= 0) s.warn = 1.4;
      });
    }

    // ---------- vòng chơi ----------
    winRound(k) {
      this.roundOver = 3; this.portal = null;
      const bonus = 500 * this.mapN; k.points += bonus;
      this.broadcast({ t: 'round', winner: k.name, id: k.id, bonus, next: this.mapN + 1 });
      if (k.client) this.saveScore(k, 'round');
    }

    tick() {
      if (this.closed) return;
      this.time += DT; this.tickNo++;
      for (const k of this.kites.values()) {
        if (!k.alive) {
          if (this.time >= k.respawnAt && (k.bot || k.client)) { const p = this.freeSpot(); Object.assign(k, { x: p.x, y: p.y, alive: true, inv: SPAWN_SAFE, stamina: 1, stun: 0, vx: 0, vy: 0, gold: k.bot ? 0 : k.gold }); this.events.push(['s', k.id]); }
          continue;
        }
        if (k.duel) continue;
        if (k.bot) {
          if ((k.think -= DT) <= 0) this.thinkBot(k);
          const g = k.goal || k; let t = Math.atan2(g.y - k.y, g.x - k.x) + Math.sin(this.time * 2 + k.id) * 0.15;
          for (const s of this.storms) if (s.warn > 0 && dist(k, s) < s.r + 90 && Math.random() < k.skill) t = Math.atan2(k.y - s.y, k.x - s.x);
          k.target = t;
        }
        if (k.ghostTask) { if (!services.taskActive || !services.taskActive(this.game.slug, k.client.viewer) || Date.now() - k.ghostSince > GHOST_MAX_MS) this.setGhost(k.client, false); else continue; }
        this.steer(k, DT);
      }
      this.collisions();
      this.stepDuels(DT);
      this.pickups(DT);
      this.hazards(DT);
      while (this.coins.size < 130) this.addCoin();
      if (this.orbs.length < 3 && !this.portal && !this.roundOver) this.addOrb();
      if ((this.nextItem -= DT) <= 0) { this.nextItem = rand(3, 6); if (this.items.length < 7) this.addItem(); }
      if (this.portal) for (const k of this.kites.values()) if (k.alive && k.orbs >= this.need && dist(k, this.portal) < this.portal.r) { this.winRound(k); break; }
      if (this.roundOver > 0 && (this.roundOver -= DT) <= 0) { this.roundOver = 0; this.newMap(); for (const k of this.kites.values()) if (k.client) k.maxMap = Math.max(k.maxMap, this.mapN); }
      if (this.tickNo % 40 === 0) this.syncBots();
      this.broadcastSnapshot();
      this.events = [];
    }

    broadcastSnapshot() {
      const all = [...this.kites.values()].filter(k => k.alive);
      const flags = k => (k.boosting ? 1 : 0) | (this.has(k, 'sword') ? 2 : 0) | (this.has(k, 'shield') ? 4 : 0) | (this.has(k, 'speed') ? 8 : 0)
        | (this.hidden(k) ? 16 : 0) | (this.has(k, 'magnet') ? 32 : 0) | (this.has(k, 'x2') ? 64 : 0) | (k.inv > 0 ? 128 : 0) | (k.stun > 0 ? 256 : 0);
      const row = k => [k.id, I(k.x), I(k.y), I(k.ang * 1000), flags(k)];
      const visible = all.filter(k => !this.hidden(k)).map(row);
      const moved = [...this.coins.values()].filter(c => c.moved).map(c => { c.moved = false; return [c.id, I(c.x), I(c.y)]; });
      let shared = `"k":${this.tickNo},"o":${JSON.stringify(this.orbs.map(o => [o.id, I(o.x), I(o.y)]))},"i":${JSON.stringify(this.items.map(o => [o.id, I(o.x), I(o.y), o.type]))}`
        + `,"st":${JSON.stringify(this.storms.map(s => [I(s.x), I(s.y), I(s.r), s.warn > 0 ? 1 : 0, s.flash > 0 ? 1 : 0]))},"bd":${JSON.stringify(this.birds.map(b => [I(b.x), I(b.y), I(b.vx)]))}`
        + `,"du":${JSON.stringify(this.duels.map(d => [d.a.id, d.b.id, I(d.x), I(d.y), I(d.bar), I(d.t * 10), I(d.spin * 1000)]))}`
        + `,"pt":${this.portal ? JSON.stringify([I(this.portal.x), I(this.portal.y), this.portal.r]) : 0},"ev":${JSON.stringify(this.events)}`;
      if (moved.length) shared += `,"cm":${JSON.stringify(moved)}`;
      if (this.tickNo % 20 === 1) {
        const top = [...this.kites.values()].sort((a, b) => b.points - a.points).slice(0, 6).map(k => [k.id, k.name, k.points, k.bot ? 1 : 0]);
        shared += `,"lb":${JSON.stringify(top)}`;
      }
      for (const c of this.clients.values()) {
        const mine = c.kite;
        let s = visible;
        if (mine && mine.alive && this.hidden(mine)) s = visible.concat([row(mine)]);        // bản thân vẫn thấy mình (mờ)
        let extra = '';
        const metas = [];
        for (const k of this.kites.values()) if (c.knownMeta.get(k.id) !== k.metaVer) { metas.push([k.id, k.name, k.a, k.b, k.pat, k.bot ? 1 : 0]); c.knownMeta.set(k.id, k.metaVer); }
        if (metas.length) extra += `,"m":${JSON.stringify(metas)}`;
        if (mine) extra += `,"me":${JSON.stringify([mine.gold, mine.orbs, mine.points, mine.kills, I(mine.stamina * 100), ...PW.map(p => I(Math.max(0, mine.pw[p] || 0) * 10)), mine.ghostTask ? 1 : 0, mine.alive ? 1 : 0])}`;
        this.send(c, `{"t":"snap","s":${JSON.stringify(s)},${shared}${extra}}`);
      }
    }

    // ---------- người chơi ----------
    onJoin(c) {
      c.kite = null; c.knownMeta = new Map();
      this.send(c, { t: 'welcome', room: { id: this.id, code: this.code, kind: 'authoritative', maxPlayers: this.maxPlayers }, you: { id: c.id, name: c.name }, world: [WW, WH], tickRate: 1000 / TICK_MS });
      this.sendMap(c);
    }
    onLeave(c, reason) {
      const k = c.kite;
      if (k) { this.saveScore(k, reason === 'room_closed' ? 'room_closed' : 'left'); this.kites.delete(k.id); this.events.push(['x', k.id]); }
      this.syncBots();
    }
    async onClose() {
      clearInterval(this.timer);
      await Promise.all([...this.clients.values()].filter(c => c.kite).map(c => this.saveScore(c.kite, 'room_closed')));
    }
    // lưu điểm (bảng xếp hạng giữ điểm cao nhất) + lịch sử trận khi rời phòng
    async saveScore(k, reason) {
      const c = k.client; if (!c) return;
      const jobs = [];
      if (reason !== 'round') jobs.push(this.recordMatch({ client: c, score: k.points, kills: k.kills, maxValue: k.maxMap, rank: null, reason, startedAt: k.startedAt }));
      if (c.userId && k.points > k.best) {
        k.best = k.points;
        jobs.push(services.recordScore(this.game.slug, c.userId, k.points, { mode: 'online', map: this.mapN, kills: k.kills, room: this.id })
          .then(r => { if (reason === 'round' && r) this.send(c, { t: 'saved', result: r }); })
          .catch(e => console.error('[dieu-chien] lưu điểm:', e.message)));
      }
      await Promise.all(jobs);
    }
    setGhost(c, on) {
      const k = c && c.kite; if (!k) return;
      if (on) {
        if (k.ghostTask || !k.alive || !services.taskActive || !services.taskActive(this.game.slug, c.viewer)) return;
        k.ghostTask = true; k.ghostSince = Date.now(); k.wantBoost = false;
        this.send(c, { t: 'ghost', on: true });
      } else if (k.ghostTask) { k.ghostTask = false; k.inv = Math.max(k.inv, 4); this.send(c, { t: 'ghost', on: false }); }
    }
    onMessage(c, m) {
      const k = c.kite;
      if (m.t === 'in') {
        if (k && Number.isFinite(m.a)) { k.target = clamp(m.a, -20, 20); k.wantBoost = !!m.b; }
      } else if (m.t === 'spawn') {
        if (k) return;
        const name = String(m.name || c.name || 'Bạn').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 14) || 'Bạn';
        const st = SKINS[m.skin] || SKINS.classic;
        const nk = this.makeKite({ bot: false, client: c, name, a: st[0], b: st[1], pat: st[2] });
        this.kites.set(nk.id, nk); c.kite = nk; c.name = name;
        this.syncBots();
        this.send(c, { t: 'you', id: nk.id });
      } else if (m.t === 'tap') {
        if (k && k.duel && (k.tapBudget || 0) >= 1) { k.tapBudget -= 1; this.duelTap(k); }   // chống auto-click: tối đa ~14 lần/giây
      } else if (m.t === 'ghost') {
        this.setGhost(c, !!m.on);
      } else if (m.t === 'debug_kill' && process.env.GAMEHUB_TEST === '1') {
        if (k && k.alive) this.kill(k, null, 'test');
      } else if (m.t === 'debug_duel' && process.env.GAMEHUB_TEST === '1') {   // ép vào đấu với một diều khác (kiểm thử)
        const o = this.kites.get(Number(m.with));
        for (const x of [k, o]) if (x && x.duel) this.cancelDuel(x.duel);
        if (k && o && k.alive && o.alive && !k.duel && !o.duel) { k.inv = o.inv = 0; o.x = k.x + 40; o.y = k.y; this.startDuel(k, o); }
      } else if (m.t === 'debug_orbs' && process.env.GAMEHUB_TEST === '1') {
        if (k && k.duel) this.cancelDuel(k.duel);
        if (k && !this.roundOver) { k.orbs = this.need; this.portal = { x: clamp(k.x + (k.x > WW / 2 ? -150 : 150), 100, WW - 100), y: k.y, r: 70 }; k.inv = 3; }
      }
    }
  };
};
