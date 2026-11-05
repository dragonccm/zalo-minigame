'use strict';
const crypto = require('node:crypto');
const Uno = require('../../seed-games/uno/uno-rules.js');

module.exports = ({ Room, services }) => class UnoRoom extends Room {
  constructor(opts) {
    super(opts);
    this.round = null; this.running = false; this.finished = false; this.host = null;
    this.startTimer = null; this.turnUntil = 0; this.rematch = new Set(); this.startedAt = 0;
    this.timer = setInterval(() => this.checkTime(), 500);
  }
  acceptsNewPlayers() { return !this.running && (!this.finished || this.clients.size < this.round.players.length); }
  info() { return [...this.clients.values()].map(c => this.playerInfo(c)); }
  lobby() { this.broadcast({ t: 'lobby', players: this.info(), host: this.host, seconds: this.startTimer ? 5 : null }); }
  onJoin(c) {
    if (!this.host) this.host = c.id;
    this.send(c, { t: 'welcome', room: { id: this.id, code: this.code, maxPlayers: 4 }, you: this.playerInfo(c) });
    this.lobby();
    if (this.clients.size === 4) { clearTimeout(this.startTimer); this.startTimer = null; this.startGame(); }
    else if (this.clients.size >= 2 && !this.startTimer) this.startTimer = setTimeout(() => { this.startTimer = null; this.startGame(); }, 5000);
  }
  onLeave(c) {
    if (this.running) {
      const still = [...this.clients.values()];
      const winner = still.length ? still.reduce((best, p) => {
        const count = this.round.players.find(x => x.id === p.id)?.hand.length ?? Infinity;
        return count < best.count ? { id: p.id, count } : best;
      }, { id: null, count: Infinity }).id : null;
      this.finish(winner, 'left', c);
    }
    if (this.host === c.id) this.host = this.clients.keys().next().value || null;
    if (this.clients.size < 2 && this.startTimer) { clearTimeout(this.startTimer); this.startTimer = null; }
    this.rematch.clear(); this.lobby();
  }
  async onClose() { clearInterval(this.timer); clearTimeout(this.startTimer); if (this.running) await this.finish(null, 'room_closed'); }
  startGame() {
    if (this.running || this.clients.size < 2) return;
    const ids = [...this.clients.keys()];
    const random = () => crypto.randomInt(0, 16777216) / 16777216;
    this.round = Uno.create(ids, random); this.running = true; this.finished = false; this.rematch.clear();
    this.startedAt = Date.now(); this.turnUntil = Date.now() + 30000;
    for (const c of this.clients.values()) this.send(c, { t: 'start', players: this.info(), view: Uno.view(this.round, c.id), until: this.turnUntil });
  }
  snapshot(message) {
    for (const c of this.clients.values()) this.send(c, { t: 'snapshot', view: Uno.view(this.round, c.id), until: this.turnUntil, message });
  }
  checkTime() {
    if (!this.running || Date.now() < this.turnUntil) return;
    const id = this.round.players[this.round.turn].id;
    if (this.round.pending) Uno.resolveD4(this.round, id, false);
    else if (this.round.drawn !== null) Uno.pass(this.round, id);
    else { Uno.draw(this.round, id); if (this.round.drawn !== null) Uno.pass(this.round, id); }
    this.turnUntil = Date.now() + 30000;
    this.snapshot('Hết thời gian lượt · tự động rút bài');
    if (this.round.ended) this.finish(this.round.winner, 'cards');
  }
  onMessage(c, m) {
    if (m.t === 'rematch') {
      if (!this.running && this.finished) {
        this.rematch.add(c.id); this.broadcast({ t: 'rematch', by: c.id, count: this.rematch.size });
        if (this.rematch.size >= this.clients.size && this.clients.size >= 2) this.startGame();
      }
      return;
    }
    if (m.t === 'start' && !this.running && !this.finished && this.host === c.id && this.clients.size >= 2) {
      clearTimeout(this.startTimer); this.startTimer = null; this.startGame(); return;
    }
    if (!this.running) return;
    let out, message = '';
    if (m.t === 'play') {
      out = Uno.play(this.round, c.id, m.cardId, m.color, !!m.uno);
      message = `${c.name} đánh bài${m.uno ? ' · UNO!' : ''}`;
    } else if (m.t === 'draw') { out = Uno.draw(this.round, c.id); message = `${c.name} rút bài`; }
    else if (m.t === 'pass') { out = Uno.pass(this.round, c.id); message = `${c.name} qua lượt`; }
    else if (m.t === 'uno') { out = Uno.declare(this.round, c.id); message = `${c.name} gọi UNO!`; }
    else if (m.t === 'catch') { out = Uno.catchUno(this.round, c.id); message = `${c.name} bắt lỗi quên UNO!`; }
    else if (m.t === 'challenge') { out = Uno.resolveD4(this.round, c.id, !!m.challenge); message = m.challenge ? `${c.name} khiếu nại +4` : `${c.name} nhận +4`; }
    else return;
    if (!out.ok) return this.send(c, { t: 'reject', error: out.error });
    this.turnUntil = Date.now() + 30000;
    this.snapshot(message);
    if (this.round.ended) this.finish(this.round.winner, 'cards');
  }
  async finish(winner, reason, leaver = null) {
    if (!this.running) return;
    this.running = false; this.finished = true;
    const score = this.round.score || 0, startedAt = this.startedAt;
    this.broadcast({ t: 'end', winner, reason, score });
    await Promise.all(this.round.players.map(async p => {
      const c = this.clients.get(p.id) || (leaver?.id === p.id ? leaver : null); if (!c) return;
      const outcome = !winner ? 'draw' : winner === c.id ? 'win' : 'loss';
      const points = outcome === 'win' ? Math.max(100, score) : 0;
      await this.recordMatch({ client: c, score: points, maxValue: p.hand.length, rank: outcome === 'loss' ? 2 : 1, reason: outcome, startedAt });
      if (c.userId && points) try { await services.recordScore(this.game.slug, c.userId, points, { mode: 'online', outcome, cardsLeft: p.hand.length }); } catch (e) { console.error('[uno] score:', e.message); }
    }));
  }
};
