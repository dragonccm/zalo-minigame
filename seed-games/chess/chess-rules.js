/* Luật cờ vua đầy đủ — dùng chung cho trình duyệt (game, AI trong Worker) và máy chủ (phòng online).
 * Bàn cờ 0x88: ô = hàng*16 + cột (hàng 0 = hàng 1 của Trắng), ô hợp lệ khi (ô & 0x88) === 0.
 * Quân = màu | loại: loại 1..6 = Tốt Mã Tượng Xe Hậu Vua, màu 0 = Trắng, 8 = Đen; 0 = ô trống.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.ChessRules = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  var PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6, WHITE = 0, BLACK = 8;
  var F_EP = 1, F_CASTLE = 2, F_DOUBLE = 4;            // cờ đặc biệt của nước đi
  var N_OFF = [33, 31, 18, 14, -33, -31, -18, -14], K_OFF = [1, -1, 16, -16, 17, 15, -17, -15];
  var B_DIR = [17, 15, -17, -15], R_DIR = [1, -1, 16, -16];
  var LETTER = ' pnbrqk', VALUE = [0, 100, 320, 330, 500, 900, 0];
  // quyền nhập thành bị mất khi quân rời/ bị ăn tại ô này
  var CASTLE_MASK = {};
  CASTLE_MASK[0x00] = ~2; CASTLE_MASK[0x07] = ~1; CASTLE_MASK[0x04] = ~3;     // a1, h1, e1
  CASTLE_MASK[0x70] = ~8; CASTLE_MASK[0x77] = ~4; CASTLE_MASK[0x74] = ~12;    // a8, h8, e8

  var type = function (p) { return p & 7; }, color = function (p) { return p & 8; };
  function sqName(s) { return 'abcdefgh'[s & 7] + ((s >> 4) + 1); }
  function sqOf(n) { if (!/^[a-h][1-8]$/.test(n)) return -1; return (n.charCodeAt(1) - 49) * 16 + (n.charCodeAt(0) - 97); }

  function Position() {
    this.b = new Int8Array(128); this.turn = WHITE; this.castle = 0; this.ep = -1; this.half = 0; this.full = 1; this.kings = [0, 0];
  }
  Position.START = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

  Position.fromFEN = function (fen) {
    var p = new Position(), parts = String(fen || '').trim().split(/\s+/);
    if (parts.length < 4) throw new Error('FEN không hợp lệ');
    var rows = parts[0].split('/');
    if (rows.length !== 8) throw new Error('FEN không hợp lệ');
    for (var r = 0; r < 8; r++) {
      var f = 0, rank = 7 - r;
      for (var i = 0; i < rows[r].length; i++) {
        var ch = rows[r][i];
        if (/[1-8]/.test(ch)) { f += +ch; continue; }
        var t = LETTER.indexOf(ch.toLowerCase());
        if (t < 1 || f > 7) throw new Error('FEN không hợp lệ');
        var pc = t | (ch === ch.toLowerCase() ? BLACK : WHITE), s = rank * 16 + f;
        p.b[s] = pc; if (t === KING) p.kings[pc >> 3] = s;
        f++;
      }
      if (f !== 8) throw new Error('FEN không hợp lệ');
    }
    p.turn = parts[1] === 'b' ? BLACK : WHITE;
    p.castle = (parts[2].indexOf('K') >= 0 ? 1 : 0) | (parts[2].indexOf('Q') >= 0 ? 2 : 0) | (parts[2].indexOf('k') >= 0 ? 4 : 0) | (parts[2].indexOf('q') >= 0 ? 8 : 0);
    p.ep = parts[3] === '-' ? -1 : sqOf(parts[3]);
    p.half = +parts[4] || 0; p.full = +parts[5] || 1;
    return p;
  };

  Position.prototype.clone = function () {
    var p = new Position(); p.b.set(this.b); p.turn = this.turn; p.castle = this.castle; p.ep = this.ep;
    p.half = this.half; p.full = this.full; p.kings = this.kings.slice(); return p;
  };

  // FEN; key = chỉ phần dùng để so lặp lại thế cờ
  Position.prototype.fen = function (key) {
    var out = '';
    for (var rank = 7; rank >= 0; rank--) {
      var empty = 0;
      for (var f = 0; f < 8; f++) {
        var pc = this.b[rank * 16 + f];
        if (!pc) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        var ch = LETTER[type(pc)]; out += color(pc) ? ch : ch.toUpperCase();
      }
      if (empty) out += empty;
      if (rank) out += '/';
    }
    var c = (this.castle & 1 ? 'K' : '') + (this.castle & 2 ? 'Q' : '') + (this.castle & 4 ? 'k' : '') + (this.castle & 8 ? 'q' : '');
    out += ' ' + (this.turn ? 'b' : 'w') + ' ' + (c || '-') + ' ' + (this.ep >= 0 ? sqName(this.ep) : '-');
    return key ? out : out + ' ' + this.half + ' ' + this.full;
  };

  // ô s có bị bên `by` tấn công không
  Position.prototype.attacked = function (s, by) {
    var b = this.b, i, t, p;
    var pd = by === WHITE ? -16 : 16;                          // tốt tấn công chéo lên phía trước của nó
    t = s + pd - 1; if (!(t & 0x88) && b[t] === (PAWN | by)) return true;
    t = s + pd + 1; if (!(t & 0x88) && b[t] === (PAWN | by)) return true;
    for (i = 0; i < 8; i++) { t = s + N_OFF[i]; if (!(t & 0x88) && b[t] === (KNIGHT | by)) return true; }
    for (i = 0; i < 8; i++) { t = s + K_OFF[i]; if (!(t & 0x88) && b[t] === (KING | by)) return true; }
    for (i = 0; i < 4; i++) {
      for (t = s + B_DIR[i]; !(t & 0x88); t += B_DIR[i]) {
        p = b[t]; if (!p) continue;
        if (color(p) === by && (type(p) === BISHOP || type(p) === QUEEN)) return true;
        break;
      }
      for (t = s + R_DIR[i]; !(t & 0x88); t += R_DIR[i]) {
        p = b[t]; if (!p) continue;
        if (color(p) === by && (type(p) === ROOK || type(p) === QUEEN)) return true;
        break;
      }
    }
    return false;
  };
  Position.prototype.inCheck = function (side) {
    side = side === undefined ? this.turn : side;
    return this.attacked(this.kings[side >> 3], side ^ 8);
  };

  // nước đi giả hợp lệ (chưa kiểm tra vua bị chiếu); capturesOnly cho tìm kiếm tĩnh của AI
  Position.prototype.pseudo = function (capturesOnly) {
    var b = this.b, us = this.turn, them = us ^ 8, out = [], s, t, p, i, d;
    function add(from, to, pc, cap, flags) {
      if (type(pc) === PAWN && ((to >> 4) === 7 || (to >> 4) === 0)) {
        for (var k = QUEEN; k >= KNIGHT; k--) out.push({ from: from, to: to, piece: pc, captured: cap, promo: k | us, flags: flags });
      } else out.push({ from: from, to: to, piece: pc, captured: cap, promo: 0, flags: flags });
    }
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      p = b[s]; if (!p || color(p) !== us) continue;
      var tp = type(p);
      if (tp === PAWN) {
        var fwd = us === WHITE ? 16 : -16, startRank = us === WHITE ? 1 : 6, lastRank = us === WHITE ? 6 : 1;
        t = s + fwd;
        if (!(t & 0x88) && !b[t] && (!capturesOnly || (s >> 4) === lastRank)) {
          add(s, t, p, 0, 0);
          if ((s >> 4) === startRank && !b[t + fwd] && !capturesOnly) add(s, t + fwd, p, 0, F_DOUBLE);
        }
        for (i = -1; i <= 1; i += 2) {
          t = s + fwd + i; if (t & 0x88) continue;
          if (b[t] && color(b[t]) === them) add(s, t, p, b[t], 0);
          else if (t === this.ep) add(s, t, p, PAWN | them, F_EP);
        }
      } else if (tp === KNIGHT || tp === KING) {
        var offs = tp === KNIGHT ? N_OFF : K_OFF;
        for (i = 0; i < 8; i++) {
          t = s + offs[i]; if (t & 0x88) continue;
          if (!b[t]) { if (!capturesOnly) add(s, t, p, 0, 0); } else if (color(b[t]) === them) add(s, t, p, b[t], 0);
        }
        if (tp === KING && !capturesOnly) {
          var home = us === WHITE ? 0x04 : 0x74, kBit = us === WHITE ? 1 : 4, qBit = us === WHITE ? 2 : 8;
          if (s === home && !this.attacked(s, them)) {
            if ((this.castle & kBit) && !b[s + 1] && !b[s + 2] && b[s + 3] === (ROOK | us) && !this.attacked(s + 1, them) && !this.attacked(s + 2, them)) add(s, s + 2, p, 0, F_CASTLE);
            if ((this.castle & qBit) && !b[s - 1] && !b[s - 2] && !b[s - 3] && b[s - 4] === (ROOK | us) && !this.attacked(s - 1, them) && !this.attacked(s - 2, them)) add(s, s - 2, p, 0, F_CASTLE);
          }
        }
      } else {
        var dirs = tp === BISHOP ? B_DIR : tp === ROOK ? R_DIR : K_OFF;
        for (i = 0; i < dirs.length; i++) {
          d = dirs[i];
          for (t = s + d; !(t & 0x88); t += d) {
            if (!b[t]) { if (!capturesOnly) add(s, t, p, 0, 0); continue; }
            if (color(b[t]) === them) add(s, t, p, b[t], 0);
            break;
          }
        }
      }
    }
    return out;
  };

  // thực hiện nước đi; trả về dữ liệu để hoàn tác
  Position.prototype.make = function (m) {
    var b = this.b, us = this.turn, u = { castle: this.castle, ep: this.ep, half: this.half, full: this.full };
    b[m.to] = m.promo || m.piece; b[m.from] = 0;
    if (m.flags & F_EP) b[m.to + (us === WHITE ? -16 : 16)] = 0;
    if (m.flags & F_CASTLE) {
      if (m.to > m.from) { b[m.to - 1] = b[m.to + 1]; b[m.to + 1] = 0; } else { b[m.to + 1] = b[m.to - 2]; b[m.to - 2] = 0; }
    }
    if (type(m.piece) === KING) this.kings[us >> 3] = m.to;
    var cm = CASTLE_MASK[m.from]; if (cm !== undefined) this.castle &= cm;
    cm = CASTLE_MASK[m.to]; if (cm !== undefined) this.castle &= cm;
    this.ep = m.flags & F_DOUBLE ? (m.from + m.to) >> 1 : -1;
    this.half = type(m.piece) === PAWN || m.captured ? 0 : this.half + 1;
    if (us === BLACK) this.full++;
    this.turn = us ^ 8;
    return u;
  };
  Position.prototype.unmake = function (m, u) {
    var b = this.b, us = this.turn ^ 8;
    this.turn = us; this.castle = u.castle; this.ep = u.ep; this.half = u.half; this.full = u.full;
    b[m.from] = m.piece;
    if (m.flags & F_EP) { b[m.to] = 0; b[m.to + (us === WHITE ? -16 : 16)] = m.captured; } else b[m.to] = m.captured;
    if (m.flags & F_CASTLE) {
      if (m.to > m.from) { b[m.to + 1] = b[m.to - 1]; b[m.to - 1] = 0; } else { b[m.to - 2] = b[m.to + 1]; b[m.to + 1] = 0; }
    }
    if (type(m.piece) === KING) this.kings[us >> 3] = m.from;
  };

  Position.prototype.legal = function () {
    var us = this.turn, out = [], ms = this.pseudo(false);
    for (var i = 0; i < ms.length; i++) {
      var u = this.make(ms[i]);
      if (!this.attacked(this.kings[us >> 3], us ^ 8)) out.push(ms[i]);
      this.unmake(ms[i], u);
    }
    return out;
  };

  // không bên nào còn đủ quân để chiếu hết
  Position.prototype.insufficient = function () {
    var minors = [], s;
    for (s = 0; s < 128; s++) {
      if (s & 0x88) { s += 7; continue; }
      var p = this.b[s]; if (!p) continue;
      var t = type(p);
      if (t === PAWN || t === ROOK || t === QUEEN) return false;
      if (t === KNIGHT || t === BISHOP) minors.push({ t: t, c: color(p), sq: ((s >> 4) + (s & 7)) & 1 });
    }
    if (minors.length <= 1) return true;
    // chỉ còn các tượng cùng màu ô
    return minors.every(function (m) { return m.t === BISHOP && m.sq === minors[0].sq; });
  };

  function san(pos, m, legal) {
    var s;
    if (m.flags & F_CASTLE) s = m.to > m.from ? 'O-O' : 'O-O-O';
    else {
      var t = type(m.piece);
      s = t === PAWN ? '' : LETTER[t].toUpperCase();
      if (t !== PAWN) {
        var same = legal.filter(function (x) { return x !== m && x.piece === m.piece && x.to === m.to && x.from !== m.from; });
        if (same.length) {
          var sameFile = same.some(function (x) { return (x.from & 7) === (m.from & 7); });
          var sameRank = same.some(function (x) { return (x.from >> 4) === (m.from >> 4); });
          s += !sameFile ? sqName(m.from)[0] : !sameRank ? sqName(m.from)[1] : sqName(m.from);
        }
      }
      if (m.captured) s += (t === PAWN ? sqName(m.from)[0] : '') + 'x';
      s += sqName(m.to);
      if (m.promo) s += '=' + LETTER[type(m.promo)].toUpperCase();
    }
    var u = pos.make(m), chk = pos.inCheck(), mate = chk && pos.legal().length === 0;
    pos.unmake(m, u);
    return s + (mate ? '#' : chk ? '+' : '');
  }

  // ---------- Ván cờ (dùng cho giao diện và máy chủ) ----------
  function Chess(fen) {
    this.pos = Position.fromFEN(fen || Position.START);
    this.history = [];             // { from, to, promo, san, fen trước nước đi, ... }
    this.keys = [this.pos.fen(true)];
  }
  Chess.prototype.fen = function () { return this.pos.fen(); };
  Chess.prototype.turn = function () { return this.pos.turn === WHITE ? 'w' : 'b'; };
  Chess.prototype.inCheck = function () { return this.pos.inCheck(); };
  // danh sách nước hợp lệ dạng dễ dùng: { from:'e2', to:'e4', promo:'q'|null, san, capture, piece:'p' }
  Chess.prototype.moves = function () {
    var pos = this.pos, legal = pos.legal();
    return legal.map(function (m) {
      return { from: sqName(m.from), to: sqName(m.to), promo: m.promo ? LETTER[type(m.promo)] : null, san: san(pos, m, legal),
        capture: !!m.captured, piece: LETTER[type(m.piece)], castle: !!(m.flags & F_CASTLE), _m: m };
    });
  };
  // đi một nước: { from, to, promo? } — trả về nước đã đi (có san) hoặc null nếu không hợp lệ
  Chess.prototype.move = function (mv) {
    if (!mv) return null;
    var list = this.moves(), promo = mv.promo ? String(mv.promo).toLowerCase() : null;
    var hit = null;
    for (var i = 0; i < list.length; i++) {
      var x = list[i];
      if (x.from === mv.from && x.to === mv.to && (x.promo === null || x.promo === (promo || 'q'))) { hit = x; break; }
    }
    if (!hit) return null;
    var before = this.pos.fen();
    this.pos.make(hit._m);
    var rec = { from: hit.from, to: hit.to, promo: hit.promo, san: hit.san, capture: hit.capture, piece: hit.piece, castle: hit.castle,
      color: this.pos.turn === WHITE ? 'b' : 'w', before: before, _m: hit._m };
    this.history.push(rec);
    this.keys.push(this.pos.fen(true));
    return rec;
  };
  Chess.prototype.undo = function () {
    var rec = this.history.pop(); if (!rec) return null;
    this.pos = Position.fromFEN(rec.before);
    this.keys.pop();
    return rec;
  };
  Chess.prototype.repetition = function () {
    var k = this.keys[this.keys.length - 1], n = 0;
    for (var i = 0; i < this.keys.length; i++) if (this.keys[i] === k) n++;
    return n >= 3;
  };
  // kết thúc ván? -> { result: '1-0' | '0-1' | '1/2-1/2', reason } hoặc null
  Chess.prototype.outcome = function () {
    var legal = this.pos.legal();
    if (!legal.length) {
      if (this.pos.inCheck()) return { result: this.pos.turn === WHITE ? '0-1' : '1-0', reason: 'checkmate' };
      return { result: '1/2-1/2', reason: 'stalemate' };
    }
    if (this.pos.insufficient()) return { result: '1/2-1/2', reason: 'insufficient' };
    if (this.pos.half >= 100) return { result: '1/2-1/2', reason: 'fifty' };
    if (this.repetition()) return { result: '1/2-1/2', reason: 'repetition' };
    return null;
  };
  // bàn cờ 8x8 cho giao diện: board()[hàng 8..1][cột a..h] = { type:'p', color:'w' } | null
  Chess.prototype.board = function () {
    var rows = [];
    for (var rank = 7; rank >= 0; rank--) {
      var row = [];
      for (var f = 0; f < 8; f++) {
        var p = this.pos.b[rank * 16 + f];
        row.push(p ? { type: LETTER[type(p)], color: color(p) ? 'b' : 'w' } : null);
      }
      rows.push(row);
    }
    return rows;
  };
  Chess.prototype.pieceAt = function (n) {
    var s = sqOf(n), p = s >= 0 ? this.pos.b[s] : 0;
    return p ? { type: LETTER[type(p)], color: color(p) ? 'b' : 'w' } : null;
  };
  // tổng giá trị quân đã bị ăn của mỗi bên (để hiện chênh lệch quân)
  Chess.prototype.material = function () {
    var w = 0, bl = 0, s;
    for (s = 0; s < 128; s++) { if (s & 0x88) { s += 7; continue; } var p = this.pos.b[s]; if (!p) continue; if (color(p)) bl += VALUE[type(p)]; else w += VALUE[type(p)]; }
    return { w: w, b: bl };
  };

  return {
    Position: Position, Chess: Chess, sqName: sqName, sqOf: sqOf, type: type, color: color,
    PAWN: PAWN, KNIGHT: KNIGHT, BISHOP: BISHOP, ROOK: ROOK, QUEEN: QUEEN, KING: KING, WHITE: WHITE, BLACK: BLACK,
    F_EP: F_EP, F_CASTLE: F_CASTLE, F_DOUBLE: F_DOUBLE, VALUE: VALUE, LETTER: LETTER, START: Position.START,
  };
});
