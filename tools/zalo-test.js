#!/usr/bin/env node
'use strict';
// Kiểm thử đăng nhập Zalo + CORS: node tools/zalo-test.js
// Tự dựng Graph API giả ở cổng 8093. Server thử nghiệm phải chạy với:
//   ZALO_GRAPH_URL=http://127.0.0.1:8093/me CORS_ORIGINS=http://localhost:3000 ZALO_APP_SECRET=zsecret
const http = require('node:http');
const crypto = require('node:crypto');

const BASE = process.env.BASE || 'http://localhost:8091';
const ORIGIN = 'http://localhost:3000';
const run = Date.now().toString(36);
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) { pass++; console.log('  ✔', name); } else { fail++; console.log('  ✖', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

// Graph API giả: token "good-<id>" → người dùng <id>; còn lại → lỗi như Zalo
const seen = [];
const graph = http.createServer((req, res) => {
  const tok = req.headers.access_token || '';
  seen.push({ tok, proof: req.headers.appsecret_proof, url: req.url });
  const m = /^good-(\d+)$/.exec(tok);
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(m ? { id: m[1], name: `Zalo User ${m[1].slice(-4)}`, error: 0, message: 'Success' } : { error: 452, message: 'Session key invalid' }));
});

async function call(method, path, { body, token, origin = ORIGIN, headers = {} } = {}) {
  const h = { Origin: origin, 'X-GH': '1', ...headers };
  if (token) h.Authorization = `Bearer ${token}`;
  if (body) h['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers: h, body: body && JSON.stringify(body) });
  const text = await res.text();
  let data; try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

(async () => {
  await new Promise(r => graph.listen(8093, '127.0.0.1', r));
  const zid = String(Date.now()) + String(Math.floor(Math.random() * 1000));

  console.log('[CORS]');
  const pre = await fetch(BASE + '/api/auth/zalo', { method: 'OPTIONS', headers: { Origin: ORIGIN, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'authorization,content-type,x-gh' } });
  ok(pre.status === 204 && pre.headers.get('access-control-allow-origin') === ORIGIN, 'Preflight từ nguồn được phép → 204 + Allow-Origin', pre.status);
  ok(/authorization/i.test(pre.headers.get('access-control-allow-headers') || '') && /x-gh/i.test(pre.headers.get('access-control-allow-headers') || ''), 'Cho phép header Authorization và X-GH');
  const preBad = await fetch(BASE + '/api/auth/zalo', { method: 'OPTIONS', headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'POST' } });
  ok(preBad.status === 403 && !preBad.headers.get('access-control-allow-origin'), 'Nguồn lạ bị từ chối', preBad.status);
  const g = await call('GET', '/api/games');
  ok(g.status === 200 && g.headers.get('access-control-allow-origin') === ORIGIN, 'GET /api/games trả Allow-Origin cho Mini App');
  const ev = await call('GET', '/api/games', { origin: 'https://evil.example' });
  ok(!ev.headers.get('access-control-allow-origin'), 'Không trả Allow-Origin cho nguồn lạ');
  const csp = (await fetch(BASE + '/g/chess/')).headers.get('content-security-policy') || '';
  ok(/frame-ancestors 'self' http:\/\/localhost:3000/.test(csp), 'Game cho phép Mini App nhúng iframe (frame-ancestors)', csp.match(/frame-ancestors[^;]*/));

  console.log('[Đăng nhập Zalo]');
  const bad = await call('POST', '/api/auth/zalo', { body: { accessToken: 'expired-token' } });
  ok(bad.status === 401, 'Token Zalo sai → 401', bad);
  const empty = await call('POST', '/api/auth/zalo', { body: {} });
  ok(empty.status === 400, 'Thiếu token → 400', empty.status);
  const r1 = await call('POST', '/api/auth/zalo', { body: { accessToken: `good-${zid}` } });
  ok(r1.status === 200 && /^[a-f0-9]{64}$/.test(r1.data.token || ''), 'Token đúng → tạo tài khoản + trả token phiên', r1.data);
  ok(r1.data.user && /^z_[a-f0-9]{12}$/.test(r1.data.user.username) && r1.data.user.displayName === `Zalo User ${zid.slice(-4)}`, 'Tài khoản dùng tên Zalo, username tự sinh', r1.data.user);
  ok(!r1.headers.get('set-cookie'), 'Không đặt cookie (Mini App dùng header)');
  const last = seen[seen.length - 1];
  ok(last && last.proof === crypto.createHmac('sha256', 'zsecret').update(`good-${zid}`).digest('hex'), 'Gửi appsecret_proof đúng cho Graph API', last);
  ok(last && /fields=id,name/.test(last.url), 'Chỉ xin id + tên từ Zalo');

  const r2 = await call('POST', '/api/auth/zalo', { body: { accessToken: `good-${zid}` } });
  ok(r2.status === 200 && r2.data.user.id === r1.data.user.id && r2.data.token !== r1.data.token, 'Đăng nhập lại → cùng tài khoản, phiên mới');

  console.log('[Token phiên qua header]');
  const me = await call('GET', '/api/me', { token: r1.data.token });
  ok(me.data.user && me.data.user.id === r1.data.user.id, 'GET /api/me nhận ra người dùng qua Bearer', me.data);
  const anon = await call('GET', '/api/me', { token: 'f'.repeat(64) });
  ok(anon.data.user === null, 'Token lạ → khách');
  const patch = await call('PATCH', '/api/me', { token: r1.data.token, body: { displayName: `Zalo ${run}`.slice(0, 24) } });
  ok(patch.status === 200, 'Sửa hồ sơ bằng token header', patch.data);
  const pw = await call('POST', '/api/auth/login', { body: { username: r1.data.user.username, password: 'whatever123' } });
  ok(pw.status === 401, 'Tài khoản Zalo không đăng nhập được bằng mật khẩu', pw.status);
  const tk = await call('GET', '/api/games/chess/realtime-ticket', { token: r1.data.token });
  ok(tk.status === 200 && tk.data.ticket, 'Xin vé chơi online bằng token header', tk.data);
  const out = await call('POST', '/api/auth/logout', { token: r1.data.token });
  ok(out.status === 200, 'Đăng xuất bằng token header');
  const me2 = await call('GET', '/api/me', { token: r1.data.token });
  ok(me2.data.user === null, 'Sau đăng xuất token hết hiệu lực');

  graph.close();
  console.log(`Kết quả: ${pass} đạt, ${fail} lỗi`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
