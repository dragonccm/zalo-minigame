// Bản thử nghiệm: kiểm tra 5 điều kiện để GameHub chạy được trong Zalo Mini App.
// Kết quả + thông tin môi trường hiển thị trên màn hình — bấm "Sao chép kết quả" để gửi lại cho đội phát triển.
import { getAccessToken, getSystemInfo, getUserID } from 'zmp-sdk/apis';

const API = __GAMEHUB_API__.replace(/\/$/, '');
const GAME = 'chess';
const $ = id => document.getElementById(id);
$('api').textContent = API;

const results = [];
function check(name) {
  const li = document.createElement('li');
  li.className = 'wait';
  li.innerHTML = '<b></b><small></small>';
  li.querySelector('b').textContent = name;
  $('checks').append(li);
  const r = { name, status: 'wait', note: '' };
  results.push(r);
  const set = (status, note) => { r.status = status; r.note = note; li.className = status; li.querySelector('small').textContent = note; };
  return { ok: n => set('ok', n), bad: n => set('bad', n), skip: n => set('skip', n) };
}
const withTimeout = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`quá ${ms / 1000}s: ${what}`)), ms))]);
const errText = e => (e && (e.message || e.code)) ? `${e.code ? e.code + ' ' : ''}${e.message || ''}` : String(e);

let token = null;
async function api(path, opts = {}) {
  const headers = { 'X-GH': '1', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(API + path, { method: opts.method || 'GET', headers, body: opts.body && JSON.stringify(opts.body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${res.status} ${data.error || ''}`.trim());
  return data;
}

async function run() {
  $('run').disabled = true;
  $('checks').textContent = '';
  results.length = 0;
  token = null;

  // 1. Gọi API khác tên miền (CORS + tên miền đã khai báo trong Zalo)
  const c1 = check('1. Gọi API máy chủ GameHub');
  try {
    const d = await withTimeout(api('/api/games'), 10000, 'GET /api/games');
    c1.ok(`${d.games.length} game: ${d.games.map(g => g.slug).join(', ')}`);
  } catch (e) {
    c1.bad(/fetch/i.test(errText(e))
      ? `${errText(e)} — máy chủ ${API} không trả lời: đang tắt, sai địa chỉ, hoặc chặn CORS (CORS_ORIGINS cần có "${location.origin}"; trong Zalo còn phải khai báo tên miền API)`
      : `${errText(e)} — kiểm tra CORS_ORIGINS có "${location.origin}"`);
  }

  // 2. Đăng nhập Zalo: access token -> máy chủ xác minh với Graph API
  const c2 = check('2. Đăng nhập bằng Zalo');
  try {
    const at = await withTimeout(getAccessToken(), 15000, 'getAccessToken');
    if (!at) throw new Error('getAccessToken trả về rỗng (đang chạy ngoài Zalo?)');
    const d = await withTimeout(api('/api/auth/zalo', { method: 'POST', body: { accessToken: at } }), 15000, 'POST /api/auth/zalo');
    token = d.token;
    c2.ok(`Tài khoản ${d.user.username} — "${d.user.displayName}"`);
  } catch (e) { c2.bad(errText(e)); }

  // 3. Token phiên qua header Authorization (thay cookie)
  const c3 = check('3. Giữ phiên đăng nhập bằng token');
  if (!token) c3.skip('bỏ qua — chưa đăng nhập được');
  else try {
    const d = await api('/api/me');
    d.user ? c3.ok(`máy chủ nhận ra ${d.user.username}`) : c3.bad('máy chủ không nhận token');
  } catch (e) { c3.bad(errText(e)); }

  // 4. WebSocket tới máy chủ (chơi online)
  const c4 = check('4. Kết nối WebSocket (chơi online)');
  try {
    const t = await api(`/api/games/${GAME}/realtime-ticket`);
    const url = `${API.replace(/^http/, 'ws')}${t.path}?ticket=${encodeURIComponent(t.ticket)}`;
    const first = await withTimeout(new Promise((resolve, reject) => {
      const ws = new WebSocket(url);
      ws.onopen = () => ws.send(JSON.stringify({ t: 'join', create: true }));
      ws.onmessage = e => { resolve(String(e.data).slice(0, 80)); ws.close(); };
      ws.onerror = () => reject(new Error('lỗi kết nối'));
      ws.onclose = e => reject(new Error(`đóng trước khi nhận dữ liệu (mã ${e.code})`));
    }), 10000, 'WebSocket');
    c4.ok(`nhận được: ${first}`);
  } catch (e) {
    c4.bad(/fetch/i.test(errText(e))
      ? `${errText(e)} — không xin được vé vào phòng (máy chủ không trả lời, xem mục 1)`
      : `${errText(e)} — kiểm tra tên miền wss:// đã khai báo trong Zalo`);
  }

  // 5. Nhúng game bằng iframe từ máy chủ GameHub: game dùng SDK gửi postMessage cho trang cha
  const c5 = check('5. Chạy game trong iframe');
  try {
    const frame = $('game');
    const msg = await withTimeout(new Promise(resolve => {
      const on = e => {
        if (e.source !== frame.contentWindow || !e.data || e.data.gh !== 1) return;
        window.removeEventListener('message', on);
        resolve(e.data.type || e.data.event || 'message');
      };
      window.addEventListener('message', on);
      frame.src = `${API}/g/${GAME}/`;
    }), 15000, 'game gửi tin nhắn SDK');
    c5.ok(`game đã tải và gửi "${msg}" qua SDK`);
  } catch (e) { c5.bad(`${errText(e)} — iframe bị chặn (frame-ancestors / Zalo không cho nhúng?)`); }

  await showEnv();
  $('run').disabled = false;
}

async function showEnv() {
  const env = { origin: location.origin, href: location.href, userAgent: navigator.userAgent, api: API };
  try { env.system = await withTimeout(getSystemInfo(), 3000, 'getSystemInfo'); } catch (e) { env.system = errText(e); }
  try { env.zaloUserId = await withTimeout(getUserID(), 3000, 'getUserID'); } catch (e) { env.zaloUserId = errText(e); }
  $('env').textContent = JSON.stringify(env, null, 2);
}

$('run').onclick = run;
$('copy').onclick = async () => {
  const text = results.map(r => `[${r.status}] ${r.name}: ${r.note}`).join('\n') + '\n\n' + $('env').textContent;
  try { await navigator.clipboard.writeText(text); $('copy').textContent = 'Đã sao chép'; }
  catch { $('copy').textContent = 'Không sao chép được — chụp màn hình giúp nhé'; }
};
showEnv();
