/* AI cờ vua: negamax alpha-beta + tìm kiếm tĩnh (chỉ xét nước ăn quân) + đào sâu dần theo thời gian.
 * Chạy trong Web Worker (nhận {fen, level} -> trả {move}) hoặc gọi trực tiếp ChessAI.think(fen, level).
 * Cần ChessRules (chess-rules.js) được nạp trước.
 */
(function (root) {
  'use strict';
  var R = root.ChessRules;
  var P = R.PAWN, N = R.KNIGHT, B = R.BISHOP, RK = R.ROOK, Q = R.QUEEN, K = R.KING;
  var VAL = [0, 100, 320, 330, 500, 900, 20000];
  // bảng điểm theo vị trí (góc nhìn Trắng, hàng 8 ở trên cùng)
  var PST = [];
  PST[P] = [0, 0, 0, 0, 0, 0, 0, 0, 50, 50, 50, 50, 50, 50, 50, 50, 10, 10, 20, 30, 30, 20, 10, 10, 5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0, 5, -5, -10, 0, 0, -10, -5, 5, 5, 10, 10, -20, -20, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0];
  PST[N] = [-50, -40, -30, -30, -30, -30, -40, -50, -40, -20, 0, 0, 0, 0, -20, -40, -30, 0, 10, 15, 15, 10, 0, -30, -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30, -30, 5, 10, 15, 15, 10, 5, -30, -40, -20, 0, 5, 5, 0, -20, -40, -50, -40, -30, -30, -30, -30, -40, -50];
  PST[B] = [-20, -10, -10, -10, -10, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 10, 10, 5, 0, -10, -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10, -10, 10, 10, 10, 10, 10, 10, -10, -10, 5, 0, 0, 0, 0, 5, -10, -20, -10, -10, -10, -10, -10, -10, -20];
  PST[RK] = [0, 0, 0, 0, 0, 0, 0, 0, 5, 10, 10, 10, 10, 10, 10, 5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, -5, 0, 0, 0, 0, 0, 0, -5, 0, 0, 0, 5, 5, 0, 0, 0];
  PST[Q] = [-20, -10, -10, -5, -5, -10, -10, -20, -10, 0, 0, 0, 0, 0, 0, -10, -10, 0, 5, 5, 5, 5, 0, -10, -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5, -10, 5, 5, 5, 5, 5, 0, -10, -10, 0, 5, 0, 0, 0, 0, -10, -20, -10, -10, -5, -5, -10, -10, -20];
  var K_MID = [-30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30, -30, -40, -40, -50, -50, -40, -40, -30,
    -20, -30, -30, -40, -40, -30, -30, -20, -10, -20, -20, -20, -20, -20, -20, -10, 20, 20, 0, 0, 0, 0, 20, 20, 20, 30, 10, 0, 0, 10, 30, 20];
  var K_END = [-50, -40, -30, -20, -20, -30, -40, -50, -30, -20, -10, 0, 0, -10, -20, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -10, 30, 40, 40, 30, -10, -30,
    -30, -10, 30, 40, 40, 30, -10, -30, -30, -10, 20, 30, 30, 20, -10, -30, -30, -30, 0, 0, 0, 0, -30, -30, -50, -30, -30, -30, -30, -30, -30, -50];
  var MATE = 100000;

  // điểm thế cờ theo góc nhìn bên đang đi
  function evaluate(pos) {
    var b = pos.b, score = 0, nonPawn = 0, s, p, t, idx, kw = -1, kb = -1;
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      p = b[s]; if (!p) continue;
      t = p & 7;
      if (t === K) { if (p & 8) kb = s; else kw = s; continue; }
      if (t !== P) nonPawn += VAL[t];
      idx = p & 8 ? ((s >> 4) * 8 + (s & 7)) : ((7 - (s >> 4)) * 8 + (s & 7));
      var v = VAL[t] + PST[t][idx];
      score += p & 8 ? -v : v;
    }
    var KT = nonPawn <= 1300 ? K_END : K_MID;            // tàn cuộc: vua nên ra giữa bàn
    score += KT[(7 - (kw >> 4)) * 8 + (kw & 7)] - KT[(kb >> 4) * 8 + (kb & 7)];
    return pos.turn ? -score : score;
  }

  function Search(pos, deadline) {
    this.pos = pos; this.deadline = deadline; this.nodes = 0; this.stop = false; this.killers = [];
  }
  Search.prototype.order = function (moves, ply) {
    var k = this.killers[ply];
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      m.o = m.captured ? 10000 + VAL[m.captured & 7] * 10 - VAL[m.piece & 7] / 10 : 0;
      if (m.promo) m.o += 9000;
      if (k && k.from === m.from && k.to === m.to) m.o += 5000;
    }
    moves.sort(function (a, b) { return b.o - a.o; });
  };
  Search.prototype.timeUp = function () {
    if ((++this.nodes & 1023) === 0 && this.deadline && Date.now() > this.deadline) this.stop = true;
    return this.stop;
  };
  Search.prototype.quiesce = function (alpha, beta, depth) {
    if (this.timeUp()) return 0;
    var pos = this.pos, stand = evaluate(pos);
    if (stand >= beta) return beta;
    if (stand > alpha) alpha = stand;
    if (depth > 6) return alpha;
    var ms = pos.pseudo(true), us = pos.turn;
    this.order(ms, 63);
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i];
      if (stand + VAL[m.captured & 7] + 200 < alpha && !m.promo) continue;   // ăn quân cũng không cứu được
      var u = pos.make(m);
      if (pos.attacked(pos.kings[us >> 3], us ^ 8)) { pos.unmake(m, u); continue; }
      var sc = -this.quiesce(-beta, -alpha, depth + 1);
      pos.unmake(m, u);
      if (this.stop) return 0;
      if (sc >= beta) return beta;
      if (sc > alpha) alpha = sc;
    }
    return alpha;
  };
  Search.prototype.negamax = function (depth, alpha, beta, ply, quiet) {
    if (this.timeUp()) return 0;
    var pos = this.pos, us = pos.turn;
    var inCheck = pos.attacked(pos.kings[us >> 3], us ^ 8);
    if (inCheck) depth++;                                // gia hạn khi bị chiếu
    if (depth <= 0) return quiet ? this.quiesce(alpha, beta, 0) : evaluate(pos);
    if (pos.half >= 100) return 0;
    var ms = pos.pseudo(false), legal = 0, best = -MATE;
    this.order(ms, ply);
    for (var i = 0; i < ms.length; i++) {
      var m = ms[i], u = pos.make(m);
      if (pos.attacked(pos.kings[us >> 3], us ^ 8)) { pos.unmake(m, u); continue; }
      legal++;
      var sc = -this.negamax(depth - 1, -beta, -alpha, ply + 1, quiet);
      pos.unmake(m, u);
      if (this.stop) return 0;
      if (sc > best) best = sc;
      if (sc > alpha) alpha = sc;
      if (alpha >= beta) { if (!m.captured) this.killers[ply] = m; break; }
    }
    if (!legal) return inCheck ? -MATE + ply : 0;       // chiếu hết / hết nước
    return best;
  };

  // cấp độ: độ sâu, thời gian tối đa, "nhiễu" để máy đánh kém đi ở cấp thấp
  var LEVELS = {
    1: { depth: 1, ms: 0, noise: 220, blunder: 0.25, quiet: false },
    2: { depth: 2, ms: 0, noise: 90, blunder: 0.08, quiet: true },
    3: { depth: 3, ms: 0, noise: 30, blunder: 0, quiet: true },
    4: { depth: 6, ms: 1200, noise: 0, blunder: 0, quiet: true },
    5: { depth: 12, ms: 2800, noise: 0, blunder: 0, quiet: true },
  };

  function think(fen, level) {
    var L = LEVELS[level] || LEVELS[3];
    var pos = R.Position.fromFEN(fen), legal = pos.legal();
    if (!legal.length) return null;
    if (Math.random() < L.blunder) return pick(legal[(Math.random() * legal.length) | 0]);
    var deadline = L.ms ? Date.now() + L.ms : 0;
    var s = new Search(pos, deadline), bestMove = legal[0], scores = null;
    for (var d = 1; d <= L.depth; d++) {
      s.order(legal, 0);
      var cur = [], alpha = -MATE - 1;
      for (var i = 0; i < legal.length; i++) {
        var m = legal[i], u = pos.make(m);
        // có nhiễu: cần điểm chính xác của mọi nước gốc -> cửa sổ đầy đủ; không nhiễu: chỉ cần biết nước nào tốt nhất
        var sc = -s.negamax(d - 1, -MATE - 1, L.noise ? MATE + 1 : -alpha, 1, L.quiet);
        pos.unmake(m, u);
        if (s.stop) break;
        cur.push({ m: m, sc: sc });
        if (sc > alpha) alpha = sc;
      }
      if (s.stop && d > 1) break;                      // hết giờ: dùng kết quả độ sâu trước
      scores = cur;
      // sắp lại để lần sau xét nước tốt nhất trước
      scores.sort(function (a, b) { return b.sc - a.sc; });
      legal = scores.map(function (x) { return x.m; }).concat(legal.filter(function (m) { return !scores.some(function (x) { return x.m === m; }); }));
      if (scores[0].sc > MATE - 100) break;            // đã thấy chiếu hết
      if (deadline && Date.now() > deadline - 50) break;
    }
    var chosen = scores[0];
    if (L.noise) {
      var bestNoisy = -Infinity;
      scores.forEach(function (x) { var v = x.sc + (Math.random() * 2 - 1) * L.noise; if (v > bestNoisy) { bestNoisy = v; chosen = x; } });
    }
    bestMove = chosen.m;
    return pick(bestMove, chosen.sc, s.nodes);
  }
  function pick(m, score, nodes) {
    return { from: R.sqName(m.from), to: R.sqName(m.to), promo: m.promo ? R.LETTER[m.promo & 7] : null, score: score || 0, nodes: nodes || 0 };
  }

  root.ChessAI = { think: think, evaluate: evaluate, LEVELS: LEVELS };
  // trong Web Worker: nhận lệnh nghĩ nước đi
  if (typeof WorkerGlobalScope !== 'undefined' && root instanceof WorkerGlobalScope) {
    root.onmessage = function (e) {
      var d = e.data || {};
      try { root.postMessage({ id: d.id, move: think(d.fen, d.level) }); } catch (err) { root.postMessage({ id: d.id, error: String(err && err.message || err) }); }
    };
  }
})(typeof self !== 'undefined' ? self : this);
