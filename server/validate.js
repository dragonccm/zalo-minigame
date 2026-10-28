'use strict';
// Kiểm tra gói game theo chuẩn GameHub (gamehub.json + cấu trúc file).
// Dùng chung cho server (khi upload) và CLI (tools/validate-game.js).

const CATEGORIES = ['arcade', 'io', 'puzzle', 'action', 'strategy', 'racing', 'sports', 'casual', 'board', 'adventure', 'other'];
const CONTROLS = ['mouse', 'keyboard', 'touch', 'gamepad'];
const PERMISSIONS = ['save', 'leaderboard', 'achievements', 'rewards', 'multiplayer'];
const ALLOWED_EXT = new Set(['html', 'htm', 'js', 'mjs', 'css', 'json', 'png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico',
  'mp3', 'ogg', 'wav', 'm4a', 'woff', 'woff2', 'ttf', 'otf', 'glb', 'gltf', 'bin', 'txt', 'md', 'wasm', 'atlas', 'xml']);
const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/;
const KEY_RE = /^[a-z0-9_]{2,40}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(?:-[0-9a-z.-]+)?$/i;
const RESERVED = new Set(['admin', 'api', 'sdk', 'g', 'preview', 'docs', 'upload', 'static', 'assets']);

const isStr = (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.length <= max;

function validateManifest(m) {
  const errors = [], warnings = [];
  const err = s => errors.push(s), warn = s => warnings.push(s);
  const ICON_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;   // tên icon Lucide (https://lucide.dev/icons)
  if (!m || typeof m !== 'object' || Array.isArray(m)) return { errors: ['gamehub.json phải là một object JSON'], warnings, manifest: null };

  if (m.schema !== 1) err('"schema" phải bằng 1');
  if (typeof m.id !== 'string' || !SLUG_RE.test(m.id)) err('"id" (slug) chỉ gồm a-z, 0-9, dấu gạch ngang, dài 3-40 ký tự');
  else if (RESERVED.has(m.id)) err(`"id" không được dùng tên dành riêng: ${m.id}`);
  if (!isStr(m.name, 2, 40)) err('"name" dài 2-40 ký tự');
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) err('"version" phải theo dạng x.y.z (ví dụ 1.0.0)');
  if (!isStr(m.description, 10, 500)) err('"description" dài 10-500 ký tự');
  if (!isStr(m.author, 2, 40)) err('"author" dài 2-40 ký tự');
  if (typeof m.sdk !== 'string' || !/^1(\.\d+)?$/.test(m.sdk)) err('"sdk" phải là "1.0" (phiên bản giao thức GameHub)');

  const entry = m.entry === undefined ? 'index.html' : m.entry;
  if (typeof entry !== 'string' || !/^[\w./-]+\.html?$/i.test(entry) || entry.includes('..') || entry.startsWith('/')) err('"entry" phải là đường dẫn tương đối tới file .html');

  if (!Array.isArray(m.categories) || m.categories.length < 1 || m.categories.length > 3 || !m.categories.every(c => CATEGORIES.includes(c)))
    err(`"categories" gồm 1-3 mục trong: ${CATEGORIES.join(', ')}`);

  const orientation = m.orientation === undefined ? 'both' : m.orientation;
  if (!['landscape', 'portrait', 'both'].includes(orientation)) err('"orientation" là landscape | portrait | both');

  const controls = m.controls === undefined ? [] : m.controls;
  if (!Array.isArray(controls) || !controls.every(c => CONTROLS.includes(c))) err(`"controls" chỉ gồm: ${CONTROLS.join(', ')}`);

  const permissions = m.permissions === undefined ? [] : m.permissions;
  if (!Array.isArray(permissions) || !permissions.every(p => PERMISSIONS.includes(p))) err(`"permissions" chỉ gồm: ${PERMISSIONS.join(', ')}`);

  let scoring = null;
  if (m.scoring !== undefined && m.scoring !== null) {
    const s = m.scoring;
    if (typeof s !== 'object' || !isStr(s.label, 1, 20)) err('"scoring.label" dài 1-20 ký tự');
    else {
      if (s.order !== undefined && !['desc', 'asc'].includes(s.order)) err('"scoring.order" là desc | asc');
      if (s.max !== undefined && !(typeof s.max === 'number' && isFinite(s.max) && s.max > 0)) err('"scoring.max" phải là số dương');
      scoring = { label: s.label, order: s.order || 'desc', unit: typeof s.unit === 'string' ? s.unit.slice(0, 10) : '', max: s.max ?? null };
    }
    if (!permissions.includes('leaderboard')) warn('Có "scoring" nhưng thiếu quyền "leaderboard" trong "permissions" — điểm sẽ bị từ chối.');
  } else if (permissions.includes('leaderboard')) warn('Khai báo quyền "leaderboard" nhưng không có "scoring".');

  const achievements = [];
  if (m.achievements !== undefined) {
    if (!Array.isArray(m.achievements) || m.achievements.length > 50) err('"achievements" là mảng tối đa 50 mục');
    else {
      const seen = new Set();
      m.achievements.forEach((a, i) => {
        const p = `achievements[${i}]`;
        if (!a || typeof a !== 'object') return err(`${p} không hợp lệ`);
        if (typeof a.key !== 'string' || !KEY_RE.test(a.key)) err(`${p}.key chỉ gồm a-z, 0-9, _ (2-40 ký tự)`);
        else if (seen.has(a.key)) err(`${p}.key bị trùng: ${a.key}`);
        else seen.add(a.key);
        if (!isStr(a.name, 2, 40)) err(`${p}.name dài 2-40 ký tự`);
        if (!isStr(a.description, 2, 120)) err(`${p}.description dài 2-120 ký tự`);
        const points = a.points === undefined ? 10 : a.points;
        if (!Number.isInteger(points) || points < 0 || points > 100) err(`${p}.points là số nguyên 0-100`);
        const iconOk = typeof a.icon === 'string' && a.icon.length <= 40 && ICON_RE.test(a.icon);
        if (a.icon !== undefined && !iconOk) warn(`${p}.icon nên là tên icon Lucide (vd "trophy", "flame") — đang dùng icon mặc định`);
        achievements.push({ key: a.key, name: a.name, description: a.description, icon: iconOk ? a.icon : 'trophy', points });
      });
      if (achievements.length && !permissions.includes('achievements')) warn('Có "achievements" nhưng thiếu quyền "achievements".');
      const totalPts = achievements.reduce((s, a) => s + (a.points || 0), 0);
      if (totalPts > 500) err(`Tổng điểm thành tựu tối đa 500 (hiện ${totalPts})`);
    }
  }

  // Phần thưởng nhiệm vụ: mỗi "placement" là một nút nhận thưởng trong game (người chơi làm nhiệm vụ do admin cấu hình để nhận).
  const rewards = [];
  if (m.rewards !== undefined) {
    if (!Array.isArray(m.rewards) || m.rewards.length > 10) err('"rewards" là mảng tối đa 10 mục');
    else {
      const seen = new Set();
      m.rewards.forEach((r, i) => {
        const p = `rewards[${i}]`;
        if (!r || typeof r !== 'object') return err(`${p} không hợp lệ`);
        if (typeof r.placement !== 'string' || !KEY_RE.test(r.placement)) err(`${p}.placement chỉ gồm a-z, 0-9, _ (2-40 ký tự)`);
        else if (seen.has(r.placement)) err(`${p}.placement bị trùng: ${r.placement}`);
        else seen.add(r.placement);
        if (!isStr(r.name, 2, 40)) err(`${p}.name dài 2-40 ký tự`);
        if (r.description !== undefined && !isStr(r.description, 1, 120)) err(`${p}.description dài 1-120 ký tự`);
        const rw = r.reward;
        if (!rw || typeof rw !== 'object' || typeof rw.type !== 'string' || !/^[a-z0-9_]{2,30}$/.test(rw.type)) err(`${p}.reward.type chỉ gồm a-z, 0-9, _ (2-30 ký tự)`);
        if (!rw || !Number.isInteger(rw.amount) || rw.amount < 1 || rw.amount > 1000000) err(`${p}.reward.amount là số nguyên 1-1.000.000`);
        const cooldownSec = r.cooldownSec === undefined ? 30 : r.cooldownSec;
        if (!Number.isInteger(cooldownSec) || cooldownSec < 0 || cooldownSec > 3600) err(`${p}.cooldownSec là số nguyên 0-3600`);
        const dailyLimit = r.dailyLimit === undefined ? 20 : r.dailyLimit;
        if (!Number.isInteger(dailyLimit) || dailyLimit < 1 || dailyLimit > 500) err(`${p}.dailyLimit là số nguyên 1-500`);
        rewards.push({ placement: r.placement, name: r.name, description: r.description || '', reward: rw ? { type: rw.type, amount: rw.amount } : null, cooldownSec, dailyLimit });
      });
      if (rewards.length && !permissions.includes('rewards')) warn('Có "rewards" nhưng thiếu quyền "rewards" trong "permissions" — requestReward() sẽ bị từ chối.');
    }
  } else if (permissions.includes('rewards')) warn('Khai báo quyền "rewards" nhưng không có mục "rewards".');

  // Multiplayer: "relay" = máy chủ chỉ chuyển tin giữa người chơi trong phòng (game nào cũng dùng được);
  // "authoritative" = máy chủ chạy logic game (chỉ game hệ thống có module server/rooms/<id>.js).
  let multiplayer = null;
  if (m.multiplayer !== undefined && m.multiplayer !== null) {
    const mp = m.multiplayer;
    if (typeof mp !== 'object' || !['relay', 'authoritative'].includes(mp.mode)) err('"multiplayer.mode" là relay | authoritative');
    else {
      const maxCap = mp.mode === 'relay' ? 16 : 50;
      const maxPlayers = mp.maxPlayers === undefined ? (mp.mode === 'relay' ? 4 : 20) : mp.maxPlayers;
      const minPlayers = mp.minPlayers === undefined ? 1 : mp.minPlayers;
      if (!Number.isInteger(maxPlayers) || maxPlayers < 2 || maxPlayers > maxCap) err(`"multiplayer.maxPlayers" là số nguyên 2-${maxCap}`);
      if (!Number.isInteger(minPlayers) || minPlayers < 1 || minPlayers > maxPlayers) err('"multiplayer.minPlayers" là số nguyên 1-maxPlayers');
      multiplayer = { mode: mp.mode, maxPlayers, minPlayers, privateRooms: mp.privateRooms !== false };
      if (!permissions.includes('multiplayer')) warn('Có "multiplayer" nhưng thiếu quyền "multiplayer" trong "permissions" — GameHub.multiplayer sẽ bị từ chối.');
    }
  } else if (permissions.includes('multiplayer')) warn('Khai báo quyền "multiplayer" nhưng không có mục "multiplayer".');

  if (m.thumbnail !== undefined && (typeof m.thumbnail !== 'string' || !/\.(png|jpe?g|webp)$/i.test(m.thumbnail) || m.thumbnail.includes('..') || m.thumbnail.startsWith('/')))
    err('"thumbnail" phải là đường dẫn tương đối tới ảnh png/jpg/webp');

  if (errors.length) return { errors, warnings, manifest: null };
  return {
    errors, warnings,
    manifest: {
      schema: 1, id: m.id, name: m.name.trim(), version: m.version, description: m.description.trim(), author: m.author.trim(),
      sdk: m.sdk, entry, thumbnail: m.thumbnail || null, categories: [...new Set(m.categories)], orientation, controls: [...new Set(controls)],
      permissions: [...new Set(permissions)], scoring, achievements, rewards, multiplayer,
    },
  };
}

// entries: [{name, data:Buffer}] (đã bỏ thư mục gốc)
function validatePackage(entries) {
  const errors = [], warnings = [];
  const byName = new Map(entries.map(e => [e.name, e]));
  const mf = byName.get('gamehub.json');
  if (!mf) return { errors: ['Thiếu file "gamehub.json" ở thư mục gốc của gói'], warnings, manifest: null, files: entries.length, size: 0 };

  let json;
  try { json = JSON.parse(mf.data.toString('utf8')); } catch (e) { return { errors: ['gamehub.json không phải JSON hợp lệ: ' + e.message], warnings, manifest: null, files: entries.length, size: 0 }; }
  const r = validateManifest(json);
  errors.push(...r.errors); warnings.push(...r.warnings);
  const manifest = r.manifest;

  let size = 0;
  for (const e of entries) {
    size += e.data.length;
    const base = e.name.split('/').pop();
    const ext = (base.includes('.') ? base.split('.').pop() : '').toLowerCase();
    if (base.startsWith('.')) errors.push(`Không cho phép file ẩn: ${e.name}`);
    else if (!ALLOWED_EXT.has(ext)) errors.push(`Loại file không được phép (.${ext || '?'}): ${e.name}`);
    if (!/^[\w ./()@+-]+$/.test(e.name)) errors.push(`Tên file chứa ký tự không hỗ trợ: ${e.name}`);
  }

  if (manifest) {
    const entry = byName.get(manifest.entry);
    if (!entry) errors.push(`Không tìm thấy file entry "${manifest.entry}"`);
    if (manifest.thumbnail) {
      const t = byName.get(manifest.thumbnail);
      if (!t) errors.push(`Không tìm thấy thumbnail "${manifest.thumbnail}"`);
      else if (t.data.length > 512 * 1024) errors.push('Thumbnail quá lớn (tối đa 512KB)');
    } else warnings.push('Chưa có "thumbnail" — game sẽ hiển thị ảnh mặc định (khuyên dùng ảnh 640x360).');

    // quét nội dung text
    let usesSdk = false, usesReady = false, usesGameOver = false, usesRewards = false;
    for (const e of entries) {
      if (!/\.(html?|m?js)$/i.test(e.name) || e.data.length > 6 * 1024 * 1024) continue;
      const text = e.data.toString('utf8');
      if (/GameHub|gamehub-sdk/.test(text)) usesSdk = true;
      if (/GameHub\.ready|\.ready\(\)/.test(text)) usesReady = true;
      if (/gameOver|submitScore/.test(text)) usesGameOver = true;
      if (/requestReward|showRewardedAd/.test(text) && !/gamehub-sdk/.test(e.name)) usesRewards = true;
      if (/\.html?$/i.test(e.name)) {
        const ext = text.match(/(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\/[^"']+/gi);
        if (ext) errors.push(`${e.name}: tải tài nguyên từ bên ngoài sẽ bị chặn bởi CSP — hãy đưa vào gói (${ext[0].slice(0, 80)}...)`);
      } else if (/\b(?:fetch|XMLHttpRequest|WebSocket|importScripts)\b[^;]{0,80}["']\s*(?:https?|wss?):\/\//.test(text)) {
        warnings.push(`${e.name}: có vẻ gọi mạng ra bên ngoài — các yêu cầu này sẽ bị CSP chặn.`);
      }
      if (/\b(?:document\.cookie|window\.top|top\.location|parent\.document)\b/.test(text) && !/gamehub-sdk/.test(e.name))
        warnings.push(`${e.name}: truy cập cookie/top/parent — bị sandbox chặn, hãy dùng GameHub SDK.`);
    }
    if (usesRewards && !manifest.rewards.length) warnings.push('Game gọi requestReward() nhưng chưa khai báo "rewards" trong gamehub.json.');
    if (!usesSdk) warnings.push('Không thấy game dùng GameHub SDK — game sẽ không lưu được điểm/thành tựu.');
    else {
      if (!usesReady) warnings.push('Game chưa gọi GameHub.ready() khi tải xong — màn hình loading sẽ tự tắt sau 8 giây.');
      if (manifest.scoring && !usesGameOver) warnings.push('Có "scoring" nhưng không thấy lời gọi submitScore()/gameOver().');
    }
  }
  return { errors, warnings, manifest, files: entries.length, size };
}

module.exports = { validateManifest, validatePackage, CATEGORIES, CONTROLS, PERMISSIONS, SLUG_RE };
