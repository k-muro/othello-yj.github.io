// エンコードされた棋譜文字列を kifu 形式（例: "f5d6c3..."）にデコードする
// URL パラメータ k= の値をこの関数で変換してから利用する

const decodeGame = (() => {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

  const _DIRS = [
    [-1, -1], [-1, 0], [-1, 1],
    [ 0, -1],          [ 0, 1],
    [ 1, -1], [ 1, 0], [ 1, 1],
  ];

  // 初期盤面をオブジェクト形式で生成する（decode 内部用）
  function _initBoard() {
    const board = {};
    for (const c of "abcdefgh")
      for (const r of "12345678")
        board[c + r] = ".";
    board["d4"] = "W"; board["e5"] = "W";
    board["d5"] = "B"; board["e4"] = "B";
    return board;
  }

  function _opp(player) { return player === "B" ? "W" : "B"; }

  function _sqToXY(sq) { return [sq.charCodeAt(0) - 97, Number(sq[1]) - 1]; }
  function _xyToSq(x, y) { return String.fromCharCode(97 + x) + String(y + 1); }

  function _flips(board, player, sq) {
    if (board[sq] !== ".") return [];
    const [x, y] = _sqToXY(sq);
    const opp = _opp(player);
    const result = [];
    for (const [dx, dy] of _DIRS) {
      let nx = x + dx, ny = y + dy;
      const line = [];
      while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8) {
        const s = _xyToSq(nx, ny);
        if (board[s] === opp)      { line.push(s); }
        else if (board[s] === player) { if (line.length) result.push(...line); break; }
        else                         { break; }
        nx += dx; ny += dy;
      }
    }
    return result;
  }

  function _legal(board, player) {
    const out = [];
    for (const c of "abcdefgh")
      for (const r of "12345678") {
        const sq = c + r;
        if (_flips(board, player, sq).length > 0) out.push(sq);
      }
    return out.sort((a, b) => a < b ? -1 : 1);
  }

  function _apply(board, player, sq) {
    const next = { ...board };
    next[sq] = player;
    for (const s of _flips(board, player, sq)) next[s] = player;
    return next;
  }

  function _nextPlayer(board, player) {
    const opp = _opp(player);
    if (_legal(board, opp).length > 0) return opp;
    if (_legal(board, player).length > 0) return player;
    return null;
  }

  function _fromBase64(s) {
    let n = 0n;
    for (const ch of s) {
      const idx = ALPHA.indexOf(ch);
      if (idx === -1) throw new Error(`decodeGame: 不正な文字: ${ch}`);
      n = n * 64n + BigInt(idx);
    }
    return n;
  }

  // エンコード済み文字列 → kifu 文字列（例: "f5d6c3..."）
  return function decodeGame(encoded) {
    if (!encoded || encoded.length < 2)
      throw new Error("decodeGame: エンコード文字列が短すぎます");

    const moveCount = ALPHA.indexOf(encoded[0]);
    if (moveCount < 0) throw new Error("decodeGame: 手数プレフィックスが不正です");

    let rank = _fromBase64(encoded.slice(1));
    let board = _initBoard();
    let player = "B";
    const out = [];

    for (let i = 0; i < moveCount; i++) {
      const legal = _legal(board, player);
      if (legal.length === 0) throw new Error(`decodeGame: 合法手なし (ply ${i + 1})`);
      const idx = Number(rank % BigInt(legal.length));
      rank = rank / BigInt(legal.length);
      out.push(legal[idx]);
      board = _apply(board, player, legal[idx]);
      player = _nextPlayer(board, player);
      if (player === null) break;
    }

    return out.join("");
  };
})();
