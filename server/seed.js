'use strict';
// Dữ liệu khởi tạo: tài khoản admin, game có sẵn (seed-games/), nhiệm vụ mẫu.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { q, one, tx } = require('./db');
const { hashPw, GAMES_DIR } = require('./api');
const { validatePackage } = require('./validate');

const ROOT = path.join(__dirname, '..');

function readDirEntries(dir, base = dir, out = []) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, f.name);
    if (f.isDirectory()) readDirEntries(full, base, out);
    else out.push({ name: path.relative(base, full).split(path.sep).join('/'), data: fs.readFileSync(full) });
  }
  return out;
}

async function ensureAdmin() {
  const admin = await one("SELECT * FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  if (admin) return admin;
  const username = process.env.ADMIN_USER || 'admin';
  const password = process.env.ADMIN_PASS || crypto.randomBytes(9).toString('base64url');
  const u = await one("INSERT INTO users (username, display_name, pass_hash, role, avatar) VALUES ($1, 'Quản trị viên', $2, 'admin', 'shield') RETURNING *",
    [username, await hashPw(password)]);
  console.log(`\n  Đã tạo tài khoản quản trị:  ${username} / ${password}\n  (mật khẩu chỉ hiển thị một lần — đặt ADMIN_PASS để tự chọn)\n`);
  return u;
}

async function seedGames(admin) {
  const dir = path.join(ROOT, 'seed-games');
  if (!fs.existsSync(dir)) return;
  for (const name of fs.readdirSync(dir)) {
    const src = path.join(dir, name);
    if (!fs.statSync(src).isDirectory()) continue;
    const r = validatePackage(readDirEntries(src));
    if (r.errors.length) { console.warn(`[seed] ${name} không đạt chuẩn:`, r.errors); continue; }
    const m = r.manifest;
    const ex = await one('SELECT id, version FROM games WHERE slug = $1', [m.id]);
    const live = path.join(GAMES_DIR, m.id);
    if (ex && ex.version === m.version && fs.existsSync(live)) continue;
    await tx(async t => {
      const id = ex
        ? (await t('UPDATE games SET name = $1, description = $2, version = $3, manifest = $4::jsonb, updated_at = now() WHERE id = $5 RETURNING id',
          [m.name, m.description, m.version, JSON.stringify(m), ex.id])).rows[0].id
        : (await t('INSERT INTO games (slug, owner_id, name, description, version, manifest, builtin) VALUES ($1, $2, $3, $4, $5, $6::jsonb, true) RETURNING id',
          [m.id, admin.id, m.name, m.description, m.version, JSON.stringify(m)])).rows[0].id;
      await t('INSERT INTO game_versions (game_id, version, manifest, published_by) VALUES ($1, $2, $3::jsonb, $4) ON CONFLICT (game_id, version) DO NOTHING',
        [id, m.version, JSON.stringify(m), admin.id]);
    });
    fs.rmSync(live, { recursive: true, force: true });
    fs.cpSync(src, live, { recursive: true });
    console.log(`[seed] đã cài game "${m.name}" v${m.version}`);
  }
}

// Nhiệm vụ mẫu để thử ngay — admin đổi sang link live/bài viết thật ở Quản trị › Nhiệm vụ.
// Mỗi "đợt" mẫu chỉ thêm 1 lần (ghi trong settings 'seed'), nên nhiệm vụ admin đã xóa sẽ không tự xuất hiện lại.
const SAMPLE_TASKS = [
  { v: 1, title: 'Xem live TikTok 30 giây', type: 'tiktok_live', url: 'https://www.tiktok.com/live', icon: 'radio', sec: 30, limit: 3, prio: 10 },
  { v: 1, title: 'Đọc bài viết Facebook', type: 'facebook_post', url: 'https://www.facebook.com/', icon: 'newspaper', sec: 15, limit: 3, prio: 5 },
  { v: 2, title: 'Xem video YouTube 20 giây', type: 'youtube', url: 'https://www.youtube.com/', icon: 'circle-play', sec: 20, limit: 5, prio: 4 },
  { v: 2, title: 'Xem live Facebook', type: 'facebook_live', url: 'https://www.facebook.com/watch/live/', icon: 'video', sec: 30, limit: 5, prio: 3 },
  { v: 2, title: 'Quan tâm Zalo OA', type: 'zalo', url: 'https://zalo.me/', icon: 'message-circle', sec: 10, limit: 2, prio: 2 },
  { v: 2, title: 'Xem bài đăng Instagram', type: 'instagram', url: 'https://www.instagram.com/', icon: 'camera', sec: 10, limit: 5, prio: 1 },
];
const SEED_TASKS_VERSION = 2;
async function seedTasks() {
  const row = await one("SELECT value FROM settings WHERE key = 'seed'");
  const seed = row ? row.value : {};
  // DB cũ (trước khi có cờ seed) đã có nhiệm vụ -> coi như đã seed đợt 1
  const done = seed.tasks || ((await one('SELECT COUNT(*) AS n FROM tasks')).n ? 1 : 0);
  if (done >= SEED_TASKS_VERSION) return;
  const ins = 'INSERT INTO tasks (title, type, url, description, icon, duration_sec, daily_limit, priority) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)';
  await tx(async t => {   // cả đợt hoặc không gì cả
    for (const x of SAMPLE_TASKS.filter(y => y.v > done)) {
      await t(ins, [x.title, x.type, x.url, 'Nhiệm vụ mẫu — admin hãy đổi sang link của kênh / trang của bạn.', x.icon, x.sec, x.limit, x.prio]);
    }
    await t(`INSERT INTO settings (key, value) VALUES ('seed', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = now()`,
      [JSON.stringify({ ...seed, tasks: SEED_TASKS_VERSION })]);
  });
  console.log(`[seed] đã thêm ${SAMPLE_TASKS.filter(x => x.v > done).length} nhiệm vụ mẫu`);
}

async function seedAll() {
  const admin = await ensureAdmin();
  await seedGames(admin);
  await seedTasks();
}

module.exports = { seedAll };
