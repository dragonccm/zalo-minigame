'use strict';
// Phòng Cờ Vua (authoritative): máy chủ giữ ván cờ, kiểm tra từng nước bằng cùng bộ luật với client
// (seed-games/chess/chess-rules.js), giữ đồng hồ chuẩn, tự ghi kết quả + điểm.
//
// Giao thức (JSON, tránh các tên SDK đã dùng: join/leave/host/state):
//  client -> server: {t:'cfg', tc} (người tạo phòng riêng chọn thời gian) | {t:'mv', from, to, promo?} | {t:'resign'}
//                    {t:'draw', a:'offer'|'accept'|'decline'} | {t:'rematch'}
//  server -> client: {t:'welcome'} | {t:'start', color, white, black, base, inc, clock} | {t:'mv', ply, from, to, promo, san, fen, clock}
//                    {t:'reject', error, moves} | {t:'drawoffer'} | {t:'drawno'} | {t:'rematch', by} | {t:'opp_left'}
//                    {t:'end', result, reason, clock, points, saved, guest}
const path = require('node:path');
const { Chess } = require(path.join(__dirname, '..', '..', 'seed-games', 'chess', 'chess-rules.js'));

module.exports = ({ Room, services }) => {
  const TCS = [[3, 2], [5, 3], [10, 5], [15, 10]];      // phút + giây cộng thêm (giống client)
  const QUICK_TC = 1;                                    // ghép trận nhanh: 5+3
  const POINTS = { win: 1500, draw: 500, loss: 0 };

  return class ChessRoom extends Room {
    constructor(opts) {
      super(opts);
      this.tc = QUICK_TC;
      this.seats = { w: null, b: null };                 // client theo màu
      this.board = null; this.running = false; this.ended = false;
      this.clock = { w: 0, b: 0 }; this.turnAt = 0; this.startedAt = 0;
      this.drawBy = null; this.rematch = new Set(); this.lastWhite = null;
      this.timer = setInterval(() => this.checkFlag(), 200);
    }

    onJoin(c) {
      this.send(c, { t: 'welcome', room: { id: this.id, code: this.code, kind: 'authoritative', maxPlayers: 2 }, you: { id: c.id, name: c.name } });
      if (this.clients.size === 2 && !this.running && !this.board) this.startGame();
    }

    onLeave(c) {
      if (this.running) {
        const color = this.colorOf(c);
        if (color) this.finish(color === 'w' ? '0-1' : '1-0', 'abandon', c);
      }
      this.seats.w = this.seats.w === c ? null : this.seats.w;
      this.seats.b = this.seats.b === c ? null : this.seats.b;
      this.rematch.clear();
      this.broadcast({ t: 'opp_left' });
    }

    async onClose() {
      clearInterval(this.timer);
      if (this.running) await this.finish('1/2-1/2', 'room_closed');
    }

    colorOf(c) { return this.seats.w === c ? 'w' : this.seats.b === c ? 'b' : null; }
    now() { return Date.now(); }

    startGame() {
      const players = [...this.clients.values()];
      if (players.length < 2) return;
      // ván đầu chia màu ngẫu nhiên, tái đấu thì đổi màu
      let white = this.lastWhite ? players.find(p => p !== this.lastWhite) : players[Math.random() < 0.5 ? 0 : 1];
      if (!white) white = players[0];
      const black = players.find(p => p !== white);
      this.seats = { w: white, b: black }; this.lastWhite = white;
      const [min, inc] = TCS[this.tc];
      this.base = min * 60e3; this.inc = inc * 1000;
      this.board = new Chess(); this.running = true; this.ended = false;
      this.clock = { w: this.base, b: this.base }; this.turnAt = this.now(); this.startedAt = this.now();
      this.drawBy = null; this.rematch.clear();
      const info = p => ({ id: p.id, name: p.name, guest: !p.userId });
      for (const [color, p] of [['w', white], ['b', black]]) {
        this.send(p, { t: 'start', color, white: info(white), black: info(black), base: this.base, inc: this.inc, clock: this.clock });
      }
    }

    // trừ thời gian của bên đang đi; true nếu đã hết giờ
    spend(color) {
      const t = this.now();
      this.clock[color] -= t - this.turnAt;
      this.turnAt = t;
      return this.clock[color] <= 0;
    }
    checkFlag() {
      if (!this.running) return;
      const turn = this.board.turn();
      if (this.clock[turn] - (this.now() - this.turnAt) > 0) return;
      this.spend(turn); this.clock[turn] = 0;
      // hết giờ nhưng đối thủ không đủ quân chiếu hết -> hòa
      const winner = turn === 'w' ? 'b' : 'w';
      this.finish(this.cannotMate(winner) ? '1/2-1/2' : winner === 'w' ? '1-0' : '0-1', 'timeout');
    }
    cannotMate(color) {
      const left = [];
      for (const row of this.board.board()) for (const p of row) if (p && p.color === color && p.type !== 'k') left.push(p.type);
      return !left.length || (left.length === 1 && (left[0] === 'n' || left[0] === 'b'));
    }

    onMessage(c, m) {
      const color = this.colorOf(c);
      switch (m.t) {
        case 'cfg':                                         // chỉ người tạo phòng riêng, trước khi ván bắt đầu
          if (this.code && !this.board && Number.isInteger(m.tc) && TCS[m.tc]) this.tc = m.tc;
          return;
        case 'mv': {
          if (!this.running || !color) return;
          const moves = () => this.board.history.map(h => ({ from: h.from, to: h.to, promo: h.promo || undefined }));
          if (this.board.turn() !== color) return this.send(c, { t: 'reject', error: 'Chưa tới lượt bạn', moves: moves() });
          const sq = /^[a-h][1-8]$/;
          if (!sq.test(m.from) || !sq.test(m.to)) return this.send(c, { t: 'reject', error: 'Nước đi không hợp lệ', moves: moves() });
          if (this.spend(color)) { this.clock[color] = 0; return this.checkFlag(); }
          const rec = this.board.move({ from: m.from, to: m.to, promo: ['q', 'r', 'b', 'n'].includes(m.promo) ? m.promo : undefined });
          if (!rec) return this.send(c, { t: 'reject', error: 'Nước đi không hợp lệ', moves: moves() });
          this.clock[color] += this.inc;
          if (this.drawBy && this.drawBy !== color) this.drawBy = null;   // đi tiếp = từ chối lời mời hòa
          this.broadcast({ t: 'mv', ply: this.board.history.length, from: rec.from, to: rec.to, promo: rec.promo, san: rec.san, fen: this.board.fen(), clock: this.clock });
          const out = this.board.outcome();
          if (out) this.finish(out.result, out.reason);
          return;
        }
        case 'resign':
          if (this.running && color) this.finish(color === 'w' ? '0-1' : '1-0', 'resign');
          return;
        case 'draw': {
          if (!this.running || !color) return;
          const opp = this.seats[color === 'w' ? 'b' : 'w'];
          if (m.a === 'offer' && this.drawBy !== color) { this.drawBy = color; if (opp) this.send(opp, { t: 'drawoffer' }); }
          else if (m.a === 'accept' && this.drawBy && this.drawBy !== color) this.finish('1/2-1/2', 'agreement');
          else if (m.a === 'decline' && this.drawBy && this.drawBy !== color) { this.drawBy = null; if (opp) this.send(opp, { t: 'drawno' }); }
          return;
        }
        case 'rematch':
          if (this.running || !this.board || !color || this.clients.size < 2) return;
          this.rematch.add(c.id);
          this.broadcast({ t: 'rematch', by: c.id });
          if (this.rematch.size >= 2) this.startGame();
          return;
      }
    }

    async finish(result, reason, leaver) {
      if (!this.running) return;
      this.running = false; this.ended = true;
      const moves = Math.ceil(this.board.history.length / 2);
      const res = { w: result === '1-0' ? 'win' : result === '0-1' ? 'loss' : 'draw' };
      res.b = res.w === 'win' ? 'loss' : res.w === 'loss' ? 'win' : 'draw';
      const names = { w: this.seats.w && this.seats.w.name, b: this.seats.b && this.seats.b.name };
      const jobs = ['w', 'b'].map(async color => {
        const p = this.seats[color]; if (!p) return;
        const outcome = res[color], points = POINTS[outcome] + (outcome === 'win' ? Math.max(0, 60 - moves) * 5 : 0);
        await this.recordMatch({ client: p, score: points, kills: 0, maxValue: moves, rank: outcome === 'win' ? 1 : outcome === 'draw' ? 1 : 2,
          reason: outcome, killedBy: names[color === 'w' ? 'b' : 'w'], startedAt: this.startedAt });
        let saved = null;
        if (p.userId && points > 0) {
          try { saved = await services.recordScore(this.game.slug, p.userId, points, { mode: 'online', result: outcome, reason, moves }); }
          catch (e) { console.error('[chess] lưu điểm:', e.message); }
        }
        if (p !== leaver) this.send(p, { t: 'end', result, reason, clock: this.clock, points, saved, guest: !p.userId });
      });
      await Promise.all(jobs);
    }
  };
};
