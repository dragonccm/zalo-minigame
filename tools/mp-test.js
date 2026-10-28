#!/usr/bin/env node
'use strict';
// Kiểm thử multiplayer bằng WebSocket thật:  GAMEHUB_TEST=1 npm start  rồi  node tools/mp-test.js
const BASE = process.env.BASE || 'http://localhost:8080';
const WSB = BASE.replace(/^http/, 'ws');
const ADMIN = { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'AdminPass123' };
const run = Date.now().toString(36);
const sleep = ms => new Promise(r => setTimeout(r, ms));
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✖', name, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); } };

class Http {
  constructor() { this.cookie = ''; }
  async req(method, url, { body, raw } = {}) {
    const h = { 'X-GH': '1' };
    if (this.cookie) h.Cookie = this.cookie;
    let payload;
    if (raw) { payload = raw; h['Content-Type'] = 'application/zip'; }
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(BASE + url, { method, headers: h, body: payload });
    const sc = res.headers.get('set-cookie');
    if (sc) this.cookie = sc.split(';')[0];
    const text = await res.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
  async ticket(slug) { const r = await this.req('GET', `/api/games/${slug}/realtime-ticket`); return r.data; }
}

// kết nối WebSocket + hàng đợi tin nhắn để chờ theo điều kiện
function connect(ticket) {
  return new Promise(resolve => {
    const ws = new WebSocket(`${WSB}/rt?ticket=${encodeURIComponent(ticket)}`);
    const c = {
      ws, msgs: [], opened: false, closed: null,
      send: o => ws.send(JSON.stringify(o)),
      async wait(pred, ms = 5000) {
        const t0 = Date.now();
        while (Date.now() - t0 < ms) { const m = c.msgs.find(pred); if (m) return m; await sleep(20); }
        return null;
      },
      last(pred) { for (let i = c.msgs.length - 1; i >= 0; i--) if (pred(c.msgs[i])) return c.msgs[i]; return null; },
      close() { try { ws.close(); } catch { /* */ } },
    };
    ws.onopen = () => { c.opened = true; resolve(c); };
    ws.onmessage = e => { try { c.msgs.push(JSON.parse(e.data)); } catch { /* */ } };
    ws.onclose = e => { c.closed = e.code; resolve(c); };
    ws.onerror = () => {};
  });
}

function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function makeZip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.from(content), nm = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22), n = Object.keys(files).length;
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(n, 8); end.writeUInt16LE(n, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}

async function completeTask(user, admin, slug, placement) {
  let r = await user.req('GET', `/api/games/${slug}/rewards/${placement}`);
  if (!r.data.available) return { err: r.data };
  const t = r.data.tasks.find(x => x.title.startsWith('MP test'));
  r = await user.req('POST', `/api/games/${slug}/rewards/${placement}/start`, { body: { taskId: t.id } });
  const runId = r.data.runId;
  r = await user.req('POST', `/api/games/${slug}/rewards/runs/${runId}/claim`, { body: {} });
  return { runId, token: r.data.token, reward: r.data.reward };
}

(async () => {
  const admin = new Http(), u1 = new Http(), guest = new Http();
  await admin.req('POST', '/api/auth/login', { body: ADMIN });
  await u1.req('POST', '/api/auth/register', { body: { username: 'mp_' + run, password: 'matkhau123', displayName: 'MP Tester' } });
  const slug = 'cubes-2048';

  console.log('\n[Vé kết nối & xác thực]');
  let t1 = await u1.ticket(slug);
  ok(t1.mode === 'authoritative' && t1.path === '/rt' && t1.ticket, 'Xin được vé realtime cho Cubes (authoritative)', t1);
  const c1 = await connect(t1.ticket);
  ok(c1.opened, 'Kết nối WebSocket bằng vé hợp lệ');
  const reuse = await connect(t1.ticket);
  ok(!reuse.opened, 'Dùng lại vé cũ bị từ chối (vé chỉ dùng 1 lần)');
  const forged = await connect(t1.ticket.replace(/.$/, c => (c === 'A' ? 'B' : 'A')));
  ok(!forged.opened, 'Vé bị sửa chữ ký bị từ chối');
  ok((await guest.req('GET', '/api/games/khong-co/realtime-ticket')).status === 404, 'Game không tồn tại → không cấp vé');

  console.log('\n[Phòng Cubes 2048 (máy chủ chạy logic)]');
  c1.send({ t: 'join' });
  const w1 = await c1.wait(m => m.t === 'welcome');
  ok(w1 && w1.frees.length > 150 && w1.divs.length === 12 && w1.pows.length === 6, 'Nhận trạng thái đấu trường ban đầu', w1 && { frees: w1.frees.length });
  const c2 = await connect((await guest.ticket(slug)).ticket);
  c2.send({ t: 'join' });
  const w2 = await c2.wait(m => m.t === 'welcome');
  ok(w2 && w2.room.id === w1.room.id, 'Người thứ 2 (khách) được ghép cùng phòng công khai');
  const snapBots = await c2.wait(m => m.t === 'snap' && m.m && m.m.length >= 10);
  ok(snapBots, 'Snapshot có danh sách rắn (bot lấp đầy đấu trường)');
  c1.send({ t: 'spawn', name: 'Tester<b>', skin: 'electric' });
  const you = await c1.wait(m => m.t === 'you');
  ok(you && you.id > 0 && you.value === 2, 'Vào trận, nhận id con rắn', you);
  const meta = await c2.wait(m => m.t === 'snap' && m.m && m.m.some(x => x[0] === you.id));
  const mm = meta && meta.m.find(x => x[0] === you.id);
  ok(mm && mm[1] === 'Testerb' && mm[3] === 'electric' && mm[4] === 0, 'Người khác thấy tên (đã lọc ký tự) + skin của mình', mm);
  c1.msgs = [];
  c1.send({ t: 'in', a: 0, b: 0 });
  await sleep(400);
  const p0 = c1.last(m => m.t === 'snap' && m.s.some(x => x[0] === you.id)).s.find(x => x[0] === you.id);
  await sleep(1000);
  const p1 = c1.last(m => m.t === 'snap' && m.s.some(x => x[0] === you.id)).s.find(x => x[0] === you.id);
  ok(p1[1] > p0[1] + 300 || p1[1] >= 4700, 'Lái sang phải (góc 0) → x tăng ~6.5 ô/giây', { p0, p1 });
  c1.send({ t: 'in', a: Math.PI, b: 1 });
  await sleep(700);
  const me = c1.last(m => m.t === 'snap' && m.me).me;
  ok(me[0] < 90, 'Giữ tăng tốc → năng lượng giảm (máy chủ tính)', me);
  ok(c1.last(m => m.t === 'snap' && m.s.some(x => x[0] === you.id)).s.find(x => x[0] === you.id)[4] & 1, 'Cờ "đang tăng tốc" có trong snapshot');
  c1.send({ t: 'in', a: 'abc', b: 1 });
  c1.send({ t: 'in', a: 1e9 });
  ok(true, 'Gửi dữ liệu lái rác không làm sập phòng');

  console.log('\n[Phần thưởng nhiệm vụ trong phòng online]');
  await admin.req('POST', '/api/admin/tasks', { body: { title: 'MP test task', type: 'link', url: 'https://example.com', durationSec: 0, dailyLimit: 20, priority: 100 } });
  const pb = await completeTask(u1, admin, slug, 'power_boost');
  ok(pb.token && pb.reward.amount === 10, 'Hoàn thành nhiệm vụ power_boost qua API', pb);
  c1.send({ t: 'reward', placement: 'power_boost', runId: pb.runId, token: pb.token });
  const rw = await c1.wait(m => m.t === 'reward');
  await sleep(150);
  const me2 = c1.last(m => m.t === 'snap' && m.me).me;
  ok(rw && rw.amount === 10 && me2[2] > 50 && me2[4] > 0, 'Máy chủ xác minh token và áp dụng khiên + tăng tốc vô hạn', { rw, me2 });
  c1.msgs = [];
  c1.send({ t: 'reward', placement: 'power_boost', runId: pb.runId, token: pb.token });
  ok(await c1.wait(m => m.t === 'error' && /đã dùng/.test(m.error)), 'Dùng lại token → bị từ chối');
  const pb2 = await completeTask(guest, admin, slug, 'revive');
  c1.send({ t: 'reward', placement: 'power_boost', runId: pb2.runId, token: pb2.token });
  ok(await c1.wait(m => m.t === 'error'), 'Token của người khác / placement khác → bị từ chối');

  console.log('\n[Tàng hình khi đang làm nhiệm vụ]');
  const myFlags = c => (c.last(m => m.t === 'snap' && m.s.some(x => x[0] === you.id)).s.find(x => x[0] === you.id) || [])[4] || 0;
  await u1.req('POST', `/api/games/${slug}/rewards/close`);                 // xóa phiên còn sót lại sau khi nhận thưởng ở trên
  c1.msgs = [];
  c1.send({ t: 'ghost', on: true });
  ok(!(await c1.wait(m => m.t === 'ghost' && m.on, 600)) && !(myFlags(c1) & 16), 'Không có phiên nhiệm vụ → máy chủ từ chối tàng hình (client không tự bật được)');
  const op = await u1.req('POST', `/api/games/${slug}/rewards/start_boost/open`);
  ok(op.status === 200 && op.data.ok === true, 'Portal báo mở khung nhiệm vụ → máy chủ ghi nhận phiên', op.data);
  c1.msgs = []; c2.msgs = [];
  c1.send({ t: 'ghost', on: true });
  ok(await c1.wait(m => m.t === 'ghost' && m.on === true), 'Có phiên nhiệm vụ → nhân vật tàng hình');
  await sleep(150);
  ok((myFlags(c1) & 16) && c1.last(m => m.t === 'snap' && m.me).me[6] === 1, 'Snapshot đánh dấu tàng hình (cờ 16 + me[6])');
  ok(await c2.wait(m => m.t === 'snap' && m.s.some(x => x[0] === you.id && (x[4] & 16))), 'Người khác nhận cờ tàng hình để ẩn nhân vật');
  const g0 = c1.last(m => m.t === 'snap' && m.s.some(x => x[0] === you.id)).s.find(x => x[0] === you.id);
  c1.send({ t: 'in', a: 2, b: 1 });
  await sleep(700);
  const g1 = c1.last(m => m.t === 'snap' && m.s.some(x => x[0] === you.id)).s.find(x => x[0] === you.id);
  ok(g0[1] === g1[1] && g0[2] === g1[2], 'Đang tàng hình: nhân vật đứng yên (không trôi, không bị bot đụng)', { g0, g1 });
  c1.send({ t: 'debug_kill' });
  ok(!(await c1.wait(m => m.t === 'dead', 600)), 'Đang tàng hình: không thể bị giết');
  const cl = await u1.req('POST', `/api/games/${slug}/rewards/close`);
  ok(cl.status === 200, 'Portal báo đóng khung nhiệm vụ');
  ok(await c1.wait(m => m.t === 'ghost' && m.on === false, 2000), 'Hết phiên nhiệm vụ → máy chủ tự cho nhân vật hiện lại (không cần client báo)');
  await sleep(150);
  const me3 = c1.last(m => m.t === 'snap' && m.me).me;
  ok(!(myFlags(c1) & 16) && me3[6] === 0 && me3[2] >= 35, 'Hiện lại kèm vài giây khiên bảo vệ', me3);
  c1.send({ t: 'in', a: 1, b: 0 });
  await sleep(400);
  const g2 = c1.last(m => m.t === 'snap' && m.s.some(x => x[0] === you.id)).s.find(x => x[0] === you.id);
  ok(g2[1] !== g1[1] || g2[2] !== g1[2], 'Sau khi hiện lại nhân vật di chuyển bình thường');

  console.log('\n[Máy chủ tự lưu điểm khi chết]');
  c1.msgs = [];
  c1.send({ t: 'debug_kill' });
  const dead = await c1.wait(m => m.t === 'dead');
  ok(dead && dead.score >= 2 && dead.result && dead.result.saved && dead.result.rank >= 1, 'Nhận kết quả trận + điểm đã lưu lên bảng xếp hạng', dead);
  if (!dead) console.log('    (cần khởi động server với GAMEHUB_TEST=1)');
  ok(await c2.wait(m => m.t === 'snap' && m.ev.some(e => e[0] === 'd' && e[1] === you.id)), 'Người khác nhận sự kiện con rắn đã chết');
  const prof = await guest.req('GET', `/api/users/mp_${run}`);
  ok(prof.data.matches.length === 1 && prof.data.matches[0].reason === 'death' && prof.data.stats.matches === 1, 'Lịch sử trận lưu vào DB, hiện trên hồ sơ', prof.data.matches);
  ok(prof.data.bestScores.some(b => b.game.slug === slug), 'Điểm do máy chủ ghi xuất hiện trong điểm cao nhất');
  const rv = await completeTask(u1, admin, slug, 'revive');
  c1.msgs = [];
  c1.send({ t: 'spawn', name: 'Tester', skin: 'medieval', revive: { runId: rv.runId, token: rv.token } });
  const you2 = await c1.wait(m => m.t === 'you');
  ok(you2 && you2.shield === 6 && you2.value === Math.max(2, dead.maxValue), 'Hồi sinh bằng nhiệm vụ: giữ khối lớn nhất + khiên 6 giây', you2);
  ok((await guest.req('POST', `/api/games/${slug}/score`, { body: { score: 5 } })).status === 401, '(khách vẫn không gửi điểm qua API được)');

  console.log('\n[Phòng riêng có mã]');
  const c3 = await connect((await u1.ticket(slug)).ticket);
  c3.send({ t: 'join', create: true });
  const w3 = await c3.wait(m => m.t === 'welcome');
  ok(w3 && /^[A-Z2-9]{6}$/.test(w3.room.code) && w3.room.id !== w1.room.id, 'Tạo phòng riêng, nhận mã 6 ký tự', w3 && w3.room);
  const c4 = await connect((await guest.ticket(slug)).ticket);
  c4.send({ t: 'join', code: w3.room.code.toLowerCase() });
  const w4 = await c4.wait(m => m.t === 'welcome');
  ok(w4 && w4.room.id === w3.room.id, 'Bạn bè vào đúng phòng bằng mã (không phân biệt hoa thường)');
  const c5 = await connect((await guest.ticket(slug)).ticket);
  c5.send({ t: 'join', code: 'ZZZZZZ' });
  ok(await c5.wait(m => m.t === 'error' && /Không tìm thấy phòng/.test(m.error)), 'Mã phòng sai → báo lỗi');
  const st = await admin.req('GET', '/api/admin/stats');
  ok(st.data.roomsOnline >= 2 && st.data.playersOnline >= 4 && ['postgres', 'pglite'].includes(st.data.db), 'Admin thấy số phòng / người đang online', st.data);

  console.log('\n[Phòng relay cho game đăng lên]');
  const relayManifest = {
    schema: 1, id: 'relay-test-' + run.slice(-4), name: 'Relay Test', version: '1.0.0', description: 'Game thử nghiệm phòng relay nhiều người.',
    author: 'Tester', sdk: '1.0', categories: ['other'], permissions: ['multiplayer'], multiplayer: { mode: 'relay', maxPlayers: 3 },
  };
  const html = '<!doctype html><script src="gamehub-sdk.js"></script><script>GameHub.init().then(()=>GameHub.ready())</script>';
  let r = await u1.req('POST', '/api/submissions', { raw: makeZip({ 'gamehub.json': JSON.stringify({ ...relayManifest, multiplayer: { mode: 'authoritative', maxPlayers: 4 } }), 'index.html': html }) });
  ok(r.status === 422 && /authoritative/.test(r.data.errors.join()), 'Game đăng lên không được dùng chế độ authoritative', r.data);
  r = await u1.req('POST', '/api/submissions', { raw: makeZip({ 'gamehub.json': JSON.stringify(relayManifest), 'index.html': html }) });
  ok(r.status === 200, 'Upload game relay', r.data);
  await admin.req('POST', `/api/admin/submissions/${r.data.submission.id}/review`, { body: { decision: 'approve', note: 'ok' } });
  const rs = relayManifest.id;
  const r1 = await connect((await u1.ticket(rs)).ticket); r1.send({ t: 'join' });
  const j1 = await r1.wait(m => m.t === 'joined');
  ok(j1 && j1.room.kind === 'relay' && j1.host === j1.you.id, 'Vào phòng relay, người đầu tiên là host', j1);
  const r2 = await connect((await guest.ticket(rs)).ticket); r2.send({ t: 'join' });
  const j2 = await r2.wait(m => m.t === 'joined');
  ok(j2 && j2.room.id === j1.room.id && j2.players.length === 2, 'Người thứ 2 vào cùng phòng, thấy danh sách người chơi');
  ok(await r1.wait(m => m.t === 'join' && m.player.id === j2.you.id), 'Host nhận sự kiện có người vào');
  r1.send({ t: 'msg', type: 'move', data: { x: 3, y: 4 } });
  const mv = await r2.wait(m => m.t === 'msg' && m.type === 'move');
  ok(mv && mv.data.x === 3 && mv.from === j1.you.id, 'Tin nhắn được chuyển tới người khác kèm id người gửi', mv);
  r2.send({ t: 'set', key: 'turn', value: j1.you.id });
  ok(await r1.wait(m => m.t === 'state' && m.key === 'turn' && m.value === j1.you.id), 'Trạng thái phòng (key/value) đồng bộ cho mọi người');
  r2.send({ t: 'msg', type: 'secret', data: 1, to: j1.you.id });
  ok(await r1.wait(m => m.t === 'msg' && m.type === 'secret'), 'Gửi riêng cho một người chơi');
  const r3 = await connect((await admin.ticket(rs)).ticket); r3.send({ t: 'join' });
  const j3 = await r3.wait(m => m.t === 'joined');
  ok(j3 && j3.state.turn === j1.you.id, 'Người vào sau nhận trạng thái phòng hiện tại');
  const r4 = await connect((await guest.ticket(rs)).ticket); r4.send({ t: 'join' });
  const j4 = await r4.wait(m => m.t === 'joined');
  ok(j4 && j4.room.id !== j1.room.id, 'Phòng đầy (3/3) → người thứ 4 được ghép phòng mới');
  r1.close();
  ok(await r2.wait(m => m.t === 'host' && m.id === j2.you.id), 'Host rời phòng → chuyển host cho người kế tiếp');
  ok(await r3.wait(m => m.t === 'leave' && m.id === j1.you.id), 'Mọi người nhận sự kiện có người rời phòng');
  let flood = 0;
  for (let i = 0; i < 200; i++) { r2.send({ t: 'msg', type: 'spam', data: i }); }
  await sleep(500);
  flood = r3.msgs.filter(m => m.type === 'spam').length;
  ok(flood > 0 && flood < 120, 'Giới hạn tần suất tin nhắn (spam 200 tin → chỉ chuyển một phần)', flood);

  console.log('\n[Phòng Cờ Vua online (máy chủ kiểm tra nước đi)]');
  const k1 = await connect((await u1.ticket('chess')).ticket); k1.send({ t: 'join' });
  ok(await k1.wait(m => m.t === 'welcome'), 'Vào phòng cờ (ghép trận nhanh), chờ đối thủ');
  const k2 = await connect((await guest.ticket('chess')).ticket); k2.send({ t: 'join' });
  const s1 = await k1.wait(m => m.t === 'start'), s2 = await k2.wait(m => m.t === 'start');
  ok(s1 && s2 && s1.color !== s2.color && s1.base === 300000 && s1.inc === 3000, 'Đủ 2 người → bắt đầu, chia 2 màu khác nhau, 5 phút +3 giây', { s1, s2 });
  const W = s1.color === 'w' ? k1 : k2, B = W === k1 ? k2 : k1, wUser = W === k1;
  B.send({ t: 'mv', from: 'e7', to: 'e5' });
  ok(await B.wait(m => m.t === 'reject' && /lượt/.test(m.error)), 'Đi khi chưa tới lượt → bị từ chối');
  W.send({ t: 'mv', from: 'e2', to: 'e5' });
  ok(await W.wait(m => m.t === 'reject' && /không hợp lệ/.test(m.error)), 'Nước đi sai luật → bị từ chối');
  W.send({ t: 'mv', from: 'f2', to: 'f3' });
  const mv1 = await B.wait(m => m.t === 'mv' && m.ply === 1);
  ok(mv1 && mv1.san === 'f3' && mv1.clock.w > 290000 && mv1.clock.w <= 303000, 'Nước hợp lệ được gửi cho cả 2 bên kèm đồng hồ (+3 giây)', mv1);
  for (const [who, f, t] of [[B, 'e7', 'e5'], [W, 'g2', 'g4'], [B, 'd8', 'h4']]) { who.send({ t: 'mv', from: f, to: t }); await sleep(80); }
  const e1 = await W.wait(m => m.t === 'end'), e2 = await B.wait(m => m.t === 'end');
  ok(e1 && e2 && e1.result === '0-1' && e1.reason === 'checkmate', 'Chiếu hết → máy chủ kết thúc ván (0-1)', e1);
  const winnerEnd = e2;                                  // Đen chiếu hết -> người thắng là bên Đen (B)
  ok(winnerEnd && winnerEnd.points >= 1500 && ((winnerEnd.saved && winnerEnd.saved.saved) || winnerEnd.guest), 'Người thắng được cộng điểm (máy chủ tự lưu nếu đã đăng nhập)', winnerEnd);
  W.send({ t: 'rematch' }); B.send({ t: 'rematch' });
  const r1s = await k1.wait(m => m.t === 'start' && m !== s1), r2s = await k2.wait(m => m.t === 'start' && m !== s2);
  ok(r1s && r2s && r1s.color !== s1.color, 'Tái đấu: cả 2 đồng ý → ván mới, đổi màu');
  const W2 = r1s.color === 'w' ? k1 : k2, B2 = W2 === k1 ? k2 : k1;
  W2.send({ t: 'draw', a: 'offer' });
  ok(await B2.wait(m => m.t === 'drawoffer'), 'Mời hòa được chuyển cho đối thủ');
  B2.send({ t: 'draw', a: 'accept' });
  const d1 = await W2.wait(m => m.t === 'end' && m.reason === 'agreement');
  ok(d1 && d1.result === '1/2-1/2', 'Đồng ý hòa → ván hòa', d1);
  W2.send({ t: 'rematch' }); B2.send({ t: 'rematch' });
  await k1.wait(m => m.t === 'start' && m !== s1 && m !== r1s);
  k1.send({ t: 'resign' });
  const rsg = await k2.wait(m => m.t === 'end' && m.reason === 'resign');
  ok(rsg && rsg.result !== '1/2-1/2', 'Đầu hàng → đối thủ thắng', rsg);
  const k3 = await connect((await u1.ticket('chess')).ticket); k3.send({ t: 'join', create: true });
  const kw = await k3.wait(m => m.t === 'welcome');
  k3.send({ t: 'cfg', tc: 0 });
  const k4 = await connect((await guest.ticket('chess')).ticket); k4.send({ t: 'join', code: kw.room.code.toLowerCase() });
  const ps = await k3.wait(m => m.t === 'start');
  ok(kw.room.code && ps && ps.base === 180000 && ps.inc === 2000, 'Phòng riêng có mã + chọn thời gian 3 phút +2 giây', { code: kw.room.code, base: ps && ps.base });
  k4.close();
  const ab = await k3.wait(m => m.t === 'end' && m.reason === 'abandon');
  ok(ab && ((ps.color === 'w' && ab.result === '1-0') || (ps.color === 'b' && ab.result === '0-1')), 'Đối thủ rời trận → bạn thắng', ab);
  await sleep(300);
  const prof2 = await guest.req('GET', `/api/users/mp_${run}`);
  ok(prof2.data.matches.some(m => m.game.slug === 'chess' && ['win', 'loss', 'draw'].includes(m.reason)), 'Ván cờ online lưu vào lịch sử trận (thắng/thua/hòa)', prof2.data.matches.slice(0, 3));
  for (const c of [k1, k2, k3]) c.close();

  console.log('\n[Phòng Diều Chiến online (máy chủ chạy logic)]');
  const kd1 = await connect((await u1.ticket('dieu-chien')).ticket); kd1.send({ t: 'join' });
  const kdw = await kd1.wait(m => m.t === 'welcome'), kdm = await kd1.wait(m => m.t === 'map');
  ok(kdw && kdm && kdm.n === 1 && kdm.need === 4 && kdm.coins.length >= 150, 'Vào phòng diều: nhận map 1 (cần 4 ngọc) + danh sách vàng', kdm && { n: kdm.n, need: kdm.need, coins: kdm.coins.length });
  kd1.send({ t: 'spawn', name: 'Phi công<i>', skin: 'night' });
  const kyou = await kd1.wait(m => m.t === 'you');
  const ksnap = await kd1.wait(m => m.t === 'snap' && m.me && m.s.some(x => x[0] === kyou.id));
  const kmeta = ksnap && (await kd1.wait(m => m.t === 'snap' && m.m && m.m.some(x => x[0] === kyou.id)));
  ok(kyou && kmeta && kmeta.m.find(x => x[0] === kyou.id)[1] === 'Phi côngi' && kmeta.m.length >= 7, 'Vào trận: có diều của mình (tên đã lọc), bot lấp phòng', kmeta && kmeta.m.length);
  const kpos = () => kd1.last(m => m.t === 'snap' && m.s.some(x => x[0] === kyou.id)).s.find(x => x[0] === kyou.id);
  const kp0 = kpos(); kd1.send({ t: 'in', a: kp0[1] > 1800 ? Math.PI : 0, b: 0 }); await sleep(1800);
  const kp1 = kpos();
  ok(Math.abs(kp1[1] - kp0[1]) > 80, 'Lái diều: máy chủ di chuyển theo hướng gửi lên', { kp0, kp1 });
  const kd2 = await connect((await guest.ticket('dieu-chien')).ticket); kd2.send({ t: 'join' });
  await kd2.wait(m => m.t === 'map'); kd2.send({ t: 'spawn', name: 'Khách', skin: 'sea' });
  const kyou2 = await kd2.wait(m => m.t === 'you');
  ok(await kd2.wait(m => m.t === 'snap' && m.s.some(x => x[0] === kyou.id)), 'Người thứ 2 cùng phòng thấy diều của người thứ 1');
  // tàng hình khi làm nhiệm vụ
  await u1.req('POST', '/api/games/dieu-chien/rewards/close');
  kd1.send({ t: 'ghost', on: true });
  ok(!(await kd1.wait(m => m.t === 'ghost' && m.on, 600)), 'Không có phiên nhiệm vụ → không được tàng hình');
  await u1.req('POST', '/api/games/dieu-chien/rewards/coins/open');
  kd1.msgs = []; kd2.msgs = [];
  kd1.send({ t: 'ghost', on: true });
  ok(await kd1.wait(m => m.t === 'ghost' && m.on), 'Có phiên nhiệm vụ → diều tàng hình');
  await sleep(250);
  const ksees = kd2.last(m => m.t === 'snap'), kself = kd1.last(m => m.t === 'snap');
  ok(ksees && !ksees.s.some(x => x[0] === kyou.id) && kself.s.some(x => x[0] === kyou.id && (x[4] & 16)), 'Đang tàng hình: người khác không nhận vị trí diều, bản thân vẫn thấy mình');
  await u1.req('POST', '/api/games/dieu-chien/rewards/close');
  ok(await kd1.wait(m => m.t === 'ghost' && m.on === false, 2000), 'Hết phiên nhiệm vụ → hiện lại');
  // gom đủ ngọc -> cổng -> thắng vòng -> cả phòng sang map 2
  kd1.send({ t: 'debug_orbs' });
  const kpt = await kd1.wait(m => m.t === 'snap' && m.pt);
  ok(kpt && kpt.me[1] >= 4, 'Đủ ngọc → cổng mở (có trong snapshot)', kpt && kpt.pt);
  const kpp = kpt.pt, kmp = kpt.s.find(x => x[0] === kyou.id);
  kd1.send({ t: 'in', a: Math.atan2(kpp[1] - kmp[2], kpp[0] - kmp[1]), b: 1 });
  const kround = await kd2.wait(m => m.t === 'round', 6000);
  ok(kround && kround.id === kyou.id && kround.next === 2 && kround.bonus === 500, 'Bay vào cổng → thắng vòng, mọi người nhận thông báo', kround);
  const km2a = await kd1.wait(m => m.t === 'map' && m.n === 2, 6000), km2b = await kd2.wait(m => m.t === 'map' && m.n === 2, 6000);
  ok(km2a && km2b && km2a.need === 5 && km2a.hazards.birds, 'Sau 3 giây cả phòng sang map 2 (cần 5 ngọc, có chim)');
  kd2.msgs = [];
  kd2.send({ t: 'debug_kill' });
  ok(await kd2.wait(m => m.t === 'dead'), 'Bị hạ → nhận thông báo');
  ok(await kd2.wait(m => m.t === 'snap' && m.s.some(x => x[0] === kyou2.id), 5000), 'Hồi sinh sau 2 giây');
  // đấu tay đôi: người bấm nhanh thắng, người kia bị hạ; người ngoài không xen vào được
  await sleep(2500);
  kd1.msgs = []; kd2.msgs = [];
  kd1.send({ t: 'debug_duel', with: kyou2.id });
  const duelSnap = await kd2.wait(m => m.t === 'snap' && m.du && m.du.some(x => x.includes(kyou.id) && x.includes(kyou2.id)));
  ok(duelSnap, 'Hai diều chạm nhau → vào vòng đấu tay đôi (cả hai đều thấy)');
  for (let i = 0; i < 40; i++) { kd1.send({ t: 'tap' }); await sleep(60); }
  const isMine = e => e[0] === 'd-' && [e[1], e[2]].includes(kyou.id) && [e[1], e[2], e[3]].includes(kyou2.id);
  const dEnd = await kd2.wait(m => m.t === 'snap' && m.ev.some(isMine), 8000);
  const ev = dEnd && dEnd.ev.find(isMine);
  ok(ev && ev[1] === kyou.id && ev[2] === kyou2.id, 'Người bấm nhanh hơn thắng vòng đấu', ev);
  ok(await kd2.wait(m => m.t === 'dead'), 'Người thua bị hạ');
  kd1.close(); await sleep(400);
  const kprof = await guest.req('GET', `/api/users/mp_${run}`);
  ok(kprof.data.matches.some(m => m.game.slug === 'dieu-chien' && m.score >= 500), 'Rời phòng → lưu lịch sử trận + điểm (có thưởng thắng vòng)', kprof.data.matches.slice(0, 2));
  ok(kprof.data.bestScores.some(b => b.game.slug === 'dieu-chien'), 'Điểm diều online lên bảng xếp hạng');
  kd2.close();

  for (const c of [c1, c2, c3, c4, c5, r2, r3, r4]) c.close();
  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Lỗi chạy test:', e); process.exit(1); });
