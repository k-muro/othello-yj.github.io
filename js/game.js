// ===== GAME STATE =====
// 定数は constants.js（先に読み込む）で定義する

let showMoveNumbers = localStorage.getItem(STORAGE_KEYS.SHOW_NUMBERS) === 'true';
let moveHistory    = [];   // 着手履歴 [{x, y, player}, …]
let currentMove    = 0;    // 表示中の手数（moveHistory のインデックス境界）
let board          = [];   // 現在の盤面（8×8 の2次元配列）
let currentPlayer  = 1;    // 手番: 1=黒, -1=白
let referenceKifu  = [];   // 最後に「反映」した棋譜（{x,y}[]）
let blackName = "黒";
let whiteName = "白";
let _skipDraw = false;     // withSkipDraw() 中は drawBoard() を抑制する

// ===== OPENING MATCHING =====

// 現在の手順と一致する定石名の配列を返す（外れた定石は除く）
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


// ===== PURE BOARD HELPERS =====
// グローバル board を参照しない純粋関数群。
// 任意の盤面 b を引数として渡せるため、analysis.js・solver.js でも再利用できる。

// 初期盤面の2次元配列を生成して返す
function createInitialBoard() {
  const b = Array(8).fill(null).map(() => Array(8).fill(0));
  b[3][3] = -1; b[4][4] = -1;
  b[3][4] =  1; b[4][3] =  1;
  return b;
}

// 棋譜配列を "a1b2…" 形式の文字列に変換する
function movesToKifuString(moves) {
  return moves.map(m => String.fromCharCode(97 + m.x) + (m.y + 1)).join('');
}

// 盤面を16進32文字にエンコードする（黒ビットボード16文字 + 白ビットボード16文字）
// ビット配置: bit(y*8+x) が座標(x,y) に対応
function encodeBoardPos(b) {
  let bB = 0n, wB = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const bit = BigInt(y * 8 + x);
      if (b[y][x] ===  1) bB |= (1n << bit);
      if (b[y][x] === -1) wB |= (1n << bit);
    }
  return bB.toString(16).padStart(16, '0') + wB.toString(16).padStart(16, '0');
}

// 16進32文字の盤面エンコードを2次元配列に戻す
function decodeBoardPos(s) {
  const bB = BigInt('0x' + s.slice(0, 16));
  const wB = BigInt('0x' + s.slice(16, 32));
  const b = Array.from({ length: 8 }, () => Array(8).fill(0));
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const bit = BigInt(y * 8 + x);
      if (bB & (1n << bit)) b[y][x] =  1;
      if (wB & (1n << bit)) b[y][x] = -1;
    }
  return b;
}

// 盤面 b の黒・白・空マス数を {black, white, empty} で返す
function countStones(b) {
  let black = 0, white = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (b[r][c] ===  1) black++;
      else if (b[r][c] === -1) white++;
    }
  return { black, white, empty: 64 - black - white };
}

// 座標 (x,y) が盤面内かどうかを返す
function inBounds(x, y) {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

// 盤面 b に (x,y) へ player を置いたときにひっくり返る石の座標リストを返す（純粋）
function getFlipsOnBoard(b, x, y, player) {
  if (b[y][x] !== 0) return [];
  let flips = [];
  for (const [dx, dy] of DIRS) {
    let nx = x + dx, ny = y + dy, temp = [];
    while (inBounds(nx, ny) && b[ny][nx] === -player) {
      temp.push([nx, ny]);
      nx += dx; ny += dy;
    }
    if (inBounds(nx, ny) && b[ny][nx] === player && temp.length > 0)
      flips = flips.concat(temp);
  }
  return flips;
}

// 盤面 b で player が打てる合法手リスト [[x,y], …] を返す（純粋）
function getValidMovesOnBoard(b, player) {
  const moves = [];
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      if (getFlipsOnBoard(b, x, y, player).length > 0) moves.push([x, y]);
  return moves;
}

// 盤面 b で player が合法手を少なくとも1手持つかを返す（純粋・早期終了）
function hasAnyMove(b, player) {
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      if (getFlipsOnBoard(b, x, y, player).length > 0) return true;
  return false;
}

// 盤面 b に (x,y) へ player を着手した新しい盤面を返す（純粋・元の配列を破壊しない）
function applyBoardMove(b, x, y, player) {
  const flips = getFlipsOnBoard(b, x, y, player);
  const nb = b.map(r => [...r]);
  nb[y][x] = player;
  flips.forEach(([fx, fy]) => { nb[fy][fx] = player; });
  return nb;
}

// player が (x,y) に置いたとき中割りになるかを返す（純粋）
// 中割り = ひっくり返す全石の周囲8マスにある空きマス数の合計が 1 以下
// 着手位置 (x,y) は着手で埋まるため空きマスとして数えない
function isNakawari(b, x, y, player) {
  const flips = getFlipsOnBoard(b, x, y, player);
  if (flips.length === 0) return false;
  let emptyCount = 0;
  for (const [fx, fy] of flips) {
    for (const [dx, dy] of DIRS) {
      const nx = fx + dx, ny = fy + dy;
      if (!inBounds(nx, ny)) continue;    // 盤外はスキップ
      if (nx === x && ny === y) continue; // 着手位置は埋まっているのでスキップ
      if (b[ny][nx] === 0) emptyCount++;
    }
  }
  return emptyCount === 0;
}

// ===== GLOBAL-BOARD WRAPPERS =====
// グローバル board を使う薄いラッパー。UI 層はこちらを呼ぶ。

// グローバル board での (x,y) 着手時にひっくり返る石リスト
function getFlips(x, y, player) {
  return getFlipsOnBoard(board, x, y, player);
}

// グローバル board での player の合法手リスト
function getValidMoves(player) {
  return getValidMovesOnBoard(board, player);
}

// ===== GAME FLOW =====

// 現在の手番が合法手を持たず相手が持つ場合は手番を逆にする（パス）
function applyPassIfNeeded() {
  if (getValidMoves(currentPlayer).length === 0 && getValidMoves(-currentPlayer).length > 0)
    currentPlayer *= -1;
}

// グローバル board を起点盤面に戻し、手番を設定する
// カスタム盤面が設定されている場合はその盤面・手番を使う
function resetBoardState() {
  if (typeof customBoardStart !== 'undefined' && customBoardStart) {
    board = customBoardStart.board.map(r => [...r]);
    currentPlayer = customBoardStart.turn;
  } else {
    board = createInitialBoard();
    currentPlayer = 1;
  }
}

// ゲーム全体をリセットする（盤面・手順・手番すべて初期化）
function initBoard() {
  resetBoardState();
  moveHistory = [];
  currentMove = 0;
}

// ===== BOARD NAVIGATION =====

// _skipDraw フラグを立てて fn() を実行し、終わったら drawBoard() を1回だけ呼ぶ
// undo10 / goToLast など複数回の状態変更を1回の描画にまとめるために使う
function withSkipDraw(fn) {
  _skipDraw = true;
  fn();
  _skipDraw = false;
  drawBoard();
}

// グローバル board に対して (x,y) に player を着手し、フリップを適用する（破壊的）
function applyMoveToBoard(x, y, player) {
  const flips = getFlips(x, y, player);
  board[y][x] = player;
  flips.forEach(([fx, fy]) => { board[fy][fx] = player; });
  currentPlayer = -player;
}

// currentMove 手目まで手順を再生してグローバル board を再構築し、描画する
function rebuildBoard() {
  resetBoardState();
  for (let i = 0; i < currentMove; i++) {
    const m = moveHistory[i];
    applyMoveToBoard(m.x, m.y, m.player);
  }
  applyPassIfNeeded();
  drawBoard();
}

// (x,y) に現在の手番を着手する。分岐ツリーの自動保存も行う。
function playMove(x, y) {
  const flips = getFlips(x, y, currentPlayer);
  if (flips.length === 0) return;

  // 分岐自動保存: 着手前の局面がツリー内にあれば、着手後も確認する
  const prevPath = savedBranches.length > 0
    ? moveHistory.slice(0, currentMove).map(m => `${m.x},${m.y}`)
    : null;

  moveHistory = moveHistory.slice(0, currentMove);
  moveHistory.push({ x, y, player: currentPlayer });
  currentMove++;

  board[y][x] = currentPlayer;
  flips.forEach(([fx, fy]) => { board[fy][fx] = currentPlayer; });
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
      if (isPathPrefixOfAnyBranch(prevPath) && !isPathPrefixOfAnyBranch(currPath))
        _addBranch(moveHistory.slice(0, currentMove));
    }
  }

  drawBoard();
}

// 1手戻る
function undo() {
  if (currentMove > 0) { currentMove--; rebuildBoard(); }
}

// 10手戻る
function undo10() {
  currentMove = Math.max(0, currentMove - 10);
  rebuildBoard();
}

// 最初まで戻る
function goToFirst() {
  currentMove = 0;
  rebuildBoard();
}

// 10手進む（複数回の描画を1回にまとめる）
function redo10() {
  withSkipDraw(() => { for (let i = 0; i < 10; i++) redo(); });
}

// 最後まで進む（複数回の描画を1回にまとめる）
function goToLast() {
  withSkipDraw(() => {
    let prev;
    do { prev = currentMove; redo(); } while (currentMove !== prev);
  });
}

// 現在の手順が参照棋譜と一致しているかを返す
function currentMatchesReference() {
  if (currentMove > referenceKifu.length) return false;
  for (let i = 0; i < currentMove; i++) {
    if (moveHistory[i].x !== referenceKifu[i].x || moveHistory[i].y !== referenceKifu[i].y) return false;
  }
  return true;
}

// 1手進む。参照棋譜があれば棋譜に沿って進む。
function redo() {
  if (currentMatchesReference() && currentMove < referenceKifu.length) {
    const ref = referenceKifu[currentMove];
    if (currentMove < moveHistory.length &&
        moveHistory[currentMove].x === ref.x && moveHistory[currentMove].y === ref.y) {
      // moveHistory の次の手が棋譜と同じ → 通常の進む
      currentMove++;
      rebuildBoard();
    } else {
      // 棋譜の手を打つ（moveHistory が尽きているか次の手が異なる場合）
      playMove(ref.x, ref.y);
    }
    return;
  }
  if (currentMove < moveHistory.length) { currentMove++; rebuildBoard(); }
}

// ===== KIFU UTILITIES =====

// "a1" 形式の座標文字列を {x, y} に変換する
function coordToXY(coord) {
  return { x: coord.charCodeAt(0) - 97, y: parseInt(coord[1]) - 1 };
}

// 棋譜文字列の妥当性を検証する（副作用なし）
// 問題がなければ null を返す。問題があれば {coord, moveNum, reason} を返す
//   coord   : 問題のある座標文字列（例 "z9"）。文字数エラー時は null
//   moveNum : 問題のある手番（1-based）。文字数エラー時は null
//   reason  : エラーの説明（日本語）
function validateKifu(kifu) {
  // 文字数チェック（2文字ペアが前提）
  if (kifu.length % 2 !== 0) {
    return { coord: null, moveNum: null, reason: '文字数が奇数です' };
  }

  // 純粋な盤面シミュレーションで各手を検証
  let b      = createInitialBoard();
  let player = 1; // 黒から開始

  for (let i = 0; i < kifu.length; i += 2) {
    const coord   = kifu.substring(i, i + 2);
    const moveNum = i / 2 + 1;

    // フォーマットチェック: a〜h の列 + 1〜8 の行
    if (!/^[a-h][1-8]$/.test(coord)) {
      return { coord, moveNum, reason: '形式が不正です' };
    }

    const x     = coord.charCodeAt(0) - 97; // 'a'=0 … 'h'=7
    const y     = parseInt(coord[1]) - 1;   // '1'=0 … '8'=7
    const flips = getFlipsOnBoard(b, x, y, player);

    // 着手可能チェック
    if (flips.length === 0) {
      return { coord, moveNum, reason: '着手不可です' };
    }

    // 盤面を進めてパス処理
    b = applyBoardMove(b, x, y, player);
    const next = -player;
    if (hasAnyMove(b, next))       { player = next; }
    else if (!hasAnyMove(b, player)) { break; } // 終局
    // else: パス（player のまま継続）
  }

  return null; // エラーなし
}

// 棋譜文字列を解析して盤面を構築する（initBoard → 逐次着手）
function kifuToMoves(kifu) {
  initBoard();
  for (let i = 0; i + 1 < kifu.length; i += 2) {
    const { x, y } = coordToXY(kifu.substring(i, i + 2));
    if (getFlips(x, y, currentPlayer).length === 0) break;
    moveHistory.push({ x, y, player: currentPlayer });
    applyMoveToBoard(x, y, currentPlayer);
    applyPassIfNeeded();
    currentMove++;
  }
}

// ===== GAME END CHECK =====

// 両者着手不可なら終局を通知して true を返す
function checkGameEnd() {
  const blackMoves = getValidMoves(1);
  const whiteMoves = getValidMoves(-1);
  if (blackMoves.length === 0 && whiteMoves.length === 0) {
    showGameResult();
    return true;
  }
  return false;
}
