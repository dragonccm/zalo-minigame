#!/usr/bin/env node
'use strict';
// Kiểm thử phân quyền quản trị: node tools/admin-test.js   (cần server test: GAMEHUB_TEST=1, ADMIN_PASS khớp)
// Chạy trên server MỚI: test tạo 3 tài khoản, mà đăng ký chỉ cho 5 lần/giờ/IP nên chạy lại trên cùng server sẽ bị 429.
const BASE = process.env.BASE || 'http://localhost:8091';
const ADMIN = { username: process.env.ADMIN_USER || 'admin', password: process.env.ADMIN_PASS || 'AdminPass123' };
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✖', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

class Client {
  constructor(label) { this.label = label; this.cookie = ''; }
  async req(method, url, body) {
    const h = { 'X-GH': '1' };
    if (this.cookie) h.Cookie = this.cookie;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    const res = await fetch(BASE + url, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const sc = res.headers.get('set-cookie');
    if (sc) { const c = sc.split(';')[0]; this.cookie = c.endsWith('=') ? '' : c; }
    const text = await res.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: res.status, data };
  }
}
const newUser = async name => {
  const c = new Client(name);
  const u = `${name}${run}`.slice(0, 20).replace(/[^a-zA-Z0-9_]/g, '');
  const r = await c.req('POST', '/api/auth/register', { username: u, password: 'Testpass123', displayName: name });
  return { c, id: r.data.user.id, username: u };
};

(async () => {
  const admin = new Client('admin');
  const la = await admin.req('POST', '/api/auth/login', { username: ADMIN.username, password: ADMIN.password });
  const adminId = la.data.user.id;
  ok(la.status === 200 && la.data.user.capabilities.includes('manage_roles'), 'Admin đăng nhập, có đủ năng lực', la.data.user && la.data.user.capabilities);

  const mod = await newUser('mod'), usr = await newUser('usr'), other = await newUser('oth');
  ok((await admin.req('POST', `/api/admin/users/${mod.id}`, { role: 'moderator' })).status === 200, 'Admin nâng một người thành moderator');
  const lm = await mod.c.req('POST', '/api/auth/login', { username: mod.username, password: 'Testpass123' });
  ok(lm.data.user.role === 'moderator' && lm.data.user.capabilities.includes('review_games') && !lm.data.user.capabilities.includes('manage_roles'), 'Moderator có năng lực duyệt, không có quyền đổi vai trò', lm.data.user && lm.data.user.capabilities);

  console.log('[Người thường]');
  const u1 = await usr.c.req('GET', '/api/admin/stats');
  ok(u1.status === 403, 'User thường không xem được thống kê admin → 403', u1.status);
  ok((await usr.c.req('GET', '/api/admin/users')).status === 403, 'User thường không xem danh sách người dùng → 403');
  ok((await usr.c.req('POST', `/api/admin/users/${other.id}`, { banned: true })).status === 403, 'User thường không khoá được người khác → 403');

  console.log('[Moderator]');
  ok((await mod.c.req('GET', '/api/admin/stats')).status === 200, 'Moderator xem được thống kê');
  ok((await mod.c.req('GET', '/api/admin/submissions?status=pending')).status === 200, 'Moderator xem được bản gửi duyệt');
  ok((await mod.c.req('GET', '/api/admin/tasks')).status === 200, 'Moderator quản lý được nhiệm vụ');
  ok((await mod.c.req('GET', '/api/admin/audit')).status === 200, 'Moderator xem được nhật ký');
  const mr = await mod.c.req('POST', `/api/admin/users/${other.id}`, { role: 'moderator' });
  ok(mr.status === 403, 'Moderator không tự phong moderator → 403', mr.status);
  const mt = await mod.c.req('POST', '/api/admin/config/test-mode', { testMode: true });
  ok(mt.status === 403, 'Moderator không bật được chế độ thử nghiệm → 403', mt.status);
  const mb = await mod.c.req('POST', `/api/admin/users/${other.id}`, { banned: true });
  ok(mb.status === 200 && mb.data.user.banned === true, 'Moderator khoá được người chơi thường');
  ok((await mod.c.req('POST', `/api/admin/users/${adminId}`, { banned: true })).status === 403, 'Moderator không khoá được admin → 403');
  ok((await mod.c.req('POST', `/api/admin/users/${mod.id}`, { banned: true })).status === 400, 'Không tự khoá chính mình');
  const ub = await admin.req('POST', `/api/admin/users/${other.id}`, { banned: false });
  ok(ub.status === 200 && ub.data.user.banned === false, 'Admin mở khoá được tài khoản');

  console.log('[Admin]');
  const ur = await admin.req('POST', `/api/admin/users/${other.id}`, { role: 'moderator' });
  ok(ur.status === 200 && ur.data.user.role === 'moderator', 'Admin đổi vai trò người dùng');
  ok((await admin.req('POST', `/api/admin/users/${adminId}`, { role: 'user' })).status === 400, 'Admin không tự hạ quyền của chính mình → 400');
  ok((await admin.req('POST', `/api/admin/users/${other.id}`, { role: 'superuser' })).status === 400, 'Vai trò không hợp lệ → 400');
  const tm = await admin.req('POST', '/api/admin/config/test-mode', { testMode: true });
  ok(tm.status === 200 && tm.data.testMode === true, 'Admin bật chế độ thử nghiệm');
  ok((await admin.req('POST', '/api/admin/config/test-mode', { testMode: false })).status === 200, 'Admin tắt chế độ thử nghiệm');
  const list = await admin.req('GET', `/api/admin/users?q=${encodeURIComponent(mod.username)}`);
  ok(list.status === 200 && list.data.users.some(u => u.id === mod.id), 'Tìm người dùng theo tên');
  const byRole = await admin.req('GET', '/api/admin/users?role=moderator');
  ok(byRole.data.users.every(u => u.role === 'moderator'), 'Lọc theo vai trò');
  const roles = await admin.req('GET', '/api/admin/roles');
  ok(roles.status === 200 && roles.data.roles.length === 3, 'Xem ma trận quyền');
  const audit = await admin.req('GET', '/api/admin/audit');
  ok(audit.data.entries.some(e => e.action === 'user.role' && String(e.target) === String(mod.id)), 'Đổi vai trò được ghi nhật ký');
  ok(audit.data.entries.some(e => e.action === 'user.ban'), 'Khoá tài khoản được ghi nhật ký');

  console.log('[Khoá phiên]');
  const ban = await admin.req('POST', `/api/admin/users/${usr.id}`, { banned: true });
  ok(ban.status === 200, 'Admin khoá người dùng');
  const after = await usr.c.req('GET', '/api/me');
  ok(after.data.user === null, 'Phiên của người bị khoá hết hiệu lực');

  console.log(`Kết quả: ${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
