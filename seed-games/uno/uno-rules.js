(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.UnoRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const COLORS = ['r', 'y', 'g', 'b'];
  const VALUES = ['skip', 'rev', 'd2'];
  function deck() {
    const out = []; let id = 0;
    for (const c of COLORS) {
      out.push({ id: ++id, c, v: '0' });
      for (let n = 1; n <= 9; n++) for (let k = 0; k < 2; k++) out.push({ id: ++id, c, v: String(n) });
      for (const v of VALUES) for (let k = 0; k < 2; k++) out.push({ id: ++id, c, v });
    }
    for (let k = 0; k < 4; k++) { out.push({ id: ++id, c: 'w', v: 'wild' }); out.push({ id: ++id, c: 'w', v: 'd4' }); }
    return out;
  }
  function shuffle(cards, random = Math.random) {
    for (let i = cards.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [cards[i], cards[j]] = [cards[j], cards[i]]; }
    return cards;
  }
  function create(ids, random = Math.random) {
    if (!Array.isArray(ids) || ids.length < 2 || ids.length > 4 || new Set(ids).size !== ids.length) throw Error('Cần 2–4 người chơi');
    const pile = shuffle(deck(), random), players = ids.map(id => ({ id, hand: [] }));
    for (let k = 0; k < 7; k++) for (const p of players) p.hand.push(pile.pop());
    // Bắt đầu bằng lá số để người đầu tiên có một lượt rõ ràng.
    let top = pile.pop(); while (Number.isNaN(Number(top.v))) { pile.unshift(top); top = pile.pop(); }
    return { players, pile, discard: [top], color: top.c, turn: 0, dir: 1, drawn: null, vulnerable: null, pending: null, ended: false, winner: null, score: 0 };
  }
  const next = (g, i, steps = 1) => (i + g.dir * steps + g.players.length * 4) % g.players.length;
  const top = g => g.discard[g.discard.length - 1];
  function playable(g, card) { return card.c === 'w' || card.c === g.color || (top(g).c !== 'w' && card.v === top(g).v); }
  function refill(g) { if (g.pile.length || g.discard.length < 2) return; const last = g.discard.pop(); g.pile = shuffle(g.discard); g.discard = [last]; }
  function take(g, i, count) { for (let n = 0; n < count; n++) { refill(g); if (!g.pile.length) break; g.players[i].hand.push(g.pile.pop()); } }
  function value(card) { return card.c === 'w' ? 50 : VALUES.includes(card.v) ? 20 : Number(card.v); }
  function win(g, i) { g.ended = true; g.winner = g.players[i].id; g.score = g.players.reduce((sum, p, j) => sum + (j === i ? 0 : p.hand.reduce((s, c) => s + value(c), 0)), 0); }
  function turn(g, id) { return !g.ended && g.players[g.turn]?.id === id; }
  const result = (ok, error = '') => ({ ok, error });
  function play(g, id, cardId, color, uno = false) {
    if (!turn(g, id) || g.pending) return result(false, 'Chưa tới lượt đánh bài');
    const i = g.turn, hand = g.players[i].hand, ix = hand.findIndex(c => c.id === cardId);
    if (ix < 0) return result(false, 'Bạn không có lá bài này');
    const card = hand[ix];
    if (g.drawn !== null && card.id !== g.drawn) return result(false, 'Sau khi rút chỉ được đánh lá vừa rút');
    if (!playable(g, card)) return result(false, 'Lá bài không cùng màu, số hoặc ký hiệu');
    if (card.c === 'w' && !COLORS.includes(color)) return result(false, 'Hãy chọn màu tiếp theo');
    const illegalD4 = card.v === 'd4' && hand.some(c => c.id !== card.id && c.c === g.color);
    g.vulnerable = null; g.drawn = null; hand.splice(ix, 1); g.discard.push(card); g.color = card.c === 'w' ? color : card.c;
    if (hand.length === 1 && !uno) g.vulnerable = id;
    if (card.v === 'd4') {
      g.pending = { offender: i, victim: next(g, i), illegal: illegalD4 };
      g.turn = g.pending.victim;
      return result(true);
    }
    if (card.v === 'd2') { take(g, next(g, i), 2); g.turn = next(g, i, 2); }
    else if (card.v === 'skip') g.turn = next(g, i, 2);
    else if (card.v === 'rev') { g.dir *= -1; g.turn = next(g, i, g.players.length === 2 ? 2 : 1); }
    else g.turn = next(g, i);
    if (hand.length === 0) win(g, i);
    return result(true);
  }
  function draw(g, id) {
    if (!turn(g, id) || g.pending || g.drawn !== null) return result(false, 'Không thể rút bài lúc này');
    g.vulnerable = null; const i = g.turn, before = g.players[i].hand.length;
    take(g, i, 1); if (g.players[i].hand.length === before) { g.turn = next(g, i); return result(true); }
    const card = g.players[i].hand.at(-1);
    if (playable(g, card)) g.drawn = card.id; else g.turn = next(g, i);
    return result(true);
  }
  function pass(g, id) {
    if (!turn(g, id) || g.pending || g.drawn === null) return result(false, 'Bạn cần rút bài trước');
    g.drawn = null; g.turn = next(g, g.turn); return result(true);
  }
  function declare(g, id) {
    const p = g.players.find(p => p.id === id);
    if (!p || p.hand.length !== 1 || g.vulnerable !== id) return result(false, 'Chưa thể gọi UNO');
    g.vulnerable = null; return result(true);
  }
  function catchUno(g, id) {
    if (!g.vulnerable || g.vulnerable === id || !g.players.some(p => p.id === id)) return result(false, 'Không có người quên gọi UNO');
    const i = g.players.findIndex(p => p.id === g.vulnerable); take(g, i, 2); g.vulnerable = null; return result(true);
  }
  function resolveD4(g, id, challenge) {
    if (!g.pending || !turn(g, id) || g.pending.victim !== g.turn) return result(false, 'Không có lá +4 để xử lý');
    const p = g.pending; g.pending = null;
    if (challenge && p.illegal) { take(g, p.offender, 4); g.turn = p.victim; }
    else { take(g, p.victim, challenge ? 6 : 4); g.turn = next(g, p.victim); if (!g.players[p.offender].hand.length) win(g, p.offender); }
    return result(true);
  }
  function view(g, id) {
    const self = g.players.find(p => p.id === id);
    return { players: g.players.map(p => ({ id: p.id, count: p.hand.length })), hand: self ? self.hand : [], top: top(g), color: g.color,
      turnId: g.players[g.turn]?.id, direction: g.dir, drawn: self && g.players[g.turn]?.id === id ? g.drawn : null,
      pendingChallenge: !!g.pending && g.players[g.pending.victim].id === id, vulnerable: g.vulnerable,
      ended: g.ended, winner: g.winner, score: g.score, deckCount: g.pile.length };
  }
  return { COLORS, deck, create, play, draw, pass, declare, catchUno, resolveD4, view, playable, value };
});
