(() => {
  'use strict';
  const R = CaroRules, GH = GameHub, $ = id => document.getElementById(id);
  const grid = $('grid'), cells = [];
  let game = R.create(), mode = null, level = 2, side = 1, room = null, pending = null, waiting = false, endShown = false, hoverAt = -1;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  let names = ['Quân X', 'Quân O'], clock = [300000, 300000], clockAt = Date.now(), statusText = 'Chọn chế độ để bắt đầu.';
  const coarse = () => matchMedia('(pointer:coarse)').matches;
  const toast = text => { statusText = text; $('status').textContent = text; };
  const fmt = ms => { const n = Math.max(0, Math.ceil(ms / 1000)); return `${String(Math.floor(n / 60)).padStart(2, '0')}:${String(n % 60).padStart(2, '0')}`; };
  const fxOn = () => !reducedMotion.matches;
  const rnd = (a, b) => a + Math.random() * (b - a);
  const INK = { 1: '#0f5e55', 2: '#c23b2c' };
  const X_SVG = '<svg class="piece x" viewBox="0 0 40 40" aria-hidden="true"><path d="M5.5 5.5 L34.5 34.5"/><path d="M34.5 5.5 L5.5 34.5"/></svg>';
  const O_SVG = '<svg class="piece o" viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="14.5"/></svg>';

  // ---------- âm thanh tổng hợp ----------
  let actx = null, muted = false;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* không có Web Audio */ } }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.07, delay = 0, to = 0 } = {}) {
    const a = muted ? null : audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  const sfx = {
    place: side => { tone(side === 1 ? 190 : 150, 0.09, { type: 'triangle', vol: 0.12, to: 70 }); tone(side === 1 ? 880 : 660, 0.05, { type: 'sine', vol: 0.03, delay: 0.005 }); },
    win: () => [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, 0.24, { type: 'triangle', vol: 0.07, delay: i * 0.1 })),
    lose: () => tone(320, 0.55, { type: 'sawtooth', vol: 0.04, to: 110 }),
    draw: () => { tone(400, 0.2, { type: 'sine', vol: 0.05 }); tone(400, 0.25, { type: 'sine', vol: 0.05, delay: 0.22 }); },
  };
  document.addEventListener('pointerdown', audio, { once: true });
  GH.on('mute', d => { muted = !!(d && d.muted); });

  // ---------- dựng bàn ----------
  for (let i = 0; i < R.SIZE; i++) {
    const cx = document.createElement('span'); cx.textContent = String.fromCharCode(65 + i); $('cx').append(cx);
    const cy = document.createElement('span'); cy.textContent = String(i + 1); $('cy').append(cy);
  }
  for (let y = 0; y < R.SIZE; y++) for (let x = 0; x < R.SIZE; x++) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'cell'; b.setAttribute('role', 'gridcell');
    b.setAttribute('aria-label', `Cột ${String.fromCharCode(65 + x)}, hàng ${y + 1}`); b.addEventListener('click', () => select(x, y));
    grid.append(b); cells.push(b);
  }
  grid.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const t = e.target.closest('.cell'); if (!t) return;
    const i = cells.indexOf(t); if (i === hoverAt) return; hoverAt = i;
    grid.style.setProperty('--hx', i % R.SIZE); grid.style.setProperty('--hy', Math.floor(i / R.SIZE));
    grid.classList.toggle('hovering', !t.disabled);
  });
  grid.addEventListener('pointerleave', () => { hoverAt = -1; grid.classList.remove('hovering'); });

  function showMenu(title = 'Cờ Caro', text = 'Chọn cách chơi. Đặt năm quân theo hàng ngang, dọc hoặc chéo để thắng.') {
    $('dialogTitle').textContent = title; $('dialogText').textContent = text; $('overlay').classList.remove('off');
    $('closeOverlay').classList.toggle('hidden', !mode);
  }
  function hideMenu() { $('overlay').classList.add('off'); }
  function reset(nextMode) {
    if (room) { room.leave(); room = null; }
    mode = nextMode; game = R.create(); pending = null; waiting = false; side = 1; endShown = false;
    clock = [300000, 300000]; clockAt = Date.now(); $('roomCode').textContent = '';
    $('modeTag').textContent = nextMode === 'ai' ? 'ĐẤU MÁY' : nextMode === 'local' ? 'HAI NGƯỜI' : 'ĐẤU ONLINE';
    names = nextMode === 'ai' ? ['Bạn', 'Máy'] : ['Quân X', 'Quân O'];
    document.body.classList.toggle('online', nextMode === 'online');
    $('winLine').replaceChildren(); $('banner').className = 'banner';
    hideMenu(); render();
  }
  function startLocal(nextMode, aiLevel) {
    reset(nextMode); level = aiLevel || 2; toast('Lượt quân X. Chọn một ô trống.'); render();
    GH.gameStart().catch(() => {});
  }
  function finishLocal() {
    const won = game.winner === 1 && mode === 'ai';
    const score = won ? 1500 : 0;
    GH.gameOver(score ? { score, meta: { mode, moves: game.history.length } } : {}).catch(() => {});
    if (won) GH.unlockAchievement('first_win').catch(() => {});
    toast(game.winner ? `${names[game.winner - 1]} thắng!` : 'Hòa: bàn cờ đã đầy.');
    $('rematchBtn').classList.remove('hidden'); render();
  }
  function play(x, y) {
    pending = null; waiting = false;
    const rec = R.move(game, x, y);
    if (!rec) return toast('Ô này đã có quân. Hãy chọn ô khác.');
    if (rec.ended) return finishLocal();
    toast(`Lượt quân ${game.turn === 1 ? 'X' : 'O'}. Chọn một ô trống.`);
    if (mode === 'ai' && game.turn === 2) {
      waiting = true; render();
      setTimeout(() => {
        if (mode !== 'ai' || game.ended) return;
        const pick = R.choose(game.board, 2, level);
        if (pick) { R.move(game, pick[0], pick[1]); if (game.ended) finishLocal(); else toast('Đến lượt bạn. Chọn một ô trống.'); }
        waiting = false; render();
      }, 520);
    }
    render();
  }
  function select(x, y) {
    if (!mode || game.ended || game.board[R.at(x, y)] || waiting) return;
    if (mode === 'online') {
      if (!room || game.turn !== side) return toast('Chưa tới lượt bạn.');
      if (pending && pending[0] === x && pending[1] === y) { waiting = true; room.send('mv', { x, y }); render(); return; }
      if (!coarse()) { waiting = true; room.send('mv', { x, y }); render(); return; }
    }
    if (mode === 'ai' && game.turn !== 1) return;
    if (pending && pending[0] === x && pending[1] === y) { mode === 'online' ? (waiting = true, room.send('mv', { x, y }), render()) : play(x, y); return; }
    if (!coarse()) return play(x, y);
    pending = [x, y]; render();
  }

  // chuỗi liên tiếp dài nhất của một bên (4 hướng)
  function longest(player) {
    let best = 0; const S = R.SIZE;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      if (game.board[R.at(x, y)] !== player) continue;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const px = x - dx, py = y - dy;
        if (px >= 0 && px < S && py >= 0 && py < S && game.board[R.at(px, py)] === player) continue; // chỉ đếm từ đầu chuỗi
        let n = 0, cx = x, cy = y;
        while (cx >= 0 && cx < S && cy >= 0 && cy < S && game.board[R.at(cx, cy)] === player) { n++; cx += dx; cy += dy; }
        if (n > best) best = n;
      }
    }
    return best;
  }

  // ---------- hiệu ứng ----------
  function placeFx(cell, side) {
    if (!fxOn()) return;
    const rip = document.createElement('i'); rip.className = 'ripple'; rip.style.setProperty('--rc', INK[side]); cell.append(rip);
    setTimeout(() => rip.remove(), 700);
    for (let i = 0; i < 7; i++) {
      const s = document.createElement('i'); s.className = 'spark'; s.style.background = i % 2 ? INK[side] : '#fff2b0'; cell.append(s);
      const a = (i / 7) * Math.PI * 2 + rnd(-.3, .3), d = rnd(14, 30);
      s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d}px)) scale(.2)`, opacity: 0 }],
        { duration: rnd(360, 560), easing: 'cubic-bezier(.1,.7,.3,1)' }).onfinish = () => s.remove();
    }
  }
  function confetti() {
    if (!fxOn()) return;
    const host = $('fxTop'), palette = ['#3fd0b8', '#edc977', '#ff7a66', '#fff6c8', '#7cc4ff', '#ff9fd0'];
    for (let i = 0; i < 80; i++) {
      const p = document.createElement('i'); p.className = 'confetti';
      p.style.cssText = `left:${rnd(0, 100)}vw;background:${palette[i % palette.length]};width:${rnd(6, 11)}px;height:${rnd(10, 18)}px`; host.append(p);
      p.animate([{ transform: 'translate3d(0,-8vh,0) rotateZ(0)', opacity: 1 }, { transform: `translate3d(${rnd(-90, 90)}px,112vh,0) rotateX(${rnd(300, 800)}deg) rotateZ(${rnd(-540, 540)}deg)`, opacity: 1 }],
        { duration: rnd(1800, 3200), delay: rnd(0, 600), easing: 'cubic-bezier(.3,.2,.6,1)', fill: 'backwards' }).onfinish = () => p.remove();
    }
  }
  function drawWinLine(line) {
    const svg = $('winLine'); svg.replaceChildren();
    if (!line.length) return;
    const [a, b] = [line[0], line[line.length - 1]], ns = 'http://www.w3.org/2000/svg';
    for (const cls of ['under', '']) {
      const l = document.createElementNS(ns, 'line'); if (cls) l.setAttribute('class', cls);
      l.setAttribute('x1', a[0] + .5); l.setAttribute('y1', a[1] + .5); l.setAttribute('x2', b[0] + .5); l.setAttribute('y2', b[1] + .5); l.setAttribute('pathLength', '30');
      svg.append(l);
    }
  }
  function showBanner(text, cls) {
    const el = $('banner'); el.className = `banner ${cls}`; el.innerHTML = `<span>${text}</span>`; void el.offsetWidth; el.classList.add('show');
  }
  function celebrate(mine) {
    drawWinLine(game.line || []);
    if (game.winner) {
      showBanner(`${names[game.winner - 1]} THẮNG!`, game.winner === 2 ? 'o' : 'x');
      if (mine === false) sfx.lose(); else sfx.win();
      if (mine !== false) setTimeout(confetti, 350);
    } else { showBanner('HÒA', 'draw'); sfx.draw(); }
  }

  function render() {
    const last = game.history.at(-1), win = new Map(game.line.map(([x, y], i) => [R.at(x, y), i]));
    const moveNo = new Map(game.history.map((m, i) => [R.at(m.x, m.y), i + 1]));
    for (let i = 0; i < cells.length; i++) {
      const b = cells[i], v = game.board[i], x = i % R.SIZE, y = Math.floor(i / R.SIZE);
      const had = b.dataset.v || '0';
      if (had !== String(v)) {
        b.replaceChildren(); b.dataset.v = String(v);
        if (v) {
          b.insertAdjacentHTML('beforeend', v === 1 ? X_SVG : O_SVG);
          if (last?.x === x && last?.y === y) {
            b.classList.add('new'); setTimeout(() => b.classList.remove('new'), 800); placeFx(b, v); sfx.place(v);
          }
        }
      }
      const isNew = b.classList.contains('new');
      b.className = 'cell' + (v === 1 ? ' x' : v === 2 ? ' o' : '') + (isNew ? ' new' : '') + (last && last.x === x && last.y === y ? ' last' : '') + (win.has(i) ? ' win' : '') + (pending && pending[0] === x && pending[1] === y ? ' preview' : '');
      if (win.has(i)) b.style.setProperty('--wi', win.get(i)); else b.style.removeProperty('--wi');
      if (moveNo.has(i)) b.dataset.n = moveNo.get(i); else delete b.dataset.n;
      b.disabled = !mode || game.ended || !!v || waiting || (mode === 'online' && game.turn !== side) || (mode === 'ai' && game.turn !== 1);
    }
    grid.classList.toggle('has-winner', win.size > 0);
    grid.dataset.turn = game.turn === 1 ? 'x' : 'o';
    document.querySelector('.board-head').dataset.turn = game.ended || !mode ? '' : game.turn === 1 ? 'x' : 'o';
    $('moveCount').textContent = `${game.history.length} nước`;
    $('name1').textContent = names[0]; $('name2').textContent = names[1];
    $('seat1').classList.toggle('active', !game.ended && game.turn === 1);
    $('seat2').classList.toggle('active', !game.ended && game.turn === 2);
    for (const [n, p] of [['1', 1], ['2', 2]]) {
      const c = longest(p), el = $(`chain${n}`);
      if (el.textContent !== String(c)) { el.textContent = c; if (fxOn() && c > 1) { el.classList.remove('chain-bump'); void el.offsetWidth; el.classList.add('chain-bump'); } }
    }
    $('turnText').textContent = game.ended ? 'KẾT THÚC' : !mode ? 'SẴN SÀNG' : `LƯỢT QUÂN ${game.turn === 1 ? 'X' : 'O'}`;
    $('headline').textContent = game.ended ? game.winner ? `${names[game.winner - 1]} thắng` : 'Ván hòa' : !mode ? 'Đặt năm quân thành hàng' : mode === 'online' && game.turn !== side ? 'Đang chờ đối thủ' : `Đến lượt ${names[game.turn - 1]}`;
    $('status').textContent = statusText;
    $('confirmBtn').classList.toggle('hidden', !pending);
    $('undoBtn').disabled = !mode || mode === 'online' || !game.history.length || game.ended || waiting;
    $('resignBtn').disabled = !mode || game.ended;
    if (game.ended && !endShown) { endShown = true; celebrate(mode === 'online' ? game.winner === side : mode === 'ai' ? game.winner === 1 : true); }
    if (!game.ended && endShown) { endShown = false; $('winLine').replaceChildren(); $('banner').className = 'banner'; }
  }
  function undo() {
    if (mode === 'online' || !game.history.length || game.ended) return;
    const history = game.history.slice(0, -((mode === 'ai' && game.history.length >= 2) ? 2 : 1));
    game = R.create(); for (const m of history) R.move(game, m.x, m.y);
    pending = null; toast('Đã đi lại nước vừa rồi.'); render();
  }
  async function join(opts) {
    reset('online'); toast('Đang kết nối phòng...'); render();
    try {
      room = await GH.multiplayer.join(opts);
      $('roomCode').textContent = room.code ? `MÃ ${room.code}` : 'GHÉP NHANH';
      toast(room.code ? `Mã phòng: ${room.code} · chờ bạn bè vào` : 'Đang chờ đối thủ...');
      room.on('start', m => {
        game = R.create(); side = m.side; names = m.players.map(p => p.name); clock = m.clock; clockAt = Date.now();
        waiting = false; pending = null; endShown = false; $('rematchBtn').classList.add('hidden');
        toast(`Bạn cầm quân ${side === 1 ? 'X' : 'O'}.`); GH.gameStart().catch(() => {}); render();
      });
      room.on('mv', m => { R.move(game, m.x, m.y); clock = m.clock; clockAt = Date.now(); waiting = false; pending = null; toast(game.turn === side ? 'Đến lượt bạn. Chọn một ô trống.' : 'Đang chờ đối thủ đi.'); render(); });
      room.on('reject', m => { waiting = false; toast(m.error || 'Nước đi không hợp lệ'); render(); });
      room.on('end', m => {
        game.ended = true; game.winner = m.winner; game.line = m.line || [];
        const won = m.winner === side;
        toast(m.winner ? won ? 'Bạn thắng!' : 'Đối thủ thắng.' : 'Ván hòa.');
        $('rematchBtn').classList.remove('hidden'); GH.gameOver({}).catch(() => {});
        if (won) { GH.unlockAchievement('first_win').catch(() => {}); GH.unlockAchievement('online_win').catch(() => {}); }
        render();
      });
      room.on('rematch', m => { if (m.by !== room.me.id) toast('Đối thủ muốn tái đấu.'); });
      room.on('opp_left', () => { if (!game.ended) toast('Đối thủ đã rời phòng.'); });
      room.on('close', () => { if (mode === 'online') { waiting = false; toast('Đã mất kết nối phòng.'); render(); } });
      room.on('error', e => toast(e.message));
    } catch (e) { toast(e.message || 'Không vào được phòng.'); render(); }
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => {
    const mode = b.dataset.mode;
    if (mode === 'ai' || mode === 'local') startLocal(mode, Number(b.dataset.level));
    else join(mode === 'create' ? { create: true } : {});
  }));
  $('joinBtn').onclick = () => { const code = $('joinCode').value.toUpperCase().trim(); if (!/^[A-Z2-9]{6}$/.test(code)) return $('dialogText').textContent = 'Nhập mã phòng gồm 6 ký tự.'; join({ code }); };
  $('menuBtn').onclick = () => showMenu(); $('closeOverlay').onclick = hideMenu;
  $('confirmBtn').onclick = () => { if (pending) select(pending[0], pending[1]); };
  $('undoBtn').onclick = undo;
  $('numBtn').onclick = () => { const on = !grid.classList.contains('show-nums'); grid.classList.toggle('show-nums', on); $('numBtn').setAttribute('aria-pressed', String(on)); };
  $('resignBtn').onclick = () => { if (mode === 'online' && room) room.send('resign'); else if (mode) { game.ended = true; game.winner = mode === 'ai' ? 2 : 3 - game.turn; finishLocal(); } };
  $('rematchBtn').onclick = () => { if (mode === 'online' && room) { room.send('rematch'); toast('Đang chờ đối thủ đồng ý...'); } else if (mode) startLocal(mode, level); };
  setInterval(() => {
    if (mode !== 'online' || game.ended || !room) return;
    const visible = clock.slice(); visible[game.turn - 1] -= Date.now() - clockAt;
    $('clock1').textContent = fmt(visible[0]); $('clock2').textContent = fmt(visible[1]);
    $('bar1').style.transform = `scaleX(${Math.max(0, Math.min(1, visible[0] / 300000))})`; $('bar2').style.transform = `scaleX(${Math.max(0, Math.min(1, visible[1] / 300000))})`;
  }, 250);
  render();
  GH.init().then(() => GH.ready()).catch(() => {});
})();
