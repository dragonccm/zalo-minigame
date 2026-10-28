/* Cờ Vua cho GameHub — chơi với máy (5 cấp), online (máy chủ kiểm tra nước đi + đồng hồ), hai người một máy. */
(() => {
'use strict';
const GH = window.GameHub, R = window.ChessRules, ic = window.ic;
const $ = id => document.getElementById(id);
const LEVELS = ['Mới học', 'Dễ', 'Vừa', 'Khó', 'Kiện tướng'];
const TCS = [[3, 2], [5, 3], [10, 5], [15, 10]];                  // phút + giây cộng thêm mỗi nước
const BASE_SCORE = [100, 250, 450, 700, 1000];                     // điểm thắng máy theo cấp
const REASONS = {
  checkmate: 'Chiếu hết', stalemate: 'Hết nước đi', insufficient: 'Không còn đủ quân để chiếu hết', fifty: 'Luật 50 nước',
  repetition: 'Lặp lại thế cờ 3 lần', resign: 'Đầu hàng', timeout: 'Hết giờ', agreement: 'Hai bên đồng ý hòa',
  abandon: 'Đối thủ đã rời trận', room_closed: 'Phòng đã đóng',
};
const START_COUNT = { p: 8, n: 2, b: 2, r: 2, q: 1 };

// ---------- trạng thái ----------
let save = { settings: { theme: 'wood', hints: true, sound: true }, stats: { wins: [0, 0, 0, 0, 0], played: 0, online: 0 }, hintBank: 0, game: null };
let mode = 'ai', chess = new R.Chess(), myColor = 'w', level = 3, flipped = false;
let sel = null, lastMove = null, hintMove = null, aiBusy = false, over = false, review = false;
let undos = 0, hintsUsed = 0, freeHint = 1, aiToken = 0;
let net = null;                                                    // { room, color, clocks, turnAt, base, inc, running, names }
let pickColor = 'r', pickTc = 1;

// ---------- tiện ích ----------
function setIc(el, name, text) { el.innerHTML = name ? ic(name) : ''; if (text) el.append((name ? ' ' : '') + text); }
function toast(text, icon) {
  const d = document.createElement('div'); setIc(d, icon, text); $('toast').appendChild(d);
  setTimeout(() => d.remove(), 2600);
}
let saveTimer = 0;
function persist() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { GH.save(save).catch(() => {}); }, 400); }
const other = c => (c === 'w' ? 'b' : 'w');
const fmtClock = ms => { ms = Math.max(0, ms); const s = Math.ceil(ms / 1000); return s >= 60 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : (ms < 10000 ? (ms / 1000).toFixed(1) : String(s)); };
document.querySelectorAll('[data-ic]').forEach(el => { el.outerHTML = ic(el.dataset.ic); });
document.querySelectorAll('[data-pc]').forEach(el => { el.src = Pieces.url(el.dataset.pc[0], el.dataset.pc[1]); });

// ---------- âm thanh (tổng hợp bằng WebAudio, không cần file) ----------
let actx = null, muted = false;
function tone(freq, dur, type = 'sine', vol = 0.15, when = 0) {
  if (muted || !save.settings.sound) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const t = actx.currentTime + when, o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(actx.destination); o.start(t); o.stop(t + dur);
  } catch { /* không có âm thanh */ }
}
const sfx = {
  move: () => { tone(320, 0.07, 'triangle', 0.18); tone(180, 0.05, 'sine', 0.1, 0.02); },
  capture: () => { tone(210, 0.12, 'square', 0.09); tone(130, 0.1, 'triangle', 0.15, 0.03); },
  check: () => { tone(660, 0.1, 'triangle', 0.12); tone(880, 0.14, 'triangle', 0.12, 0.09); },
  end: win => { [523, 659, 784].forEach((f, i) => tone(win ? f : f * 0.75, 0.3, 'triangle', 0.1, i * 0.11)); },
  click: () => tone(500, 0.04, 'sine', 0.06),
};

// ---------- bàn cờ ----------
const boardEl = $('board'), squares = [];
for (let i = 0; i < 64; i++) { const d = document.createElement('div'); d.className = 'sq'; boardEl.appendChild(d); squares.push(d); }
// vị trí trên màn hình (i) <-> tên ô
const nameAt = i => { const r = i >> 3, c = i & 7; return flipped ? 'abcdefgh'[7 - c] + (r + 1) : 'abcdefgh'[c] + (8 - r); };
const indexOf = n => { const f = n.charCodeAt(0) - 97, rk = +n[1]; return flipped ? (rk - 1) * 8 + (7 - f) : (8 - rk) * 8 + f; };
let legalCache = null;
const legal = () => legalCache || (legalCache = chess.moves());

function render() {
  legalCache = null;
  const kingSq = chess.inCheck() ? findKing(chess.turn()) : null;
  const targets = sel && save.settings.hints ? legal().filter(m => m.from === sel) : [];
  for (let i = 0; i < 64; i++) {
    const n = nameAt(i), d = squares[i], p = chess.pieceAt(n);
    const dark = ((n.charCodeAt(0) - 97) + +n[1]) % 2 === 0;
    d.className = 'sq' + (dark ? ' d' : '') + (lastMove && (lastMove.from === n || lastMove.to === n) ? ' last' : '')
      + (sel === n ? ' sel' : '') + (kingSq === n ? ' chk' : '') + (hintMove && (hintMove.from === n || hintMove.to === n) ? ' hint' : '');
    d.dataset.sq = n;
    let html = p ? `<img src="${Pieces.url(p.type, p.color)}" alt="">` : '';
    const t = targets.find(m => m.to === n);
    if (t) html += t.capture || (p && p.color !== chess.turn()) ? '<span class="ring"></span>' : '<span class="dot"></span>';
    if ((i & 7) === 7) html += `<span class="coord r">${n[1]}</span>`;
    if (i >> 3 === 7) html += `<span class="coord f">${n[0]}</span>`;
    if (d.innerHTML !== html) d.innerHTML = html;
  }
  renderBars(); renderMoves(); renderTools();
}
function findKing(c) {
  for (const row of 'abcdefgh') for (let r = 1; r <= 8; r++) { const p = chess.pieceAt(row + r); if (p && p.type === 'k' && p.color === c) return row + r; }
  return null;
}

// thanh người chơi: tên, quân đã ăn, chênh lệch quân, đồng hồ
function renderBars() {
  const bottom = flipped ? 'b' : 'w', top = other(bottom);
  const counts = { w: {}, b: {} };
  for (const row of chess.board()) for (const p of row) if (p) counts[p.color][p.type] = (counts[p.color][p.type] || 0) + 1;
  const mat = chess.material(), turn = chess.turn();
  [['barBottom', bottom], ['barTop', top]].forEach(([id, c]) => {
    const bar = $(id), opp = other(c);
    let caps = '';
    for (const t of ['q', 'r', 'b', 'n', 'p']) for (let k = (counts[opp][t] || 0); k < START_COUNT[t]; k++) caps += `<img src="${Pieces.url(t, opp)}" alt="">`;
    const diff = Math.round((mat[c === 'w' ? 'w' : 'b'] - mat[opp === 'w' ? 'w' : 'b']) / 100);
    if (diff > 0) caps += `<em>+${diff}</em>`;
    const capEl = bar.querySelector('[data-caps]'); if (capEl.innerHTML !== caps) capEl.innerHTML = caps;
    bar.querySelector('[data-name]').textContent = playerName(c);
    const av = playerIcon(c), avEl = bar.querySelector('[data-av]');
    if (avEl.dataset.v !== av) { avEl.dataset.v = av; avEl.innerHTML = ic(av); }
    bar.classList.toggle('turn', !over && turn === c);
    bar.querySelector('[data-clock]').classList.toggle('hidden', mode !== 'online');
  });
}
function playerName(c) {
  if (mode === 'online' && net && net.names) return (net.names[c] || '?') + (c === myColor ? ' (bạn)' : '');
  if (mode === 'ai') return c === myColor ? (GH.player && !GH.player.guest ? GH.player.displayName : 'Bạn') : `Máy · ${LEVELS[level - 1]}`;
  return c === 'w' ? 'Trắng' : 'Đen';
}
const playerIcon = c => (mode === 'ai' && c !== myColor ? 'bot' : c === 'w' ? 'crown' : 'swords');

function renderMoves() {
  const ol = $('moves'), h = chess.history;
  let html = '';
  for (let i = 0; i < h.length; i += 2) {
    const cur = j => (j === h.length - 1 ? ' class="cur"' : '');
    html += `<li><span class="n">${i / 2 + 1}.</span><span${cur(i)}>${h[i].san}</span><span${cur(i + 1)}>${h[i + 1] ? h[i + 1].san : ''}</span></li>`;
  }
  if (ol.dataset.n !== String(h.length)) { ol.innerHTML = html; ol.dataset.n = h.length; ol.scrollTop = ol.scrollHeight; ol.scrollLeft = ol.scrollWidth; }
  const st = $('statusText');
  st.textContent = over ? 'Đã kết thúc' : aiBusy ? 'Máy đang nghĩ...' : chess.inCheck() ? 'Chiếu!' : (mode === 'local' ? `Lượt ${chess.turn() === 'w' ? 'Trắng' : 'Đen'}` : chess.turn() === myColor ? 'Lượt bạn' : 'Lượt đối thủ');
}
function renderTools() {
  const live = !over && !review;
  $('bUndo').disabled = !live || mode === 'online' || aiBusy || !chess.history.length || (mode === 'ai' && chess.history.length < (myColor === 'w' ? 1 : 2));
  $('bHint').disabled = !live || mode !== 'ai' || aiBusy || chess.turn() !== myColor;
  $('bDraw').disabled = !live || mode === 'local' || (mode === 'online' && !(net && net.running));
  $('bResign').disabled = !live || (mode === 'online' && !(net && net.running));
  $('hintLeft').textContent = mode === 'ai' ? `(${freeHint + save.hintBank})` : '';
  const snd = $('bSound'); const v = save.settings.sound ? 'volume-2' : 'volume-x';
  if (snd.dataset.v !== v) { snd.dataset.v = v; snd.querySelector('.icon').outerHTML = ic(v); }
  $('modeLabel').textContent = mode === 'ai' ? `Đấu máy · ${LEVELS[level - 1]}` : mode === 'online' ? (net && net.code ? `Phòng ${net.code}` : 'Online') : 'Hai người một máy';
}

// ---------- điều khiển: bấm hoặc kéo thả ----------
const canMove = () => !over && !review && !aiBusy && (mode === 'local' || chess.turn() === myColor) && (mode !== 'online' || (net && net.running));
let drag = null;
boardEl.addEventListener('pointerdown', e => {
  const d = e.target.closest('.sq'); if (!d || !canMove()) return;
  const n = d.dataset.sq, p = chess.pieceAt(n);
  if (sel && sel !== n && legal().some(m => m.from === sel && m.to === n)) { tryMove(sel, n); return; }
  if (p && p.color === chess.turn()) {
    sel = n; hintMove = null; render(); sfx.click();
    const img = d.querySelector('img');
    drag = { from: n, x: e.clientX, y: e.clientY, el: null, img, size: d.getBoundingClientRect().width };
    boardEl.setPointerCapture(e.pointerId);
  } else { sel = null; render(); }
});
boardEl.addEventListener('pointermove', e => {
  if (!drag) return;
  if (!drag.el && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 6) {
    drag.el = drag.img.cloneNode(); drag.el.id = 'ghost'; drag.el.style.width = drag.el.style.height = drag.size + 'px';
    document.body.appendChild(drag.el); squares[indexOf(drag.from)].classList.add('drag');
  }
  if (drag.el) { drag.el.style.left = e.clientX + 'px'; drag.el.style.top = e.clientY + 'px'; }
});
const endDrag = e => {
  if (!drag) return;
  const d0 = drag; drag = null;
  if (d0.el) {
    d0.el.remove(); squares.forEach(s => s.classList.remove('drag'));
    const t = document.elementFromPoint(e.clientX, e.clientY), d = t && t.closest && t.closest('.sq');
    if (d && d.dataset.sq !== d0.from && legal().some(m => m.from === d0.from && m.to === d.dataset.sq)) tryMove(d0.from, d.dataset.sq);
  }
};
boardEl.addEventListener('pointerup', endDrag);
boardEl.addEventListener('pointercancel', endDrag);

function tryMove(from, to) {
  const opts = legal().filter(m => m.from === from && m.to === to);
  if (!opts.length) return;
  if (opts.some(m => m.promo)) return askPromotion(to, chess.turn(), promo => commit({ from, to, promo }));
  commit({ from, to });
}
function askPromotion(to, color, done) {
  const box = $('promo'), size = boardEl.getBoundingClientRect().width / 8, i = indexOf(to);
  box.innerHTML = ['q', 'r', 'b', 'n'].map(t => `<button data-p="${t}"><img src="${Pieces.url(t, color)}" style="width:${size}px;height:${size}px" alt=""></button>`).join('');
  box.style.left = (i & 7) * size + 'px';
  const fromTop = (i >> 3) < 4;
  box.style.top = fromTop ? (i >> 3) * size + 'px' : '';
  box.style.bottom = fromTop ? '' : (7 - (i >> 3)) * size + 'px';
  box.style.flexDirection = fromTop ? 'column' : 'column-reverse';
  box.classList.remove('hidden');
  box.onclick = e => { const b = e.target.closest('[data-p]'); if (!b) return; box.classList.add('hidden'); done(b.dataset.p); };
}

function commit(mv, fromNet) {
  const rec = chess.move(mv);
  if (!rec) return null;
  sel = null; hintMove = null; lastMove = { from: rec.from, to: rec.to };
  if (chess.inCheck()) sfx.check(); else if (rec.capture) sfx.capture(); else sfx.move();
  if (rec.promo && (mode !== 'online' || rec.color === myColor) && (mode === 'local' || rec.color === myColor)) GH.unlockAchievement('promote').catch(() => {});
  if (rec.color === myColor && /x/.test(rec.san) && rec.piece === 'p' && chess.history.length && isEnPassant(rec)) GH.unlockAchievement('en_passant').catch(() => {});
  if (mode === 'online' && !fromNet) net.room.send('mv', { from: rec.from, to: rec.to, promo: rec.promo || undefined });
  render();
  afterMove();
  return rec;
}
function isEnPassant(rec) { return rec._m && (rec._m.flags & R.F_EP); }

function afterMove() {
  if (mode === 'online') return;                                   // máy chủ quyết định kết thúc ván online
  const out = chess.outcome();
  if (out) return finish(out);
  if (mode === 'ai') {
    saveGame();
    if (chess.turn() !== myColor) aiMove();
  }
}

// ---------- AI (chạy trong Web Worker để không đứng giao diện) ----------
let worker = null, workerReady = null;
function getWorker() {
  if (workerReady) return workerReady;
  // iframe sandbox không tạo Worker từ URL thường được -> ghép mã luật + AI thành Blob
  workerReady = Promise.all(['chess-rules.js', 'chess-ai.js'].map(f => fetch(f).then(r => { if (!r.ok) throw new Error(f); return r.text(); })))
    .then(([a, b]) => { worker = new Worker(URL.createObjectURL(new Blob([a, '\n', b], { type: 'text/javascript' }))); return worker; })
    .catch(() => null);
  return workerReady;
}
let thinkSeq = 0;
function think(fen, lv) {
  return getWorker().then(w => new Promise(resolve => {
    if (!w) { setTimeout(() => resolve(window.ChessAI.think(fen, lv)), 30); return; }      // dự phòng: nghĩ ngay trên luồng chính
    const id = ++thinkSeq;
    const on = e => { if (e.data.id !== id) return; w.removeEventListener('message', on); resolve(e.data.move || null); };
    w.addEventListener('message', on);
    w.postMessage({ id, fen, level: lv });
  }));
}
async function aiMove() {
  const token = ++aiToken, t0 = Date.now();
  aiBusy = true; $('thinking').classList.remove('hidden'); render();
  const m = await think(chess.fen(), level);
  await new Promise(r => setTimeout(r, Math.max(0, 380 - (Date.now() - t0))));   // đi quá nhanh trông không tự nhiên
  if (token !== aiToken || over || mode !== 'ai') return;
  aiBusy = false; $('thinking').classList.add('hidden');
  if (m) commit(m); else render();
}
function stopAI() { aiToken++; aiBusy = false; $('thinking').classList.add('hidden'); }

// ---------- bắt đầu ván ----------
function newGame(m, opts = {}) {
  stopAI();
  mode = m; over = false; review = false; sel = null; lastMove = null; hintMove = null; undos = 0; hintsUsed = 0; freeHint = m === 'ai' ? 1 : 0;
  chess = new R.Chess();
  if (m === 'ai') { level = opts.level || level; myColor = opts.color || 'w'; }
  else if (m === 'local') myColor = 'w';
  flipped = myColor === 'b';
  if (opts.moves) { for (const mv of opts.moves) chess.move(mv); const h = chess.history[chess.history.length - 1]; if (h) lastMove = { from: h.from, to: h.to }; undos = opts.undos || 0; hintsUsed = opts.hintsUsed || 0; freeHint = opts.freeHint ?? 1; }
  ['menu', 'over', 'wait'].forEach(id => $(id).classList.add('hidden'));
  $('offer').classList.add('hidden');
  GH.gameStart().catch(() => {});
  render();
  if (m === 'ai') { saveGame(); if (chess.turn() !== myColor) aiMove(); }
}
function saveGame() {
  if (mode !== 'ai') return;
  save.game = over ? null : { level, color: myColor, moves: chess.history.map(h => ({ from: h.from, to: h.to, promo: h.promo || undefined })), undos, hintsUsed, freeHint };
  persist();
}

// ---------- kết thúc ván ----------
function finish(out, extra = {}) {
  if (over) return;
  over = true; stopAI(); sel = null;
  const draw = out.result === '1/2-1/2', winner = draw ? null : out.result === '1-0' ? 'w' : 'b';
  const youWin = winner && winner === myColor, youLose = winner && winner !== myColor;
  let title, cls, icon;
  if (mode === 'local') { title = draw ? 'Hòa!' : `${winner === 'w' ? 'Trắng' : 'Đen'} thắng!`; cls = draw ? 'draw' : ''; icon = draw ? 'handshake' : 'trophy'; }
  else { title = draw ? 'Hòa!' : youWin ? 'Bạn thắng!' : 'Bạn thua'; cls = draw ? 'draw' : youWin ? '' : 'lose'; icon = draw ? 'handshake' : youWin ? 'trophy' : 'frown'; }
  const oi = $('overIcon'); oi.className = 'oicon ' + cls; oi.innerHTML = ic(icon);
  $('overTitle').textContent = title;
  $('overReason').textContent = REASONS[out.reason] || out.reason || '';
  $('overScore').textContent = '';
  $('oAgain').textContent = mode === 'online' ? 'Tái đấu' : 'Chơi lại';
  $('oReward').classList.add('hidden');
  sfx.end(!youLose);
  render();
  const moves = Math.ceil(chess.history.length / 2);
  if (mode === 'ai') {
    save.game = null; save.stats.played++;
    let score = 0;
    if (youWin) {
      save.stats.wins[level - 1]++;
      score = BASE_SCORE[level - 1] + Math.max(0, 60 - moves) * 5 + (!undos && !hintsUsed ? 100 : 0);
      GH.unlockAchievement('first_win').catch(() => {});
      if (level >= 3) GH.unlockAchievement('beat_lv3').catch(() => {});
      if (level >= 5) GH.unlockAchievement('beat_lv5').catch(() => {});
      if (!undos && !hintsUsed && level >= 2) GH.unlockAchievement('clean_win').catch(() => {});
      if (out.reason === 'checkmate' && moves <= 20) GH.unlockAchievement('quick_mate').catch(() => {});
    } else if (draw) score = Math.round(BASE_SCORE[level - 1] / 4);
    persist();
    GH.gameOver(score ? { score, meta: { level, moves, result: youWin ? 'win' : 'draw', undos, hints: hintsUsed } } : {}).then(r => {
      const s = r && r.score;
      if (score && s && s.saved) $('overScore').textContent = `+${score.toLocaleString('vi-VN')} điểm · hạng #${s.rank}${s.isNewBest ? ' · kỷ lục mới!' : ''}`;
      else if (score) $('overScore').textContent = `+${score.toLocaleString('vi-VN')} điểm` + (GH.player && GH.player.guest ? ' (đăng nhập để lưu)' : '');
    }).catch(() => {});
  } else if (mode === 'online') {
    if (extra.score) $('overScore').textContent = extra.score;
    if (youWin) { save.stats.online++; persist(); GH.unlockAchievement('online_win').catch(() => {}); }
    GH.gameOver({}).catch(() => {});
  }
  setTimeout(() => $('over').classList.remove('hidden'), 650);
}

// ---------- nút điều khiển ----------
$('bFlip').onclick = () => { flipped = !flipped; render(); };
$('bSound').onclick = () => { save.settings.sound = !save.settings.sound; persist(); render(); };
$('bUndo').onclick = () => {
  if (aiBusy) return;
  const n = mode === 'ai' ? (chess.turn() === myColor ? 2 : 1) : 1;
  for (let i = 0; i < n && chess.history.length; i++) chess.undo();
  undos++; sel = null; hintMove = null;
  const h = chess.history[chess.history.length - 1]; lastMove = h ? { from: h.from, to: h.to } : null;
  render(); saveGame();
};
$('bHint').onclick = async () => {
  if (freeHint + save.hintBank <= 0) {
    const r = await GH.requestReward('hints').catch(() => null);
    if (r && r.rewarded) { save.hintBank += (r.reward && r.reward.amount) || 3; persist(); toast(`Nhận ${(r.reward && r.reward.amount) || 3} lượt gợi ý`, 'lightbulb'); render(); }
    else if (r && r.reason && r.reason !== 'closed') toast(r.reason === 'cooldown' ? `Thử lại sau ${r.retryAfterSec || ''} giây` : 'Chưa nhận được lượt gợi ý', 'triangle-alert');
    return;
  }
  if (freeHint > 0) freeHint--; else save.hintBank--;
  hintsUsed++; persist();
  aiBusy = true; $('thinking').classList.remove('hidden'); render();
  const m = await think(chess.fen(), 4);
  aiBusy = false; $('thinking').classList.add('hidden');
  hintMove = m; render(); saveGame();
};
$('bDraw').onclick = () => {
  if (mode === 'online') { net.room.send('draw', { a: 'offer' }); toast('Đã gửi lời mời hòa', 'handshake'); $('bDraw').disabled = true; return; }
  // máy chỉ đồng ý hòa khi nó đang bất lợi
  const evalForAI = window.ChessAI.evaluate(R.Position.fromFEN(chess.fen())) * (chess.turn() === myColor ? -1 : 1);
  if (evalForAI < -150) finish({ result: '1/2-1/2', reason: 'agreement' });
  else toast('Máy từ chối hòa', 'bot');
};
$('bResign').onclick = () => {
  if (!confirm('Bạn chắc chắn muốn đầu hàng?')) return;
  if (mode === 'online') { net.room.send('resign'); return; }
  const loser = mode === 'local' ? chess.turn() : myColor;
  finish({ result: loser === 'w' ? '0-1' : '1-0', reason: 'resign' });
};
$('bMenu').onclick = () => {
  if (mode === 'online' && net && net.running && !confirm('Rời phòng sẽ bị xử thua. Tiếp tục?')) return;
  leaveOnline(); stopAI(); showMenu();
};
$('oMenu').onclick = () => { leaveOnline(); showMenu(); };
$('oReview').onclick = () => { review = true; $('over').classList.add('hidden'); render(); toast('Bấm "Menu" để chơi ván mới', 'info'); };
$('oAgain').onclick = () => {
  if (mode === 'online') { net.room.send('rematch'); $('oAgain').disabled = true; $('overScore').textContent = 'Đang chờ đối thủ đồng ý tái đấu...'; return; }
  newGame(mode, { level, color: pickColor === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : pickColor });
};

// ---------- menu ----------
function showMenu() {
  over = true; review = false;
  ['over', 'wait'].forEach(id => $(id).classList.add('hidden'));
  $('menu').classList.remove('hidden');
  $('mResume').classList.toggle('hidden', !save.game);
  const w = save.stats.wins;
  $('mStats').textContent = `Đã thắng máy: ${w.reduce((a, b) => a + b, 0)} ván` + (save.stats.online ? ` · online: ${save.stats.online}` : '');
  $('netMsg').textContent = '';
  render();
}
$('levels').innerHTML = LEVELS.map((n, i) => `<button data-l="${i + 1}" class="${i + 1 === level ? 'on' : ''}">${i + 1}<small>${n}</small></button>`).join('');
$('levels').onclick = e => { const b = e.target.closest('[data-l]'); if (!b) return; level = +b.dataset.l; seg('levels', b); };
$('colors').onclick = e => { const b = e.target.closest('[data-c]'); if (!b) return; pickColor = b.dataset.c; seg('colors', b); };
$('tcs').innerHTML = TCS.map(([m, s], i) => `<button data-tc="${i}" class="${i === pickTc ? 'on' : ''}">${m}+${s}</button>`).join('');
$('tcs').onclick = e => { const b = e.target.closest('[data-tc]'); if (!b) return; pickTc = +b.dataset.tc; seg('tcs', b); };
$('themes').onclick = e => {
  const b = e.target.closest('[data-t]'); if (!b) return;
  save.settings.theme = b.dataset.t; applyTheme(); seg('themes', b); persist();
};
$('optHints').onchange = e => { save.settings.hints = e.target.checked; persist(); render(); };
function seg(id, b) { $(id).querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b)); sfx.click(); }
function applyTheme() { document.body.classList.remove('t-green', 't-slate'); if (save.settings.theme !== 'wood') document.body.classList.add('t-' + save.settings.theme); }
$('mAI').onclick = () => newGame('ai', { level, color: pickColor === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : pickColor });
$('mLocal').onclick = () => newGame('local');
$('mResume').onclick = () => { const g = save.game; if (g) newGame('ai', { level: g.level, color: g.color, moves: g.moves, undos: g.undos, hintsUsed: g.hintsUsed, freeHint: g.freeHint }); };

// ---------- online ----------
function setNet(text, icon) { setIc($('netMsg'), icon, text); }
async function goOnline(opts) {
  if (net) return;
  setNet('Đang kết nối máy chủ...', 'loader-circle');
  let room;
  try { room = await GH.multiplayer.join(opts); }
  catch (e) { setNet(e.code === 'offline' ? 'Chơi online cần mở game trên GameHub' : e.message, 'triangle-alert'); return; }
  net = { room, color: null, running: false, code: room.code, clocks: { w: 0, b: 0 }, turnAt: 0, names: null };
  setNet('');
  if (opts.create) room.send('cfg', { tc: pickTc });
  $('menu').classList.add('hidden');
  showWait(opts.create ? 'Phòng riêng đã sẵn sàng' : 'Đang tìm đối thủ...', opts.create ? 'Gửi mã này cho bạn bè để cùng chơi:' : 'Ghép với người chơi đang chờ (5 phút +3 giây)', room.code);
  room.on('start', m => {
    mode = 'online'; myColor = m.color; flipped = myColor === 'b'; over = false; review = false;
    chess = new R.Chess(); sel = null; lastMove = null; hintMove = null;
    Object.assign(net, { color: m.color, running: true, clocks: m.clock, turnAt: performance.now(), base: m.base, inc: m.inc, names: { w: m.white.name, b: m.black.name } });
    ['menu', 'over', 'wait'].forEach(id => $(id).classList.add('hidden'));
    $('oAgain').disabled = false; $('offer').classList.add('hidden');
    GH.gameStart().catch(() => {});
    toast(`Bạn cầm quân ${m.color === 'w' ? 'Trắng — đi trước' : 'Đen'}`, 'swords');
    render();
  });
  room.on('mv', m => {
    net.clocks = m.clock; net.turnAt = performance.now();
    const h = chess.history[chess.history.length - 1];
    if (!(h && m.ply === chess.history.length && h.from === m.from && h.to === m.to)) {   // nước của đối thủ (của mình thì đã đi trước)
      if (!commit({ from: m.from, to: m.to, promo: m.promo }, true)) resync(m.fen);
    }
    $('bDraw').disabled = false;
    render();
  });
  room.on('reject', m => { toast(m.error || 'Nước đi không hợp lệ', 'triangle-alert'); resync(m.fen, m.moves); });
  room.on('drawoffer', () => {
    const box = $('offer');
    box.innerHTML = `${ic('handshake')} Đối thủ mời hòa<div class="btns"><button class="ghost" data-a="accept">Đồng ý</button><button class="ghost" data-a="decline">Từ chối</button></div>`;
    box.classList.remove('hidden');
    box.onclick = e => { const b = e.target.closest('[data-a]'); if (!b) return; room.send('draw', { a: b.dataset.a }); box.classList.add('hidden'); };
  });
  room.on('drawno', () => toast('Đối thủ từ chối hòa', 'handshake'));
  room.on('rematch', m => { if (m.by !== room.me.id) $('overScore').textContent = 'Đối thủ muốn tái đấu — bấm "Tái đấu" để bắt đầu'; });
  room.on('end', m => {
    net.running = false; if (m.clock) net.clocks = m.clock;
    let s = '';
    if (m.saved && m.saved.saved) s = `+${m.points.toLocaleString('vi-VN')} điểm · hạng #${m.saved.rank}`;
    else if (m.points && m.guest) s = 'Đăng nhập GameHub để lưu điểm online';
    finish({ result: m.result, reason: m.reason }, { score: s });
  });
  room.on('opp_left', () => { toast('Đối thủ đã rời phòng', 'triangle-alert'); $('oAgain').disabled = true; });
  room.on('close', () => { if (net && net.room === room) { if (net.running) toast('Mất kết nối máy chủ', 'wifi-off'); net = null; if (!$('wait').classList.contains('hidden')) showMenu(); } });
  room.on('error', e => toast(e.message, 'triangle-alert'));
}
function resync(fen, moves) {
  chess = new R.Chess();
  if (moves) for (const mv of moves) chess.move(mv); else if (fen) chess = new R.Chess(fen);
  sel = null; render();
}
function leaveOnline() { if (net) { try { net.room.leave(); } catch { /* */ } net = null; } }
function showWait(title, text, code) {
  $('waitTitle').textContent = title; $('waitText').textContent = text;
  $('waitCode').textContent = code || ''; $('waitCode').classList.toggle('hidden', !code);
  $('wait').classList.remove('hidden');
}
$('wCancel').onclick = () => { leaveOnline(); showMenu(); };
$('mQuick').onclick = () => goOnline({});
$('mCreate').onclick = () => goOnline({ create: true });
$('mJoin').onclick = () => { const c = $('mCode').value.trim().toUpperCase(); if (c.length < 4) { setNet('Nhập mã phòng 6 ký tự', 'triangle-alert'); return; } goOnline({ code: c }); };
$('mCode').onkeydown = e => { if (e.key === 'Enter') $('mJoin').click(); };

// đồng hồ online: máy chủ giữ giờ chuẩn, client chỉ đếm lùi để hiển thị
function tickClocks() {
  if (mode === 'online' && net) {
    const turn = chess.turn(), el = performance.now() - net.turnAt;
    const bottom = flipped ? 'b' : 'w';
    [['barBottom', bottom], ['barTop', other(bottom)]].forEach(([id, c]) => {
      const ms = net.running && turn === c ? net.clocks[c] - el : net.clocks[c];
      const ce = $(id).querySelector('[data-clock]'), txt = fmtClock(ms);
      if (ce.textContent !== txt) ce.textContent = txt;
      ce.classList.toggle('low', ms < 20000);
    });
  }
  requestAnimationFrame(tickClocks);
}
requestAnimationFrame(tickClocks);
window.addEventListener('keydown', e => { if (e.key === 'Escape') { sel = null; $('promo').classList.add('hidden'); render(); } });

// ---------- khởi động ----------
GH.on('mute', d => { muted = !!(d && d.muted); });
GH.init().then(() => GH.load().catch(() => null)).then(data => {
  if (data && typeof data === 'object') {
    save = Object.assign(save, data);
    save.settings = Object.assign({ theme: 'wood', hints: true, sound: true }, data.settings || {});
    save.stats = Object.assign({ wins: [0, 0, 0, 0, 0], played: 0, online: 0 }, data.stats || {});
    save.hintBank = data.hintBank || 0;
  }
  $('optHints').checked = save.settings.hints;
  $('themes').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.t === save.settings.theme));
  applyTheme();
  if (GH.mode !== 'hosted') $('onlineBox').querySelector('.mtitle').insertAdjacentHTML('beforeend', ' <small class="muted">(cần chạy trên GameHub)</small>');
  showMenu();
  getWorker();
  GH.ready();
});
window.__chess = { get chess() { return chess; }, get net() { return net; }, newGame, commit, goOnline, get mode() { return mode; } };
})();
