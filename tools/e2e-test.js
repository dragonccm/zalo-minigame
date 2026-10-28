#!/usr/bin/env node
'use strict';
// Kiểm thử end-to-end: node tools/e2e-test.js   (cần server đang chạy; ADMIN_PASS khớp với server)
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

const BASE = process.env.BASE || 'http://localhost:8080';
const ADMIN = { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'AdminPass123' };
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✖', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

class Client {
  constructor() { this.cookie = ''; }
  async req(method, url, { body, raw, csrf = true, headers = {} } = {}) {
    const h = { ...headers };
    if (csrf) h['X-GH'] = '1';
    if (this.cookie) h.Cookie = this.cookie;
    let payload;
    if (raw) { payload = raw; h['Content-Type'] = 'application/zip'; }
    else if (body !== undefined) { payload = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
    const res = await fetch(BASE + url, { method, headers: h, body: payload, redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) { const c = sc.split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    let data = null; const text = await res.text();
    try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data, headers: res.headers };
  }
}

// zip "stored" tối giản để dựng gói thử nghiệm (kể cả gói độc hại)
function crc32(buf) { let c, crc = ~0; for (const b of buf) { c = (crc ^ b) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return ~crc >>> 0; }
function makeZip(files) {
  const locals = [], centrals = []; let off = 0;
  for (const [name, content] of Object.entries(files)) {
    const data = Buffer.isBuffer(content) ? content : Buffer.from(content), nm = Buffer.from(name), crc = crc32(data);
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(data.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(nm.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(data.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(nm.length, 28); ch.writeUInt32LE(off, 42);
    locals.push(lh, nm, data); centrals.push(ch, nm); off += 30 + nm.length + data.length;
  }
  const cd = Buffer.concat(centrals), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...locals, cd, end]);
}
const readDir = (dir, base = dir, out = {}) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) readDir(p, base, out); else out[path.relative(base, p).split(path.sep).join('/')] = fs.readFileSync(p); } return out; };

(async () => {
  const anon = new Client(), dev = new Client(), admin = new Client(), other = new Client();
  const uname = 'dev_' + run;

  console.log('\n[Bảo mật cơ bản]');
  ok((await anon.req('POST', '/api/auth/login', { body: {}, csrf: false })).status === 403, 'POST không có X-GH bị chặn (CSRF)');
  ok((await anon.req('POST', '/api/games/cubes-2048/score', { body: { score: 1 } })).status === 401, 'Gửi điểm khi chưa đăng nhập → 401');
  ok((await anon.req('GET', '/api/admin/stats')).status === 401, 'API admin khi chưa đăng nhập → 401');

  console.log('\n[Đăng ký / đăng nhập]');
  let r = await dev.req('POST', '/api/auth/register', { body: { username: uname, password: 'matkhau123', displayName: 'Dev Test' } });
  ok(r.status === 200 && r.data.user.username === uname, 'Đăng ký thành công', r.data);
  ok((await dev.req('GET', '/api/me')).data.user.username === uname, 'Cookie phiên hoạt động');
  ok((await anon.req('POST', '/api/auth/register', { body: { username: uname, password: 'matkhau123' } })).status === 409, 'Tên trùng bị từ chối');
  ok((await anon.req('POST', '/api/auth/register', { body: { username: 'ab', password: 'matkhau123' } })).status === 400, 'Tên quá ngắn bị từ chối');
  ok((await anon.req('POST', '/api/auth/login', { body: { username: uname, password: 'sai-mat-khau' } })).status === 401, 'Sai mật khẩu → 401');
  r = await other.req('POST', '/api/auth/login', { body: { username: uname, password: 'matkhau123' } });
  ok(r.status === 200, 'Đăng nhập lại thành công');
  r = await admin.req('POST', '/api/auth/login', { body: ADMIN });
  ok(r.status === 200 && r.data.user.role === 'admin', 'Đăng nhập admin', r.data);
  ok((await dev.req('GET', '/api/admin/stats')).status === 403, 'User thường không vào được API admin → 403');

  console.log('\n[Game, điểm, thành tựu, lưu game]');
  r = await anon.req('GET', '/api/games');
  ok(r.data.games.some(g => g.slug === 'cubes-2048'), 'Danh sách game có Cubes 2048');
  r = await dev.req('POST', '/api/games/cubes-2048/play');
  ok(r.status === 200 && r.data.playId > 0, 'Bắt đầu lượt chơi');
  const playId = r.data.playId;
  r = await dev.req('POST', '/api/games/cubes-2048/score', { body: { score: 1500, meta: { maxBlock: 256 } } });
  ok(r.status === 200 && r.data.saved && r.data.rank === 1 && r.data.isNewBest, 'Gửi điểm → hạng 1, kỷ lục mới', r.data);
  ok((await dev.req('POST', '/api/games/cubes-2048/score', { body: { score: 1600 } })).status === 429, 'Gửi điểm quá nhanh → 429 (rate limit)');
  await new Promise(res => setTimeout(res, 2100));
  ok((await dev.req('POST', '/api/games/cubes-2048/score', { body: { score: 1e15 } })).status === 400, 'Điểm vô lý bị từ chối');
  await new Promise(res => setTimeout(res, 2100));
  ok((await dev.req('POST', '/api/games/cubes-2048/score', { body: { score: 'abc' } })).status === 400, 'Điểm không phải số bị từ chối');
  r = await dev.req('GET', '/api/games/cubes-2048/leaderboard?period=all');
  ok(r.data.entries.length === 1 && r.data.entries[0].score === 1500 && r.data.me.rank === 1, 'Bảng xếp hạng đúng', r.data);
  r = await dev.req('POST', '/api/games/cubes-2048/achievements/merge_64');
  ok(r.data.newlyUnlocked === true, 'Mở khóa thành tựu lần đầu');
  r = await dev.req('POST', '/api/games/cubes-2048/achievements/merge_64');
  ok(r.data.newlyUnlocked === false, 'Mở khóa lại → không cộng trùng');
  ok((await dev.req('POST', '/api/games/cubes-2048/achievements/khong_co')).status === 404, 'Thành tựu không khai báo → 404');
  r = await dev.req('PUT', '/api/games/cubes-2048/save', { body: { data: { best: 1500, skin: 'electric' } } });
  ok(r.data.saved === true, 'Lưu dữ liệu game');
  ok((await dev.req('GET', '/api/games/cubes-2048/save')).data.data.skin === 'electric', 'Đọc lại dữ liệu đã lưu');
  ok((await dev.req('PUT', '/api/games/cubes-2048/save', { body: { data: 'x'.repeat(70000) } })).status === 413, 'Dữ liệu lưu > 64KB bị từ chối');
  ok((await dev.req('POST', `/api/games/cubes-2048/play/${playId}/end`)).data.ok === true, 'Kết thúc lượt chơi');
  r = await anon.req('GET', `/api/users/${uname}`);
  ok(r.data.achievements.length === 1 && r.data.bestScores[0].best === 1500 && r.data.stats.plays === 1, 'Hồ sơ công khai hiển thị thành tích', r.data.stats);
  ok(r.data.user.xp >= 10 + 5, 'XP được cộng', r.data.user.xp);

  console.log('\n[Phục vụ file game / sandbox]');
  r = await anon.req('GET', '/g/cubes-2048/index.html');
  const csp = r.headers.get('content-security-policy') || '';
  ok(r.status === 200 && /sandbox allow-scripts/.test(csp) && /connect-src 'self'/.test(csp), 'File game có CSP sandbox + chặn kết nối ngoài');
  ok((await anon.req('GET', '/g/cubes-2048/../../server/db.js')).status === 404, 'Path traversal bị chặn');
  ok((await anon.req('GET', '/g/cubes-2048/%2e%2e/%2e%2e/server/db.js')).status === 404, 'Path traversal (mã hóa) bị chặn');
  ok((await anon.req('GET', '/g/khong-co/index.html')).status === 404, 'Game không tồn tại → 404');
  ok((await anon.req('GET', '/sdk/gamehub-sdk.js')).status === 200, 'SDK tải được');

  console.log('\n[Upload & kiểm tra gói]');
  const good = readDir(path.join(__dirname, '..', 'sample-game'));
  const goodManifest = JSON.parse(good['gamehub.json'].toString());
  const up = (files, c = dev) => c.req('POST', '/api/submissions', { raw: makeZip(files) });
  ok((await anon.req('POST', '/api/submissions', { raw: makeZip(good) })).status === 401, 'Upload khi chưa đăng nhập → 401');
  r = await dev.req('POST', '/api/submissions', { raw: Buffer.from('khong phai zip') });
  ok(r.status === 422, 'File không phải zip → 422', r.data);
  r = await up({ 'index.html': '<html></html>' });
  ok(r.status === 422 && /gamehub\.json/.test(r.data.errors.join()), 'Thiếu gamehub.json → 422');
  r = await up({ ...good, '../evil.html': 'x' });
  ok(r.status === 422 && /không an toàn/.test(r.data.errors.join()), 'Zip-slip (../) bị chặn', r.data);
  r = await up({ ...good, 'hack.php': '<?php ?>' });
  ok(r.status === 422 && /không được phép/.test(r.data.errors.join()), 'File .php bị chặn', r.data);
  r = await up({ ...good, 'index.html': '<script src="https://cdn.evil.com/x.js"></script><script src="gamehub-sdk.js"></script>' });
  ok(r.status === 422 && /bên ngoài/.test(r.data.errors.join()), 'Tải tài nguyên ngoài bị chặn', r.data);
  r = await up({ ...good, 'gamehub.json': JSON.stringify({ ...goodManifest, id: 'Bad Slug!', categories: ['xxx'], achievements: [{ key: 'A B', name: 'x' }] }) });
  ok(r.status === 422 && r.data.errors.length >= 3, 'Manifest sai nhiều chỗ → báo đủ lỗi', r.data.errors);
  r = await up({ ...good, 'gamehub.json': JSON.stringify({ ...goodManifest, id: 'cubes-2048' }) });
  ok(r.status === 422 && /đã được game khác/.test(r.data.errors.join()), 'Trùng slug game của người khác bị chặn', r.data);

  const slug = 'click-rush';
  r = await up(good);
  ok(r.status === 200 && r.data.submission.status === 'pending', 'Upload game mẫu đạt chuẩn → chờ duyệt', r.data);
  const subId = r.data.submission.id;
  r = await up(good);
  ok(r.status === 200 && r.data.submission.id !== subId, 'Gửi lại → bản cũ bị rút, bản mới chờ duyệt');
  const subId2 = r.data.submission.id;
  ok((await anon.req('GET', '/api/games/click-rush')).status === 404, 'Game chưa duyệt chưa hiển thị công khai');
  ok((await anon.req('GET', `/preview/${subId2}/index.html`)).status === 404, 'Khách không xem thử được gói chờ duyệt');
  r = await dev.req('GET', `/api/submissions/${subId2}/preview`);
  const pvUrl = r.data.url;
  ok(r.status === 200 && (await anon.req('GET', pvUrl)).status === 200, 'Chủ gói xin được URL xem thử có chữ ký, tải được cả khi không có cookie');
  ok((await anon.req('GET', pvUrl.replace(/~[a-f0-9]{64}/, '~' + 'a'.repeat(64)))).status === 404, 'Chữ ký xem thử giả bị từ chối');
  const stranger = new Client();
  await stranger.req('POST', '/api/auth/register', { body: { username: 'oth_' + run, password: 'matkhau123' } });
  ok((await stranger.req('GET', `/api/submissions/${subId2}/preview`)).status === 404, 'Người lạ không xin được URL xem thử');
  ok((await other.req('GET', '/api/admin/submissions')).status === 403, 'User thường không xem hàng đợi duyệt');

  console.log('\n[Admin duyệt]');
  r = await admin.req('GET', '/api/admin/submissions?status=pending');
  ok(r.data.submissions.some(s => s.id === subId2) && !r.data.submissions.some(s => s.id === subId), 'Hàng đợi chỉ có bản mới nhất');
  ok((await admin.req('GET', `/api/admin/submissions/${subId2}/files`)).data.files.length === 4, 'Admin xem được danh sách file');
  ok((await admin.req('GET', `/api/submissions/${subId2}/preview`)).status === 200, 'Admin xin được URL xem thử');
  ok((await admin.req('POST', `/api/admin/submissions/${subId2}/review`, { body: { decision: 'reject', note: '' } })).status === 400, 'Từ chối mà không có lý do → 400');
  r = await admin.req('POST', `/api/admin/submissions/${subId2}/review`, { body: { decision: 'reject', note: 'Thiếu hướng dẫn chơi trong game' } });
  ok(r.data.status === 'rejected', 'Từ chối kèm lý do');
  r = await dev.req('GET', '/api/my/submissions');
  ok(r.data.submissions[0].status === 'rejected' && /hướng dẫn/.test(r.data.submissions[0].note), 'Dev thấy lý do bị từ chối');
  r = await up(good);
  const subId3 = r.data.submission.id;
  ok(r.status === 200, 'Dev sửa và gửi lại');
  const pv3 = (await admin.req('GET', `/api/submissions/${subId3}/preview`)).data.url;
  r = await admin.req('POST', `/api/admin/submissions/${subId3}/review`, { body: { decision: 'approve', note: 'OK' } });
  ok(r.data.status === 'approved', 'Admin duyệt');
  r = await anon.req('GET', `/api/games/${slug}`);
  ok(r.status === 200 && r.data.game.achievements.length === 3, 'Game đã xuất bản và truy cập công khai');
  ok((await anon.req('GET', `/g/${slug}/index.html`)).status === 200, 'File game phục vụ tại /g/click-rush/');
  ok((await anon.req('GET', pv3)).status === 404, 'URL xem thử vô hiệu sau khi duyệt');
  r = await up(good);
  ok(r.status === 422 && /đã được duyệt/.test(r.data.errors.join()), 'Không gửi lại đúng phiên bản đã duyệt', r.data);
  r = await up({ ...good, 'gamehub.json': JSON.stringify({ ...goodManifest, version: '1.1.0' }) });
  ok(r.status === 200, 'Cập nhật game với version mới được chấp nhận');
  await new Promise(res => setTimeout(res, 2100));
  r = await dev.req('POST', `/api/games/${slug}/score`, { body: { score: 120 } });
  ok(r.data.saved === true, 'Gửi điểm cho game mới duyệt');
  r = await dev.req('GET', `/api/users/${uname}`);
  ok(r.data.developed.some(g => g.slug === slug), 'Hồ sơ hiển thị game đã phát hành');
  ok((await admin.req('POST', `/api/admin/games/${slug}/status`, { body: { status: 'unpublished' } })).data.ok, 'Admin gỡ game');
  ok((await anon.req('GET', `/g/${slug}/index.html`)).status === 404, 'Game đã gỡ không còn truy cập được');
  await admin.req('POST', `/api/admin/games/${slug}/status`, { body: { status: 'live' } });

  console.log('\n[Nhiệm vụ nhận thưởng]');
  const wait = ms => new Promise(res => setTimeout(res, ms));
  ok((await anon.req('GET', '/api/rewards/config')).data.enabled === true, 'Cấu hình nhiệm vụ công khai, đang bật');
  r = await dev.req('GET', '/api/games/cubes-2048/rewards/power_boost');
  ok(r.data.available && r.data.tasks.length >= 2 && r.data.tasks.every(t => /^[a-z0-9-]+$/.test(t.icon)) && r.data.placement.reward.amount === 10, 'Placement của game + nhiệm vụ mẫu (icon là tên icon, không phải emoji)', r.data);
  ok((await dev.req('GET', '/api/games/cubes-2048/rewards/khong_co')).status === 404, 'Placement không khai báo → 404');
  r = await up({ ...good, 'gamehub.json': JSON.stringify({ ...goodManifest, version: '9.0.0', rewards: [{ placement: 'Bad Key', name: 'x', reward: { type: 'a', amount: 0 }, cooldownSec: -1 }] }) });
  ok(r.status === 422 && r.data.errors.filter(e => /rewards\[0\]/.test(e)).length >= 4, 'Khai báo rewards sai → báo lỗi từng trường', r.data.errors);
  ok((await dev.req('POST', '/api/admin/tasks', { body: { title: 'Hack', type: 'link', url: 'https://x.com' } })).status === 403, 'User thường không tạo được nhiệm vụ');
  ok((await admin.req('POST', '/api/admin/tasks', { body: { title: 'Link xấu', type: 'link', url: 'javascript:alert(1)' } })).status === 400, 'Link không phải http(s) bị từ chối');
  ok((await admin.req('POST', '/api/admin/tasks', { body: { title: 'Thiếu mã', type: 'link', url: 'https://x.com', verify: 'code' } })).status === 400, 'Nhiệm vụ cần mã mà không nhập mã → 400');
  r = await admin.req('POST', '/api/admin/tasks', { body: { title: 'Đọc bài FB có mã', type: 'facebook_post', url: 'https://www.facebook.com/gamehub/posts/1', durationSec: 2, verify: 'code', code: 'ABC123', dailyLimit: 2, priority: 50 } });
  ok(r.status === 200 && r.data.task.icon === 'newspaper', 'Admin tạo nhiệm vụ (icon tự động theo loại)', r.data);
  const taskId = r.data.task.id;
  r = await dev.req('GET', '/api/games/cubes-2048/rewards/power_boost');
  ok(r.data.tasks[0].id === taskId && !('code' in r.data.tasks[0]), 'Nhiệm vụ ưu tiên cao đứng đầu, không lộ mã cho người chơi');
  r = await dev.req('POST', '/api/games/cubes-2048/rewards/power_boost/start', { body: { taskId } });
  ok(r.status === 200 && r.data.runId > 0 && r.data.task.url.includes('facebook'), 'Bắt đầu nhiệm vụ', r.data);
  const runId = r.data.runId;
  r = await dev.req('POST', `/api/games/cubes-2048/rewards/runs/${runId}/claim`, { body: { code: 'ABC123' } });
  ok(r.status === 400 && r.data.remainingSec > 0, 'Nhận thưởng quá sớm → bị chặn, báo số giây còn lại', r.data);
  await wait(2100);
  ok((await stranger.req('POST', `/api/games/cubes-2048/rewards/runs/${runId}/claim`, { body: { code: 'ABC123' } })).status === 404, 'Người khác không nhận được thưởng của lượt này');
  r = await dev.req('POST', `/api/games/cubes-2048/rewards/runs/${runId}/claim`, { body: { code: 'sai-ma' } });
  ok(r.status === 400 && r.data.badCode, 'Sai mã xác nhận → 400');
  const xpBefore = (await dev.req('GET', '/api/me')).data.user.xp;
  r = await dev.req('POST', `/api/games/cubes-2048/rewards/runs/${runId}/claim`, { body: { code: ' abc123 ' } });
  ok(r.data.rewarded === true && r.data.reward.amount === 10 && /^[a-f0-9]{64}$/.test(r.data.token), 'Đúng mã (không phân biệt hoa thường) → nhận thưởng + token', r.data);
  ok((await dev.req('GET', '/api/me')).data.user.xp === xpBefore + 2, 'Hoàn thành nhiệm vụ được +2 XP');
  ok((await dev.req('POST', `/api/games/cubes-2048/rewards/runs/${runId}/claim`, { body: { code: 'ABC123' } })).status === 409, 'Không nhận lại lần 2 cùng một lượt');
  r = await dev.req('GET', '/api/games/cubes-2048/rewards/power_boost');
  ok(!r.data.available && r.data.reason === 'cooldown' && r.data.retryAfterSec > 30, 'Cooldown của placement (40 giây)', r.data);
  ok((await dev.req('POST', '/api/games/cubes-2048/rewards/power_boost/start', { body: { taskId } })).status === 409, 'Không bắt đầu được khi đang cooldown');
  // start_boost có cooldown 0 -> làm lại nhiệm vụ có mã tới khi chạm giới hạn 2 lần/ngày của nhiệm vụ
  r = await dev.req('POST', '/api/games/cubes-2048/rewards/start_boost/start', { body: { taskId } });
  await wait(2100);
  r = await dev.req('POST', `/api/games/cubes-2048/rewards/runs/${r.data.runId}/claim`, { body: { code: 'ABC123' } });
  ok(r.data.rewarded && r.data.reward.type === 'start_cube' && r.data.reward.amount === 16, 'Placement khác trả phần thưởng riêng (start_cube 16)', r.data);
  r = await dev.req('GET', '/api/games/cubes-2048/rewards/start_boost');
  ok(r.data.available && !r.data.tasks.some(t => t.id === taskId), 'Nhiệm vụ đạt giới hạn 2 lần/ngày thì không còn hiện', r.data.tasks);
  // hủy lượt
  r = await dev.req('POST', '/api/games/cubes-2048/rewards/start_boost/start', { body: { taskId: r.data.tasks[0].id } });
  ok((await dev.req('POST', `/api/games/cubes-2048/rewards/runs/${r.data.runId}/cancel`)).data.ok, 'Hủy lượt nhiệm vụ');
  ok((await dev.req('POST', `/api/games/cubes-2048/rewards/runs/${r.data.runId}/claim`, {})).status === 409, 'Lượt đã hủy không nhận thưởng được');
  // cài đặt chung
  ok((await anon.req('GET', '/api/games/cubes-2048/rewards/revive')).data.available === true, 'Khách làm được nhiệm vụ (mặc định)');
  ok((await dev.req('PUT', '/api/admin/settings/rewards', { body: { enabled: false } })).status === 403, 'User thường không đổi được cài đặt');
  await admin.req('PUT', '/api/admin/settings/rewards', { body: { guestsAllowed: false } });
  ok((await anon.req('GET', '/api/games/cubes-2048/rewards/revive')).data.reason === 'login', 'Tắt cho khách → khách nhận lý do "login"');
  await admin.req('PUT', '/api/admin/settings/rewards', { body: { dailyCapPerViewer: 2 } });
  ok((await dev.req('GET', '/api/games/cubes-2048/rewards/revive')).data.reason === 'limit', 'Giới hạn chung mỗi người/ngày → "limit"');
  await admin.req('PUT', '/api/admin/settings/rewards', { body: { testMode: true } });
  r = await dev.req('GET', '/api/games/cubes-2048/rewards/revive');
  ok(r.data.available && r.data.testMode && r.data.tasks.every(t => t.durationSec <= 5), 'Chế độ thử nghiệm: bỏ giới hạn lượt, chờ tối đa 5 giây', r.data);
  await admin.req('PUT', '/api/admin/settings/rewards', { body: { testMode: false } });
  ok((await dev.req('GET', '/api/games/cubes-2048/rewards/revive')).data.reason === 'limit', 'Tắt chế độ thử nghiệm → giới hạn có hiệu lực lại');
  await admin.req('PUT', '/api/admin/settings/rewards', { body: { enabled: false } });
  ok((await dev.req('GET', '/api/games/cubes-2048/rewards/revive')).data.reason === 'disabled', 'Tắt toàn bộ → "disabled"');
  await admin.req('PUT', '/api/admin/settings/rewards', { body: { enabled: true, guestsAllowed: true, dailyCapPerViewer: 30 } });
  r = await admin.req('GET', '/api/admin/tasks');
  const at = r.data.tasks.find(t => t.id === taskId);
  ok(at && at.stats.completed === 2 && at.code === 'ABC123', 'Admin thấy thống kê 7 ngày và mã của nhiệm vụ', at && at.stats);
  ok((await admin.req('PUT', `/api/admin/tasks/${taskId}`, { body: { ...at, active: false } })).data.task.active === false, 'Admin tắt nhiệm vụ');
  ok(!(await anon.req('GET', '/api/games/cubes-2048/rewards/revive')).data.tasks.some(t => t.id === taskId), 'Nhiệm vụ đã tắt không còn hiện');
  ok((await admin.req('DELETE', `/api/admin/tasks/${taskId}`)).data.ok, 'Admin xóa nhiệm vụ');

  console.log('\n[Quản lý người dùng]');
  r = await admin.req('GET', '/api/admin/users');
  const du = r.data.users.find(u => u.username === uname);
  ok((await admin.req('POST', `/api/admin/users/${du.id}`, { body: { banned: true } })).data.ok, 'Admin khóa tài khoản');
  ok((await dev.req('GET', '/api/me')).data.user === null, 'Tài khoản bị khóa mất phiên đăng nhập');
  ok((await anon.req('POST', '/api/auth/login', { body: { username: uname, password: 'matkhau123' } })).status === 403, 'Tài khoản bị khóa không đăng nhập được');
  await admin.req('POST', `/api/admin/users/${du.id}`, { body: { banned: false } });

  console.log(`\nKết quả: ${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('Lỗi chạy test:', e); process.exit(1); });
