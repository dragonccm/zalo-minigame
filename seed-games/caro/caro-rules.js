(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.CaroRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const SIZE = 15;
  const DIRS = [[1, 0], [0, 1], [1, 1], [1, -1]];
  const at = (x, y) => y * SIZE + x;
  const inside = (x, y) => x >= 0 && x < SIZE && y >= 0 && y < SIZE;
  const create = () => ({ board: Array(SIZE * SIZE).fill(0), turn: 1, history: [], winner: 0, line: [], ended: false });

  function inspect(board, x, y, side) {
    for (const [dx, dy] of DIRS) {
      const line = [[x, y]];
      for (const sign of [-1, 1]) {
        let nx = x + dx * sign, ny = y + dy * sign;
        while (inside(nx, ny) && board[at(nx, ny)] === side) {
          if (sign < 0) line.unshift([nx, ny]); else line.push([nx, ny]);
          nx += dx * sign; ny += dy * sign;
        }
      }
      if (line.length < 5) continue;
      const a = line[0], b = line[line.length - 1];
      const leftX = a[0] - dx, leftY = a[1] - dy, rightX = b[0] + dx, rightY = b[1] + dy;
      const blockedLeft = !inside(leftX, leftY) || board[at(leftX, leftY)] === 3 - side;
      const blockedRight = !inside(rightX, rightY) || board[at(rightX, rightY)] === 3 - side;
      if (line.length >= 6 || !(blockedLeft && blockedRight)) return line;
    }
    return null;
  }

  function move(state, x, y) {
    if (state.ended || !Number.isInteger(x) || !Number.isInteger(y) || !inside(x, y) || state.board[at(x, y)]) return null;
    const side = state.turn;
    state.board[at(x, y)] = side;
    state.history.push({ x, y, side });
    const line = inspect(state.board, x, y, side);
    if (line) { state.winner = side; state.line = line; state.ended = true; }
    else if (state.history.length === SIZE * SIZE) state.ended = true;
    else state.turn = 3 - side;
    return { x, y, side, winner: state.winner, line: state.line, ended: state.ended, ply: state.history.length };
  }

  function candidates(board) {
    if (!board.some(Boolean)) return [[7, 7]];
    const found = new Set();
    for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) if (board[at(x, y)]) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (inside(nx, ny) && !board[at(nx, ny)]) found.add(at(nx, ny));
      }
    }
    return [...found].map(n => [n % SIZE, Math.floor(n / SIZE)]);
  }

  function pattern(board, x, y, side) {
    board[at(x, y)] = side;
    if (inspect(board, x, y, side)) { board[at(x, y)] = 0; return 1000000; }
    let score = 0;
    for (const [dx, dy] of DIRS) {
      let n = 1, open = 0;
      for (const sign of [-1, 1]) {
        let nx = x + dx * sign, ny = y + dy * sign;
        while (inside(nx, ny) && board[at(nx, ny)] === side) { n++; nx += dx * sign; ny += dy * sign; }
        if (inside(nx, ny) && !board[at(nx, ny)]) open++;
      }
      score += n >= 5 ? 25000 : n === 4 ? (open === 2 ? 12000 : 2600) : n === 3 ? (open === 2 ? 1300 : 250) : n === 2 ? (open === 2 ? 90 : 18) : 2;
    }
    board[at(x, y)] = 0;
    return score;
  }

  function choose(board, side, level = 2) {
    const cells = candidates(board);
    if (!cells.length) return null;
    if (level === 1) return cells[Math.floor(Math.random() * cells.length)];
    const scored = cells.map(([x, y]) => ({ x, y, score: pattern(board, x, y, side) + pattern(board, x, y, 3 - side) * (level >= 3 ? 1.08 : .8) + Math.random() * 4 }));
    scored.sort((a, b) => b.score - a.score);
    const best = level === 2 && scored[0].score < 1000000 ? scored[Math.floor(Math.random() * Math.min(3, scored.length))] : scored[0];
    return [best.x, best.y];
  }
  return { SIZE, create, move, inspect, choose, at };
});
