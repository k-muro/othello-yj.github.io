// ===== CONSTANTS =====

const STORAGE_KEYS = {
  SOLVER_DEPTH:    'othello-solver-depth',
  SHOW_NUMBERS:    'othello-show-numbers',
  GRAPH_MODE:      'othello-graph-mode',
  EVAL_LEVEL:      'othello-eval-level',
  SHOW_MOVE_EVALS: 'othello-show-move-evals',
  panel:           id => `othello-panel-${id}`,
  SHOW_OPENINGS:   'othello-show-openings',
};
const MAX_SAVED_BRANCHES       = 5;
const DEFAULT_SOLVER_DEPTH     = 20;
const EVAL_ADVANTAGE_THRESHOLD = 15;
const MAX_SHOWN_MISTAKES       = 7;
const MIN_LOSS_FOR_MISTAKE     = 6;
const BLUNDER_THRESHOLD        = 12;

const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];

// ===== 定石名 =====
// オセロ盤の4重対称（初期配置の黒白を保存する変換のみ）
// 90°/270°回転は黒白を入れ替えるため除外。180°回転・主対角・副対角のみ有効。
const OPENING_TRANSFORMS = [
  (x, y) => [x, y],         // 恒等
  (x, y) => [7 - x, 7 - y], // 180°回転
  (x, y) => [y, x],         // 主対角反転
  (x, y) => [7 - y, 7 - x], // 副対角反転
];

const OPENINGS = [
  { name: 'ウサギ',       kifu: 'f5d6c5f4e3c6d3f6e6d7' },
  { name: '馬',           kifu: 'f5d6c5f4d3e3g4g5e6c4' },
  { name: '虎',           kifu: 'f5d6c3d3c4f4' },
  { name: 'ネズミ',       kifu: 'f5f4e3f6d3c5d6c4e6' },
  { name: '牛',           kifu: 'f5f6e6f4e3c5c4e7c6e2' },
  { name: '蛇',           kifu: 'f5f6e6f4g6c5g4g5' },
  { name: 'バッファロー', kifu: 'f5f6e6f4c3d7e3d6e7c5' },
].map(o => ({
  name: o.name,
  moves: Array.from({ length: o.kifu.length / 2 }, (_, i) => ({
    x: o.kifu.charCodeAt(i * 2) - 97,
    y: parseInt(o.kifu[i * 2 + 1]) - 1,
  })),
}));

// 色相環を定石数で等分して各定石に色を割り当てる
const OPENING_COLORS = Object.fromEntries(
  OPENINGS.map((op, i) => [op.name, `hsl(${Math.round(360 * i / OPENINGS.length)}, 70%, 50%)`])
);

// 現在の手順と一致する定石名の配列を返す（外れた定石は含まない）。
function getMatchingOpenings(moves) {
  if (moves.length === 0) return [];
  const found = new Set();
  for (const T of OPENING_TRANSFORMS) {
    const tr = moves.map(({ x, y }) => { const [nx, ny] = T(x, y); return { x: nx, y: ny }; });
    for (const op of OPENINGS) {
      if (tr.length > op.moves.length) continue;
      if (tr.every((m, i) => m.x === op.moves[i].x && m.y === op.moves[i].y)) found.add(op.name);
    }
  }
  return [...found];
}

// ===== GAME STATE =====

let showMoveNumbers = localStorage.getItem(STORAGE_KEYS.SHOW_NUMBERS) === 'true';
let moveHistory = [];
let currentMove = 0;
let board = [];
let currentPlayer = 1; // 1=黒, -1=白
let referenceKifu = []; // 最後に「反映」した棋譜
let blackName = "黒";
let whiteName = "白";
let _skipDraw = false;

// ===== PURE GAME LOGIC =====

// 初期盤面の2次元配列を生成して返す
function createInitialBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(0));
  b[3][3] = -1;
  b[4][4] = -1;
  b[3][4] = 1;
  b[4][3] = 1;
  return b;
}

// 棋譜配列を "a1b2…" 形式の文字列に変換する
function movesToKifuString(moves) {
  return moves.map(m => String.fromCharCode(97 + m.x) + (m.y + 1)).join('');
}

function countStones(b) {
  let black = 0, white = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (b[r][c] === 1) black++;
      else if (b[r][c] === -1) white++;
    }
  return { black, white, empty: 64 - black - white };
}

function applyBoardMove(b, x, y, player) {
  const nb = b.map(r => [...r]);
  nb[y][x] = player;
  for (const [dx, dy] of DIRS) {
    let nx = x+dx, ny = y+dy, tmp = [];
    while (nx>=0&&nx<8&&ny>=0&&ny<8&&nb[ny][nx]===-player){tmp.push([nx,ny]);nx+=dx;ny+=dy;}
    if (nx>=0&&nx<8&&ny>=0&&ny<8&&nb[ny][nx]===player) tmp.forEach(([fx,fy])=>{nb[fy][fx]=player;});
  }
  return nb;
}

function inBounds(x, y) {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

function getFlips(x, y, player) {
  if (board[y][x] !== 0) return [];
  let flips = [];
  for (const [dx, dy] of DIRS) {
    let nx = x + dx;
    let ny = y + dy;
    let temp = [];
    while (inBounds(nx, ny) && board[ny][nx] === -player) {
      temp.push([nx, ny]);
      nx += dx;
      ny += dy;
    }
    // temp.length > 0 を確認: 相手石を少なくとも1枚挟む手のみ合法
    if (inBounds(nx, ny) && board[ny][nx] === player && temp.length > 0) {
      flips = flips.concat(temp);
    }
  }
  return flips;
}

function getValidMoves(player) {
  const moves = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      // getFlips が空でない座標だけが合法手
      if (getFlips(x, y, player).length > 0) moves.push([x, y]);
    }
  }
  return moves;
}

// 相手が置けない場合は手番をそのままにする（パス）
function applyPassIfNeeded() {
  if (getValidMoves(currentPlayer).length === 0 && getValidMoves(-currentPlayer).length > 0)
    currentPlayer *= -1;
}

function resetBoardState() {
  board = createInitialBoard();
  currentPlayer = 1;
}

function initBoard() {
  resetBoardState();
  moveHistory = [];
  currentMove = 0;
}

// ===== BOARD NAVIGATION =====

// _skipDraw フラグを立てて fn() を実行し、終わったら drawBoard() を呼ぶ
function withSkipDraw(fn) {
  _skipDraw = true;
  fn();
  _skipDraw = false;
  drawBoard();
}

// グローバル board に対して (x,y) に player を置き、フリップを適用する
function applyMoveToBoard(x, y, player) {
  const flips = getFlips(x, y, player);
  board[y][x] = player;
  flips.forEach(([fx, fy]) => { board[fy][fx] = player; });
  currentPlayer = -player;
}

function rebuildBoard() {
  resetBoardState();
  for (let i = 0; i < currentMove; i++) {
    const m = moveHistory[i];
    applyMoveToBoard(m.x, m.y, m.player);
  }
  applyPassIfNeeded();
  drawBoard();
}

function playMove(x, y) {
  const flips = getFlips(x, y, currentPlayer);
  if (flips.length === 0) return;

  // 分岐自動保存: 打つ前の局面がツリー内にあれば、打った後の局面も確認する
  const prevPath = savedBranches.length > 0
    ? moveHistory.slice(0, currentMove).map(m => `${m.x},${m.y}`)
    : null;

  moveHistory = moveHistory.slice(0, currentMove);
  moveHistory.push({x, y, player: currentPlayer});
  currentMove++;

  board[y][x] = currentPlayer;
  flips.forEach(([fx, fy]) => board[fy][fx] = currentPlayer);
  currentPlayer *= -1;
  applyPassIfNeeded();

  if (prevPath) {
    // prevPath がある枝の末尾と完全一致 → その枝を延長更新
    const extendIdx = savedBranches.findIndex(b =>
      b.moves.length === prevPath.length &&
      prevPath.every((key, i) => key === `${b.moves[i].x},${b.moves[i].y}`)
    );
    if (extendIdx >= 0) {
      savedBranches[extendIdx].moves = moveHistory.slice(0, currentMove);
    } else if (savedBranches.length < MAX_SAVED_BRANCHES) {
      // prevPath がどこかの枝のプレフィックス → 初めて外れた瞬間だけ新規保存
      const currPath = moveHistory.slice(0, currentMove).map(m => `${m.x},${m.y}`);
      if (isPathPrefixOfAnyBranch(prevPath) && !isPathPrefixOfAnyBranch(currPath)) {
        _addBranch(moveHistory.slice(0, currentMove));
      }
    }
  }

  drawBoard();
}

function undo() {
  if (currentMove > 0) { currentMove--; rebuildBoard(); }
}

function undo10() {
  currentMove = Math.max(0, currentMove - 10);
  rebuildBoard();
}

function goToFirst() {
  currentMove = 0;
  rebuildBoard();
}

function redo10() {
  withSkipDraw(() => {
    for (let i = 0; i < 10; i++) redo();
  });
}

function goToLast() {
  withSkipDraw(() => {
    let prev;
    do {
      prev = currentMove;
      redo();
    } while (currentMove !== prev);
  });
}

function currentMatchesReference() {
  if (currentMove > referenceKifu.length) return false;
  for (let i = 0; i < currentMove; i++) {
    if (moveHistory[i].x !== referenceKifu[i].x || moveHistory[i].y !== referenceKifu[i].y) return false;
  }
  return true;
}

function redo() {
  if (currentMatchesReference() && currentMove < referenceKifu.length) {
    const ref = referenceKifu[currentMove];
    if (currentMove < moveHistory.length &&
        moveHistory[currentMove].x === ref.x && moveHistory[currentMove].y === ref.y) {
      // moveHistoryの次の手が棋譜と同じ → 通常のredo
      currentMove++;
      rebuildBoard();
    } else {
      // moveHistoryが尽きているか次の手が棋譜と異なる → 棋譜の手を打つ
      playMove(ref.x, ref.y);
    }
    return;
  }
  if (currentMove < moveHistory.length) { currentMove++; rebuildBoard(); }
}

// ===== KIFU UTILITIES =====

function coordToXY(coord) {
  const x = coord.charCodeAt(0) - 97;
  const y = parseInt(coord[1]) - 1;
  return {x, y};
}

function kifuToMoves(kifu) {
  initBoard();
  for (let i = 0; i + 1 < kifu.length; i += 2) {
    const {x, y} = coordToXY(kifu.substring(i, i + 2));
    if (getFlips(x, y, currentPlayer).length === 0) break;
    moveHistory.push({x, y, player: currentPlayer});
    applyMoveToBoard(x, y, currentPlayer);
    applyPassIfNeeded();
    currentMove++;
  }
}

// ===== GAME END CHECK =====

function checkGameEnd() {
  const blackMoves = getValidMoves(1);   // 黒
  const whiteMoves = getValidMoves(-1);  // 白

  if (blackMoves.length === 0 && whiteMoves.length === 0) {
    // 終局
    showGameResult();
    return true;
  }

  return false;
}
