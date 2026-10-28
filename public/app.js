(() => {
'use strict';

// ---------- tiện ích ----------
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = n => Number(n).toLocaleString('vi-VN');
const dateStr = t => new Date(t).toLocaleDateString('vi-VN');
const dur = s => s >= 3600 ? `${Math.floor(s / 3600)}g ${Math.floor(s % 3600 / 60)}p` : s >= 60 ? `${Math.floor(s / 60)} phút` : `${s} giây`;
const CAT = { arcade: 'Arcade', io: '.io', puzzle: 'Giải đố', action: 'Hành động', strategy: 'Chiến thuật', racing: 'Đua xe', sports: 'Thể thao', casual: 'Giải trí', board: 'Cờ bàn', adventure: 'Phiêu lưu', other: 'Khác' };
// icon SVG (Lucide) — xem public/icons.js; avatar & icon thành tựu/nhiệm vụ lưu bằng tên icon
const AVATARS = ['smile', 'laugh', 'glasses', 'bot', 'ghost', 'cat', 'dog', 'rabbit', 'bird', 'fish', 'turtle', 'squirrel',
  'rocket', 'zap', 'flame', 'gamepad-2', 'crown', 'wand-sparkles', 'swords', 'skull', 'gem', 'star'];
const av = (name, cls) => ic(ic.or(name, 'smile'), cls);      // avatar người chơi
const aic = name => ic(ic.or(name, 'trophy'));                 // icon thành tựu
const tic = name => ic(ic.or(name, 'link'));                   // icon nhiệm vụ
const MATCH_END = { left: 'rời phòng', room_closed: 'phòng đóng', win: 'thắng', loss: 'thua', draw: 'hòa' };
const view = $('#view');

async function api(path, { method = 'GET', body, raw } = {}) {
  const headers = { 'X-GH': '1' };
  let payload;
  if (raw) { payload = raw; headers['Content-Type'] = 'application/zip'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  const res = await fetch(path, { method, headers, body: payload, credentials: 'same-origin' });
  let data = null;
  try { data = await res.json(); } catch { /* không có body */ }
  if (!res.ok) {
    const e = new Error((data && data.error) || `Lỗi ${res.status}`);
    e.status = res.status; e.data = data;
    throw e;
  }
  return data;
}

function toast(html, cls = '', ms = 4200) {
  const t = document.createElement('div');
  t.className = 'toast ' + cls;
  t.innerHTML = html;
  $('#toasts').appendChild(t);
  setTimeout(() => t.remove(), ms);
}
const errToast = e => toast(ic('triangle-alert') + ' ' + esc(e.message), 'bad');

// ---------- modal ----------
function openModal(html, wide) {
  const card = $('#modalCard');
  card.className = 'modal-card' + (wide ? ' wide' : '');
  card.innerHTML = html;
  $('#modal').classList.remove('hidden');
  return card;
}
let modalCleanup = null;
function closeModal() {
  $('#modal').classList.add('hidden');
  $('#modalCard').innerHTML = '';
  if (modalCleanup) { modalCleanup(); modalCleanup = null; }
}
$('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
window.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').classList.contains('hidden')) closeModal(); });

// ---------- phiên đăng nhập ----------
let me = null;
async function refreshMe() {
  try { me = (await api('/api/me')).user; } catch { me = null; }
  renderUserbox();
}
function renderUserbox() {
  const box = $('#userbox');
  $('#navAdmin').classList.toggle('hidden', !(me && me.role === 'admin'));
  if (!me) {
    box.innerHTML = '<button class="btn sm" data-act="login">Đăng nhập</button><button class="btn sm primary" data-act="register">Đăng ký</button>';
    return;
  }
  box.innerHTML = `<a class="userchip" href="#/u/${esc(me.username)}"><span class="avatar">${av(me.avatar)}</span>${esc(me.displayName)} <span class="lvl">Lv ${me.level}</span></a>
    <button class="btn sm" data-act="logout">Thoát</button>`;
}

function authModal(mode = 'login') {
  const isReg = mode === 'register';
  const card = openModal(`
    <h2>${isReg ? ic('sparkles') + ' Tạo tài khoản' : ic('key-round') + ' Đăng nhập'}</h2>
    <form id="authForm">
      <label class="field">Tên đăng nhập<input name="username" type="text" required minlength="3" maxlength="20" autocomplete="username"></label>
      ${isReg ? '<label class="field">Tên hiển thị (tùy chọn)<input name="displayName" type="text" maxlength="24"></label>' : ''}
      <label class="field">Mật khẩu<input name="password" type="password" required minlength="${isReg ? 8 : 1}" autocomplete="${isReg ? 'new-password' : 'current-password'}"></label>
      ${isReg ? '<p class="muted small">Mật khẩu từ 8 ký tự. Tài khoản giúp lưu điểm, thành tựu và tiến trình game của bạn.</p>' : ''}
      <button class="btn primary" style="width:100%" type="submit">${isReg ? 'Đăng ký' : 'Đăng nhập'}</button>
    </form>
    <p class="center muted small" style="margin:14px 0 0">${isReg ? 'Đã có tài khoản?' : 'Chưa có tài khoản?'}
      <a href="#" id="authSwitch">${isReg ? 'Đăng nhập' : 'Đăng ký'}</a></p>`);
  $('#authSwitch', card).onclick = e => { e.preventDefault(); authModal(isReg ? 'login' : 'register'); };
  $('input', card).focus();
  $('#authForm', card).onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try {
      const r = await api(isReg ? '/api/auth/register' : '/api/auth/login', { method: 'POST', body: f });
      me = r.user; renderUserbox(); closeModal();
      toast(`${ic('hand')} Xin chào <b>${esc(me.displayName)}</b>!`, 'good');
      route();
    } catch (err) { errToast(err); }
  };
}

document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  if (act === 'login' || act === 'register') authModal(act);
  else if (act === 'logout') { await api('/api/auth/logout', { method: 'POST' }).catch(() => {}); me = null; renderUserbox(); toast('Đã đăng xuất'); route(); }
});

// ---------- cầu nối portal <-> game (GameHub SDK protocol v1) ----------
class GameHost {
  constructor(iframe, game, opts = {}) {
    this.iframe = iframe; this.game = game; this.preview = !!opts.preview; this.opts = opts;
    this.playId = null; this.muted = false; this.guestHinted = false; this.mock = { best: null, ach: {}, save: null };
    this.onMsg = e => this.onMessage(e);
    // khi người chơi quay lại từ tab TikTok/Facebook mà bảng nhiệm vụ vẫn mở thì game vẫn phải dừng
    this.onVis = () => { if (!document.hidden && this.taskBusy) return; this.send({ event: document.hidden ? 'pause' : 'resume' }); };
    window.addEventListener('message', this.onMsg);
    document.addEventListener('visibilitychange', this.onVis);
  }
  destroy() {
    window.removeEventListener('message', this.onMsg);
    document.removeEventListener('visibilitychange', this.onVis);
    this.endPlay(true);
  }
  send(msg) { try { this.iframe.contentWindow.postMessage({ gh: 1, ...msg }, '*'); } catch { /* iframe đã đóng */ } }
  setMuted(m) { this.muted = m; this.send({ event: 'mute', data: { muted: m } }); }
  log(type, payload, result) { if (this.opts.log) this.opts.log(type, payload, result); }

  async onMessage(e) {
    if (e.source !== this.iframe.contentWindow) return;           // chỉ nhận từ iframe của game này
    const m = e.data;
    if (!m || m.gh !== 1 || typeof m.type !== 'string') return;
    try {
      const data = await this.handle(m.type, m.payload || {});
      this.log(m.type, m.payload, data);
      this.send({ replyTo: m.id, ok: true, data });
    } catch (err) {
      this.log(m.type, m.payload, { error: err.message });
      this.send({ replyTo: m.id, ok: false, error: err.message, code: err.status || 'error' });
    }
  }

  playerInfo() {
    return me ? { id: me.id, username: me.username, displayName: me.displayName, avatar: me.avatar, guest: false }
      : { id: null, username: null, displayName: 'Khách', avatar: 'user-round', guest: true };
  }
  hintLogin() {
    if (this.guestHinted || this.preview) return;
    this.guestHinted = true;
    toast(ic('lock') + ' Đăng nhập để lưu điểm & thành tựu <button class="btn sm primary" data-act="login" style="margin-left:6px">Đăng nhập</button>', '', 7000);
  }
  async endPlay(quiet) {
    if (!this.playId || this.preview) return;
    const id = this.playId; this.playId = null;
    try { await fetch(`/api/games/${this.game.slug}/play/${id}/end`, { method: 'POST', headers: { 'X-GH': '1' }, credentials: 'same-origin', keepalive: true }); }
    catch { /* bỏ qua */ }
    if (!quiet) refreshMe();
  }

  async submit(score, meta) {
    if (this.preview) {
      const isNew = this.mock.best === null || score > this.mock.best; if (isNew) this.mock.best = score;
      return { saved: true, best: this.mock.best, isNewBest: isNew, rank: 1, preview: true };
    }
    if (!me) { this.hintLogin(); return { saved: false, reason: 'login' }; }
    try {
      const r = await api(`/api/games/${this.game.slug}/score`, { method: 'POST', body: { score, meta } });
      toast(`<span class="big">${ic('medal')}</span>Đã lưu <b>${num(score)}</b> điểm — hạng <b>#${r.rank}</b>${r.isNewBest ? ' · ' + ic('flame') + ' kỷ lục mới!' : ''}`, 'good');
      if (this.opts.onScore) this.opts.onScore(r);
      refreshMe();
      return r;
    } catch (e) { return { saved: false, reason: e.status === 429 ? 'rate' : e.status === 403 ? 'forbidden' : 'error', error: e.message }; }
  }

  async rewardStatus(placement) {
    if (this.preview) {
      const p = (this.game.rewards || []).find(r => r.placement === placement);
      return p ? { available: true, placement: p, preview: true, tasks: [PREVIEW_TASK] } : { available: false, reason: 'unknown_placement' };
    }
    try { return await api(`/api/games/${this.game.slug}/rewards/${encodeURIComponent(placement)}`); }
    catch (e) { return { available: false, reason: e.status === 404 ? 'unknown_placement' : e.status === 403 ? 'forbidden' : 'error', error: e.message }; }
  }

  // Game xin thưởng -> portal cho người chơi chọn & làm nhiệm vụ (game bị tạm dừng trong lúc đó)
  async requestReward(placement) {
    if (this.taskBusy) return { rewarded: false, reason: 'busy' };
    this.taskBusy = true;
    let paused = false, taskOpen = false;
    try {
      const offer = await this.rewardStatus(placement);
      if (!offer.available) {
        if (offer.reason === 'login') this.hintLogin();
        const { tasks, ...rest } = offer;
        return { rewarded: false, ...rest };
      }
      // báo máy chủ "đang làm nhiệm vụ" TRƯỚC khi báo game, để phòng online cho phép nhân vật tàng hình
      if (!this.preview) await api(`/api/games/${this.game.slug}/rewards/${encodeURIComponent(placement)}/open`, { method: 'POST' }).catch(() => {});
      this.send({ event: 'pause' }); this.send({ event: 'mute', data: { muted: true } });
      this.send({ event: 'task', data: { open: true, placement } });
      paused = true; taskOpen = true;
      return await taskOverlay(this, offer);
    } finally {
      this.taskBusy = false;
      if (taskOpen) {
        this.send({ event: 'task', data: { open: false, placement } });   // nhân vật hiện lại (game tự cho vài giây bảo vệ)
        if (!this.preview) api(`/api/games/${this.game.slug}/rewards/close`, { method: 'POST' }).catch(() => {});
      }
      if (paused) { this.send({ event: 'mute', data: { muted: this.muted } }); if (!document.hidden) this.send({ event: 'resume' }); }
    }
  }

  async handle(type, p) {
    const slug = this.game.slug;
    switch (type) {
      case 'init': return { player: this.playerInfo(), game: { slug, name: this.game.name, version: this.game.version }, settings: { muted: this.muted }, preview: this.preview, rewards: this.game.rewards || [] };
      case 'rtTicket': {
        if (this.preview) { const e = new Error('Multiplayer chưa dùng được khi xem thử — hãy thử sau khi game được duyệt'); e.status = 'preview'; throw e; }
        const r = await api(`/api/games/${slug}/realtime-ticket`);
        return { url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${r.path}?ticket=${encodeURIComponent(r.ticket)}`, mode: r.mode, maxPlayers: r.maxPlayers };
      }
      case 'rewardStatus': return this.rewardStatus(String(p.placement || ''));
      case 'requestReward': return this.requestReward(String(p.placement || ''));
      case 'ready': if (this.opts.onReady) this.opts.onReady(); return {};
      case 'gameStart':
        if (!this.preview) { await this.endPlay(true); this.playId = (await api(`/api/games/${slug}/play`, { method: 'POST' })).playId; }
        return {};
      case 'gameOver': {
        await this.endPlay();
        const hasScore = p.score !== undefined && p.score !== null;
        return { score: hasScore ? await this.submit(Number(p.score), p.meta) : null };
      }
      case 'submitScore': return this.submit(Number(p.score), p.meta);
      case 'unlockAchievement': {
        if (this.preview) { const fresh = !this.mock.ach[p.key]; this.mock.ach[p.key] = 1; return { saved: true, newlyUnlocked: fresh, preview: true }; }
        if (!me) { this.hintLogin(); return { saved: false, reason: 'login' }; }
        try {
          const r = await api(`/api/games/${slug}/achievements/${encodeURIComponent(p.key)}`, { method: 'POST' });
          if (r.newlyUnlocked) {
            toast(`<span class="big">${aic(r.achievement.icon)}</span>Thành tựu: <b>${esc(r.achievement.name)}</b><br><span class="small muted">+${r.achievement.points} XP</span>`, 'good', 5500);
            if (this.opts.onAchievement) this.opts.onAchievement(r.achievement.key);
            refreshMe();
          }
          return r;
        } catch (e) { return { saved: false, reason: e.status === 403 ? 'forbidden' : 'error', error: e.message }; }
      }
      case 'save':
        if (this.preview) { this.mock.save = p.data; return { saved: true, preview: true }; }
        if (!me) return { saved: false, reason: 'login' };
        try { return await api(`/api/games/${slug}/save`, { method: 'PUT', body: { data: p.data } }); }
        catch (e) { return { saved: false, reason: 'error', error: e.message }; }
      case 'load':
        if (this.preview) return { data: this.mock.save };
        if (!me) return { data: null };
        try { return await api(`/api/games/${slug}/save`); } catch { return { data: null }; }
      case 'leaderboard':
        if (this.preview) return { entries: [], preview: true };
        return api(`/api/games/${slug}/leaderboard?period=${encodeURIComponent(p.period || 'all')}&limit=${Math.min(50, Number(p.limit) || 10)}`);
      case 'event': return {};
      default: { const e = new Error('Lệnh không hỗ trợ: ' + type); e.status = 400; throw e; }
    }
  }
}

// ---------- giao diện làm nhiệm vụ (hiện ngay trong khung game, kể cả khi toàn màn hình) ----------
const PREVIEW_TASK = { id: 0, title: 'Nhiệm vụ mẫu (xem thử)', type: 'link', typeLabel: 'Mở liên kết', url: '', description: 'Chế độ xem thử: không mở link thật, chỉ đợi 3 giây.', icon: 'flask-conical', durationSec: 3, verify: 'time' };

function taskOverlay(host, offer) {
  return new Promise(resolve => {
    const slug = host.game.slug, p = offer.placement;
    const layer = document.createElement('div');
    layer.className = 'tasklayer';
    (host.opts.overlay || document.body).appendChild(layer);
    let run = null, timer = null, done = false;

    const finish = res => { if (done) return; done = true; clearInterval(timer); layer.remove(); resolve(res); };
    const dropRun = async () => {
      clearInterval(timer);
      if (run && !host.preview) await api(`/api/games/${slug}/rewards/runs/${run.runId}/cancel`, { method: 'POST' }).catch(() => {});
      run = null;
    };
    const close = async () => { await dropRun(); finish({ rewarded: false, reason: 'closed', placement: p.placement }); };
    const head = (title, back) => `<div class="tk-head">${back ? '<button class="tk-back" data-back title="Quay lại">‹</button>' : ''}<span>${title}</span><button class="tk-x" data-x title="Đóng">${ic('x')}</button></div>`;

    const list = () => {
      layer.innerHTML = `<div class="taskcard">${head(ic('gift') + ' Làm nhiệm vụ nhận thưởng')}
        <div class="tk-reward">${ic('gift')} ${esc(p.name)}${p.description ? `<small>${esc(p.description)}</small>` : ''}</div>
        ${offer.testMode ? `<div class="tk-test">${ic('flask-conical')} Chế độ thử nghiệm: không giới hạn lượt, chờ tối đa 5 giây</div>` : ''}
        <p class="muted small">Chọn 1 nhiệm vụ${offer.remainingToday ? ` · còn ${offer.remainingToday} lượt hôm nay` : ''}:</p>
        <div class="tk-list">${offer.tasks.map(t => `<button class="tk-item" data-t="${t.id}"><span class="tk-ic">${tic(t.icon)}</span>
          <span><b>${esc(t.title)}</b><small>${esc(t.typeLabel)} · ${ic('timer')} ${t.durationSec} giây${t.verify === 'code' ? ' · ' + ic('key-round') + ' cần mã xác nhận' : ''}</small></span><span class="tk-go">›</span></button>`).join('')}</div></div>`;
      $('[data-x]', layer).onclick = close;
      $$('[data-t]', layer).forEach(b => { b.onclick = () => detail(offer.tasks.find(t => String(t.id) === b.dataset.t)); });
    };

    const detail = task => {
      const needCode = task.verify === 'code';
      layer.innerHTML = `<div class="taskcard">${head(`${tic(task.icon)} ${esc(task.title)}`, true)}
        ${task.description ? `<p class="muted small" style="margin-top:0">${esc(task.description)}</p>` : ''}
        <ol class="tk-steps"><li>Bấm <b>${esc(task.typeLabel)}</b> — trang sẽ mở ở tab mới.</li>
          <li>Ở lại ít nhất <b>${task.durationSec} giây</b>${needCode ? ', tìm <b>mã xác nhận</b> được đọc/ghim trong đó' : ''}.</li>
          <li>Quay lại đây và bấm <b>Nhận thưởng</b>.</li></ol>
        <button class="btn primary tk-wide" data-open>${ic('external-link')} ${esc(task.typeLabel)}</button>
        <div class="tk-progress hidden" data-prog><div class="bar"><i data-bar style="width:0%"></i></div><span data-left></span></div>
        ${needCode ? '<input type="text" data-code class="hidden" placeholder="Nhập mã xác nhận" maxlength="40" autocomplete="off">' : ''}
        <div class="tk-err" data-err></div>
        <button class="btn good tk-wide hidden" data-claim disabled>${ic('gift')} Nhận thưởng: ${esc(p.name)}</button></div>`;
      const err = m => { $('[data-err]', layer).textContent = m || ''; };
      const claim = $('[data-claim]', layer), codeIn = $('[data-code]', layer);
      $('[data-x]', layer).onclick = close;
      $('[data-back]', layer).onclick = async () => { await dropRun(); list(); };

      $('[data-open]', layer).onclick = async e => {
        if (task.url) window.open(task.url, '_blank', 'noopener,noreferrer');   // mở trong lúc người dùng bấm để không bị chặn popup
        if (run) return;                                                       // mở lại link: không tính lại thời gian
        err('');
        try {
          run = host.preview ? { runId: 0 } : await api(`/api/games/${slug}/rewards/${encodeURIComponent(p.placement)}/start`, { method: 'POST', body: { taskId: task.id } });
        } catch (ex) { err(ex.message); return; }
        e.target.innerHTML = ic('external-link') + ' Mở lại link';
        e.target.classList.remove('primary');
        $('[data-prog]', layer).classList.remove('hidden');
        claim.classList.remove('hidden');
        if (codeIn) { codeIn.classList.remove('hidden'); }
        const t0 = Date.now();                     // chỉ để hiển thị — server mới là nơi kiểm tra thời gian thật
        const tick = () => {
          const el = (Date.now() - t0) / 1000, left = Math.max(0, Math.ceil(task.durationSec - el));
          $('[data-bar]', layer).style.width = (task.durationSec ? Math.min(100, el / task.durationSec * 100) : 100) + '%';
          $('[data-left]', layer).innerHTML = left > 0 ? `Còn ${left} giây...` : ic('circle-check') + ' Đã đủ thời gian';
          claim.disabled = left > 0 || (codeIn && !codeIn.value.trim());
        };
        if (codeIn) codeIn.oninput = tick;
        timer = setInterval(tick, 250); tick();
      };

      claim.onclick = async () => {
        claim.disabled = true; err('');
        try {
          const r = host.preview ? { rewarded: true, placement: p.placement, reward: p.reward, preview: true }
            : await api(`/api/games/${slug}/rewards/runs/${run.runId}/claim`, { method: 'POST', body: { code: codeIn ? codeIn.value : '' } });
          clearInterval(timer);
          layer.innerHTML = `<div class="taskcard center"><div style="font-size:56px">${ic('party-popper')}</div><h3>Hoàn thành nhiệm vụ!</h3><p class="muted">Đã nhận: <b>${esc(p.name)}</b></p></div>`;
          if (!host.preview) refreshMe();
          setTimeout(() => finish({ rewarded: true, placement: r.placement, reward: r.reward, token: r.token || null, runId: r.runId || null, task: r.task ? { id: r.task.id, title: r.task.title, type: r.task.type } : null, preview: !!r.preview }), 1100);
        } catch (ex) {
          err(ex.message);
          if (ex.status === 409 || ex.status === 410) { run = null; clearInterval(timer); }   // hết lượt / hết hạn: phải đóng hoặc chọn lại
          else claim.disabled = false;
        }
      };
    };
    list();
  });
}

function makeFrame(game, entryUrl, wrapper) {
  const iframe = document.createElement('iframe');
  iframe.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');   // KHÔNG có allow-same-origin: game không đọc được cookie/DOM của portal
  iframe.setAttribute('allow', 'fullscreen; autoplay; gamepad');
  iframe.title = game.name;
  iframe.src = entryUrl;
  wrapper.appendChild(iframe);
  return iframe;
}

// ---------- trang chủ ----------
const home = { category: '', q: '', sort: 'popular' };
const gameCard = g => `<a class="gcard" href="#/game/${esc(g.slug)}">
  <div class="thumb">${g.thumbnail ? `<img src="${esc(g.thumbnail)}" alt="" loading="lazy">` : ic('gamepad-2')}</div>
  <div class="body"><h3>${esc(g.name)}</h3><p class="desc">${esc(g.description)}</p>
  <div class="meta"><span>${g.categories.slice(0, 2).map(c => `<span class="tag">${esc(CAT[c] || c)}</span>`).join('')}</span><span>${ic('play')} ${num(g.plays)}</span></div></div></a>`;

async function homePage() {
  const [{ games, categories }, top] = await Promise.all([api('/api/games'), api('/api/leaderboard/global')]);
  const used = categories.filter(c => games.some(g => g.categories.includes(c)));
  view.innerHTML = `
    <section class="hero"><div><h1>Chơi game HTML5 miễn phí ${ic('gamepad-2')}</h1>
      <p>Đăng nhập để lưu điểm, thành tựu và tiến trình. Bạn là nhà phát triển? Đăng game của bạn theo chuẩn GameHub để mọi người cùng chơi.</p></div>
      <span class="spacer"></span><a class="btn primary" href="#/upload">${ic('upload')} Đăng game</a></section>
    <div class="grid2"><div>
      <div class="chips" id="chips"></div>
      <div class="row" style="margin-bottom:14px"><span class="muted small" id="count"></span><span class="spacer"></span>
        <select id="sort" style="width:auto"><option value="popular">Phổ biến nhất</option><option value="new">Mới nhất</option></select></div>
      <div class="cards" id="cards"></div></div>
      <aside class="panel"><h3>${ic('trophy')} Top người chơi</h3><ul class="lb">${top.entries.length ? top.entries.slice(0, 10).map(e => `
        <li><span class="rk">${e.rank}</span><span class="avatar">${av(e.user.avatar)}</span><a class="nm" href="#/u/${esc(e.user.username)}">${esc(e.user.displayName)}</a>
        <span class="sc">${num(e.xp)} XP</span></li>`).join('') : '<li class="muted">Chưa có ai</li>'}</ul></aside></div>`;
  const draw = () => {
    $('#chips').innerHTML = `<button class="chip ${home.category ? '' : 'on'}" data-c="">Tất cả</button>` +
      used.map(c => `<button class="chip ${home.category === c ? 'on' : ''}" data-c="${c}">${esc(CAT[c] || c)}</button>`).join('');
    let list = games.filter(g => (!home.category || g.categories.includes(home.category)) &&
      (!home.q || (g.name + ' ' + g.description + ' ' + g.author).toLowerCase().includes(home.q.toLowerCase())));
    list = [...list].sort(home.sort === 'new' ? (a, b) => b.createdAt - a.createdAt : (a, b) => b.plays - a.plays);
    $('#count').textContent = `${list.length} game${home.q ? ` cho "${home.q}"` : ''}`;
    $('#cards').innerHTML = list.length ? list.map(gameCard).join('') : '<p class="muted">Không tìm thấy game phù hợp.</p>';
  };
  $('#sort').value = home.sort;
  $('#sort').onchange = e => { home.sort = e.target.value; draw(); };
  $('#chips').onclick = e => { const c = e.target.closest('[data-c]'); if (c) { home.category = c.dataset.c; draw(); } };
  draw();
}

$('#searchForm').addEventListener('submit', e => {
  e.preventDefault();
  home.q = $('#searchInput').value.trim();
  if ((location.hash || '#/') === '#/') route(); else location.hash = '#/';
});

// ---------- trang chơi game ----------
async function gamePage(slug) {
  const { game } = await api(`/api/games/${encodeURIComponent(slug)}`);
  const unlocked = new Set(((game.me && game.me.unlocked) || []).map(x => x.key));
  document.title = `${game.name} — GameHub`;
  const portrait = game.orientation === 'portrait';
  document.body.classList.add('gamepage');
  view.innerHTML = `
    ${me ? '' : '<div class="banner" style="margin-bottom:10px">' + ic('lock') + ' Bạn đang chơi với tư cách khách — <a href="#" data-act="login">đăng nhập</a> để lưu điểm, thành tựu và tiến trình.</div>'}
    <div class="gamegrid"><div class="gamemain">
      <div class="stage"><div class="player ${portrait ? 'portrait' : ''}" id="player"><div class="loading" id="loading"><div><div class="spin"></div>Đang tải ${esc(game.name)}...</div></div></div></div>
      <div class="gamebar"><h1>${esc(game.name)}</h1>
        <span class="muted small gmeta">v${esc(game.version)} · ${esc(game.author)} · ${ic('play')} ${num(game.plays)}</span><span class="spacer"></span>
        <button class="btn sm" id="bReload" title="Tải lại game">${ic('rotate-ccw')}</button>
        <button class="btn sm" id="bMute" title="Tắt/bật tiếng">${ic('volume-2')}</button>
        <button class="btn sm" id="bFull" title="Toàn màn hình">${ic('maximize')}</button></div>
    </div>
    <aside class="gameside">
      ${game.scoring ? `<div class="panel"><h3>${ic('trophy')} Bảng xếp hạng</h3>
        <div class="tabs"><button class="btn sm" data-p="day">Hôm nay</button><button class="btn sm" data-p="week">Tuần</button><button class="btn sm" data-p="all">Tất cả</button></div>
        <ul class="lb" id="lb"></ul><div id="lbMe" class="muted small" style="margin-top:8px"></div></div>` : ''}
      ${game.achievements.length ? `<div class="panel"><h3>${ic('award')} Thành tựu <span class="muted small" id="achCount"></span></h3><div id="achList"></div></div>` : ''}
      <div class="panel" id="nextBox" hidden><h3>${ic('gamepad-2')} Chơi tiếp theo</h3><div class="nextgrid" id="nextGrid"></div></div>
    </aside></div>
    <div class="panel gameinfo"><div class="row" style="margin-bottom:8px">
      ${game.categories.map(c => `<span class="tag">${esc(CAT[c] || c)}</span>`).join('')}
      <span class="spacer"></span><span class="muted small">${num(game.stats.players)} người có điểm</span></div>
      <p style="margin:0 0 8px">${esc(game.description)}</p>
      <p class="muted small" style="margin:0">Điều khiển: ${game.controls.length ? game.controls.map(c => ({ mouse: ic('mouse') + ' chuột', keyboard: ic('keyboard') + ' bàn phím', touch: ic('pointer') + ' cảm ứng', gamepad: ic('gamepad-2') + ' tay cầm' }[c])).join(' · ') : 'xem trong game'}</p></div>`;
  api('/api/games').then(({ games }) => {   // gợi ý game khác
    const others = games.filter(g => g.slug !== slug).slice(0, 6);
    if (!others.length || !$('#nextGrid')) return;
    $('#nextBox').hidden = false;
    $('#nextGrid').innerHTML = others.map(g => `<a class="ng" href="#/game/${esc(g.slug)}"><div class="thumb">${g.thumbnail ? `<img src="${esc(g.thumbnail)}" alt="" loading="lazy">` : ic('gamepad-2')}</div><span>${esc(g.name)}</span></a>`).join('');
  }).catch(() => {});

  const wrap = $('#player');
  const fit = () => {   // khung game + thanh tên vừa đúng phần màn hình còn lại dưới header
    const grid = $('.gamegrid'), main = $('.gamemain'), mobile = matchMedia('(max-width: 900px)').matches;
    const top = grid.getBoundingClientRect().top + scrollY, h = Math.max(380, innerHeight - top - 12) + 'px';
    grid.style.height = mobile ? '' : h; main.style.height = mobile ? h : '';
  };
  fit(); addEventListener('resize', fit); addEventListener('orientationchange', fit);
  const loading = $('#loading');
  const hideLoading = () => loading && loading.remove();
  let host = null, iframe = null;
  const start = () => {
    if (host) host.destroy();
    if (iframe) iframe.remove();
    iframe = makeFrame(game, game.entry, wrap);
    host = new GameHost(iframe, game, {
      onReady: hideLoading,
      overlay: wrap,
      onScore: () => loadLb(curPeriod),
      onAchievement: key => { unlocked.add(key); drawAch(); },
    });
    setTimeout(hideLoading, 8000);
    $('#bMute').innerHTML = ic('volume-2');
  };
  start();

  $('#bReload').onclick = () => { if (host) host.muted = false; start(); };
  $('#bMute').onclick = () => { host.setMuted(!host.muted); $('#bMute').innerHTML = ic(host.muted ? 'volume-x' : 'volume-2'); };
  const stage = $('.stage');
  const pseudoFull = on => {   // trình duyệt không hỗ trợ Fullscreen API (iPhone): phóng khung game phủ kín màn hình
    stage.classList.toggle('pfs', on); document.body.classList.toggle('pfs-on', on);
    const old = $('#pfsExit'); if (old) old.remove();
    if (on) { const x = document.createElement('button'); x.id = 'pfsExit'; x.className = 'pfs-exit'; x.innerHTML = ic('x'); x.title = 'Thoát toàn màn hình'; x.onclick = () => pseudoFull(false); stage.appendChild(x); }
  };
  $('#bFull').onclick = () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (stage.classList.contains('pfs')) pseudoFull(false);
    else if (wrap.requestFullscreen) wrap.requestFullscreen().catch(() => pseudoFull(true));
    else pseudoFull(true);
  };

  let curPeriod = 'all';
  async function loadLb(period) {
    if (!game.scoring) return;
    curPeriod = period;
    $$('[data-p]').forEach(b => b.classList.toggle('primary', b.dataset.p === period));
    try {
      const r = await api(`/api/games/${encodeURIComponent(slug)}/leaderboard?period=${period}&limit=10`);
      const unit = game.scoring.unit ? ' ' + esc(game.scoring.unit) : '';
      $('#lb').innerHTML = r.entries.length ? r.entries.map(e => `<li class="${me && e.user.username === me.username ? 'me' : ''}">
        <span class="rk">${e.rank <= 3 ? ic('medal', 'rank' + e.rank) : e.rank}</span><span class="avatar" style="width:26px;height:26px;font-size:14px">${av(e.user.avatar)}</span>
        <a class="nm" href="#/u/${esc(e.user.username)}">${esc(e.user.displayName)}</a><span class="sc">${num(e.score)}${unit}</span></li>`).join('')
        : '<li class="muted">Chưa có ai — hãy là người đầu tiên!</li>';
      $('#lbMe').textContent = r.me ? `Bạn: hạng #${r.me.rank} · ${num(r.me.score)} ${game.scoring.label.toLowerCase()}` : (me ? 'Bạn chưa có điểm trong khoảng này' : '');
    } catch (e) { errToast(e); }
  }
  function drawAch() {
    const box = $('#achList');
    if (!box) return;
    $('#achCount').textContent = `${unlocked.size}/${game.achievements.length}`;
    box.innerHTML = game.achievements.map(a => `<div class="ach ${unlocked.has(a.key) ? '' : 'locked'}" title="${esc(a.name)} — ${esc(a.description)} (+${a.points} XP)"><div class="ic">${aic(a.icon)}</div>
      <div><div class="t">${esc(a.name)}</div><div class="d">${esc(a.description)}</div></div><div class="pt">+${a.points} XP</div></div>`).join('');
  }
  $$('[data-p]').forEach(b => b.onclick = () => loadLb(b.dataset.p));
  loadLb('all'); drawAch();
  cleanup = () => { document.body.classList.remove('pfs-on'); removeEventListener('resize', fit); removeEventListener('orientationchange', fit); if (host) host.destroy(); document.title = 'GameHub — Cổng game HTML5'; };
}

// ---------- hồ sơ ----------
async function profilePage(username) {
  const d = await api(`/api/users/${encodeURIComponent(username)}`);
  const u = d.user, own = me && me.username === u.username;
  document.title = `${u.displayName} — GameHub`;
  const lo = 20 * (u.level - 1) ** 2, hi = 20 * u.level ** 2, pct = Math.min(100, Math.round((u.xp - lo) / (hi - lo) * 100));
  view.innerHTML = `
    <div class="panel phead"><span class="avatar big">${av(u.avatar)}</span>
      <div style="flex:1;min-width:240px"><h1 style="margin:0">${esc(u.displayName)} ${u.role === 'admin' ? '<span class="tag">' + ic('shield') + ' Admin</span>' : ''}</h1>
        <div class="muted">@${esc(u.username)} · tham gia ${dateStr(u.createdAt)}</div>
        <p style="margin:8px 0">${esc(u.bio) || '<span class="muted">Chưa có giới thiệu.</span>'}</p>
        <div class="row small"><span class="lvl">Lv ${u.level}</span><div class="bar" style="flex:1;min-width:140px"><i style="width:${pct}%"></i></div><span class="muted">${num(u.xp)} / ${num(hi)} XP</span></div></div>
      ${own ? '<button class="btn" id="editProfile">' + ic('pencil') + ' Chỉnh sửa hồ sơ</button>' : ''}</div>
    <div class="stats" style="margin:16px 0">
      <div class="stat"><b>${num(d.stats.plays)}</b><span>Lượt chơi</span></div>
      <div class="stat"><b>${dur(d.stats.playSeconds)}</b><span>Thời gian chơi</span></div>
      <div class="stat"><b>${d.stats.gamesPlayed}</b><span>Game đã chơi</span></div>
      <div class="stat"><b>${d.stats.achievements}</b><span>Thành tựu</span></div>
      <div class="stat"><b>${num(d.stats.achievementPoints)}</b><span>Điểm thành tựu</span></div>
      <div class="stat"><b>${num(d.stats.matches)}</b><span>Trận online</span></div>
      <div class="stat"><b>${num(d.stats.kills)}</b><span>Đối thủ đã nuốt</span></div>
      <div class="stat"><b>${d.stats.bestRoomRank ? '#' + d.stats.bestRoomRank : '—'}</b><span>Hạng cao nhất trong phòng</span></div></div>
    <div class="grid2"><div class="stack">
      <div class="panel"><h3>${ic('medal')} Điểm cao nhất</h3>${d.bestScores.length ? `<table><tr><th>Game</th><th>Điểm cao nhất</th><th>Hạng</th><th>Lượt</th></tr>${d.bestScores.map(s => `
        <tr><td><a href="#/game/${esc(s.game.slug)}">${esc(s.game.name)}</a></td><td><b>${num(s.best)}</b> <span class="muted small">${esc(s.label)}</span></td><td>#${s.rank}</td><td>${s.runs}</td></tr>`).join('')}</table>` : '<p class="muted">Chưa có điểm nào.</p>'}</div>
      ${d.matches.length ? `<div class="panel"><h3>${ic('globe')} Trận online gần đây</h3><table><tr><th>Game</th><th>Điểm</th><th>Hạng phòng</th><th>Nuốt</th><th>Thời gian</th><th>Kết thúc</th></tr>${d.matches.map(m => `
        <tr><td><a href="#/game/${esc(m.game.slug)}">${esc(m.game.name)}</a><div class="small muted">${new Date(m.endedAt).toLocaleString('vi-VN')}</div></td><td><b>${num(m.score)}</b></td>
        <td>${m.rank ? '#' + m.rank : '—'}</td><td>${m.kills}</td><td>${dur(m.seconds)}</td>
        <td class="small">${m.reason === 'death' ? (m.killedBy ? `bị ${esc(m.killedBy)} nuốt` : 'đâm vào khối lớn') : MATCH_END[m.reason] ? MATCH_END[m.reason] + (m.killedBy ? ` · ${esc(m.killedBy)}` : '') : esc(m.reason)}</td></tr>`).join('')}</table></div>` : ''}
      <div class="panel"><h3>${ic('award')} Thành tựu (${d.achievements.length})</h3><div class="agrid">${d.achievements.length ? d.achievements.map(a => `
        <div class="ach"><div class="ic">${aic(a.icon)}</div><div><div class="t">${esc(a.name)}</div><div class="d">${esc(a.game.name)} · ${dateStr(a.unlockedAt)}</div></div><div class="pt">+${a.points}</div></div>`).join('') : '<p class="muted">Chưa mở khóa thành tựu nào.</p>'}</div></div>
      </div><aside class="stack">
      <div class="panel"><h3>${ic('joystick')} Chơi gần đây</h3>${d.recent.length ? d.recent.map(g => `<a class="ach" href="#/game/${esc(g.slug)}" style="color:inherit"><div class="ic">${g.thumbnail ? `<img src="${esc(g.thumbnail)}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:12px">` : ic('gamepad-2')}</div>
        <div><div class="t">${esc(g.name)}</div><div class="d">${g.plays} lượt · ${dateStr(g.lastPlayed)}</div></div></a>`).join('') : '<p class="muted">Chưa chơi game nào.</p>'}</div>
      ${d.developed.length ? `<div class="panel"><h3>${ic('wrench')} Game đã phát hành</h3>${d.developed.map(g => `<a class="ach" href="#/game/${esc(g.slug)}" style="color:inherit"><div class="ic">${ic('gamepad-2')}</div><div><div class="t">${esc(g.name)}</div><div class="d">${ic('play')} ${num(g.plays)} lượt chơi</div></div></a>`).join('')}</div>` : ''}
      </aside></div>`;
  if (own) $('#editProfile').onclick = () => editProfileModal();
}

function editProfileModal() {
  let avatar = me.avatar;
  const card = openModal(`<h2>${ic('pencil')} Chỉnh sửa hồ sơ</h2><form id="pf">
    <label class="field">Tên hiển thị<input name="displayName" type="text" maxlength="24" required value="${esc(me.displayName)}"></label>
    <div class="muted small" style="font-weight:600">Avatar</div><div class="emoji-pick" id="ep">${AVATARS.map(e => `<button type="button" data-e="${e}" title="${e}" class="${e === avatar ? 'on' : ''}">${ic(e)}</button>`).join('')}</div>
    <label class="field">Giới thiệu<textarea name="bio" rows="3" maxlength="200">${esc(me.bio)}</textarea></label>
    <div class="row"><button class="btn primary" type="submit">Lưu</button><button class="btn" type="button" id="pwBtn">Đổi mật khẩu</button></div></form>`);
  $('#ep', card).onclick = e => { const b = e.target.closest('[data-e]'); if (!b) return; avatar = b.dataset.e; $$('#ep button', card).forEach(x => x.classList.toggle('on', x === b)); };
  $('#pf', card).onsubmit = async e => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    try { me = (await api('/api/me', { method: 'PATCH', body: { ...f, avatar } })).user; renderUserbox(); closeModal(); toast('Đã lưu hồ sơ', 'good'); route(); } catch (err) { errToast(err); }
  };
  $('#pwBtn', card).onclick = () => {
    const c = openModal(`<h2>${ic('lock-keyhole')} Đổi mật khẩu</h2><form id="pw"><label class="field">Mật khẩu cũ<input name="oldPassword" type="password" required></label>
      <label class="field">Mật khẩu mới (từ 8 ký tự)<input name="newPassword" type="password" required minlength="8"></label><button class="btn primary" type="submit">Đổi mật khẩu</button></form>`);
    $('#pw', c).onsubmit = async e => {
      e.preventDefault();
      try { await api('/api/me/password', { method: 'POST', body: Object.fromEntries(new FormData(e.target)) }); closeModal(); toast('Đã đổi mật khẩu', 'good'); } catch (err) { errToast(err); }
    };
  };
}

// ---------- đăng game ----------
const reportHtml = (errors, warnings, okMsg) => `
  ${errors.length ? `<div class="report err"><b>${ic('circle-x')} Chưa đạt chuẩn — ${errors.length} lỗi cần sửa:</b><ul>${errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  ${warnings.length ? `<div class="report warn"><b>${ic('triangle-alert')} Cảnh báo (không chặn upload):</b><ul>${warnings.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
  ${!errors.length && okMsg ? `<div class="report ok">${okMsg}</div>` : ''}`;

async function uploadPage() {
  if (!me) {
    view.innerHTML = `<div class="panel center" style="max-width:560px;margin:40px auto"><h2>${ic('upload')} Đăng game của bạn</h2>
      <p class="muted">Bạn cần đăng nhập để gửi game. Game sẽ được quản trị viên xem xét trước khi hiển thị công khai.</p>
      <button class="btn primary" data-act="login">Đăng nhập</button> <button class="btn" data-act="register">Tạo tài khoản</button>
      <p class="small" style="margin-top:16px"><a href="#/docs">${ic('book-open')} Xem chuẩn game & SDK</a></p></div>`;
    return;
  }
  view.innerHTML = `<div class="grid2"><div class="stack">
    <div class="panel"><h2>${ic('upload')} Đăng game</h2>
      <p class="muted">Nén game thành <b>.zip</b> theo chuẩn GameHub (có <code>gamehub.json</code> ở thư mục gốc và dùng <code>GameHub SDK</code>). Máy chủ sẽ kiểm tra tự động, sau đó quản trị viên xem và duyệt.</p>
      <div class="drop" id="drop"><div style="font-size:42px">${ic('package')}</div><b>Kéo thả file .zip vào đây</b><div class="muted small">hoặc bấm để chọn · tối đa 30MB</div>
        <input type="file" id="file" accept=".zip,application/zip" hidden></div><div id="result"></div></div>
    <div class="panel"><h3>${ic('send')} Các lần gửi của bạn</h3><div id="subs">Đang tải...</div></div></div>
    <aside class="panel"><h3>${ic('circle-check')} Checklist nhanh</h3><ul style="padding-left:18px;margin:0" class="muted">
      <li><code>gamehub.json</code> ở gốc gói</li><li>Có file <code>index.html</code> (entry)</li><li>Mọi file nằm trong gói — <b>không</b> tải CDN/ngoài</li>
      <li>Gọi <code>GameHub.init()</code>, <code>ready()</code>, <code>submitScore()</code></li><li>Có <code>thumbnail</code> 640×360</li><li>Tăng <code>version</code> khi cập nhật</li></ul>
      <p style="margin-top:14px"><a class="btn" href="#/docs">${ic('book-open')} Đọc tài liệu</a></p>
      <p class="small muted">Kiểm tra trước khi gửi:<br><code>npm run validate -- ./game-cua-ban</code></p></aside></div>`;

  const loadSubs = async () => {
    try {
      const { submissions } = await api('/api/my/submissions');
      $('#subs').innerHTML = submissions.length ? submissions.map(s => `<div class="panel" style="margin-bottom:10px;background:var(--card2)">
        <div class="row"><b>${esc(s.manifest.name)}</b> <span class="muted small">v${esc(s.version)}</span><span class="status ${s.status}">${({ pending: 'Chờ duyệt', approved: 'Đã duyệt', rejected: 'Bị từ chối', withdrawn: 'Đã rút' })[s.status]}</span>
        <span class="spacer"></span><span class="muted small">${dateStr(s.createdAt)}</span>${s.status === 'pending' ? `<button class="btn sm" data-pv="${s.id}">${ic('play')} Chơi thử</button><button class="btn sm bad" data-wd="${s.id}">Rút lại</button>` : ''}</div>
        ${s.note ? `<div class="report ${s.status === 'rejected' ? 'err' : 'ok'}" style="margin-top:8px"><b>Phản hồi từ quản trị viên:</b> ${esc(s.note)}</div>` : ''}
        ${s.status === 'approved' ? `<div style="margin-top:6px"><a href="#/game/${esc(s.slug)}">→ Mở trang game</a></div>` : ''}</div>`).join('') : '<p class="muted">Chưa có lần gửi nào.</p>';
    } catch (e) { $('#subs').textContent = e.message; }
  };
  loadSubs();
  $('#subs').onclick = async e => {
    const pv = e.target.closest('[data-pv]');
    if (pv) { const { submissions } = await api('/api/my/submissions'); const s = submissions.find(x => String(x.id) === pv.dataset.pv); if (s) previewModal(s); return; }
    const b = e.target.closest('[data-wd]'); if (!b) return;
    try { await api(`/api/submissions/${b.dataset.wd}`, { method: 'DELETE' }); toast('Đã rút bản gửi'); loadSubs(); } catch (err) { errToast(err); }
  };

  const send = async file => {
    const out = $('#result');
    if (!file) return;
    if (!/\.zip$/i.test(file.name)) { out.innerHTML = reportHtml(['Chỉ nhận file .zip'], []); return; }
    out.innerHTML = '<div class="report warn">' + ic('hourglass') + ' Đang tải lên và kiểm tra...</div>';
    try {
      const r = await api('/api/submissions', { method: 'POST', raw: file });
      out.innerHTML = reportHtml([], r.warnings, `<b>${ic('check')} Đã gửi duyệt!</b> "${esc(r.submission.manifest.name)}" v${esc(r.submission.version)} đang chờ quản trị viên xem xét.`);
      loadSubs();
    } catch (e) { out.innerHTML = reportHtml((e.data && e.data.errors) || [e.message], (e.data && e.data.warnings) || []); }
  };
  const drop = $('#drop'), file = $('#file');
  drop.onclick = () => file.click();
  file.onchange = () => { send(file.files[0]); file.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); send(e.dataTransfer.files[0]); };
}

// ---------- tài liệu ----------
async function docsPage() {
  const html = await (await fetch('/docs.html')).text();
  view.innerHTML = `<div class="docs">${html}</div>`;
  const list = $('#iconList');
  if (list) list.innerHTML = ic.names.map(n => `<div title="${n}">${ic(n)}<code>${n}</code></div>`).join('');
}

// ---------- quản trị ----------
const admin = { tab: 'pending' };
async function adminPage() {
  if (!me || me.role !== 'admin') { view.innerHTML = '<div class="panel center"><h2>' + ic('lock') + ' Chỉ dành cho quản trị viên</h2></div>'; return; }
  const st = await api('/api/admin/stats');
  view.innerHTML = `<h1>${ic('shield')} Quản trị</h1>
    <div class="stats" style="margin-bottom:16px">${[['Chờ duyệt', st.pending], ['Game đang chạy', st.games], ['Người dùng', st.users], ['Lượt chơi', st.plays], ['Trận online', st.matches], ['Đang online', `${st.playersOnline} người / ${st.roomsOnline} phòng`], ['Nhiệm vụ xong (24h)', st.tasksToday]]
      .map(([k, v]) => `<div class="stat"><b>${typeof v === 'number' ? num(v) : esc(v)}</b><span>${k}</span></div>`).join('')}</div>
    <p class="muted small" style="margin:-6px 0 12px">Cơ sở dữ liệu: <b>${st.db === 'postgres' ? 'PostgreSQL' : 'PGlite (nhúng, dùng khi phát triển)'}</b></p>
    <div class="chips" id="atabs">${[['pending', `Chờ duyệt (${st.pending})`], ['done', 'Đã xử lý'], ['games', 'Game'], ['tasks', ic('target') + ' Nhiệm vụ'], ['users', 'Người dùng'], ['audit', ic('scroll-text') + ' Nhật ký']]
      .map(([k, t]) => `<button class="chip ${admin.tab === k ? 'on' : ''}" data-t="${k}">${t}</button>`).join('')}</div><div id="apane">Đang tải...</div>`;
  $('#atabs').onclick = e => { const b = e.target.closest('[data-t]'); if (b) { admin.tab = b.dataset.t; adminPage(); } };
  const pane = $('#apane');
  try {
    if (admin.tab === 'pending') await adminPending(pane);
    else if (admin.tab === 'done') await adminDone(pane);
    else if (admin.tab === 'games') await adminGames(pane);
    else if (admin.tab === 'tasks') await adminTasks(pane);
    else if (admin.tab === 'audit') await adminAudit(pane);
    else await adminUsers(pane);
  } catch (e) { pane.innerHTML = `<div class="report err">${esc(e.message)}</div>`; }
}

const kv = s => `<dl class="kv"><dt>Slug</dt><dd><code>${esc(s.slug)}</code></dd><dt>Phiên bản</dt><dd>${esc(s.version)}</dd><dt>Tác giả</dt><dd>${esc(s.manifest.author)} <span class="muted">(@${esc(s.owner.username)})</span></dd>
  <dt>Thể loại</dt><dd>${s.manifest.categories.map(c => `<span class="tag">${esc(CAT[c] || c)}</span>`).join('')}</dd><dt>Quyền</dt><dd>${s.manifest.permissions.join(', ') || '—'}</dd>
  <dt>Bảng điểm</dt><dd>${s.manifest.scoring ? `${esc(s.manifest.scoring.label)} (${s.manifest.scoring.order})` : 'không có'}</dd><dt>Thành tựu</dt><dd>${s.manifest.achievements.length}</dd>
  <dt>Gói</dt><dd>${s.files} file · ${(s.size / 1024).toFixed(0)} KB</dd><dt>Gửi lúc</dt><dd>${new Date(s.createdAt).toLocaleString('vi-VN')}</dd></dl>`;

async function adminPending(pane) {
  const { submissions } = await api('/api/admin/submissions?status=pending');
  if (!submissions.length) { pane.innerHTML = '<div class="panel center muted">' + ic('party-popper') + ' Không có game nào đang chờ duyệt.</div>'; return; }
  pane.innerHTML = `<div class="stack">${submissions.map(s => `<div class="panel" data-id="${s.id}"><div class="subcard"><div class="thumb">${ic('gamepad-2')}</div><div>
    <h3>${esc(s.manifest.name)} <span class="status pending">Chờ duyệt</span></h3><p class="muted" style="margin:0 0 8px">${esc(s.manifest.description)}</p>${kv(s)}
    ${s.report.warnings && s.report.warnings.length ? `<div class="report warn" style="margin-top:8px"><b>Cảnh báo tự động:</b><ul>${s.report.warnings.map(w => `<li>${esc(w)}</li>`).join('')}</ul></div>` : '<div class="report ok" style="margin-top:8px">' + ic('check') + ' Không có cảnh báo tự động.</div>'}
    <div class="row" style="margin-top:12px"><button class="btn sm" data-a="files">${ic('folder-open')} Danh sách file</button><button class="btn sm" data-a="preview">${ic('play')} Xem thử (không lưu điểm)</button></div>
    <label class="field" style="margin-top:12px">Ghi chú gửi nhà phát triển (bắt buộc khi từ chối)<textarea rows="2" data-note maxlength="500"></textarea></label>
    <div class="row"><button class="btn good" data-a="approve">${ic('check')} Duyệt & xuất bản</button><button class="btn bad" data-a="reject">${ic('circle-x')} Từ chối</button></div></div></div></div>`).join('')}</div>`;
  pane.onclick = async e => {
    const b = e.target.closest('[data-a]'); if (!b) return;
    const card = b.closest('[data-id]'), id = card.dataset.id, s = submissions.find(x => String(x.id) === id);
    if (b.dataset.a === 'files') {
      const { files } = await api(`/api/admin/submissions/${id}/files`).catch(er => { errToast(er); return { files: [] }; });
      openModal(`<h2>${ic('folder-open')} ${esc(s.manifest.name)}</h2><div class="dim"><table>${files.map(f => `<tr><td><code>${esc(f.name)}</code></td><td class="muted">${(f.size / 1024).toFixed(1)} KB</td></tr>`).join('')}</table></div>`);
    } else if (b.dataset.a === 'preview') previewModal(s);
    else {
      const note = $('[data-note]', card).value.trim();
      if (b.dataset.a === 'reject' && note.length < 5) { toast(ic('triangle-alert') + ' Hãy ghi lý do từ chối (≥ 5 ký tự)', 'bad'); return; }
      try { await api(`/api/admin/submissions/${id}/review`, { method: 'POST', body: { decision: b.dataset.a, note } }); toast(b.dataset.a === 'approve' ? ic('check') + ' Đã xuất bản game' : 'Đã từ chối', 'good'); adminPage(); } catch (er) { errToast(er); }
    }
  };
}

async function previewModal(s) {
  let url;
  try { url = (await api(`/api/submissions/${s.id}/preview`)).url; } catch (e) { errToast(e); return; }
  const card = openModal(`<h2>${ic('play')} Xem thử: ${esc(s.manifest.name)}</h2><p class="muted small" style="margin-top:-6px">Chế độ xem thử: điểm/thành tựu/lưu game <b>không</b> ghi vào hệ thống. Cột bên phải là nhật ký các lệnh SDK mà game gọi.</p>
    <div style="display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:14px"><div class="player" id="pv"></div><div class="logbox" id="plog"></div></div>`, true);
  const log = $('#plog', card);
  const iframe = makeFrame(s.manifest, url, $('#pv', card));
  const host = new GameHost(iframe, { slug: s.slug, name: s.manifest.name, version: s.version, rewards: s.manifest.rewards || [] }, {
    preview: true,
    overlay: $('#pv', card),
    log: (type, payload, res) => {
      const d = document.createElement('div');
      d.innerHTML = `<span class="t">${esc(type)}</span> ${esc(JSON.stringify(payload) || '')} → ${esc(JSON.stringify(res) || '')}`.slice(0, 600);
      log.appendChild(d); log.scrollTop = log.scrollHeight;
    },
  });
  modalCleanup = () => host.destroy();
}

async function adminDone(pane) {
  const [a, r] = await Promise.all([api('/api/admin/submissions?status=approved'), api('/api/admin/submissions?status=rejected')]);
  const all = [...a.submissions, ...r.submissions].sort((x, y) => y.id - x.id);
  pane.innerHTML = `<div class="panel">${all.length ? `<table><tr><th>Game</th><th>Phiên bản</th><th>Tác giả</th><th>Kết quả</th><th>Ghi chú</th><th>Ngày</th></tr>${all.map(s => `<tr><td>${esc(s.manifest.name)}</td><td>${esc(s.version)}</td>
    <td>@${esc(s.owner.username)}</td><td><span class="status ${s.status}">${s.status === 'approved' ? 'Đã duyệt' : 'Từ chối'}</span></td><td>${esc(s.note)}</td><td>${s.reviewedAt ? dateStr(s.reviewedAt) : ''}</td></tr>`).join('')}</table>` : '<p class="muted">Chưa có.</p>'}</div>`;
}

async function adminGames(pane) {
  const { games } = await api('/api/admin/games');
  pane.innerHTML = `<div class="panel"><table><tr><th>Game</th><th>Tác giả</th><th>Phiên bản</th><th>Lượt chơi</th><th>Trạng thái</th><th></th></tr>${games.map(g => `<tr><td><a href="#/game/${esc(g.slug)}">${esc(g.name)}</a> ${g.builtin ? '<span class="tag">có sẵn</span>' : ''}</td>
    <td>${esc(g.author)}</td><td>${esc(g.version)}</td><td>${num(g.plays)}</td><td><span class="status ${g.status}">${g.status === 'live' ? 'Đang chạy' : 'Đã gỡ'}</span></td>
    <td><button class="btn sm ${g.status === 'live' ? 'bad' : 'good'}" data-slug="${esc(g.slug)}" data-to="${g.status === 'live' ? 'unpublished' : 'live'}">${g.status === 'live' ? 'Gỡ game' : 'Đăng lại'}</button></td></tr>`).join('')}</table></div>`;
  pane.onclick = async e => {
    const b = e.target.closest('[data-slug]'); if (!b) return;
    try { await api(`/api/admin/games/${b.dataset.slug}/status`, { method: 'POST', body: { status: b.dataset.to } }); adminPage(); } catch (er) { errToast(er); }
  };
}

// Mẫu nhanh khi tạo nhiệm vụ: admin chỉ cần thay link của kênh / trang mình
const TASK_TEMPLATES = [
  { type: 'tiktok_live', title: 'Xem live TikTok 30 giây', url: 'https://www.tiktok.com/@ten-kenh/live', durationSec: 30, dailyLimit: 3 },
  { type: 'tiktok_video', title: 'Xem video TikTok mới', url: 'https://www.tiktok.com/@ten-kenh', durationSec: 20, dailyLimit: 5 },
  { type: 'facebook_post', title: 'Đọc bài viết trên fanpage', url: 'https://www.facebook.com/ten-trang', durationSec: 15, dailyLimit: 3 },
  { type: 'facebook_live', title: 'Xem live Facebook', url: 'https://www.facebook.com/ten-trang/live', durationSec: 30, dailyLimit: 3 },
  { type: 'facebook_page', title: 'Theo dõi fanpage', url: 'https://www.facebook.com/ten-trang', durationSec: 10, dailyLimit: 1 },
  { type: 'youtube', title: 'Xem video YouTube', url: 'https://www.youtube.com/@ten-kenh', durationSec: 30, dailyLimit: 5 },
  { type: 'instagram', title: 'Xem bài đăng Instagram', url: 'https://www.instagram.com/ten-tai-khoan', durationSec: 10, dailyLimit: 3 },
  { type: 'zalo', title: 'Quan tâm Zalo OA', url: 'https://zalo.me/ten-oa', durationSec: 10, dailyLimit: 1 },
  { type: 'link', title: 'Ghé website của chúng tôi', url: 'https://', durationSec: 15, dailyLimit: 3 },
];
const TASK_ICONS = ['radio', 'music-2', 'newspaper', 'video', 'thumbs-up', 'circle-play', 'camera', 'message-circle', 'link', 'globe',
  'gift', 'star', 'heart', 'flame', 'zap', 'target', 'gamepad-2', 'users', 'send', 'book-open', 'sparkles', 'trophy', 'crown', 'eye'];

async function adminTasks(pane) {
  const { tasks, types, settings } = await api('/api/admin/tasks');
  const now = Date.now();
  const running = t => t.active && !(t.endsAt && t.endsAt < now);
  pane.innerHTML = `
    <div class="panel" style="margin-bottom:14px"><h3>${ic('settings')} Cài đặt nhiệm vụ thưởng</h3>
      <p class="muted small" style="margin-top:-6px">Game khai báo phần thưởng (<code>rewards</code> trong gamehub.json) và gọi <code>GameHub.requestReward()</code>. Người chơi chọn 1 nhiệm vụ bên dưới, mở link, ở lại đủ thời gian (và nhập mã nếu có) thì game mới trao thưởng.</p>
      <form id="rs" class="row">
        <label class="row small"><input type="checkbox" name="enabled" ${settings.enabled ? 'checked' : ''}> Bật nhiệm vụ thưởng</label>
        <label class="row small"><input type="checkbox" name="guestsAllowed" ${settings.guestsAllowed ? 'checked' : ''}> Cho khách chưa đăng nhập làm</label>
        <label class="row small">Tối đa mỗi người / ngày <input type="number" name="dailyCapPerViewer" min="1" max="500" value="${settings.dailyCapPerViewer}" style="width:90px"></label>
        <label class="row small testmode"><input type="checkbox" name="testMode" ${settings.testMode ? 'checked' : ''}> ${ic('flask-conical')} Chế độ thử nghiệm</label>
        <button class="btn sm primary" type="submit">Lưu cài đặt</button></form>
      <p class="muted small" style="margin:8px 0 0">Chế độ thử nghiệm: bỏ cooldown và mọi giới hạn số lượt, mỗi nhiệm vụ chỉ cần chờ tối đa 5 giây — dùng khi đang làm/kiểm tra game. <b>Nhớ tắt khi chạy thật.</b></p>
      ${settings.testMode ? `<div class="report warn" style="margin-top:10px">${ic('flask-conical')} Đang bật <b>chế độ thử nghiệm</b> — người chơi nhận thưởng không giới hạn.</div>` : ''}</div>
    <div class="panel"><div class="row" style="margin-bottom:10px"><h3 style="margin:0">${ic('target')} Nhiệm vụ (${tasks.filter(running).length} đang chạy / ${tasks.length})</h3><span class="spacer"></span><button class="btn sm primary" id="newTask">${ic('plus')} Thêm nhiệm vụ</button></div>
      ${tasks.length ? `<table><tr><th>Nhiệm vụ</th><th>Thời gian</th><th>Xác nhận</th><th>Lượt/người/ngày</th><th>7 ngày (xong/bắt đầu)</th><th>Trạng thái</th><th></th></tr>${tasks.map(t => `<tr>
        <td><div class="row" style="flex-wrap:nowrap;gap:10px"><span class="taskic">${tic(t.icon)}</span><div><b>${esc(t.title)}</b><div class="small muted">${esc(t.typeLabel)} · <a href="${esc(t.url)}" target="_blank" rel="noopener noreferrer">${esc(t.url.length > 48 ? t.url.slice(0, 48) + '…' : t.url)}</a></div></div></div></td>
        <td>${t.durationSec}s</td><td>${t.verify === 'code' ? `${ic('key-round')} <code>${esc(t.code)}</code>` : 'thời gian'}</td><td>${t.dailyLimit}</td>
        <td>${num(t.stats.completed || 0)} / ${num(t.stats.started || 0)}</td>
        <td><span class="status ${running(t) ? 'live' : 'unpublished'}">${!t.active ? 'Đang tắt' : t.endsAt && t.endsAt < now ? 'Hết hạn' : 'Đang chạy'}</span>${t.endsAt ? `<div class="small muted">đến ${dateStr(t.endsAt)}</div>` : ''}</td>
        <td class="row" style="flex-wrap:nowrap"><button class="btn sm" data-edit="${t.id}" title="Sửa">${ic('pencil')}</button><button class="btn sm" data-copy="${t.id}" title="Nhân bản">${ic('copy')}</button><button class="btn sm" data-toggle="${t.id}">${t.active ? 'Tắt' : 'Bật'}</button><button class="btn sm bad" data-del="${t.id}" title="Xóa">${ic('trash-2')}</button></td></tr>`).join('')}</table>`
        : `<div class="center" style="padding:20px 10px"><p class="muted">Chưa có nhiệm vụ nào — game sẽ báo "chưa có nhiệm vụ" khi người chơi bấm nhận thưởng.</p><button class="btn primary" id="newTask2">${ic('plus')} Tạo nhiệm vụ đầu tiên</button></div>`}</div>`;

  $('#rs').onsubmit = async e => {
    e.preventDefault();
    const f = e.target;
    try {
      await api('/api/admin/settings/rewards', { method: 'PUT', body: { enabled: f.enabled.checked, guestsAllowed: f.guestsAllowed.checked, dailyCapPerViewer: Number(f.dailyCapPerViewer.value), testMode: f.testMode.checked } });
      toast('Đã lưu cài đặt', 'good'); adminPage();
    } catch (er) { errToast(er); }
  };
  $('#newTask').onclick = () => taskForm(types, null);
  if ($('#newTask2')) $('#newTask2').onclick = () => taskForm(types, null);
  pane.onclick = async e => {
    const b = e.target.closest('[data-edit],[data-copy],[data-toggle],[data-del]'); if (!b) return;
    const t = tasks.find(x => String(x.id) === (b.dataset.edit || b.dataset.copy || b.dataset.toggle || b.dataset.del));
    if (b.dataset.edit) return taskForm(types, t);
    if (b.dataset.copy) return taskForm(types, { ...t, id: null, title: (t.title + ' (bản sao)').slice(0, 80) }, true);
    try {
      if (b.dataset.del) {
        if (!confirm(`Xóa nhiệm vụ "${t.title}"? Thống kê của nhiệm vụ này cũng bị xóa.`)) return;
        await api(`/api/admin/tasks/${t.id}`, { method: 'DELETE' });
      } else await api(`/api/admin/tasks/${t.id}`, { method: 'PUT', body: { ...t, active: !t.active } });
      adminPage();
    } catch (er) { errToast(er); }
  };
}

// t: nhiệm vụ đang sửa (null = tạo mới); copy = tạo mới từ nhiệm vụ có sẵn
function taskForm(types, t, copy) {
  const isNew = !t || copy;
  const v = t || { title: '', type: 'tiktok_live', url: '', description: '', icon: '', durationSec: 30, verify: 'time', code: '', dailyLimit: 3, priority: 0, active: true, endsAt: null };
  const d = v.endsAt ? new Date(v.endsAt) : null;
  const dateVal = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '';
  const card = openModal(`<h2>${isNew ? ic('plus') + (copy ? ' Nhân bản nhiệm vụ' : ' Thêm nhiệm vụ') : ic('pencil') + ' Sửa nhiệm vụ'}</h2>
    ${!t ? `<div class="muted small" style="font-weight:600;margin-bottom:6px">Mẫu nhanh — bấm để điền sẵn, rồi thay link của bạn:</div>
      <div class="tpls">${TASK_TEMPLATES.map((x, i) => `<button type="button" class="chip" data-tpl="${i}">${tic(types[x.type].icon)} ${esc(types[x.type].label)}</button>`).join('')}</div>` : ''}
    <form id="tf">
    <label class="field">Tiêu đề<input type="text" name="title" maxlength="80" required value="${esc(v.title)}" placeholder="Xem live TikTok tối nay 30 giây"></label>
    <label class="field">Loại<select name="type">${Object.entries(types).map(([k, x]) => `<option value="${k}" ${k === v.type ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</select></label>
    <div class="field">Icon <span class="muted">(mặc định theo loại)</span><input type="hidden" name="icon" value="${esc(v.icon || '')}">
      <div class="iconpick" id="iconPick">${TASK_ICONS.map(n => `<button type="button" data-ic="${n}" title="${n}">${ic(n)}</button>`).join('')}</div></div>
    <label class="field">Link (TikTok live, bài viết Facebook...)<input type="url" name="url" required value="${esc(v.url)}" placeholder="https://www.tiktok.com/@kenh-cua-ban/live"></label>
    <label class="field">Mô tả ngắn (tùy chọn)<textarea name="description" rows="2" maxlength="200" placeholder="VD: Vào live tối nay, mã xác nhận được ghim trên màn hình">${esc(v.description)}</textarea></label>
    <div class="row"><label class="field" style="flex:1">Ở lại tối thiểu (giây)<input type="number" name="durationSec" min="0" max="600" value="${v.durationSec}"></label>
      <label class="field" style="flex:1">Lượt / người / ngày<input type="number" name="dailyLimit" min="1" max="50" value="${v.dailyLimit}"></label>
      <label class="field" style="flex:1">Ưu tiên<input type="number" name="priority" min="-100" max="100" value="${v.priority}"></label></div>
    <div class="row"><label class="field" style="flex:1">Cách xác nhận<select name="verify"><option value="time" ${v.verify === 'time' ? 'selected' : ''}>Chỉ cần đủ thời gian</option>
        <option value="code" ${v.verify === 'code' ? 'selected' : ''}>Nhập mã (đọc/ghim trong live, bài viết)</option></select></label>
      <label class="field" style="flex:1" id="codeField">Mã xác nhận<input type="text" name="code" maxlength="40" value="${esc(v.code || '')}" placeholder="VD: GAMEHUB24"></label></div>
    <div class="row"><label class="field" style="flex:1">Kết thúc vào (tùy chọn)<input type="date" name="endsAt" value="${dateVal}"></label>
      <label class="row small" style="flex:1"><input type="checkbox" name="active" ${v.active ? 'checked' : ''}> Đang chạy</label></div>
    <p class="muted small">Mã xác nhận giúp chắc người chơi đã thật sự xem: hãy đọc hoặc ghim mã trong live/bài viết. Chỉ dùng thời gian thì người chơi có thể mở link rồi tắt ngay.</p>
    <button class="btn primary" type="submit" style="width:100%">${isNew ? 'Tạo nhiệm vụ' : 'Lưu thay đổi'}</button></form>`);
  const f = $('#tf', card);
  const syncCode = () => { $('#codeField', card).style.visibility = f.verify.value === 'code' ? 'visible' : 'hidden'; };
  // icon đang chọn; chưa chọn thì sáng icon mặc định của loại
  const syncIcon = () => {
    const cur = f.icon.value || types[f.type.value].icon;
    $$('#iconPick button', card).forEach(b => { b.classList.toggle('on', b.dataset.ic === cur); b.classList.toggle('auto', !f.icon.value && b.dataset.ic === cur); });
  };
  f.verify.onchange = syncCode; syncCode();
  f.type.onchange = syncIcon; syncIcon();
  $('#iconPick', card).onclick = e => {
    const b = e.target.closest('[data-ic]'); if (!b) return;
    f.icon.value = f.icon.value === b.dataset.ic ? '' : b.dataset.ic;   // bấm lại -> về mặc định theo loại
    syncIcon();
  };
  card.addEventListener('click', e => {
    const b = e.target.closest('[data-tpl]'); if (!b) return;
    const x = TASK_TEMPLATES[Number(b.dataset.tpl)];
    f.title.value = x.title; f.type.value = x.type; f.url.value = x.url; f.icon.value = '';
    f.durationSec.value = x.durationSec; f.dailyLimit.value = x.dailyLimit;
    $$('[data-tpl]', card).forEach(c => c.classList.toggle('on', c === b));
    syncIcon(); f.url.focus(); f.url.select();
  });
  f.onsubmit = async e => {
    e.preventDefault();
    const body = {
      title: f.title.value, type: f.type.value, icon: f.icon.value, url: f.url.value, description: f.description.value,
      durationSec: Number(f.durationSec.value), dailyLimit: Number(f.dailyLimit.value), priority: Number(f.priority.value),
      verify: f.verify.value, code: f.code.value, active: f.active.checked,
      endsAt: f.endsAt.value ? new Date(f.endsAt.value + 'T23:59:59').getTime() : null,
    };
    try {
      await api(isNew ? '/api/admin/tasks' : `/api/admin/tasks/${t.id}`, { method: isNew ? 'POST' : 'PUT', body });
      closeModal(); toast(isNew ? 'Đã tạo nhiệm vụ' : 'Đã lưu nhiệm vụ', 'good'); adminPage();
    } catch (er) { errToast(er); }
  };
}

const AUDIT_LABEL = {
  'submission.approve': ic('check') + ' Duyệt game', 'submission.reject': ic('circle-x') + ' Từ chối game', 'game.status': ic('gamepad-2') + ' Đổi trạng thái game',
  'user.role': ic('user-round') + ' Đổi vai trò', 'user.ban': ic('ban') + ' Khóa tài khoản', 'user.unban': ic('lock-open') + ' Mở khóa tài khoản',
  'task.create': ic('target') + ' Tạo nhiệm vụ', 'task.update': ic('target') + ' Sửa nhiệm vụ', 'task.delete': ic('trash-2') + ' Xóa nhiệm vụ', 'settings.rewards': ic('settings') + ' Cài đặt nhiệm vụ',
};
async function adminAudit(pane) {
  const { entries } = await api('/api/admin/audit');
  pane.innerHTML = `<div class="panel">${entries.length ? `<table><tr><th>Thời gian</th><th>Người thực hiện</th><th>Hành động</th><th>Đối tượng</th><th>Chi tiết</th></tr>${entries.map(e => `<tr>
    <td class="small">${new Date(e.at).toLocaleString('vi-VN')}</td><td>@${esc(e.actor || '?')}</td><td>${AUDIT_LABEL[e.action] || esc(e.action)}</td>
    <td><code>${esc(e.target)}</code></td><td class="small muted">${esc(JSON.stringify(e.data)).slice(0, 160)}</td></tr>`).join('')}</table>` : '<p class="muted">Chưa có thao tác nào.</p>'}</div>`;
}

async function adminUsers(pane) {
  const { users } = await api('/api/admin/users');
  pane.innerHTML = `<div class="panel"><table><tr><th>Người dùng</th><th>Cấp</th><th>XP</th><th>Vai trò</th><th>Ngày tạo</th><th></th></tr>${users.map(u => `<tr><td><span class="avatar" style="width:24px;height:24px;font-size:13px">${av(u.avatar)}</span>
    <a href="#/u/${esc(u.username)}">${esc(u.displayName)}</a> <span class="muted small">@${esc(u.username)}</span></td><td>${u.level}</td><td>${num(u.xp)}</td><td>${u.role}</td><td>${dateStr(u.createdAt)}</td>
    <td>${u.id === me.id ? '' : `<button class="btn sm" data-u="${u.id}" data-role="${u.role === 'admin' ? 'user' : 'admin'}">${u.role === 'admin' ? 'Bỏ admin' : 'Cấp admin'}</button>
    <button class="btn sm ${u.banned ? 'good' : 'bad'}" data-u="${u.id}" data-ban="${u.banned ? 0 : 1}">${u.banned ? 'Mở khóa' : 'Khóa'}</button>`}</td></tr>`).join('')}</table></div>`;
  pane.onclick = async e => {
    const b = e.target.closest('[data-u]'); if (!b) return;
    const body = b.dataset.role ? { role: b.dataset.role } : { banned: b.dataset.ban === '1' };
    try { await api(`/api/admin/users/${b.dataset.u}`, { method: 'POST', body }); adminPage(); } catch (er) { errToast(er); }
  };
}

// ---------- router ----------
let cleanup = null;
async function route() {
  if (cleanup) { cleanup(); cleanup = null; }
  document.body.classList.remove('gamepage');
  const parts = (location.hash.slice(1) || '/').split('?')[0].split('/');   // ['', 'game', 'slug']
  const [, a, b] = parts;
  document.body.dataset.page = a || 'home';
  $$('#nav a').forEach(x => x.classList.toggle('active', x.dataset.nav === (a === 'game' || a === 'u' || !a ? 'home' : a)));
  document.title = 'GameHub — Cổng game HTML5';
  view.innerHTML = '<p class="muted center" style="padding:60px">Đang tải...</p>';
  try {
    if (!a) await homePage();
    else if (a === 'game' && b) await gamePage(b);
    else if (a === 'u' && b) await profilePage(b);
    else if (a === 'upload') await uploadPage();
    else if (a === 'docs') await docsPage();
    else if (a === 'admin') await adminPage();
    else view.innerHTML = '<div class="panel center"><h2>404</h2><p class="muted">Không tìm thấy trang.</p><a class="btn" href="#/">Về trang chủ</a></div>';
  } catch (e) {
    view.innerHTML = `<div class="panel center"><h2>${ic('frown')} ${e.status === 404 ? 'Không tìm thấy' : 'Có lỗi'}</h2><p class="muted">${esc(e.message)}</p><a class="btn" href="#/">Về trang chủ</a></div>`;
  }
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', route);
refreshMe().then(route);
})();
