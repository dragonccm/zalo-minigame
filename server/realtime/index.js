'use strict';
// Máy chủ realtime (WebSocket tại /rt). Game nhận "vé" qua portal (GameHub SDK) rồi kết nối trực tiếp.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { WebSocketServer } = require('ws');
const db = require('../db');
const { verifyTicket, ROOMS_DIR, services, setRealtimeStats } = require('../api');
const { Room, RelayRoom } = require('./room');

const rooms = new Map();              // roomId -> room
const usedTickets = new Map();        // nonce -> hết hạn (vé chỉ dùng 1 lần)
const roomClasses = new Map();        // slug -> lớp phòng authoritative
let wss = null, seq = 0, timer = null;

function roomClassFor(slug) {
  if (roomClasses.has(slug)) return roomClasses.get(slug);
  const file = path.join(ROOMS_DIR, `${slug}.js`);
  const Cls = /^[a-z0-9-]+$/.test(slug) && fs.existsSync(file) ? require(file)({ Room, services }) : null;
  roomClasses.set(slug, Cls);
  return Cls;
}

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from(crypto.randomBytes(6), b => CODE_CHARS[b % CODE_CHARS.length]).join('');

async function pickRoom(c, msg) {
  const g = await db.one("SELECT id, slug, manifest, builtin, status FROM games WHERE slug = $1", [c.ticket.g]);
  if (!g || g.status !== 'live') throw new Error('Game không còn hoạt động');
  const mp = g.manifest.multiplayer;
  if (!mp || !g.manifest.permissions.includes('multiplayer')) throw new Error('Game không hỗ trợ multiplayer');
  let Cls = RelayRoom;
  if (mp.mode === 'authoritative') {
    Cls = g.builtin ? roomClassFor(g.slug) : null;
    if (!Cls) throw new Error('Máy chủ chưa có logic phòng cho game này');
  }
  const mine = [...rooms.values()].filter(r => r.game.slug === g.slug && !r.closed);
  if (msg.code) {
    const r = mine.find(x => x.code === String(msg.code).toUpperCase().trim());
    if (!r) throw new Error('Không tìm thấy phòng với mã này');
    if (r.full) throw new Error('Phòng đã đầy');
    return r;
  }
  if (msg.create) {
    if (mp.privateRooms === false) throw new Error('Game không cho tạo phòng riêng');
    let code; do code = newCode(); while (mine.some(x => x.code === code));
    const r = new Cls({ game: g, kind: mp.mode, code, maxPlayers: mp.maxPlayers, manager: module.exports });
    rooms.set(r.id, r);
    return r;
  }
  // ghép phòng công khai: phòng đông nhất chưa đầy
  const open = mine.filter(r => !r.code && !r.full).sort((a, b) => b.clients.size - a.clients.size)[0];
  if (open) return open;
  const r = new Cls({ game: g, kind: mp.mode, code: null, maxPlayers: mp.maxPlayers, manager: module.exports });
  rooms.set(r.id, r);
  return r;
}

function onConnection(ws, ticket) {
  const c = {
    id: 'p' + (++seq).toString(36), ws, ticket, room: null, userId: ticket.u, viewer: ticket.v,
    name: ticket.n, avatar: ticket.a, alive: true, tokens: 60, lastRefill: Date.now(),
  };
  const fail = (msg, code = 4000) => { try { ws.send(JSON.stringify({ t: 'error', error: msg, fatal: true })); ws.close(code, 'error'); } catch { /* */ } };
  const joinTimer = setTimeout(() => { if (!c.room) fail('Chưa gửi lệnh join', 4001); }, 10000);

  ws.on('pong', () => { c.alive = true; });
  ws.on('message', async raw => {
    // giới hạn 40 tin/giây (cho phép dồn tối đa 60)
    const t = Date.now();
    c.tokens = Math.min(60, c.tokens + (t - c.lastRefill) * 0.04); c.lastRefill = t;
    if (c.tokens < 1) return;
    c.tokens -= 1;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (!m || typeof m !== 'object' || typeof m.t !== 'string') return;
    if (m.t === 'join') {
      if (c.room || c.joining) return;
      c.joining = true;
      try {
        const room = await pickRoom(c, m);
        clearTimeout(joinTimer);
        room.addClient(c);
      } catch (e) { fail(e.message, 4002); }
      c.joining = false;
      return;
    }
    if (m.t === 'ping') return ws.send(JSON.stringify({ t: 'pong', at: m.at, server: Date.now() }));
    if (c.room) { try { c.room.onMessage(c, m); } catch (e) { console.error('[rt] lỗi xử lý tin:', e); } }
  });
  ws.on('close', () => { clearTimeout(joinTimer); if (c.room) c.room.removeClient(c, 'left'); });
  ws.on('error', () => {});
}

function attach(server) {
  wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname !== '/rt') return socket.destroy();
    const ticket = verifyTicket(url.searchParams.get('ticket'));
    if (!ticket || usedTickets.has(ticket.j)) { socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return socket.destroy(); }
    usedTickets.set(ticket.j, ticket.exp);
    wss.handleUpgrade(req, socket, head, ws => onConnection(ws, ticket));
  });
  // nhịp tim: ngắt kết nối chết, dọn phòng trống, dọn vé đã dùng
  timer = setInterval(() => {
    for (const r of rooms.values()) {
      for (const c of r.clients.values()) {
        if (!c.alive) { try { c.ws.terminate(); } catch { /* */ } continue; }
        c.alive = false;
        try { c.ws.ping(); } catch { /* */ }
      }
      if (!r.clients.size && r.emptySince && Date.now() - r.emptySince > 30e3) { rooms.delete(r.id); r.close(); }
    }
    const t = Date.now();
    for (const [k, exp] of usedTickets) if (exp < t) usedTickets.delete(k);
  }, 10e3);
  timer.unref();
  setRealtimeStats(() => ({ rooms: rooms.size, players: [...rooms.values()].reduce((s, r) => s + r.clients.size, 0) }));
}

async function shutdown() {
  clearInterval(timer);
  await Promise.all([...rooms.values()].map(r => r.close()));
  rooms.clear();
  if (wss) wss.close();
}

module.exports = { attach, shutdown, rooms };
