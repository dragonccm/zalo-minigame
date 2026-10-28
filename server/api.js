'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const db = require('./db');
const { subkey } = require('./env');
const { readZip, stripRoot, LIMITS } = require('./zip');
const { validatePackage, CATEGORIES } = require('./validate');

const { q, one, many, tx, ms } = db;
const scrypt = promisify(crypto.scrypt);
const SECURE = process.env.COOKIE_SECURE === '1';
const now = () => Date.now();
const iso = t => new Date(t).toISOString();
const GAMES_DIR = path.join(db.DATA, 'games');
const SUBS_DIR = path.join(db.DATA, 'submissions');
const ROOMS_DIR = path.join(__dirname, 'rooms');
const DAY = 86400e3;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
const bad = (m, extra) => new HttpError(400, m, extra);

// ---------- tiện ích ----------
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
const b64u = b => Buffer.from(b).toString('base64url');
const hmac = (purpose, data) => crypto.createHmac('sha256', subkey(purpose)).update(data).digest();
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };

async function hashPw(pw) {
  const salt = crypto.randomBytes(16);
  return `s1$${salt.toString('hex')}$${(await scrypt(pw, salt, 32)).toString('hex')}`;
}
async function checkPw(pw, stored) {
  const [v, s, h] = String(stored).split('$');
  if (v !== 's1' || !s || !h) return false;          // tài khoản Zalo: không có mật khẩu
  const a = await scrypt(pw, Buffer.from(s, 'hex'), 32), b = Buffer.from(h, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const hits = new Map();
function rate(key, max, windowMs) {
  const t = now();
  const arr = (hits.get(key) || []).filter(x => t - x < windowMs);
  if (arr.length >= max) { hits.set(key, arr); throw new HttpError(429, 'Thao tác quá nhanh, vui lòng thử lại sau ít phút'); }
  arr.push(t); hits.set(key, arr);
}
setInterval(() => {
  const t = now();
  for (const [k, v] of hits) if (!v.length || t - v[v.length - 1] > 3600e3) hits.delete(k);
  q('DELETE FROM sessions WHERE expires_at < now()').catch(e => console.error('[db] dọn phiên:', e.message));
}, 600e3).unref();

const level = xp => Math.floor(Math.sqrt(xp / 20)) + 1;
function userDto(u) {
  const l = level(u.xp), lo = 20 * (l - 1) ** 2, hi = 20 * l ** 2;
  return {
    id: u.id, username: u.username, displayName: u.display_name, avatar: u.avatar, bio: u.bio,
    role: u.role, xp: u.xp, level: l, levelProgress: { current: u.xp - lo, needed: hi - lo }, createdAt: ms(u.created_at),
  };
}
const pubUser = u => ({ username: u.username, displayName: u.display_name, avatar: u.avatar });
const addXp = (userId, n, run = q) => (n > 0 ? run('UPDATE users SET xp = xp + $1 WHERE id = $2', [n, userId]) : null);
const audit = (actorId, action, target, data = {}) =>
  q('INSERT INTO audit_log (actor_id, action, target, data) VALUES ($1, $2, $3, $4::jsonb)', [actorId, action, String(target), JSON.stringify(data)])
    .catch(e => console.error('[audit]', e.message));

function gameDto(g, full) {
  const m = g.manifest;
  const d = {
    slug: g.slug, name: g.name, description: g.description, version: g.version, author: m.author,
    owner: { username: g.owner_username, displayName: g.owner_name },
    categories: m.categories, orientation: m.orientation, controls: m.controls, scoring: m.scoring,
    multiplayer: m.multiplayer || null,
    plays: g.plays, status: g.status, builtin: g.builtin, createdAt: ms(g.created_at), updatedAt: ms(g.updated_at),
    thumbnail: m.thumbnail ? `/g/${g.slug}/${m.thumbnail}` : null,
  };
  if (full) { d.achievements = m.achievements; d.permissions = m.permissions; d.rewards = m.rewards || []; d.entry = `/g/${g.slug}/${m.entry}`; }
  return d;
}
const GAME_SQL = `SELECT g.*, u.username AS owner_username, u.display_name AS owner_name FROM games g JOIN users u ON u.id = g.owner_id`;
async function liveGame(slug) {
  const g = await one(`${GAME_SQL} WHERE g.slug = $1`, [String(slug)]);
  if (!g || g.status !== 'live') throw new HttpError(404, 'Không tìm thấy game');
  return g;
}

// ---------- router ----------
const routes = [];
function route(method, pattern, handler) {
  const keys = [];
  const re = new RegExp('^' + pattern.replace(/:(\w+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, re, keys, handler });
}
const needUser = ctx => { if (!ctx.user) throw new HttpError(401, 'Bạn cần đăng nhập'); return ctx.user; };
const needAdmin = ctx => { if (needUser(ctx).role !== 'admin') throw new HttpError(403, 'Chỉ dành cho quản trị viên'); return ctx.user; };

function parseCookies(h) {
  const out = {};
  for (const p of (h || '').split(';')) { const i = p.indexOf('='); if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); }
  return out;
}
// Token phiên: cookie (web) hoặc header "Authorization: Bearer ..." (Zalo Mini App — webview chặn cookie khác tên miền)
const sessionToken = req => {
  const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
  return m ? m[1] : parseCookies(req.headers.cookie).gh_session;
};
async function currentUser(req) {
  const tok = sessionToken(req);
  if (!tok) return null;
  const u = await one(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = $1 AND s.expires_at > now()`, [sha(tok)]);
  if (!u || u.banned) return null;
  if (!u.last_seen_at || now() - ms(u.last_seen_at) > 300e3) q('UPDATE users SET last_seen_at = now() WHERE id = $1', [u.id]).catch(() => {});
  return u;
}
async function startSession(ctx, userId, { cookie = true } = {}) {
  const tok = crypto.randomBytes(32).toString('hex');
  await q(`INSERT INTO sessions (token_hash, user_id, expires_at, ip, user_agent) VALUES ($1, $2, now() + interval '30 days', $3, $4)`,
    [sha(tok), userId, ctx.ip, String(ctx.req.headers['user-agent'] || '').slice(0, 200)]);
  if (cookie) ctx.res.setHeader('Set-Cookie', `gh_session=${tok}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${30 * 86400}${SECURE ? '; Secure' : ''}`);
  return tok;
}

function readRaw(req, max) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => {
      n += c.length;
      if (n > max) { reject(new HttpError(413, 'Dữ liệu gửi lên quá lớn')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req, max = 70 * 1024) {
  const buf = await readRaw(req, max);
  if (!buf.length) return {};
  try { const v = JSON.parse(buf.toString('utf8')); return v && typeof v === 'object' ? v : {}; }
  catch { throw bad('JSON không hợp lệ'); }
}
const clientIp = req => (process.env.TRUST_PROXY === '1' && req.headers['x-forwarded-for'])
  ? String(req.headers['x-forwarded-for']).split(',')[0].trim() : req.socket.remoteAddress;

async function handleApi(req, res, url) {
  const send = (status, body) => {
    const s = JSON.stringify(body);
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': Buffer.byteLength(s) });
    res.end(s);
  };
  try {
    const ctx = {
      req, res, url, params: {}, query: Object.fromEntries(url.searchParams), ip: clientIp(req),
      user: await currentUser(req), json: () => readJson(req), raw: max => readRaw(req, max),
    };
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['x-gh'] !== '1') throw new HttpError(403, 'Thiếu header X-GH (chống CSRF)');
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(url.pathname);
      if (!m) continue;
      r.keys.forEach((k, i) => { ctx.params[k] = decodeURIComponent(m[i + 1]); });
      const out = await r.handler(ctx);
      if (out !== undefined) send(200, out);
      return;
    }
    throw new HttpError(404, 'API không tồn tại');
  } catch (e) {
    if (e instanceof HttpError) return send(e.status, { error: e.message, ...(e.extra || {}) });
    if (e && e.code === '23505') return send(409, { error: 'Dữ liệu bị trùng' });          // unique violation
    console.error('[api]', req.method, url.pathname, e);
    send(500, { error: 'Lỗi máy chủ' });
  }
}

// ======================= AUTH =======================
route('POST', '/api/auth/register', async ctx => {
  rate(`reg:${ctx.ip}`, 5, 3600e3);
  const b = await ctx.json();
  const username = String(b.username || '').trim(), password = String(b.password || '');
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) throw bad('Tên đăng nhập gồm 3-20 ký tự: chữ, số, dấu _');
  if (password.length < 8 || password.length > 100) throw bad('Mật khẩu cần từ 8 ký tự');
  const display = String(b.displayName || username).trim().slice(0, 24) || username;
  if (await one('SELECT 1 FROM users WHERE lower(username) = lower($1)', [username])) throw new HttpError(409, 'Tên đăng nhập đã tồn tại');
  const u = await one('INSERT INTO users (username, display_name, pass_hash) VALUES ($1, $2, $3) RETURNING *', [username, display, await hashPw(password)]);
  await startSession(ctx, u.id);
  return { user: userDto(u) };
});

route('POST', '/api/auth/login', async ctx => {
  const b = await ctx.json();
  const username = String(b.username || '').trim();
  rate(`login:${ctx.ip}:${username.toLowerCase()}`, 8, 600e3);
  const u = await one('SELECT * FROM users WHERE lower(username) = lower($1)', [username]);
  if (!u || !(await checkPw(String(b.password || ''), u.pass_hash))) throw new HttpError(401, 'Sai tên đăng nhập hoặc mật khẩu');
  if (u.banned) throw new HttpError(403, 'Tài khoản đã bị khóa');
  await startSession(ctx, u.id);
  return { user: userDto(u) };
});

// Zalo Mini App: client gửi access token lấy từ zmp-sdk getAccessToken(); máy chủ hỏi Graph API của Zalo để biết ID người dùng.
// Trả về token phiên để client gửi qua header Authorization (không dùng cookie).
const ZALO_GRAPH_URL = process.env.ZALO_GRAPH_URL || 'https://graph.zalo.me/v2.0/me';
async function zaloProfile(accessToken) {
  const headers = { access_token: accessToken };
  if (process.env.ZALO_APP_SECRET) {
    headers.appsecret_proof = crypto.createHmac('sha256', process.env.ZALO_APP_SECRET).update(accessToken).digest('hex');
  }
  let r;
  try {
    const res = await fetch(`${ZALO_GRAPH_URL}?fields=id,name`, { headers, signal: AbortSignal.timeout(8000) });
    r = await res.json();
  } catch (e) {
    console.error('[zalo] graph:', e.message);
    throw new HttpError(502, 'Không kết nối được Zalo, thử lại sau');
  }
  if (!r || r.error || !/^\d{1,32}$/.test(String(r.id || ''))) {
    if (r && r.error) console.warn('[zalo] graph lỗi:', r.error, r.message);
    throw new HttpError(401, 'Phiên Zalo không hợp lệ');
  }
  return { id: String(r.id), name: typeof r.name === 'string' ? r.name : '' };
}

route('POST', '/api/auth/zalo', async ctx => {
  rate(`zalo:${ctx.ip}`, 30, 600e3);
  const b = await ctx.json();
  const token = String(b.accessToken || '');
  if (!token || token.length > 2000) throw bad('Thiếu access token Zalo');
  const z = await zaloProfile(token);
  let u = await one('SELECT * FROM users WHERE zalo_id = $1', [z.id]);
  if (!u) {
    const username = 'z_' + sha(z.id).slice(0, 12);
    const display = z.name.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 24) || 'Người chơi';
    u = await one(`INSERT INTO users (username, display_name, pass_hash, zalo_id) VALUES ($1, $2, '!', $3)
      ON CONFLICT (zalo_id) WHERE zalo_id IS NOT NULL DO UPDATE SET zalo_id = EXCLUDED.zalo_id RETURNING *`, [username, display, z.id]);
  }
  if (u.banned) throw new HttpError(403, 'Tài khoản đã bị khóa');
  const tok = await startSession(ctx, u.id, { cookie: false });
  return { user: userDto(u), token: tok };
});

route('POST', '/api/auth/logout', async ctx => {
  const tok = sessionToken(ctx.req);
  if (tok) await q('DELETE FROM sessions WHERE token_hash = $1', [sha(tok)]);
  ctx.res.setHeader('Set-Cookie', 'gh_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0');
  return { ok: true };
});

route('GET', '/api/me', ctx => ({ user: ctx.user ? userDto(ctx.user) : null }));

route('PATCH', '/api/me', async ctx => {
  const u = needUser(ctx), b = await ctx.json();
  const display = b.displayName === undefined ? u.display_name : String(b.displayName).trim().slice(0, 24);
  if (!display) throw bad('Tên hiển thị không được để trống');
  const avatar = b.avatar === undefined ? u.avatar : String(b.avatar).trim();
  if (!ICON_NAME.test(avatar) || avatar.length > 40) throw bad('Avatar không hợp lệ');
  const bio = b.bio === undefined ? u.bio : String(b.bio).slice(0, 200);
  const nu = await one('UPDATE users SET display_name = $1, avatar = $2, bio = $3 WHERE id = $4 RETURNING *', [display, avatar, bio, u.id]);
  return { user: userDto(nu) };
});

route('POST', '/api/me/password', async ctx => {
  const u = needUser(ctx), b = await ctx.json();
  rate(`pw:${u.id}`, 5, 600e3);
  if (!(await checkPw(String(b.oldPassword || ''), u.pass_hash))) throw new HttpError(401, 'Mật khẩu cũ không đúng');
  const np = String(b.newPassword || '');
  if (np.length < 8 || np.length > 100) throw bad('Mật khẩu mới cần từ 8 ký tự');
  await q('UPDATE users SET pass_hash = $1 WHERE id = $2', [await hashPw(np), u.id]);
  await q('DELETE FROM sessions WHERE user_id = $1', [u.id]);
  await startSession(ctx, u.id);
  return { ok: true };
});

// ======================= GAMES =======================
route('GET', '/api/games', async ctx => {
  const { category, q: search, sort } = ctx.query;
  let rows = (await many(`${GAME_SQL} WHERE g.status = 'live'`)).map(g => gameDto(g, false));
  if (category && CATEGORIES.includes(category)) rows = rows.filter(g => g.categories.includes(category));
  if (search) { const s = String(search).toLowerCase(); rows = rows.filter(g => (g.name + ' ' + g.description + ' ' + g.author).toLowerCase().includes(s)); }
  rows.sort(sort === 'new' ? (a, b) => b.createdAt - a.createdAt : (a, b) => b.plays - a.plays);
  return { games: rows, categories: CATEGORIES };
});

const isAsc = g => !!(g.manifest.scoring && g.manifest.scoring.order === 'asc');
async function bestScore(g, userId) {
  const r = await one(`SELECT ${isAsc(g) ? 'MIN' : 'MAX'}(score) AS b FROM scores WHERE game_id = $1 AND user_id = $2`, [g.id, userId]);
  return r && r.b !== null ? r.b : null;
}
async function rankOf(g, score, since = 0) {
  const asc = isAsc(g);
  const r = await one(`SELECT COUNT(*) AS n FROM (SELECT ${asc ? 'MIN' : 'MAX'}(score) AS b FROM scores WHERE game_id = $1 AND created_at >= $2::timestamptz GROUP BY user_id) t
                       WHERE b ${asc ? '<' : '>'} $3`, [g.id, iso(since), score]);
  return r.n + 1;
}

route('GET', '/api/games/:slug', async ctx => {
  const g = await liveGame(ctx.params.slug);
  const dto = gameDto(g, true);
  if (ctx.user) {
    dto.me = {
      unlocked: (await many('SELECT key, unlocked_at FROM user_achievements WHERE user_id = $1 AND game_id = $2', [ctx.user.id, g.id])).map(r => ({ key: r.key, at: ms(r.unlocked_at) })),
      best: await bestScore(g, ctx.user.id),
    };
  }
  const st = await one(`SELECT (SELECT COUNT(DISTINCT user_id) FROM scores WHERE game_id = $1) AS players,
                               (SELECT COUNT(*) FROM user_achievements WHERE game_id = $1) AS ach,
                               (SELECT COUNT(*) FROM matches WHERE game_id = $1) AS matches`, [g.id]);
  dto.stats = { players: st.players, achievementsUnlocked: st.ach, matches: st.matches };
  return { game: dto };
});

const PERIODS = { all: 0, week: 7 * DAY, day: DAY };
route('GET', '/api/games/:slug/leaderboard', async ctx => {
  const g = await liveGame(ctx.params.slug);
  const period = PERIODS[ctx.query.period] === undefined ? 'all' : ctx.query.period;
  const since = period === 'all' ? 0 : now() - PERIODS[period];
  const limit = Math.min(50, Math.max(1, parseInt(ctx.query.limit, 10) || 20));
  const agg = isAsc(g) ? 'MIN' : 'MAX';
  const rows = await many(`SELECT u.username, u.display_name, u.avatar, ${agg}(s.score) AS score FROM scores s JOIN users u ON u.id = s.user_id
      WHERE s.game_id = $1 AND s.created_at >= $2::timestamptz AND NOT u.banned GROUP BY u.id
      ORDER BY score ${agg === 'MIN' ? 'ASC' : 'DESC'}, MIN(s.created_at) ASC LIMIT $3`, [g.id, iso(since), limit]);
  const out = { period, entries: rows.map((r, i) => ({ rank: i + 1, user: pubUser(r), score: r.score })) };
  if (ctx.user) {
    const r = await one(`SELECT ${agg}(score) AS b FROM scores WHERE game_id = $1 AND user_id = $2 AND created_at >= $3::timestamptz`, [g.id, ctx.user.id, iso(since)]);
    if (r && r.b !== null) out.me = { rank: await rankOf(g, r.b, since), score: r.b };
  }
  return out;
});

route('POST', '/api/games/:slug/play', async ctx => {
  const g = await liveGame(ctx.params.slug);
  rate(`play:${ctx.user ? ctx.user.id : ctx.ip}`, 60, 3600e3);
  const r = await tx(async t => {
    await t('UPDATE games SET plays = plays + 1 WHERE id = $1', [g.id]);
    return (await t('INSERT INTO plays (user_id, game_id) VALUES ($1, $2) RETURNING id', [ctx.user ? ctx.user.id : null, g.id])).rows[0];
  });
  return { playId: r.id };
});

route('POST', '/api/games/:slug/play/:id/end', async ctx => {
  const g = await liveGame(ctx.params.slug);
  const p = await one('SELECT * FROM plays WHERE id = $1 AND game_id = $2', [Number(ctx.params.id) || 0, g.id]);
  if (!p || p.ended_at || (p.user_id || null) !== (ctx.user ? ctx.user.id : null)) return { ok: false };
  const r = await one(`UPDATE plays SET ended_at = now(), duration_sec = LEAST(21600, EXTRACT(EPOCH FROM now() - started_at)::int)
                       WHERE id = $1 RETURNING duration_sec`, [p.id]);
  if (p.user_id) await addXp(p.user_id, Math.min(10, Math.floor(r.duration_sec / 60)));
  return { ok: true, duration: r.duration_sec };
});

// Lưu điểm — dùng chung cho API (client gửi) và phòng multiplayer (server tự tính, source = 'server')
async function recordScore(g, userId, score, meta, source = 'client') {
  const prev = await bestScore(g, userId);
  const asc = isAsc(g);
  const isBest = prev === null || (asc ? score < prev : score > prev);
  await q('INSERT INTO scores (game_id, user_id, score, meta, source) VALUES ($1, $2, $3, $4::jsonb, $5)', [g.id, userId, score, JSON.stringify(meta || {}), source]);
  await addXp(userId, prev === null ? 10 : isBest ? 5 : 1);
  const best = isBest ? score : prev;
  return { saved: true, best, isNewBest: isBest, rank: await rankOf(g, best, 0) };
}

route('POST', '/api/games/:slug/score', async ctx => {
  const u = needUser(ctx), g = await liveGame(ctx.params.slug), m = g.manifest;
  if (!m.permissions.includes('leaderboard') || !m.scoring) throw new HttpError(403, 'Game không khai báo quyền leaderboard');
  if (m.multiplayer && m.multiplayer.mode === 'authoritative' && m.multiplayer.serverScores) throw new HttpError(403, 'Điểm của game này do máy chủ multiplayer ghi nhận');
  rate(`score:${u.id}:${g.id}`, 1, 2000);
  rate(`scorehr:${u.id}`, 120, 3600e3);
  const b = await ctx.json();
  const score = Number(b.score);
  if (b.score === null || b.score === '' || !isFinite(score) || score < -1e12 || score > 1e12) throw bad('Điểm không hợp lệ');
  if (m.scoring.max !== null && score > m.scoring.max) throw bad(`Điểm vượt giới hạn tối đa của game (${m.scoring.max})`);
  if (m.scoring.order === 'desc' && score < 0) throw bad('Điểm không được âm');
  let meta = {};
  if (b.meta && typeof b.meta === 'object') { if (JSON.stringify(b.meta).length > 2048) throw bad('meta quá lớn (tối đa 2KB)'); meta = b.meta; }
  return recordScore(g, u.id, score, meta, 'client');
});

route('POST', '/api/games/:slug/achievements/:key', async ctx => {
  const u = needUser(ctx), g = await liveGame(ctx.params.slug), m = g.manifest;
  if (!m.permissions.includes('achievements')) throw new HttpError(403, 'Game không khai báo quyền achievements');
  rate(`ach:${u.id}`, 60, 60e3);
  const a = m.achievements.find(x => x.key === ctx.params.key);
  if (!a) throw new HttpError(404, 'Thành tựu không có trong gamehub.json');
  const r = await q('INSERT INTO user_achievements (user_id, game_id, key) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [u.id, g.id, a.key]);
  const fresh = r.rowCount > 0;
  if (fresh) await addXp(u.id, a.points);
  return { saved: true, newlyUnlocked: fresh, achievement: a };
});

route('GET', '/api/games/:slug/save', async ctx => {
  const u = needUser(ctx), g = await liveGame(ctx.params.slug);
  const r = await one('SELECT data FROM saves WHERE user_id = $1 AND game_id = $2', [u.id, g.id]);
  return { data: r ? r.data : null };
});

route('PUT', '/api/games/:slug/save', async ctx => {
  const u = needUser(ctx), g = await liveGame(ctx.params.slug);
  if (!g.manifest.permissions.includes('save')) throw new HttpError(403, 'Game không khai báo quyền save');
  rate(`save:${u.id}:${g.id}`, 30, 60e3);
  const b = await ctx.json();
  const data = JSON.stringify(b.data === undefined ? null : b.data);
  if (data.length > 64 * 1024) throw new HttpError(413, 'Dữ liệu lưu tối đa 64KB');
  await q(`INSERT INTO saves (user_id, game_id, data) VALUES ($1, $2, $3::jsonb)
           ON CONFLICT (user_id, game_id) DO UPDATE SET data = excluded.data, updated_at = now()`, [u.id, g.id, data]);
  return { saved: true };
});

// ======================= NHIỆM VỤ NHẬN THƯỞNG =======================
// Game khai báo "rewards" trong gamehub.json; admin tạo nhiệm vụ (xem live TikTok, đọc bài Facebook...).
// requestReward(placement) -> người chơi chọn nhiệm vụ, mở link, đợi đủ thời gian (và nhập mã) -> nhận thưởng.
// icon = tên icon Lucide (https://lucide.dev), portal/game tự vẽ thành SVG
const TASK_TYPES = {
  tiktok_live: { label: 'Xem live TikTok', icon: 'radio' },
  tiktok_video: { label: 'Xem video TikTok', icon: 'music-2' },
  facebook_post: { label: 'Xem bài viết Facebook', icon: 'newspaper' },
  facebook_live: { label: 'Xem live Facebook', icon: 'video' },
  facebook_page: { label: 'Theo dõi trang Facebook', icon: 'thumbs-up' },
  youtube: { label: 'Xem YouTube', icon: 'circle-play' },
  instagram: { label: 'Xem Instagram', icon: 'camera' },
  zalo: { label: 'Quan tâm Zalo OA', icon: 'message-circle' },
  link: { label: 'Mở liên kết', icon: 'link' },
};
const ICON_NAME = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const iconOr = (v, def) => (typeof v === 'string' && v.length <= 40 && ICON_NAME.test(v) ? v : def);
// testMode: chế độ thử nghiệm cho admin/nhà phát triển — bỏ cooldown & giới hạn lượt, chờ tối đa 5 giây
const REWARD_DEFAULTS = { enabled: true, guestsAllowed: true, dailyCapPerViewer: 30, testMode: false };
const TEST_WAIT_SEC = 5;
async function rewardSettings() {
  const r = await one("SELECT value FROM settings WHERE key = 'rewards'");
  return { ...REWARD_DEFAULTS, ...(r ? r.value : {}) };
}
const viewerOf = (user, ip) => (user ? `u:${user.id}` : `g:${sha('ip:' + ip).slice(0, 32)}`);
const taskPublic = (t, test) => ({
  id: t.id, title: t.title, type: t.type, typeLabel: (TASK_TYPES[t.type] || TASK_TYPES.link).label, url: t.url,
  description: t.description, icon: iconOr(t.icon, (TASK_TYPES[t.type] || TASK_TYPES.link).icon),
  durationSec: test ? Math.min(t.duration_sec, TEST_WAIT_SEC) : t.duration_sec, verify: t.verify,
});
const placementDto = p => ({ placement: p.placement, name: p.name, description: p.description, reward: p.reward, cooldownSec: p.cooldownSec, dailyLimit: p.dailyLimit });
const rewardToken = (runId, slug, placement, viewer) => hmac('task', `${runId}.${slug}.${placement}.${viewer}`).toString('hex');

function placementOf(g, name) {
  const m = g.manifest;
  if (!m.permissions.includes('rewards')) throw new HttpError(403, 'Game không khai báo quyền "rewards"');
  const p = (m.rewards || []).find(r => r.placement === name);
  if (!p) throw new HttpError(404, `Placement "${name}" không có trong gamehub.json`);
  return p;
}

// Người chơi còn được nhận thưởng ở placement này không? Nếu có: danh sách nhiệm vụ có thể làm.
async function rewardOffer(user, viewer, g, p) {
  const s = await rewardSettings();
  const no = (reason, extra) => ({ available: false, reason, ...extra });
  if (!s.enabled) return no('disabled');
  if (!user && !s.guestsAllowed) return no('login');
  const st = await one(`SELECT
      MAX(completed_at) FILTER (WHERE game_id = $2 AND placement = $3) AS last,
      COUNT(*) FILTER (WHERE game_id = $2 AND placement = $3 AND completed_at > now() - interval '1 day') AS used_p,
      COUNT(*) FILTER (WHERE completed_at > now() - interval '1 day') AS used_all
    FROM task_runs WHERE viewer = $1 AND status = 'completed'`, [viewer, g.id, p.placement]);
  const last = ms(st.last), t = now(), test = !!s.testMode;
  if (!test && last && last + p.cooldownSec * 1000 > t) return no('cooldown', { retryAfterSec: Math.ceil((last + p.cooldownSec * 1000 - t) / 1000) });
  if (!test && (st.used_p >= p.dailyLimit || st.used_all >= s.dailyCapPerViewer)) return no('limit');
  const tasks = await many(`SELECT t.* FROM tasks t WHERE t.active AND (t.ends_at IS NULL OR t.ends_at > now())
      AND ($2 OR (SELECT COUNT(*) FROM task_runs r WHERE r.task_id = t.id AND r.viewer = $1 AND r.status = 'completed'
           AND r.completed_at > now() - interval '1 day') < t.daily_limit)
      ORDER BY t.priority DESC, t.id ASC LIMIT 6`, [viewer, test]);
  if (!tasks.length) {
    // phân biệt "chưa có nhiệm vụ nào" với "đã làm hết lượt của mọi nhiệm vụ hôm nay"
    const any = await one('SELECT COUNT(*) AS n FROM tasks WHERE active AND (ends_at IS NULL OR ends_at > now())');
    return no(any.n ? 'tasks_done' : 'no_tasks');
  }
  return {
    available: true, testMode: test, tasks: tasks.map(x => taskPublic(x, test)),
    remainingToday: test ? null : Math.min(p.dailyLimit - st.used_p, s.dailyCapPerViewer - st.used_all),
  };
}

// "Phiên nhiệm vụ": khoảng thời gian người chơi đang thật sự làm nhiệm vụ (portal mở khung nhiệm vụ / bắt đầu lượt).
// Phòng multiplayer chỉ cho nhân vật tàng hình khi có phiên này — client không tự bật được.
const taskSessions = new Map();
const tsKey = (slug, viewer) => `${slug}|${viewer}`;
function openTaskSession(slug, viewer, ttlMs) {
  const k = tsKey(slug, viewer), exp = now() + ttlMs;
  if (!taskSessions.has(k) || taskSessions.get(k) < exp) taskSessions.set(k, exp);
  if (taskSessions.size > 5000) for (const [kk, e] of taskSessions) if (e < now()) taskSessions.delete(kk);
}
const closeTaskSession = (slug, viewer, graceMs = 0) => { const k = tsKey(slug, viewer); if (graceMs > 0) taskSessions.set(k, now() + graceMs); else taskSessions.delete(k); };
const taskActive = (slug, viewer) => (taskSessions.get(tsKey(slug, viewer)) || 0) > now();

route('POST', '/api/games/:slug/rewards/:placement/open', async ctx => {   // portal vừa mở khung nhiệm vụ trong game
  const g = await liveGame(ctx.params.slug), p = placementOf(g, ctx.params.placement);
  const viewer = viewerOf(ctx.user, ctx.ip);
  rate(`taskopen:${viewer}`, 120, 3600e3);
  const offer = await rewardOffer(ctx.user, viewer, g, p);
  if (!offer.available) return { ok: false };
  openTaskSession(g.slug, viewer, 3 * 60e3);
  return { ok: true };
});
route('POST', '/api/games/:slug/rewards/close', async ctx => {               // khung nhiệm vụ đã đóng (xong / hủy)
  const g = await liveGame(ctx.params.slug);
  closeTaskSession(g.slug, viewerOf(ctx.user, ctx.ip));
  return { ok: true };
});

route('GET', '/api/rewards/config', async () => {
  const s = await rewardSettings();
  return { enabled: s.enabled, guestsAllowed: s.guestsAllowed, types: TASK_TYPES };
});

route('GET', '/api/games/:slug/rewards/:placement', async ctx => {
  const g = await liveGame(ctx.params.slug), p = placementOf(g, ctx.params.placement);
  return { placement: placementDto(p), ...(await rewardOffer(ctx.user, viewerOf(ctx.user, ctx.ip), g, p)) };
});

route('POST', '/api/games/:slug/rewards/:placement/start', async ctx => {
  const g = await liveGame(ctx.params.slug), p = placementOf(g, ctx.params.placement);
  const viewer = viewerOf(ctx.user, ctx.ip);
  rate(`taskstart:${viewer}`, 40, 3600e3);
  const b = await ctx.json();
  const offer = await rewardOffer(ctx.user, viewer, g, p);
  if (!offer.available) throw new HttpError(409, 'Chưa thể nhận thưởng lúc này', offer);
  const task = offer.tasks.find(x => x.id === Number(b.taskId));
  if (!task) throw new HttpError(404, 'Nhiệm vụ không còn khả dụng');
  const r = await one('INSERT INTO task_runs (task_id, game_id, placement, viewer, user_id) VALUES ($1, $2, $3, $4, $5) RETURNING id, started_at',
    [task.id, g.id, p.placement, viewer, ctx.user ? ctx.user.id : null]);
  openTaskSession(g.slug, viewer, (task.durationSec || 0) * 1000 + 10 * 60e3);
  return { runId: r.id, task, startedAt: ms(r.started_at) };
});

async function runOf(ctx) {
  const g = await liveGame(ctx.params.slug);
  const run = await one('SELECT * FROM task_runs WHERE id = $1 AND game_id = $2', [Number(ctx.params.id) || 0, g.id]);
  if (!run || run.viewer !== viewerOf(ctx.user, ctx.ip)) throw new HttpError(404, 'Không tìm thấy lượt làm nhiệm vụ');
  return { g, run };
}

route('POST', '/api/games/:slug/rewards/runs/:id/claim', async ctx => {
  const { g, run } = await runOf(ctx);
  rate(`taskclaim:${run.viewer}`, 20, 600e3);
  if (run.status !== 'started') throw new HttpError(409, 'Lượt nhiệm vụ này đã kết thúc');
  const task = await one('SELECT * FROM tasks WHERE id = $1', [run.task_id]);
  if (!task) throw new HttpError(410, 'Nhiệm vụ đã bị xóa');
  const elapsed = now() - ms(run.started_at);
  if (elapsed > 2 * 3600e3) throw new HttpError(410, 'Lượt nhiệm vụ đã hết hạn, hãy làm lại');
  const settings = await rewardSettings();
  const needSec = settings.testMode ? Math.min(task.duration_sec, TEST_WAIT_SEC) : task.duration_sec;
  const remainingSec = Math.ceil((needSec * 1000 - elapsed) / 1000);
  if (remainingSec > 0) throw new HttpError(400, `Chưa đủ thời gian — còn ${remainingSec} giây`, { remainingSec });
  const b = await ctx.json();
  if (task.verify === 'code' && String(b.code || '').trim().toLowerCase() !== task.code.trim().toLowerCase())
    throw new HttpError(400, 'Mã xác nhận chưa đúng — hãy tìm mã trong live/bài viết', { badCode: true });
  // kiểm tra lại giới hạn lúc nhận (chống mở nhiều lượt song song để nhận nhiều lần)
  const p = placementOf(g, run.placement);
  const offer = await rewardOffer(ctx.user, run.viewer, g, p);
  if (!offer.available) throw new HttpError(409, 'Đã đạt giới hạn nhận thưởng', offer);
  const used = await one(`SELECT COUNT(*) AS n FROM task_runs WHERE task_id = $1 AND viewer = $2 AND status = 'completed' AND completed_at > now() - interval '1 day'`, [task.id, run.viewer]);
  if (!settings.testMode && used.n >= task.daily_limit) throw new HttpError(409, 'Bạn đã làm nhiệm vụ này đủ số lần hôm nay', { reason: 'limit' });
  const done = await q("UPDATE task_runs SET status = 'completed', completed_at = now() WHERE id = $1 AND status = 'started'", [run.id]);
  if (!done.rowCount) throw new HttpError(409, 'Lượt nhiệm vụ này đã kết thúc');
  if (ctx.user) await addXp(ctx.user.id, 2);
  closeTaskSession(g.slug, run.viewer, 6000);   // giữ tàng hình thêm chút cho màn "hoàn thành"; portal sẽ gọi close ngay sau đó
  return { rewarded: true, placement: run.placement, reward: p.reward, task: taskPublic(task), runId: run.id, token: rewardToken(run.id, g.slug, run.placement, run.viewer) };
});

route('POST', '/api/games/:slug/rewards/runs/:id/cancel', async ctx => {
  const { g, run } = await runOf(ctx);
  await q("UPDATE task_runs SET status = 'canceled' WHERE id = $1 AND status = 'started'", [run.id]);
  closeTaskSession(g.slug, run.viewer);
  return { ok: true };
});

// Phòng multiplayer dùng token thưởng (một lần). Trả về phần thưởng hoặc null.
async function consumeReward({ slug, viewer, runId, token, placement }) {
  if (!runId || !token || !safeEq(rewardToken(runId, slug, placement, viewer), token)) return null;
  const g = await one('SELECT * FROM games WHERE slug = $1', [slug]);
  if (!g) return null;
  const r = await q(`UPDATE task_runs SET consumed_at = now() WHERE id = $1 AND viewer = $2 AND placement = $3 AND game_id = $4
                     AND status = 'completed' AND consumed_at IS NULL AND completed_at > now() - interval '1 hour'`, [Number(runId), viewer, placement, g.id]);
  if (!r.rowCount) return null;
  const p = (g.manifest.rewards || []).find(x => x.placement === placement);
  return p ? p.reward : null;
}

// ======================= MULTIPLAYER: vé kết nối realtime =======================
// Game chạy trong iframe sandbox không có cookie -> portal xin "vé" (ký HMAC, hết hạn 60 giây) rồi chuyển cho SDK để mở WebSocket.
function signTicket(payload) {
  const body = b64u(JSON.stringify(payload));
  return `${body}.${b64u(hmac('rt', body))}`;
}
function verifyTicket(ticket) {
  const [body, sig] = String(ticket || '').split('.');
  if (!body || !sig || !safeEq(b64u(hmac('rt', body)), sig)) return null;
  try { const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); return p.exp > now() ? p : null; } catch { return null; }
}
route('GET', '/api/games/:slug/realtime-ticket', async ctx => {
  const g = await liveGame(ctx.params.slug), mp = g.manifest.multiplayer;
  if (!mp || !g.manifest.permissions.includes('multiplayer')) throw new HttpError(403, 'Game không khai báo multiplayer');
  rate(`rt:${ctx.user ? ctx.user.id : ctx.ip}`, 60, 600e3);
  const ticket = signTicket({
    g: g.slug, gid: g.id, u: ctx.user ? ctx.user.id : null, v: viewerOf(ctx.user, ctx.ip),
    n: ctx.user ? ctx.user.display_name : 'Khách', a: ctx.user ? ctx.user.avatar : 'user-round', exp: now() + 60e3,
    j: crypto.randomBytes(9).toString('base64url'),          // nonce: vé chỉ dùng được 1 lần
  });
  return { path: '/rt', ticket, mode: mp.mode, maxPlayers: mp.maxPlayers };
});

// ======================= PROFILE =======================
route('GET', '/api/users/:username', async ctx => {
  const u = await one('SELECT * FROM users WHERE lower(username) = lower($1) AND NOT banned', [ctx.params.username]);
  if (!u) throw new HttpError(404, 'Không tìm thấy người chơi');
  const games = await many(`${GAME_SQL} WHERE g.status = 'live'`);
  const byId = new Map(games.map(g => [g.id, g]));
  const achievements = [];
  for (const r of await many('SELECT game_id, key, unlocked_at FROM user_achievements WHERE user_id = $1 ORDER BY unlocked_at DESC', [u.id])) {
    const g = byId.get(r.game_id); if (!g) continue;
    const a = g.manifest.achievements.find(x => x.key === r.key); if (!a) continue;
    achievements.push({ game: { slug: g.slug, name: g.name }, ...a, unlockedAt: ms(r.unlocked_at) });
  }
  const bestScores = [];
  for (const r of await many('SELECT game_id, COUNT(*) AS n FROM scores WHERE user_id = $1 GROUP BY game_id', [u.id])) {
    const g = byId.get(r.game_id); if (!g || !g.manifest.scoring) continue;
    const best = await bestScore(g, u.id);
    bestScores.push({ game: { slug: g.slug, name: g.name }, label: g.manifest.scoring.label, best, rank: await rankOf(g, best, 0), runs: r.n });
  }
  const st = await one('SELECT COUNT(*) AS plays, COALESCE(SUM(duration_sec), 0)::int AS secs, COUNT(DISTINCT game_id) AS games FROM plays WHERE user_id = $1', [u.id]);
  const recent = (await many('SELECT game_id, MAX(started_at) AS at, COUNT(*) AS n FROM plays WHERE user_id = $1 GROUP BY game_id ORDER BY at DESC LIMIT 6', [u.id]))
    .filter(r => byId.has(r.game_id)).map(r => { const g = byId.get(r.game_id); return { slug: g.slug, name: g.name, thumbnail: gameDto(g).thumbnail, lastPlayed: ms(r.at), plays: r.n }; });
  const matches = (await many(`SELECT m.*, g.slug, g.name AS game_name FROM matches m JOIN games g ON g.id = m.game_id
                               WHERE m.user_id = $1 ORDER BY m.ended_at DESC LIMIT 10`, [u.id]))
    .map(m => ({ game: { slug: m.slug, name: m.game_name }, score: m.score, kills: m.kills, maxValue: m.max_value, rank: m.rank_in_room,
      reason: m.end_reason, killedBy: m.killed_by, seconds: Math.round((ms(m.ended_at) - ms(m.started_at)) / 1000), endedAt: ms(m.ended_at) }));
  const mst = await one('SELECT COUNT(*) AS n, COALESCE(SUM(kills), 0)::int AS kills, MIN(rank_in_room) AS best_rank FROM matches WHERE user_id = $1', [u.id]);
  return {
    user: { ...pubUser(u), bio: u.bio, level: level(u.xp), xp: u.xp, role: u.role, createdAt: ms(u.created_at) },
    stats: { plays: st.plays, playSeconds: st.secs, gamesPlayed: st.games, achievements: achievements.length,
      achievementPoints: achievements.reduce((s, a) => s + a.points, 0), matches: mst.n, kills: mst.kills, bestRoomRank: mst.best_rank },
    achievements, bestScores, recent, matches, developed: games.filter(g => g.owner_id === u.id).map(g => gameDto(g)),
  };
});

route('GET', '/api/leaderboard/global', async () => ({
  entries: (await many('SELECT username, display_name, avatar, xp FROM users WHERE NOT banned ORDER BY xp DESC, id ASC LIMIT 20'))
    .map((u, i) => ({ rank: i + 1, user: pubUser(u), xp: u.xp, level: level(u.xp) })),
}));

// ======================= SUBMISSIONS (nhà phát triển) =======================
function writeFiles(dir, entries) {
  fs.rmSync(dir, { recursive: true, force: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (!p.startsWith(dir + path.sep)) throw new Error('path traversal');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, e.data);
  }
}
const subDto = s => ({
  id: s.id, slug: s.slug, version: s.version, status: s.status, note: s.note, createdAt: ms(s.created_at), reviewedAt: ms(s.reviewed_at),
  size: s.size_bytes, files: s.file_count, manifest: s.manifest, report: s.report,
  ...(s.owner_username ? { owner: { username: s.owner_username, displayName: s.owner_name } } : {}),
});
const hasRoomModule = slug => /^[a-z0-9-]+$/.test(slug) && fs.existsSync(path.join(ROOMS_DIR, `${slug}.js`));

route('POST', '/api/submissions', async ctx => {
  const u = needUser(ctx);
  rate(`upload:${u.id}`, Number(process.env.UPLOADS_PER_HOUR || 10), 3600e3);
  const buf = await ctx.raw(LIMITS.maxZipBytes + 1024);
  let entries;
  try { entries = stripRoot(readZip(buf)); }
  catch (e) { throw new HttpError(422, e.message, { errors: [e.message], warnings: [] }); }
  const r = validatePackage(entries);
  const errors = [...r.errors], warnings = r.warnings;
  if (r.manifest) {
    const slug = r.manifest.id;
    const live = await one('SELECT owner_id, version FROM games WHERE slug = $1', [slug]);
    if (live && live.owner_id !== u.id) errors.push(`id "${slug}" đã được game khác sử dụng`);
    else if (live && live.version === r.manifest.version) errors.push(`Phiên bản ${live.version} đã được duyệt — hãy tăng "version" khi cập nhật game`);
    if (await one("SELECT 1 FROM submissions WHERE slug = $1 AND owner_id <> $2 AND status = 'pending'", [slug, u.id])) errors.push(`id "${slug}" đang được người khác gửi duyệt`);
    const mp = r.manifest.multiplayer;
    if (mp && mp.mode === 'authoritative' && (u.role !== 'admin' || !hasRoomModule(slug)))
      errors.push('multiplayer "authoritative" (logic chạy trên máy chủ) chỉ dành cho game hệ thống — game đăng lên hãy dùng "relay"');
  }
  if (errors.length) throw new HttpError(422, 'Gói game chưa đạt chuẩn', { errors, warnings });

  const m = r.manifest;
  const sub = await tx(async t => {
    const old = (await t("UPDATE submissions SET status = 'withdrawn' WHERE slug = $1 AND owner_id = $2 AND status = 'pending' RETURNING id", [m.id, u.id])).rows;
    for (const o of old) fs.rmSync(path.join(SUBS_DIR, String(o.id)), { recursive: true, force: true });
    return (await t(`INSERT INTO submissions (slug, owner_id, version, manifest, report, size_bytes, file_count) VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7) RETURNING *`,
      [m.id, u.id, m.version, JSON.stringify(m), JSON.stringify({ warnings }), r.size, r.files])).rows[0];
  });
  writeFiles(path.join(SUBS_DIR, String(sub.id)), entries);
  return { ok: true, submission: subDto(sub), warnings };
});

route('GET', '/api/my/submissions', async ctx => {
  const u = needUser(ctx);
  return { submissions: (await many('SELECT * FROM submissions WHERE owner_id = $1 ORDER BY id DESC LIMIT 50', [u.id])).map(subDto) };
});

route('DELETE', '/api/submissions/:id', async ctx => {
  const u = needUser(ctx);
  const s = await one("UPDATE submissions SET status = 'withdrawn' WHERE id = $1 AND owner_id = $2 AND status = 'pending' RETURNING id", [Number(ctx.params.id) || 0, u.id]);
  if (!s) throw new HttpError(404, 'Không có bản gửi duyệt đang chờ');
  fs.rmSync(path.join(SUBS_DIR, String(s.id)), { recursive: true, force: true });
  return { ok: true };
});

// Xem thử gói chờ duyệt: iframe sandbox không gửi cookie khi tải file con, nên dùng URL có chữ ký HMAC (hết hạn sau 1 giờ).
const previewSig = (id, exp) => hmac('preview', `${id}.${exp}`).toString('hex');
function verifyPreview(id, exp, sig) {
  return Number(exp) > now() && safeEq(previewSig(id, exp), sig);
}
route('GET', '/api/submissions/:id/preview', async ctx => {
  const u = needUser(ctx);
  const s = await one('SELECT * FROM submissions WHERE id = $1', [Number(ctx.params.id) || 0]);
  if (!s || s.status !== 'pending' || (u.role !== 'admin' && u.id !== s.owner_id)) throw new HttpError(404, 'Không có bản gửi duyệt đang chờ');
  const exp = now() + 3600e3;
  return { url: `/preview/${s.id}~${exp}~${previewSig(s.id, exp)}/${s.manifest.entry}` };
});

// ======================= ADMIN =======================
let realtimeStats = () => ({ rooms: 0, players: 0 });
const setRealtimeStats = fn => { realtimeStats = fn; };

route('GET', '/api/admin/stats', async ctx => {
  needAdmin(ctx);
  const s = await one(`SELECT
      (SELECT COUNT(*) FROM users) AS users,
      (SELECT COUNT(*) FROM games WHERE status = 'live') AS games,
      (SELECT COUNT(*) FROM submissions WHERE status = 'pending') AS pending,
      (SELECT COUNT(*) FROM plays) AS plays,
      (SELECT COUNT(*) FROM scores) AS scores,
      (SELECT COUNT(*) FROM matches) AS matches,
      (SELECT COUNT(*) FROM task_runs WHERE status = 'completed' AND completed_at > now() - interval '1 day') AS tasks_today`);
  const rt = realtimeStats();
  return { users: s.users, games: s.games, pending: s.pending, plays: s.plays, scores: s.scores, matches: s.matches, tasksToday: s.tasks_today, roomsOnline: rt.rooms, playersOnline: rt.players, db: db.kind() };
});

route('GET', '/api/admin/submissions', async ctx => {
  needAdmin(ctx);
  const status = ['pending', 'approved', 'rejected', 'withdrawn'].includes(ctx.query.status) ? ctx.query.status : 'pending';
  return {
    submissions: (await many(`SELECT s.*, u.username AS owner_username, u.display_name AS owner_name FROM submissions s JOIN users u ON u.id = s.owner_id
                              WHERE s.status = $1 ORDER BY s.id DESC LIMIT 100`, [status])).map(subDto),
  };
});

function walk(dir, base = dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p, base, out); else out.push({ name: path.relative(base, p).split(path.sep).join('/'), size: fs.statSync(p).size });
  }
  return out;
}
route('GET', '/api/admin/submissions/:id/files', async ctx => {
  needAdmin(ctx);
  const dir = path.join(SUBS_DIR, String(Number(ctx.params.id) || 0));
  if (!fs.existsSync(dir)) throw new HttpError(404, 'Gói đã bị xóa');
  return { files: walk(dir).sort((a, b) => a.name.localeCompare(b.name)) };
});

route('POST', '/api/admin/submissions/:id/review', async ctx => {
  const admin = needAdmin(ctx), b = await ctx.json();
  const s = await one('SELECT * FROM submissions WHERE id = $1', [Number(ctx.params.id) || 0]);
  if (!s || s.status !== 'pending') throw new HttpError(404, 'Không có bản gửi duyệt đang chờ');
  const note = String(b.note || '').trim().slice(0, 500);
  const dir = path.join(SUBS_DIR, String(s.id));

  if (b.decision === 'reject') {
    if (note.length < 5) throw bad('Hãy ghi lý do từ chối (ít nhất 5 ký tự) để nhà phát triển sửa');
    await q("UPDATE submissions SET status = 'rejected', note = $1, reviewer_id = $2, reviewed_at = now() WHERE id = $3", [note, admin.id, s.id]);
    fs.rmSync(dir, { recursive: true, force: true });
    audit(admin.id, 'submission.reject', s.slug, { submission: s.id, version: s.version, note });
    return { ok: true, status: 'rejected' };
  }
  if (b.decision !== 'approve') throw bad('decision là approve hoặc reject');
  if (!fs.existsSync(dir)) throw new HttpError(410, 'Gói đã bị xóa khỏi máy chủ');

  const m = s.manifest;
  const existing = await one('SELECT * FROM games WHERE slug = $1', [m.id]);
  if (existing && existing.owner_id !== s.owner_id) throw new HttpError(409, 'Slug đã thuộc về người khác');
  const live = path.join(GAMES_DIR, m.id), tmp = path.join(GAMES_DIR, `.tmp-${m.id}-${s.id}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.cpSync(dir, tmp, { recursive: true });
  await tx(async t => {
    let gameId;
    if (existing) {
      await t("UPDATE games SET name = $1, description = $2, version = $3, manifest = $4::jsonb, status = 'live', updated_at = now() WHERE id = $5",
        [m.name, m.description, m.version, JSON.stringify(m), existing.id]);
      gameId = existing.id;
    } else {
      gameId = (await t('INSERT INTO games (slug, owner_id, name, description, version, manifest) VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id',
        [m.id, s.owner_id, m.name, m.description, m.version, JSON.stringify(m)])).rows[0].id;
      await addXp(s.owner_id, 50, t);
    }
    await t(`INSERT INTO game_versions (game_id, version, manifest, submission_id, published_by) VALUES ($1, $2, $3::jsonb, $4, $5)
             ON CONFLICT (game_id, version) DO NOTHING`, [gameId, m.version, JSON.stringify(m), s.id, admin.id]);
    await t("UPDATE submissions SET status = 'approved', note = $1, reviewer_id = $2, reviewed_at = now() WHERE id = $3", [note, admin.id, s.id]);
  });
  // chỉ thay file sau khi DB đã ghi thành công
  fs.rmSync(live, { recursive: true, force: true });
  fs.renameSync(tmp, live);
  fs.rmSync(dir, { recursive: true, force: true });
  audit(admin.id, 'submission.approve', m.id, { submission: s.id, version: m.version, note });
  return { ok: true, status: 'approved' };
});

route('GET', '/api/admin/games', async ctx => {
  needAdmin(ctx);
  return { games: (await many(`${GAME_SQL} ORDER BY g.id DESC`)).map(g => gameDto(g)) };
});
route('GET', '/api/admin/games/:slug/versions', async ctx => {
  needAdmin(ctx);
  const rows = await many(`SELECT v.version, v.published_at, u.username FROM game_versions v JOIN games g ON g.id = v.game_id
                           LEFT JOIN users u ON u.id = v.published_by WHERE g.slug = $1 ORDER BY v.published_at DESC`, [ctx.params.slug]);
  return { versions: rows.map(r => ({ version: r.version, publishedAt: ms(r.published_at), by: r.username })) };
});
route('POST', '/api/admin/games/:slug/status', async ctx => {
  const admin = needAdmin(ctx);
  const b = await ctx.json();
  if (!['live', 'unpublished'].includes(b.status)) throw bad('status là live | unpublished');
  const r = await q('UPDATE games SET status = $1 WHERE slug = $2', [b.status, ctx.params.slug]);
  if (!r.rowCount) throw new HttpError(404, 'Không tìm thấy game');
  audit(admin.id, 'game.status', ctx.params.slug, { status: b.status });
  return { ok: true };
});

route('GET', '/api/admin/users', async ctx => {
  needAdmin(ctx);
  return { users: (await many('SELECT * FROM users ORDER BY id DESC LIMIT 200')).map(u => ({ ...userDto(u), banned: u.banned, lastSeenAt: ms(u.last_seen_at) })) };
});
route('POST', '/api/admin/users/:id', async ctx => {
  const admin = needAdmin(ctx), b = await ctx.json();
  const id = Number(ctx.params.id) || 0;
  if (id === admin.id) throw bad('Không thể tự thay đổi quyền của chính mình');
  if (b.role !== undefined) {
    if (!['user', 'admin'].includes(b.role)) throw bad('role là user | admin');
    await q('UPDATE users SET role = $1 WHERE id = $2', [b.role, id]);
    audit(admin.id, 'user.role', id, { role: b.role });
  }
  if (b.banned !== undefined) {
    await q('UPDATE users SET banned = $1 WHERE id = $2', [!!b.banned, id]);
    if (b.banned) await q('DELETE FROM sessions WHERE user_id = $1', [id]);
    audit(admin.id, b.banned ? 'user.ban' : 'user.unban', id);
  }
  return { ok: true };
});

route('GET', '/api/admin/audit', async ctx => {
  needAdmin(ctx);
  const rows = await many('SELECT a.*, u.username FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.id DESC LIMIT 100');
  return { entries: rows.map(r => ({ id: r.id, actor: r.username, action: r.action, target: r.target, data: r.data, at: ms(r.created_at) })) };
});

// ----- quản lý nhiệm vụ -----
function taskInput(b) {
  const int = (v, lo, hi, def, name) => {
    const n = v === undefined || v === '' || v === null ? def : Number(v);
    if (!Number.isInteger(n) || n < lo || n > hi) throw bad(`${name} là số nguyên ${lo}-${hi}`);
    return n;
  };
  const title = String(b.title || '').trim();
  if (title.length < 3 || title.length > 80) throw bad('Tiêu đề dài 3-80 ký tự');
  if (!TASK_TYPES[b.type]) throw bad('Loại nhiệm vụ không hợp lệ');
  let url;
  try { url = new URL(String(b.url || '').trim()); } catch { throw bad('Link không hợp lệ'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.href.length > 500) throw bad('Link phải bắt đầu bằng http:// hoặc https://');
  const verify = b.verify === 'code' ? 'code' : 'time';
  const code = String(b.code || '').trim().slice(0, 40);
  if (verify === 'code' && !code) throw bad('Hãy nhập mã xác nhận (mã bạn sẽ đọc/ghim trong live hoặc bài viết)');
  const endsAt = b.endsAt ? Number(b.endsAt) : null;
  if (endsAt !== null && !(endsAt > 0)) throw bad('Ngày kết thúc không hợp lệ');
  const icon = iconOr(String(b.icon || '').trim(), TASK_TYPES[b.type].icon);
  return [title, b.type, url.href, String(b.description || '').trim().slice(0, 200), icon, int(b.durationSec, 0, 600, 30, 'Thời gian'),
    verify, verify === 'code' ? code : '', int(b.dailyLimit, 1, 50, 3, 'Giới hạn/ngày'), int(b.priority, -100, 100, 0, 'Độ ưu tiên'),
    b.active !== false, endsAt === null ? null : iso(endsAt)];
}
const TASK_COLS = ['title', 'type', 'url', 'description', 'icon', 'duration_sec', 'verify', 'code', 'daily_limit', 'priority', 'active', 'ends_at'];
async function taskAdminDto(t) {
  const st = await one(`SELECT COUNT(*) FILTER (WHERE status = 'completed') AS completed, COUNT(*) AS started
                        FROM task_runs WHERE task_id = $1 AND started_at > now() - interval '7 days'`, [t.id]);
  return { ...taskPublic(t, false), code: t.code, dailyLimit: t.daily_limit, priority: t.priority, active: t.active, endsAt: ms(t.ends_at), createdAt: ms(t.created_at), stats: st };
}

route('GET', '/api/admin/tasks', async ctx => {
  needAdmin(ctx);
  const tasks = await many('SELECT * FROM tasks ORDER BY active DESC, priority DESC, id DESC');
  return { tasks: await Promise.all(tasks.map(taskAdminDto)), types: TASK_TYPES, settings: await rewardSettings() };
});
route('POST', '/api/admin/tasks', async ctx => {
  const admin = needAdmin(ctx);
  const v = taskInput(await ctx.json());
  const t = await one(`INSERT INTO tasks (${TASK_COLS.join(', ')}) VALUES (${TASK_COLS.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *`, v);
  audit(admin.id, 'task.create', t.id, { title: t.title });
  return { task: await taskAdminDto(t) };
});
route('PUT', '/api/admin/tasks/:id', async ctx => {
  const admin = needAdmin(ctx);
  const v = taskInput(await ctx.json());
  const t = await one(`UPDATE tasks SET ${TASK_COLS.map((c, i) => `${c} = $${i + 1}`).join(', ')} WHERE id = $${TASK_COLS.length + 1} RETURNING *`, [...v, Number(ctx.params.id) || 0]);
  if (!t) throw new HttpError(404, 'Không tìm thấy nhiệm vụ');
  audit(admin.id, 'task.update', t.id, { title: t.title, active: t.active });
  return { task: await taskAdminDto(t) };
});
route('DELETE', '/api/admin/tasks/:id', async ctx => {
  const admin = needAdmin(ctx);
  const t = await one('DELETE FROM tasks WHERE id = $1 RETURNING id, title', [Number(ctx.params.id) || 0]);
  if (!t) throw new HttpError(404, 'Không tìm thấy nhiệm vụ');
  audit(admin.id, 'task.delete', t.id, { title: t.title });
  return { ok: true };
});
route('PUT', '/api/admin/settings/rewards', async ctx => {
  const admin = needAdmin(ctx);
  const b = await ctx.json(), cur = await rewardSettings();
  const cap = b.dailyCapPerViewer === undefined ? cur.dailyCapPerViewer : Number(b.dailyCapPerViewer);
  if (!Number.isInteger(cap) || cap < 1 || cap > 500) throw bad('Giới hạn mỗi người/ngày là số nguyên 1-500');
  const pickB = k => (b[k] === undefined ? cur[k] : !!b[k]);
  const s = { enabled: pickB('enabled'), guestsAllowed: pickB('guestsAllowed'), dailyCapPerViewer: cap, testMode: pickB('testMode') };
  await q(`INSERT INTO settings (key, value) VALUES ('rewards', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`, [JSON.stringify(s)]);
  audit(admin.id, 'settings.rewards', 'rewards', s);
  return { settings: s };
});

module.exports = {
  handleApi, currentUser, verifyPreview, verifyTicket, hashPw, HttpError, GAMES_DIR, SUBS_DIR, ROOMS_DIR,
  // dịch vụ cho phòng multiplayer
  services: {
    recordScore: async (slug, userId, score, meta) => {
      const g = await one('SELECT * FROM games WHERE slug = $1', [slug]);
      return g && g.manifest.scoring ? recordScore(g, userId, score, meta, 'server') : null;
    },
    consumeReward,
    taskActive,
  },
  setRealtimeStats,
};
