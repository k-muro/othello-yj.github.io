const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const DIRS = [
  [-1, -1], [-1, 0], [-1, 1],
  [ 0, -1],          [ 0, 1],
  [ 1, -1], [ 1, 0], [ 1, 1],
];

function initBoard() {
  const board = {};
  for (const c of "abcdefgh") {
    for (const r of "12345678") {
      board[c + r] = ".";
    }
  }
  board["d4"] = "W";
  board["e5"] = "W";
  board["d5"] = "B";
  board["e4"] = "B";
  return board;
}

function opponent(player) {
  return player === "B" ? "W" : "B";
}

function inBounds(x, y) {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

function sqToXY(sq) {
  return [sq.charCodeAt(0) - 97, Number(sq[1]) - 1];
}

function xyToSq(x, y) {
  return String.fromCharCode(97 + x) + String(y + 1);
}

function flipsForMove(board, player, sq) {
  if (board[sq] !== ".") return [];

  const [x, y] = sqToXY(sq);
  const opp = opponent(player);
  const flips = [];

  for (const [dx, dy] of DIRS) {
    let nx = x + dx;
    let ny = y + dy;
    const line = [];

    while (inBounds(nx, ny)) {
      const s = xyToSq(nx, ny);
      const piece = board[s];

      if (piece === opp) {
        line.push(s);
      } else if (piece === player) {
        if (line.length > 0) flips.push(...line);
        break;
      } else {
        break;
      }

      nx += dx;
      ny += dy;
    }
  }

  return flips;
}

function legalMoves(board, player) {
  const out = [];
  for (const c of "abcdefgh") {
    for (const r of "12345678") {
      const sq = c + r;
      if (flipsForMove(board, player, sq).length > 0) {
        out.push(sq);
      }
    }
  }
  return out;
}

function sortLegalMoves(moves) {
  return [...moves].sort((a, b) => {
    if (a[0] !== b[0]) return a.charCodeAt(0) - b.charCodeAt(0);
    return Number(a[1]) - Number(b[1]);
  });
}

function applyMove(board, player, move) {
  const flips = flipsForMove(board, player, move);
  if (flips.length === 0) {
    throw new Error(`Illegal move: ${move} for ${player}`);
  }

  const next = { ...board };
  next[move] = player;
  for (const sq of flips) {
    next[sq] = player;
  }
  return next;
}

function nextPlayer(board, player) {
  const opp = opponent(player);
  if (legalMoves(board, opp).length > 0) return opp;
  if (legalMoves(board, player).length > 0) return player;
  return null;
}

function decodeBase64UrlSafe(s) {
  let n = 0n;
  for (const ch of s) {
    const idx = ALPHABET.indexOf(ch);
    if (idx === -1) {
      throw new Error(`Invalid character: ${ch}`);
    }
    n = n * 64n + BigInt(idx);
  }
  return n;
}

function decodeGame(encoded) {
  if (!encoded || encoded.length < 2) {
    throw new Error("Encoded string is too short");
  }

  const moveCount = ALPHABET.indexOf(encoded[0]);
  if (moveCount < 0) {
    throw new Error("Invalid moveCount prefix");
  }

  let rank = decodeBase64UrlSafe(encoded.slice(1));

  let board = initBoard();
  let player = "B";
  const out = [];

  for (let i = 0; i < moveCount; i++) {
    const legal = sortLegalMoves(legalMoves(board, player));
    const base = legal.length;

    if (base === 0) {
      throw new Error(`No legal moves for ${player} at ply ${i + 1}`);
    }

    const idx = Number(rank % BigInt(base));
    rank = rank / BigInt(base);

    const move = legal[idx];
    if (move === undefined) {
      throw new Error(`Decoded index out of range at ply ${i + 1}`);
    }

    out.push(move);
    board = applyMove(board, player, move);
    player = nextPlayer(board, player);

    if (player === null) break;
  }

  return out.join("");
}

// 例
const encoded = "6Pdhh_6ceR-HiI6MASwUfqDXvyo";
console.log(decodeGame(encoded)); // f5d6c3d3