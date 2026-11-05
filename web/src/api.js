export const CAT = {
  arcade: 'Arcade',
  io: '.io',
  puzzle: 'Giải đố',
  action: 'Hành động',
  strategy: 'Chiến thuật',
  racing: 'Đua xe',
  sports: 'Thể thao',
  casual: 'Giải trí',
  board: 'Cờ bàn',
  adventure: 'Phiêu lưu',
  other: 'Khác',
};

export const AVATARS = [
  'smile', 'laugh', 'glasses', 'bot', 'ghost', 'cat', 'dog', 'rabbit', 'bird', 'fish', 'turtle', 'squirrel',
  'rocket', 'zap', 'flame', 'gamepad-2', 'crown', 'wand-sparkles', 'swords', 'skull', 'gem', 'star',
];

export const MATCH_END = {
  left: 'rời phòng',
  room_closed: 'phòng đóng',
  win: 'thắng',
  loss: 'thua',
  draw: 'hòa',
};

export function num(n) {
  return Number(n || 0).toLocaleString('vi-VN');
}

export function dateStr(t) {
  return new Date(t).toLocaleDateString('vi-VN');
}

export function dur(s) {
  return s >= 3600
    ? `${Math.floor(s / 3600)}g ${Math.floor((s % 3600) / 60)}p`
    : s >= 60
    ? `${Math.floor(s / 60)} phút`
    : `${s} giây`;
}

export async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-GH': '1' };
  let payload;
  if (raw) {
    payload = raw;
    headers['Content-Type'] = 'application/zip';
  } else if (body !== undefined) {
    payload = JSON.stringify(body);
    headers['Content-Type'] = 'application/json';
  }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* empty */
  }
  if (!res.ok) {
    const e = new Error((data && data.error) || `Lỗi ${res.status}`);
    e.status = res.status;
    e.data = data;
    throw e;
  }
  return data;
}
