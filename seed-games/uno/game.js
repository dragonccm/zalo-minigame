(() => {
  'use strict';
  const U = UnoRules, GH = GameHub, $ = id => document.getElementById(id);
  const colorNames = { r: 'ĐỎ', y: 'VÀNG', g: 'XANH LÁ', b: 'XANH DƯƠNG' };
  const colorHex = { r: '#e54b54', y: '#e3a62e', g: '#37a77a', b: '#367acb' };
  const symbols = { skip: '⊘', rev: '↻', d2: '+2', wild: '◉', d4: '+4' };
  let mode = null, bots = 1, round = null, view = null, room = null, self = 'you', names = {}, selected = null, armed = false;
  let until = 0, botTimer = null, finished = false, message = 'Đánh lá cùng màu, cùng số hoặc cùng ký hiệu.';
  let previous = null, endFx = false, pile = [], pileEls = new Map();
  const handEls = new Map();
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
  const label = c => symbols[c.v] || c.v;
  const cardName = c => `${c.c === 'w' ? 'Đổi màu' : colorNames[c.c]} ${c.v === 'd2' ? 'Rút 2' : c.v === 'd4' ? 'Rút 4' : c.v === 'rev' ? 'Đổi chiều' : c.v === 'skip' ? 'Bỏ lượt' : c.v === 'wild' ? '' : c.v}`;
  const isPlayable = c => view && (c.c === 'w' || c.c === view.color || (view.top.c !== 'w' && c.v === view.top.v)) && (view.drawn === null || view.drawn === c.id);
  const say = text => { message = text; $('log').textContent = text; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const center = r => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 });

  // ---------- âm thanh tổng hợp (không cần file) ----------
  let actx = null, muted = false;
  function audio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* không có Web Audio */ } }
    if (actx && actx.state === 'suspended') actx.resume().catch(() => {});
    return actx;
  }
  function tone(freq, dur, { type = 'sine', vol = 0.06, delay = 0, to = 0 } = {}) {
    const a = muted ? null : audio(); if (!a) return;
    const o = a.createOscillator(), g = a.createGain(), t = a.currentTime + delay;
    o.type = type; o.frequency.setValueAtTime(freq, t); if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
  }
  function swish(vol = 0.05, dur = 0.14) {
    const a = muted ? null : audio(); if (!a) return;
    const buf = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain();
    s.buffer = buf; f.type = 'bandpass'; f.frequency.setValueAtTime(1800, a.currentTime); f.frequency.exponentialRampToValueAtTime(5200, a.currentTime + dur);
    g.gain.value = vol; s.connect(f).connect(g).connect(a.destination); s.start();
  }
  const sfx = {
    draw: () => swish(0.05, 0.16),
    play: () => { swish(0.04, 0.1); tone(150, 0.12, { type: 'triangle', vol: 0.09, delay: 0.1, to: 70 }); },
    special: () => { tone(330, 0.12, { type: 'square', vol: 0.04 }); tone(520, 0.16, { type: 'square', vol: 0.04, delay: 0.09 }); },
    uno: () => { tone(660, 0.1, { type: 'triangle', vol: 0.08 }); tone(880, 0.18, { type: 'triangle', vol: 0.08, delay: 0.1 }); },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, { type: 'triangle', vol: 0.07, delay: i * 0.11 })),
    lose: () => tone(300, 0.5, { type: 'sawtooth', vol: 0.04, to: 110 }),
  };
  document.addEventListener('pointerdown', audio, { once: true });
  GH.on('mute', d => { muted = !!(d && d.muted); });

  // ---------- thẻ bài 3D: hai mặt (trước/sau) trong khối preserve-3d ----------
  function cardElement(card, clickable = false) {
    const el = document.createElement(clickable ? 'button' : 'div');
    el.dataset.cardId = card.id;
    el.innerHTML = `<span class="card-3d"><span class="face front"><span class="corner">${label(card)}</span><span class="value">${label(card)}</span><span class="corner bottom">${label(card)}</span><span class="shine"></span></span><span class="face back"><span>UNO</span></span></span>`;
    if (clickable) { el.type = 'button'; el.setAttribute('aria-label', cardName(card)); el.onclick = () => choose(card); }
    styleCard(el, card, clickable);
    return el;
  }
  function styleCard(el, card, clickable) {
    el.className = `card ${card.c}` + (clickable && isPlayable(card) ? ' playable' : '') + (el.classList.contains('top') ? ' top' : '') + (el.classList.contains('trail') ? ' trail' : '');
    if (clickable) el.disabled = !view || view.turnId !== self || !isPlayable(card) || view.ended || view.pendingChallenge;
  }
  function showMenu() { $('overlay').classList.remove('off'); $('closeOverlay').classList.toggle('hidden', !mode); }
  function hideMenu() { $('overlay').classList.add('off'); }
  function reset(next) {
    if (room) { room.leave(); room = null; }
    if (botTimer) clearTimeout(botTimer);
    mode = next; round = null; view = null; names = {}; selected = null; armed = false; finished = false; until = 0;
    previous = null; endFx = false; pile = []; pileEls = new Map(); handEls.clear();
    $('hand').replaceChildren(); $('discard').replaceChildren();
    $('modeTag').textContent = next === 'bot' ? 'ĐẤU MÁY' : 'ĐẤU ONLINE';
    $('rematchBtn').classList.add('hidden'); hideMenu(); render();
  }
  function startLocal(count) {
    reset('bot'); bots = count;
    const ids = ['you', ...Array.from({ length: count }, (_, i) => `bot${i + 1}`)];
    names = Object.fromEntries(ids.map((id, i) => [id, i ? `Máy ${i}` : 'Bạn']));
    round = U.create(ids); self = 'you'; view = U.view(round, self);
    say('Lượt của bạn. Chọn lá phù hợp hoặc rút bài.');
    GH.gameStart().catch(() => {}); render(); shuffleDeck();
  }
  function finishLocal() {
    if (finished || !round?.ended) return;
    finished = true;
    const won = round.winner === self;
    say(won ? `Bạn thắng! Ghi ${round.score} điểm.` : `${names[round.winner]} thắng vòng này.`);
    $('rematchBtn').classList.remove('hidden');
    GH.gameOver(won ? { score: Math.max(100, round.score), meta: { mode: 'bot', opponents: bots } } : {}).catch(() => {});
    if (won) GH.unlockAchievement('first_win').catch(() => {});
  }
  function syncLocal(text) {
    view = U.view(round, self); if (text) say(text);
    finishLocal(); render(); queueBots();
  }
  function act(type, data = {}) {
    if (!view || view.ended) return;
    audio();
    if (mode === 'online') { if (room) room.send(type, data); return; }
    const fn = { play: () => U.play(round, self, data.cardId, data.color, data.uno), draw: () => U.draw(round, self),
      pass: () => U.pass(round, self), uno: () => U.declare(round, self), catch: () => U.catchUno(round, self),
      challenge: () => U.resolveD4(round, self, data.challenge) }[type];
    if (!fn) return;
    const out = fn(); if (!out.ok) return say(out.error);
    syncLocal(type === 'play' ? 'Bạn đã đánh một lá.' : type === 'draw' ? 'Bạn rút một lá.' : type === 'uno' ? 'UNO!' : type === 'catch' ? 'Bắt lỗi UNO! Đối thủ rút 2 lá.' : 'Đã xử lý lượt.');
  }
  function choose(card) {
    if (card.c === 'w') { selected = card; $('colorPicker').classList.remove('hidden'); }
    else playCard(card, null);
  }
  function playCard(card, color) {
    $('colorPicker').classList.add('hidden'); selected = null;
    const uno = armed; armed = false;
    act('play', { cardId: card.id, color, uno });
  }
  function bestColor(hand) {
    const counts = { r: 0, y: 0, g: 0, b: 0 };
    for (const c of hand) if (c.c !== 'w') counts[c.c]++;
    return Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0];
  }
  function queueBots() {
    if (mode !== 'bot' || !round || round.ended || round.players[round.turn].id === self) return;
    if (botTimer) clearTimeout(botTimer);
    botTimer = setTimeout(() => {
      if (mode !== 'bot' || !round || round.ended) return;
      const id = round.players[round.turn].id;
      if (id === self) return;
      if (round.pending) U.resolveD4(round, id, false);
      else {
        const p = round.players[round.turn];
        const playable = p.hand.filter(c => U.playable(round, c) && (round.drawn === null || round.drawn === c.id));
        if (playable.length) {
          const pick = playable.find(c => c.c !== 'w') || playable[0];
          U.play(round, id, pick.id, pick.c === 'w' ? bestColor(p.hand) : null, p.hand.length === 2);
        } else if (round.drawn !== null) U.pass(round, id);
        else U.draw(round, id);
      }
      syncLocal(`${names[id]} đã chơi.`);
    }, 900);
  }

  // ---------- hiệu ứng ----------
  const fxOn = () => !reducedMotion.matches;
  const table = () => $('table');
  function announce(text, color = '#fff', at = null) {
    if (!fxOn()) return;
    const el = document.createElement('div'); el.className = 'announce'; el.textContent = text;
    el.style.setProperty('--c', color);
    const host = $('fxTop');
    if (at) { el.style.left = `${at.x}px`; el.style.top = `${at.y}px`; }
    host.append(el);
    el.animate([
      { transform: 'translate(-50%,-50%) scale(.3) rotate(-8deg)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.22) rotate(2deg)', opacity: 1, offset: .22 },
      { transform: 'translate(-50%,-56%) scale(1) rotate(0)', opacity: 1, offset: .7 },
      { transform: 'translate(-50%,-90%) scale(.96)', opacity: 0 },
    ], { duration: 1100, easing: 'cubic-bezier(.2,.8,.2,1)' }).onfinish = () => el.remove();
  }
  function burst(x, y, color, count = 16) {
    if (!fxOn()) return;
    const host = $('fxTop');
    const ring = document.createElement('div'); ring.className = 'ring'; ring.style.cssText = `left:${x}px;top:${y}px;--c:${color}`; host.append(ring);
    ring.animate([{ transform: 'translate(-50%,-50%) scale(.2)', opacity: .95 }, { transform: 'translate(-50%,-50%) scale(2.6)', opacity: 0 }], { duration: 640, easing: 'cubic-bezier(.15,.7,.2,1)' }).onfinish = () => ring.remove();
    for (let i = 0; i < count; i++) {
      const s = document.createElement('i'); s.className = 'spark'; s.style.cssText = `left:${x}px;top:${y}px;background:${i % 3 ? color : '#fff6c8'}`; host.append(s);
      const a = (i / count) * Math.PI * 2 + rnd(-.2, .2), d = rnd(40, 110);
      s.animate([{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: `translate(calc(-50% + ${Math.cos(a) * d}px),calc(-50% + ${Math.sin(a) * d + 18}px)) scale(.1)`, opacity: 0 }],
        { duration: rnd(480, 760), easing: 'cubic-bezier(.1,.7,.3,1)' }).onfinish = () => s.remove();
    }
  }
  function confetti() {
    if (!fxOn()) return;
    const host = $('fxTop'), palette = ['#e54b54', '#e3a62e', '#37a77a', '#367acb', '#fff6c8', '#ff7ac8'];
    for (let i = 0; i < 90; i++) {
      const p = document.createElement('i'); p.className = 'confetti';
      p.style.cssText = `left:${rnd(0, 100)}vw;background:${palette[i % palette.length]};width:${rnd(6, 11)}px;height:${rnd(10, 18)}px`;
      host.append(p);
      p.animate([
        { transform: 'translate3d(0,-8vh,0) rotateX(0) rotateZ(0)', opacity: 1 },
        { transform: `translate3d(${rnd(-90, 90)}px,112vh,0) rotateX(${rnd(400, 900)}deg) rotateZ(${rnd(-540, 540)}deg)`, opacity: 1 },
      ], { duration: rnd(1800, 3400), delay: rnd(0, 700), easing: 'cubic-bezier(.3,.2,.6,1)', fill: 'backwards' }).onfinish = () => p.remove();
    }
  }
  function shakeTable(power = 5) {
    if (!fxOn()) return;
    table().animate([{ transform: 'translate(0,0)' }, { transform: `translate(${power}px,${-power / 2}px)` }, { transform: `translate(${-power}px,${power / 2}px)` },
      { transform: `translate(${power / 2}px,${power / 2}px)` }, { transform: 'translate(0,0)' }], { duration: 340, easing: 'ease-out' });
  }
  // bay từ rect nguồn tới vị trí thật của phần tử: cung cong, xoay, tuỳ chọn lật mặt và va chạm
  function flyIn(el, from, { delay = 0, dur = 640, flip = false, lift = 80, spin = -14, slam = false } = {}) {
    if (!fxOn() || !from) return;
    const to = el.getBoundingClientRect();
    if (!to.width || !from.width) return;
    const dx = from.left + from.width / 2 - (to.left + to.width / 2), dy = from.top + from.height / 2 - (to.top + to.height / 2);
    const rest = getComputedStyle(el).transform, base = rest === 'none' ? '' : `${rest} `;
    el.animate([
      { transform: `translate(${dx}px,${dy}px) ${base}scale(.8) rotate(${spin}deg)`, opacity: 0 },
      { opacity: 1, offset: .08 },
      { transform: `translate(${dx * .45}px,${dy * .45 - lift}px) ${base}scale(1.2) rotate(${spin / 3}deg)`, offset: .5 },
      { transform: `translate(${dx * .03}px,${dy * .03}px) ${base}scale(${slam ? 1.28 : 1.07})`, offset: .86 },
      { transform: base || 'none' },
    ], { duration: dur, delay, fill: 'backwards', easing: 'cubic-bezier(.22,.7,.2,1)' });
    const inner = el.querySelector('.card-3d');
    if (flip && inner) inner.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(-16deg)', offset: .76 }, { transform: 'rotateY(0)' }],
      { duration: dur, delay, fill: 'backwards', easing: 'ease-out' });
    if (slam) setTimeout(() => { const r = el.getBoundingClientRect(), c = center(r); burst(c.x, c.y, colorHex[view?.color] || '#fff6c8', 12); shakeTable(2.5); }, delay + dur * .88);
  }
  function flyBack(from, to, delay = 0, dur = 560) {
    if (!fxOn() || !from || !to) return;
    const el = document.createElement('div'); el.className = 'backcard'; $('fxTop').append(el);
    const w = el.offsetWidth, h = el.offsetHeight, a = center(from), b = center(to);
    el.style.left = `${a.x - w / 2}px`; el.style.top = `${a.y - h / 2}px`;
    const dx = b.x - a.x, dy = b.y - a.y;
    el.animate([
      { transform: 'translate(0,0) rotate(-10deg) scale(1)', opacity: 0 },
      { opacity: 1, offset: .1 },
      { transform: `translate(${dx * .5}px,${dy * .5 - 60}px) rotate(${rnd(-30, 30)}deg) scale(1.15)`, offset: .55 },
      { transform: `translate(${dx}px,${dy}px) rotate(${rnd(-20, 20)}deg) scale(.55)`, opacity: .9 },
    ], { duration: dur, delay, fill: 'backwards', easing: 'cubic-bezier(.3,.6,.3,1)' }).onfinish = () => el.remove();
  }
  function shuffleDeck() {
    const d = $('drawPile'); if (!fxOn()) return;
    d.classList.remove('shuffling'); void d.offsetWidth; d.classList.add('shuffling');
    sfx.draw(); setTimeout(() => d.classList.remove('shuffling'), 1000);
  }
  function restart(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); }

  // ---------- dựng giao diện ----------
  function buildDeck() {
    const deck = $('drawPile');
    if (!deck.firstChild) deck.innerHTML = Array.from({ length: 6 }, (_, i) => `<span class="layer" style="--k:${i}"></span>`).join('') + '<span class="layer top" style="--k:6"><span>UNO</span></span>';
  }
  function sizeRing() { const t = table(); t.style.setProperty('--ring', `${Math.round(Math.min(t.clientWidth, t.clientHeight) * .84)}px`); }
  function layoutHand() {
    const hand = $('hand'), kids = [...hand.children], n = kids.length;
    if (!n) return;
    const w = kids[0].offsetWidth, W = hand.clientWidth - 44;
    const step = n > 1 ? Math.max(Math.min(w + 8, (W - w) / (n - 1)), 12) : 0;
    const spread = Math.min(5, 34 / Math.max(n, 1));
    kids.forEach((el, i) => {
      const k = i - (n - 1) / 2;
      el.style.marginLeft = i ? `${step - w}px` : '0';
      el.style.setProperty('--rot', `${(k * spread).toFixed(2)}deg`);
      el.style.setProperty('--drop', `${(Math.abs(k) * Math.abs(k) * Math.min(1.2, 8 / n)).toFixed(1)}px`);
      el.style.zIndex = String(i + 1);
    });
  }
  function syncHand() {
    const hand = $('hand'), want = view.hand.map(c => String(c.id)), seen = new Set(want), entering = [];
    for (const [id, el] of [...handEls]) if (!seen.has(id)) { el.remove(); handEls.delete(id); }
    view.hand.forEach((c, i) => {
      let el = handEls.get(String(c.id));
      if (!el) { el = cardElement(c, true); handEls.set(String(c.id), el); entering.push(el); }
      else { styleCard(el, c, true); }
      if (hand.children[i] !== el) hand.insertBefore(el, hand.children[i] || null);
    });
    return entering;
  }
  function syncDiscard(topChanged) {
    const holder = $('discard');
    if (topChanged || !pile.length) {
      pile.push({ card: view.top, rot: rnd(-16, 16), ox: rnd(-7, 7), oy: rnd(-5, 5) });
      pile = pile.slice(-5);
    }
    const keep = new Set(pile.map(p => String(p.card.id)));
    for (const [id, el] of [...pileEls]) if (!keep.has(id)) { el.remove(); pileEls.delete(id); }
    let created = null;
    pile.forEach((p, i) => {
      const id = String(p.card.id); let el = pileEls.get(id);
      if (!el) { el = cardElement(p.card, false); pileEls.set(id, el); created = el; }
      el.classList.toggle('top', i === pile.length - 1); el.classList.toggle('trail', i !== pile.length - 1);
      el.style.setProperty('--rot', `${p.rot}deg`); el.style.setProperty('--ox', `${p.ox}px`); el.style.setProperty('--oy', `${p.oy}px`);
      el.style.zIndex = String(i + 1);
      if (el.parentNode !== holder) holder.append(el);
    });
    return created;
  }
  function render() {
    const opponents = $('opponents'), hand = $('hand');
    const handRects = new Map([...handEls].map(([id, el]) => [id, el.getBoundingClientRect()]));
    const oppRects = new Map(Array.from(opponents.children, el => [el.dataset.pid, el.getBoundingClientRect()]));
    const deckRect = $('drawPile').getBoundingClientRect();
    opponents.replaceChildren();
    buildDeck();
    if (!view) {
      $('turnText').textContent = mode === 'online' ? 'Đang chờ người chơi' : 'Chọn chế độ để bắt đầu'; $('handTitle').textContent = 'Sẵn sàng chơi?';
      $('discard').replaceChildren(); return;
    }
    for (const p of view.players.filter(p => p.id !== self)) {
      const el = document.createElement('div'); el.className = 'opponent' + (view.turnId === p.id ? ' current' : '') + (p.count === 1 ? ' uno' : ''); el.dataset.pid = p.id;
      const fan = document.createElement('div'); fan.className = 'mini-fan';
      const shown = Math.min(p.count, 8);
      for (let i = 0; i < shown; i++) { const c = document.createElement('i'); c.style.setProperty('--r', `${(i - (shown - 1) / 2) * 9}deg`); c.style.setProperty('--d', `${i * 35}ms`); fan.append(c); }
      const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = (names[p.id] || '?')[0].toUpperCase();
      const info = document.createElement('div'); const b = document.createElement('b'); b.textContent = names[p.id] || 'Đối thủ';
      const small = document.createElement('small'); small.textContent = `${p.count} lá`; info.append(b, small);
      el.append(avatar, info, fan);
      if (p.count === 1) { const tag = document.createElement('span'); tag.className = 'uno-tag'; tag.textContent = 'UNO!'; el.append(tag); }
      opponents.append(el);
    }
    const topChanged = !previous || previous.top !== view.top.id;
    const newTop = syncDiscard(topChanged);
    $('pileCount').textContent = `${view.deckCount} lá`; $('activeColor').textContent = `MÀU ${colorNames[view.color]}`;
    $('activeColor').className = `active-color ${view.color}`;
    table().style.setProperty('--glow', colorHex[view.color]); sizeRing();
    $('dirRing').dataset.dir = view.direction === -1 ? '-1' : '1';
    $('turnText').textContent = view.ended ? view.winner === self ? 'BẠN THẮNG!' : `${names[view.winner] || 'Đối thủ'} THẮNG` : view.turnId === self ? 'LƯỢT CỦA BẠN' : `LƯỢT ${names[view.turnId] || 'ĐỐI THỦ'}`;
    $('handTitle').textContent = `${view.hand.length} lá trên tay`;
    const entering = syncHand();
    layoutHand();

    const myTurn = view.turnId === self && !view.ended;
    $('drawBtn').textContent = view.drawn !== null ? 'QUA LƯỢT' : 'RÚT BÀI';
    $('drawBtn').disabled = !myTurn || !!view.pendingChallenge;
    $('drawPile').disabled = $('drawBtn').disabled;
    $('drawPile').classList.toggle('hint', myTurn && view.drawn === null && !view.hand.some(isPlayable));
    $('unoBtn').disabled = view.ended || (view.hand.length !== 2 && !(view.hand.length === 1 && view.vulnerable === self));
    $('unoBtn').textContent = view.hand.length === 1 && view.vulnerable === self ? 'GỌI UNO NGAY!' : armed ? 'UNO ĐÃ SẴN SÀNG ✓' : 'GỌI UNO!';
    $('catchBtn').classList.toggle('hidden', !view.vulnerable || view.vulnerable === self);
    $('challengeBox').classList.toggle('hidden', !view.pendingChallenge);
    $('rematchBtn').classList.toggle('hidden', !view.ended);
    $('log').textContent = message;

    if (fxOn()) motion({ entering, newTop, topChanged, handRects, oppRects, deckRect });
    previous = { top: view.top.id, hand: new Set(view.hand.map(c => String(c.id))), counts: new Map(view.players.map(p => [p.id, p.count])),
      color: view.color, dir: view.direction, turnId: view.turnId, ended: view.ended, handLen: view.hand.length };
  }
  // so sánh với trạng thái trước để biết ai rút / ai đánh rồi bay bài tương ứng
  function motion({ entering, newTop, topChanged, handRects, oppRects, deckRect }) {
    const first = !previous, discardEl = $('discard');
    entering.forEach((el, i) => { flyIn(el, deckRect, { delay: Math.min(i, 8) * (first ? 85 : 110), flip: true, spin: -20 }); });
    if (entering.length) sfx.draw();
    if (first) {
      if (newTop) flyIn(newTop, deckRect, { delay: 760, flip: true, dur: 560 });
      return;
    }
    // người khác rút bài
    for (const p of view.players) {
      if (p.id === self) continue;
      const delta = p.count - (previous.counts.get(p.id) ?? p.count);
      for (let i = 0; i < Math.min(delta, 6); i++) flyBack(deckRect, oppRects.get(p.id), i * 120);
      if (delta > 0) sfx.draw();
    }
    if (topChanged && newTop) {
      const t = view.top, mine = previous.hand.has(String(t.id));
      const fromOpp = !mine && previous.turnId !== self ? oppRects.get(previous.turnId) : null;
      const from = mine ? handRects.get(String(t.id)) : fromOpp || deckRect;
      flyIn(newTop, from, { flip: !mine, slam: true, dur: mine ? 560 : 680, lift: mine ? 60 : 90, spin: mine ? -8 : 24 });
      sfx.play();
      const cx = center(discardEl.getBoundingClientRect());
      const sp = { d2: ['+2', '#ff5a5f'], d4: ['+4', '#ffd23f'], skip: ['BỎ LƯỢT', '#7cc4ff'], rev: ['ĐỔI CHIỀU', '#8ef0b0'], wild: ['ĐỔI MÀU', colorHex[view.color]] }[t.v];
      if (sp) setTimeout(() => { announce(sp[0], sp[1], { x: cx.x, y: cx.y - 70 }); sfx.special(); if (t.v === 'd2' || t.v === 'd4') shakeTable(7); }, 560);
      if (t.v === 'd4' || t.v === 'wild' || previous.color !== view.color) restart(table(), 'pulse');
    }
    if (previous.dir !== view.direction) restart($('dirRing'), 'flip');
    if (previous.turnId !== view.turnId && !view.ended) restart($('turnText'), 'bump');
    // UNO!
    const unoOpp = view.players.find(p => p.id !== self && p.count === 1 && (previous.counts.get(p.id) ?? 1) !== 1);
    if (unoOpp) setTimeout(() => { const r = $('opponents').querySelector(`[data-pid="${CSS.escape(unoOpp.id)}"]`); if (r) announce('UNO!', '#ff4d4d', center(r.getBoundingClientRect())); sfx.uno(); }, 500);
    if (view.hand.length === 1 && previous.handLen !== 1) { announce('UNO!', '#ff4d4d', center($('hand').getBoundingClientRect())); sfx.uno(); }
    // kết thúc ván
    if (view.ended && !previous.ended && !endFx) {
      endFx = true;
      setTimeout(() => { if (view.winner === self) { confetti(); announce('CHIẾN THẮNG!', '#ffd23f', { x: innerWidth / 2, y: innerHeight * .4 }); sfx.win(); } else { announce('KẾT THÚC', '#9aa0d0', { x: innerWidth / 2, y: innerHeight * .4 }); sfx.lose(); } }, 700);
    }
  }
  async function join(opts) {
    reset('online'); say('Đang kết nối phòng...'); self = null;
    try {
      room = await GH.multiplayer.join(opts); self = room.me.id;
      say(room.code ? `Mã phòng ${room.code} · chờ người chơi` : 'Đang chờ người chơi khác...');
      room.on('lobby', m => { names = Object.fromEntries(m.players.map(p => [p.id, p.name]));
        if (!finished || m.players.length >= 2) say(m.players.length >= 2 ? 'Sắp bắt đầu bàn bài...' : 'Đang chờ người chơi khác...');
        render(); });
      room.on('start', m => { names = Object.fromEntries(m.players.map(p => [p.id, p.name])); view = m.view; until = m.until; finished = false; armed = false;
        previous = null; endFx = false; pile = []; pileEls = new Map(); handEls.clear(); $('hand').replaceChildren(); $('discard').replaceChildren();
        say('Bàn bài đã bắt đầu.'); GH.gameStart().catch(() => {}); render(); shuffleDeck(); });
      room.on('snapshot', m => { view = m.view; until = m.until; if (m.message) say(m.message); render(); });
      room.on('reject', m => say(m.error || 'Nước đi không hợp lệ'));
      room.on('end', m => { finished = true; if (view) { view.ended = true; view.winner = m.winner; view.score = m.score; }
        say(m.winner === self ? `Bạn thắng! Ghi ${m.score} điểm.` : m.winner ? `${names[m.winner] || 'Đối thủ'} thắng vòng này.` : 'Ván đấu kết thúc.');
        GH.gameOver({}).catch(() => {}); if (m.winner === self) { GH.unlockAchievement('first_win').catch(() => {}); GH.unlockAchievement('online_win').catch(() => {}); } render(); });
      room.on('rematch', m => say(`Đã đồng ý tái đấu ${m.count} người.`));
      room.on('close', () => { if (mode === 'online') say('Mất kết nối phòng.'); });
      room.on('error', e => say(e.message));
      render();
    } catch (e) { say(e.message || 'Không vào được phòng.'); render(); }
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.onclick = () => b.dataset.mode === 'bot' ? startLocal(Number(b.dataset.bots)) : join(b.dataset.mode === 'create' ? { create: true } : {}));
  $('joinBtn').onclick = () => { const code = $('joinCode').value.toUpperCase().trim(); if (!/^[A-Z2-9]{6}$/.test(code)) return $('dialogText').textContent = 'Nhập mã phòng 6 ký tự.'; join({ code }); };
  $('menuBtn').onclick = showMenu; $('closeOverlay').onclick = hideMenu;
  $('drawBtn').onclick = () => act(view?.drawn !== null ? 'pass' : 'draw'); $('drawPile').onclick = () => act(view?.drawn !== null ? 'pass' : 'draw');
  $('unoBtn').onclick = () => { if (view?.hand.length === 1 && view.vulnerable === self) act('uno'); else { armed = !armed; render(); } };
  $('catchBtn').onclick = () => act('catch');
  $('rematchBtn').onclick = () => mode === 'online' ? (room?.send('rematch'), say('Đang chờ mọi người tái đấu...')) : startLocal(bots);
  document.querySelectorAll('[data-color]').forEach(b => b.onclick = () => { if (selected) playCard(selected, b.dataset.color); });
  $('cancelColor').onclick = () => { selected = null; $('colorPicker').classList.add('hidden'); };
  $('acceptFour').onclick = () => act('challenge', { challenge: false }); $('challengeFour').onclick = () => act('challenge', { challenge: true });

  // nghiêng thẻ 3D theo con trỏ + ánh bóng chạy theo
  const hand = $('hand');
  hand.addEventListener('pointermove', e => {
    if (e.pointerType === 'touch') return;
    const c = e.target.closest('.card.playable'); if (!c) return;
    const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width, py = (e.clientY - r.top) / r.height, inner = c.firstElementChild;
    inner.style.setProperty('--rx', `${((px - .5) * 22).toFixed(1)}deg`); inner.style.setProperty('--ry', `${((.5 - py) * 18).toFixed(1)}deg`);
    inner.style.setProperty('--mx', `${(px * 100).toFixed(0)}%`); inner.style.setProperty('--my', `${(py * 100).toFixed(0)}%`);
  });
  hand.addEventListener('pointerout', e => {
    const c = e.target.closest('.card'); if (!c || c.contains(e.relatedTarget)) return;
    c.firstElementChild.style.removeProperty('--rx'); c.firstElementChild.style.removeProperty('--ry');
  });
  addEventListener('resize', () => { layoutHand(); sizeRing(); });
  setInterval(() => { $('countdown').textContent = mode === 'online' && view && !view.ended ? `00:${String(Math.max(0, Math.ceil((until - Date.now()) / 1000))).padStart(2, '0')}` : ''; }, 250);
  GH.init().then(() => GH.ready()).catch(() => {});
})();
