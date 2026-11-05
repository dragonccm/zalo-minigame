'use strict';
const Rules = require('../../seed-games/caro/caro-rules.js');

module.exports = ({ Room, services }) => class CaroRoom extends Room {
  constructor(opts) {
    super(opts);
    this.seats = [null, null]; this.board = null; this.running = false; this.rematch = new Set();
    this.clock = [300000, 300000]; this.turnAt = 0; this.startedAt = 0;
    this.timer = setInterval(() => this.checkTime(), 500);
  }
  onJoin(c) {
    this.send(c, { t: 'welcome', room: { id: this.id, code: this.code, maxPlayers: 2 }, you: this.playerInfo(c) });
    if (this.clients.size === 2 && !this.running && (!this.board || !this.seats.every(p => p && this.clients.has(p.id)))) this.startGame();
  }
  onLeave(c) {
    if (this.running) this.finish(this.seats[0] === c ? 2 : 1, 'left');
    this.broadcast({ t: 'opp_left' });
    this.rematch.clear();
  }
  async onClose() { clearInterval(this.timer); if (this.running) await this.finish(0, 'room_closed'); }
  sideOf(c) { return this.seats[0] === c ? 1 : this.seats[1] === c ? 2 : 0; }
  startGame() {
    const players = [...this.clients.values()]; if (players.length !== 2) return;
    const samePlayers = this.board && this.seats.every(p => p && this.clients.has(p.id));
    this.seats = samePlayers ? [this.seats[1], this.seats[0]] : (Math.random() < .5 ? players : players.reverse());
    this.board = Rules.create(); this.running = true; this.rematch.clear();
    this.clock = [300000, 300000]; this.turnAt = Date.now(); this.startedAt = this.turnAt;
    for (const c of this.seats) this.send(c, { t: 'start', side: this.sideOf(c), players: this.seats.map(p => this.playerInfo(p)), board: this.board.board, clock: this.clock });
  }
  spend(side) {
    const now = Date.now(); this.clock[side - 1] -= now - this.turnAt; this.turnAt = now;
    return this.clock[side - 1] <= 0;
  }
  checkTime() {
    if (!this.running) return;
    const side = this.board.turn;
    if (this.clock[side - 1] - (Date.now() - this.turnAt) <= 0) { this.spend(side); this.clock[side - 1] = 0; this.finish(3 - side, 'timeout'); }
  }
  onMessage(c, m) {
    const side = this.sideOf(c);
    if (m.t === 'mv') {
      if (!this.running || !side || this.board.turn !== side) return this.send(c, { t: 'reject', error: 'Chưa tới lượt bạn' });
      if (this.spend(side)) { this.clock[side - 1] = 0; return this.finish(3 - side, 'timeout'); }
      const rec = Rules.move(this.board, m.x, m.y);
      if (!rec) return this.send(c, { t: 'reject', error: 'Ô cờ không hợp lệ' });
      this.clock[side - 1] += 3000;
      this.broadcast({ t: 'mv', ...rec, clock: this.clock });
      if (rec.ended) this.finish(rec.winner, rec.winner ? 'five' : 'board_full');
    } else if (m.t === 'resign' && this.running && side) this.finish(3 - side, 'resign');
    else if (m.t === 'rematch' && !this.running && this.board && side) {
      this.rematch.add(c.id); this.broadcast({ t: 'rematch', by: c.id });
      if (this.rematch.size === 2) this.startGame();
    }
  }
  async finish(winner, reason) {
    if (!this.running) return;
    this.running = false;
    const count = this.board.history.length, startedAt = this.startedAt;
    this.broadcast({ t: 'end', winner, reason, line: this.board.line, clock: this.clock, moves: count });
    await Promise.all(this.seats.map(async (c, i) => {
      if (!c) return;
      const outcome = winner === 0 ? 'draw' : winner === i + 1 ? 'win' : 'loss';
      const score = outcome === 'win' ? 1500 : outcome === 'draw' ? 500 : 0;
      await this.recordMatch({ client: c, score, maxValue: count, rank: outcome === 'loss' ? 2 : 1, reason: outcome, startedAt });
      if (c.userId && score) try { await services.recordScore(this.game.slug, c.userId, score, { mode: 'online', outcome, moves: count }); } catch (e) { console.error('[caro] score:', e.message); }
    }));
  }
};
