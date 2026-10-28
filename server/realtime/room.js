'use strict';
const crypto = require('node:crypto');
const db = require('../db');

// Phòng cơ sở: quản lý người chơi, gửi tin, ghi phòng & trận vào DB.
class Room {
  constructor({ game, kind, code, maxPlayers, manager }) {
    this.id = crypto.randomUUID();
    this.game = game;                 // { id, slug, manifest }
    this.kind = kind;
    this.code = code || null;         // phòng riêng có mã; null = phòng công khai
    this.maxPlayers = maxPlayers;
    this.manager = manager;
    this.clients = new Map();         // clientId -> client
    this.peak = 0;
    this.closed = false;
    this.emptySince = Date.now();
    this.ready = db.q('INSERT INTO rooms (id, game_id, kind, code, max_players) VALUES ($1, $2, $3, $4, $5)',
      [this.id, game.id, kind, this.code, maxPlayers]).catch(e => console.error('[rt] ghi phòng:', e.message));
  }

  get full() { return this.clients.size >= this.maxPlayers; }

  send(c, obj) { if (c.ws.readyState === 1) c.ws.send(typeof obj === 'string' ? obj : JSON.stringify(obj)); }
  broadcast(obj, except) {
    const s = JSON.stringify(obj);
    for (const c of this.clients.values()) if (c !== except) this.send(c, s);
  }
  playerInfo(c) { return { id: c.id, name: c.name, avatar: c.avatar, guest: !c.userId }; }

  addClient(c) {
    this.clients.set(c.id, c);
    c.room = this;
    this.emptySince = 0;
    if (this.clients.size > this.peak) {
      this.peak = this.clients.size;
      this.ready.then(() => db.q('UPDATE rooms SET peak_players = GREATEST(peak_players, $1) WHERE id = $2', [this.peak, this.id])).catch(() => {});
    }
    this.onJoin(c);
  }
  removeClient(c, reason = 'left') {
    if (!this.clients.has(c.id)) return;
    this.clients.delete(c.id);
    this.onLeave(c, reason);
    if (!this.clients.size) this.emptySince = Date.now();
  }

  // ghi một "mạng" chơi vào lịch sử trận
  recordMatch({ client, score, kills = 0, maxValue = 0, rank = null, reason = 'death', killedBy = null, startedAt }) {
    return this.ready.then(() => db.q(`INSERT INTO matches (room_id, game_id, user_id, display_name, score, kills, max_value, rank_in_room, end_reason, killed_by, started_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::timestamptz)`,
      [this.id, this.game.id, client.userId, client.name, score, kills, maxValue, rank, reason, killedBy, new Date(startedAt).toISOString()]))
      .catch(e => console.error('[rt] ghi trận:', e.message));
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    await this.onClose();
    for (const c of this.clients.values()) { try { c.ws.close(1001, 'room closed'); } catch { /* */ } }
    this.clients.clear();
    await this.ready;
    await db.q('UPDATE rooms SET ended_at = now() WHERE id = $1', [this.id]).catch(() => {});
  }

  // các hook cho lớp con
  onJoin() {}
  onLeave() {}
  onMessage() {}
  async onClose() {}
}

// Phòng relay: máy chủ chỉ chuyển tin giữa người chơi + giữ "trạng thái phòng" dạng key/value.
// Dùng được cho mọi game đăng lên (logic game nằm ở client, thường do "host" quyết định).
class RelayRoom extends Room {
  constructor(opts) {
    super(opts);
    this.state = {};
    this.stateSize = 0;
    this.hostId = null;
  }
  onJoin(c) {
    if (!this.hostId) this.hostId = c.id;
    this.send(c, {
      t: 'joined', room: { id: this.id, code: this.code, kind: 'relay', maxPlayers: this.maxPlayers },
      you: this.playerInfo(c), host: this.hostId, players: [...this.clients.values()].map(x => this.playerInfo(x)), state: this.state,
    });
    this.broadcast({ t: 'join', player: this.playerInfo(c) }, c);
  }
  onLeave(c) {
    this.broadcast({ t: 'leave', id: c.id });
    if (this.hostId === c.id) {
      const next = this.clients.values().next().value;
      this.hostId = next ? next.id : null;
      if (next) this.broadcast({ t: 'host', id: this.hostId });
    }
  }
  onMessage(c, m) {
    if (m.t === 'msg') {
      const type = String(m.type || '').slice(0, 32);
      if (!type) return;
      const out = { t: 'msg', type, data: m.data === undefined ? null : m.data, from: c.id };
      if (m.to) { const target = this.clients.get(String(m.to)); if (target) this.send(target, out); }
      else this.broadcast(out, m.self ? undefined : c);
    } else if (m.t === 'set') {
      const key = String(m.key || '').slice(0, 40);
      if (!key) return;
      const size = JSON.stringify(m.value === undefined ? null : m.value).length;
      const old = key in this.state ? JSON.stringify(this.state[key]).length : 0;
      if (Object.keys(this.state).length >= 64 && !(key in this.state)) return this.send(c, { t: 'error', error: 'Trạng thái phòng tối đa 64 khóa' });
      if (this.stateSize - old + size > 16 * 1024) return this.send(c, { t: 'error', error: 'Trạng thái phòng tối đa 16KB' });
      this.stateSize += size - old;
      if (m.value === null || m.value === undefined) delete this.state[key]; else this.state[key] = m.value;
      this.broadcast({ t: 'state', key, value: m.value === undefined ? null : m.value, by: c.id });
    }
  }
}

module.exports = { Room, RelayRoom };
