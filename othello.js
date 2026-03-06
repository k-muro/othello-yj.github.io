const boardElement = document.getElementById("board");
const info = document.getElementById("info");
const scBlack    = document.getElementById("sc-black");
const scWhite    = document.getElementById("sc-white");
const scEmpty    = document.getElementById("sc-empty");
const scBlackName = document.getElementById("sc-black-name");
const scWhiteName = document.getElementById("sc-white-name");
const balanceBar = document.getElementById("balance-bar");
const endgameEl = document.getElementById("endgame");

let solverDepth = parseInt(localStorage.getItem('othello-solver-depth') || '20');
let savedBranches = []; // 分岐ツリー（セッション内のみ、最大5手順）
let _branchPaddingCache = new Map(); // bi -> paddingLeft（フリッカー防止用）
let _solverCancelFlag = false; // 全読みキャンセル用フラグ
let _solverResult = ''; // 現局面の全読み結果テキスト
let _solverPending = false; // ソルバーがまだ結果を出していない間 true

function _evalLabel() {
  if (!egaroucidReady || currentMove >= evalCache.length) return '';
  const v = evalCache[currentMove];
  const a = Math.abs(v), s = v >= 0 ? '+' : '';
  if (v === 0) return '互角';
  if (a < 15) return v > 0 ? `黒有利(${s}${v})` : `白有利(${v})`;
  return v > 0 ? `黒勝勢(${s}${v})` : `白勝勢(${v})`;
}

function updateEndgameEl(solverText) {
  if (solverText !== undefined) _solverResult = solverText;
  const label = _solverPending ? '' : _evalLabel();
  const solving = _solverResult === '読み中…';
  if (!solving && label && _solverResult) {
    endgameEl.innerHTML = `${label}<br><span style="font-size:0.82em">${_solverResult}</span>`;
  } else {
    endgameEl.textContent = solving ? _solverResult : (_solverResult || label);
  }
}
let showMoveNumbers = localStorage.getItem('othello-show-numbers') === 'true';
let moveHistory = [];
let currentMove = 0;
let board = [];
let currentPlayer = 1; // 1=黒, -1=白
let referenceKifu = []; // 最後に「反映」した棋譜
let blackName = "黒";
let whiteName = "白";
let _skipDraw = false;
let scoreChart = null;
let egaroucidReady = false;
let graphMode = localStorage.getItem('othello-graph-mode') || 'ai'; // 'ai' | 'stone'
let evalCache = [];
let evalKifu = '';
let evalLevel = parseInt(localStorage.getItem('othello-eval-level') || '8');
let showMoveEvals = localStorage.getItem('othello-show-move-evals') === 'true';
let moveEvalGeneration = 0; // drawBoard のたびに更新し、古い評価タスクを破棄
function showGameResult() {
  let black = 0;
  let white = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (board[r][c] === 1) black++;
      else if (board[r][c] === -1) white++;
    }
  }

  const bName = document.getElementById("sc-black-name").textContent;
  const wName = document.getElementById("sc-white-name").textContent;

  const info = document.getElementById("info");
  const endgame = document.getElementById("endgame");

  if (black > white) {
    info.textContent = `⚫ ${bName} の勝ち！`;
  } else if (white > black) {
    info.textContent = `⚪ ${wName} の勝ち！`;
  } else {
    info.textContent = `⚫⚪ 引き分け！`;
  }

  let stoneResult;
  if (black > white)      stoneResult = `黒の ${black - white} 石勝ち`;
  else if (white > black) stoneResult = `白の ${white - black} 石勝ち`;
  else                    stoneResult = `引き分け`;
  endgame.textContent = `最終結果：⚫ ${black} - ⚪ ${white}（${stoneResult}）`;
}
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
function shortenName(name, maxLength = 10) {
  if (!name) return "";

  // 全角半角をざっくり均等扱いで安全にカット
  const chars = Array.from(name);

  if (chars.length <= maxLength) return name;

  return chars.slice(0, maxLength).join("") + "…";
}
function updateNames() {
  const bInput = document.getElementById("black-name-input");
  const wInput = document.getElementById("white-name-input");

  const bRaw = bInput.value.trim();
  const wRaw = wInput.value.trim();

  const bShort = shortenName(bRaw, 8);  // ←ここで最大文字数調整
  const wShort = shortenName(wRaw, 8);

  document.getElementById("sc-black-name").textContent = bShort || "黒";
  document.getElementById("sc-white-name").textContent = wShort || "白";

  localStorage.setItem("othello-black-name", bRaw);
  localStorage.setItem("othello-white-name", wRaw);
}
function updateStoneCount() {
  // board はあなたの盤面配列（グローバル or state）に合わせて参照してください
  let black = 0, white = 0;

  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      const v = board[r][c];
      if (v === 1) black++;
      else if (v === -1) white++;
    }
  }

  const empty = 64 - black - white;

  const elB = document.getElementById("sc-black");
  const elW = document.getElementById("sc-white");
  const elE = document.getElementById("sc-empty");
  if (elB) elB.textContent = String(black);
  if (elW) elW.textContent = String(white);
  if (elE) elE.textContent = String(empty);

  // バランスバー（黒の比率）
  const bar = document.getElementById("balance-bar");
  if (bar) {
    const total = black + white;
    const pct = total === 0 ? 50 : (black / total) * 100;
    bar.style.width = `${pct}%`;
  }
}
function resetBoardState() {
  board = Array(8).fill().map(() => Array(8).fill(0));
  board[3][3] = -1;
  board[4][4] = -1;
  board[3][4] = 1;
  board[4][3] = 1;
  currentPlayer = 1;
}

function initBoard() {
  resetBoardState();
  moveHistory = [];
  currentMove = 0;
}

function getValidMoves(player) {
  const moves = [];
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if (getFlips(x, y, player).length > 0) moves.push([x, y]);
    }
  }
  return moves;
}

function drawBoard() {
  if (_skipDraw) return;
  _solverCancelFlag = true;  // 実行中の全読みをキャンセル
  boardElement.innerHTML = "";
  const validMoves = getValidMoves(currentPlayer);
  const validSet = new Set(validMoves.map(([x, y]) => `${x},${y}`));
  const lastMove = currentMove > 0 ? moveHistory[currentMove - 1] : null;
  const nextRef = currentMatchesReference() && currentMove < referenceKifu.length
    ? referenceKifu[currentMove] : null;
  const nextRefKey = nextRef ? `${nextRef.x},${nextRef.y}` : null;

  const moveNumMap = new Map();
  if (showMoveNumbers) {
    moveHistory.slice(0, currentMove).forEach((m, i) => {
      moveNumMap.set(`${m.x},${m.y}`, { num: i + 1, player: m.player });
    });
  }

  const currentEvalGen = ++moveEvalGeneration;

  const makeLabel = (text) => {
    const lbl = document.createElement("div");
    lbl.className = "board-label";
    lbl.textContent = text;
    return lbl;
  };

  // 上段: コーナー + a-h + コーナー
  boardElement.appendChild(document.createElement("div"));
  for (let x = 0; x < 8; x++) boardElement.appendChild(makeLabel(String.fromCharCode(97 + x)));
  boardElement.appendChild(document.createElement("div"));

  for (let y = 0; y < 8; y++) {
    boardElement.appendChild(makeLabel(y + 1)); // 左ラベル

    for (let x = 0; x < 8; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.pos = `${x},${y}`;
      cell.onclick = () => playMove(x, y);
      if (lastMove && lastMove.x === x && lastMove.y === y) cell.classList.add("last-move");
      if (board[y][x] !== 0) {
        const stone = document.createElement("div");
        stone.className = "stone " + (board[y][x] === 1 ? "black" : "white");
        cell.appendChild(stone);
        if (showMoveNumbers) {
          const entry = moveNumMap.get(`${x},${y}`);
          if (entry !== undefined) {
            const numEl = document.createElement("span");
            numEl.className = "stone-num " + (entry.player === 1 ? "stone-num-by-black" : "stone-num-by-white");
            numEl.textContent = entry.num;
            cell.appendChild(numEl);
          }
        }
      } else if (validSet.has(`${x},${y}`)) {
        const hint = document.createElement("div");
        const isNextRef = `${x},${y}` === nextRefKey;
        hint.className = "hint " + (isNextRef
          ? (currentPlayer === 1 ? "hint-ref-black" : "hint-ref-white")
          : (currentPlayer === 1 ? "hint-black" : "hint-white"));
        cell.appendChild(hint);
      }
      boardElement.appendChild(cell);
    }
    boardElement.appendChild(makeLabel(y + 1)); // 右ラベル
  }

  // 下段: コーナー + a-h + コーナー
  boardElement.appendChild(document.createElement("div"));
  for (let x = 0; x < 8; x++) boardElement.appendChild(makeLabel(String.fromCharCode(97 + x)));
  boardElement.appendChild(document.createElement("div"));

  let black = 0, white = 0;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      if (board[y][x] === 1) black++;
      else if (board[y][x] === -1) white++;
    }
  const empty = 64 - black - white;
  scBlack.textContent = black;
  scWhite.textContent = white;
  scEmpty.textContent = empty;
  scBlackName.textContent = blackName;
  scWhiteName.textContent = whiteName;
  const total = black + white;
  balanceBar.style.width = (total > 0 ? (black / total * 100) : 50).toFixed(1) + '%';

  _solverResult = '';
  endgameEl.textContent = "";

  const kifu = moveHistory.slice(0, currentMove)
    .map(m => String.fromCharCode(97 + m.x) + (m.y + 1))
    .join("");
  document.getElementById("current-kifu").value = kifu;

  // ===== 終局チェック =====
const blackMoves = getValidMoves(1);
const whiteMoves = getValidMoves(-1);

if (blackMoves.length === 0 && whiteMoves.length === 0) {
  showGameResult();
} else {
  info.textContent = currentPlayer === 1
    ? `${blackName}（⚫）の番`
    : `${whiteName}（⚪）の番`;

  const branchBtn = document.getElementById('branch-btn');
  if (branchBtn) {
    const len = Math.min(currentMove, referenceKifu.length);
    let hasBranch = false;
    for (let i = 0; i < len; i++) {
      if (moveHistory[i].x !== referenceKifu[i].x || moveHistory[i].y !== referenceKifu[i].y) {
        hasBranch = true;
        break;
      }
    }
    branchBtn.disabled = !hasBranch;
  }
}
_solverPending = !(blackMoves.length === 0 && whiteMoves.length === 0) && empty <= solverDepth;
computeAllEvals();
updateScoreGraph();
updateNavButtons();
renderBranchTree();

// 分岐の先端にいる間は悪手解析を自動実行
if (egaroucidReady && currentMove > 0) {
  const _atBranchEnd = savedBranches.some(b =>
    b.moves.length === currentMove &&
    b.moves.every((m, i) => m.x === moveHistory[i].x && m.y === moveHistory[i].y)
  );
  if (_atBranchEnd) computeMistakes();
}

// 評価値表示が終わったら全読みを起動
const solverGen = currentEvalGen;
const snapBoard = board.map(r => [...r]);
const snapPlayer = currentPlayer;
const snapEmpty = empty;
const snapGameOver = blackMoves.length === 0 && whiteMoves.length === 0;
function runSolver() {
  if (solverGen !== moveEvalGeneration) return;
  if (snapGameOver) { _solverPending = false; updateEndgameEl(''); return; }
  if (snapEmpty > solverDepth) { _solverPending = false; updateEndgameEl(); return; }
  updateEndgameEl('読み中…');
  _solverCancelFlag = false;
  try {
    let score, bestPos, line;
    if (egaroucidReady) {
      // egaroucid が使えるなら残り手数に関わらず WASM で解く
      ({ score, bestPos, line } = egaroucidSolveTop(snapBoard, snapPlayer, snapEmpty));
    } else if (snapEmpty <= 10) {
      // egaroucid 未準備のときは JS ソルバー（≤20手のみ）
      let blackBB = 0n, whiteBB = 0n;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          if (snapBoard[y][x] === 1)  blackBB |= 1n << BigInt(y * 8 + x);
          else if (snapBoard[y][x] === -1) whiteBB |= 1n << BigInt(y * 8 + x);
        }
      ({ score, bestPos, line } = bbSolveTop(blackBB, whiteBB, snapPlayer === 1));
    } else {
      _solverPending = false;
      updateEndgameEl('AI読み込み後に全読みできます');
      return;
    }
    if (solverGen !== moveEvalGeneration) return;
    const lineStr = line.map(m => String.fromCharCode(97 + m.x) + (m.y + 1)).join(" ");
    let result;
    if (score > 0)      result = `黒が +${score} で勝ち`;
    else if (score < 0) result = `白が +${Math.abs(score)} で勝ち`;
    else                result = `引き分け`;
    _solverPending = false;
    updateEndgameEl(`最善手を読み切り: ${result}　(${lineStr})`);
    if (bestPos >= 0) {
      const bx = bestPos & 7, by = bestPos >> 3;
      const bestCell = boardElement.querySelector(`[data-pos="${bx},${by}"]`);
      if (bestCell) {
        const dot = document.createElement("div");
        dot.className = "best-move-dot";
        bestCell.appendChild(dot);
      }
    }
  } catch(e) {
    if (e !== 'solver_cancelled') throw e;
  }
}

scheduleMoveEvals(validMoves, currentEvalGen, runSolver);
}

function updateNavButtons() {
  const canBack = currentMove > 0;
  const canForward = currentMove < moveHistory.length ||
    (currentMatchesReference() && currentMove < referenceKifu.length);
  document.getElementById('btn-first').disabled  = !canBack;
  document.getElementById('btn-undo10').disabled  = !canBack;
  document.getElementById('btn-undo').disabled    = !canBack;
  document.getElementById('btn-redo').disabled    = !canForward;
  document.getElementById('btn-redo10').disabled  = !canForward;
  document.getElementById('btn-last').disabled    = !canForward;
}

// ===== 分岐ツリー =====
function _addBranch(moves, atFront = false) {
  if (savedBranches.length >= 5 || moves.length === 0) return false;
  const key = moves.map(m => `${m.x},${m.y}`).join('|');
  if (savedBranches.some(b => b.moves.map(m => `${m.x},${m.y}`).join('|') === key)) return false;
  _branchPaddingCache.clear();
  if (atFront) savedBranches.unshift({ moves });
  else         savedBranches.push({ moves });
  return true;
}

function isPathPrefixOfAnyBranch(path) {
  if (path.length === 0) return true;
  return savedBranches.some(b => {
    if (path.length > b.moves.length) return false;
    return path.every((key, i) => key === `${b.moves[i].x},${b.moves[i].y}`);
  });
}

function saveBranch() {
  if (currentMove === 0) return;
  if (_addBranch(moveHistory.slice(0, currentMove))) renderBranchTree();
}

function saveReferenceKifu() {
  if (currentMove === 0) return;
  const moves = moveHistory.slice(0, currentMove);
  const key = moves.map(m => `${m.x},${m.y}`).join('|');
  // 既存エントリがあれば isRef を確実に付与して先頭へ移動
  const existIdx = savedBranches.findIndex(b => b.moves.map(m => `${m.x},${m.y}`).join('|') === key);
  if (existIdx >= 0) {
    savedBranches[existIdx].isRef = true;
    if (existIdx !== 0) {
      const [entry] = savedBranches.splice(existIdx, 1);
      savedBranches.unshift(entry);
    }
    return;
  }
  if (savedBranches.length >= 5) return;
  savedBranches.unshift({ moves, isRef: true });
}

function deleteBranch(idx) {
  if (savedBranches[idx]?.isRef) return;
  _branchPaddingCache.clear();
  savedBranches.splice(idx, 1);
  renderBranchTree();
}

function loadBranch(idx) {
  const { moves } = savedBranches[idx];
  referenceKifu = moves.map(m => ({ x: m.x, y: m.y }));
  const kifu = moves.map(m => String.fromCharCode(97 + m.x) + (m.y + 1)).join('');
  kifuToMoves(kifu);
  drawBoard();
}

// pairs: [{moves, origIdx}]  origIdx = savedBranches の元インデックス
function buildBranchTrie(pairs) {
  const root = { move: null, moveIdx: -1, children: [], endBranchIdx: -1 };
  for (const { moves, origIdx } of pairs) {
    let node = root;
    for (let mi = 0; mi < moves.length; mi++) {
      const m = moves[mi];
      let child = node.children.find(c => c.move.x === m.x && c.move.y === m.y);
      if (!child) {
        child = { move: m, moveIdx: mi, children: [], endBranchIdx: -1 };
        node.children.push(child);
      }
      node = child;
    }
    node.endBranchIdx = origIdx;
  }
  return root;
}

function renderBranchTree() {
  const container = document.getElementById('branch-tree-container');
  const saveBtn   = document.getElementById('save-branch-btn');
  if (!container) return;

  if (saveBtn) {
    saveBtn.disabled = savedBranches.length >= 5 || currentMove === 0;
    saveBtn.textContent = `この手順を保存 (${savedBranches.length}/5)`;
  }

  // 新コンテンツは staging に構築し、確定後に container へ差し替える
  // （差し替えまで container は古い表示を保持してフリッカーを防ぐ）
  const staging = document.createElement('div');
  staging.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;width:' +
    container.offsetWidth + 'px;';
  container.parentNode.insertBefore(staging, container.nextSibling);

  function commit() {
    container.innerHTML = '';
    while (staging.firstChild) container.appendChild(staging.firstChild);
    staging.remove();
  }

  if (savedBranches.length === 0) {
    const msg = document.createElement('div');
    msg.className = 'text-secondary small text-center py-2';
    msg.textContent = '保存された手順はありません';
    staging.appendChild(msg);
    commit();
    return;
  }

  const curPath = moveHistory.slice(0, currentMove).map(m => `${m.x},${m.y}`);
  function coord(m) { return String.fromCharCode(97 + m.x) + (m.y + 1); }
  function onPath(mi, m) { return mi < curPath.length && curPath[mi] === `${m.x},${m.y}`; }

  function mkSpan(cls, text) {
    const s = document.createElement('span');
    s.className = cls;
    s.textContent = text;
    return s;
  }

  function appendMove(line, move, gameIdx) {
    const mv = mkSpan(
      'tree-move' + (onPath(gameIdx, move) ? ' tree-move-active' : ''),
      coord(move)
    );
    mv.dataset.gameidx = gameIdx;
    line.appendChild(mv);
  }

  // ランドマークに基づいて手順を描画する。
  // pairs: [{move, gameIdx}]
  // pinIdxs: Set<number> — pairs内で必ず表示するインデックス（現在位置・分岐点等）
  // baseHead: 先頭から必ず表示する手数（デフォルト2）
  // baseTail: 末尾から必ず表示する手数（デフォルト1）
  function renderSeq(line, pairs, pinIdxs, baseHead = 2, baseTail = 1) {
    if (pairs.length === 0) return;
    const len = pairs.length;

    const lms = new Set(pinIdxs || []);
    for (let i = 0; i < Math.min(baseHead, len); i++) lms.add(i);
    for (let i = Math.max(0, len - baseTail); i < len; i++) lms.add(i);

    // ギャップが1手だけの場合はその手も追加（…(1手)… を避ける）
    const sorted = [...lms].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length - 1; i++) {
      if (sorted[i + 1] - sorted[i] === 2) lms.add(sorted[i] + 1);
    }

    const landmarks = [...lms].sort((a, b) => a - b);
    let prev = -1;
    landmarks.forEach(lmIdx => {
      if (prev >= 0) {
        const gap = lmIdx - prev - 1;
        if (gap > 0) line.appendChild(mkSpan('tree-arrow', `…(${gap}手)…`));
        line.appendChild(mkSpan('tree-arrow', '→'));
      }
      appendMove(line, pairs[lmIdx].move, pairs[lmIdx].gameIdx);
      prev = lmIdx;
    });
  }

  // branchMoves が refMoves と最初に異なるインデックスを返す
  function findDivIdx(branchMoves, refMoves) {
    const len = Math.min(branchMoves.length, refMoves.length);
    for (let i = 0; i < len; i++) {
      if (branchMoves[i].x !== refMoves[i].x || branchMoves[i].y !== refMoves[i].y) return i;
    }
    return len;
  }

  // 手数ラベル・現在バッジ・削除ボタン
  function appendLeafSuffix(line, bi) {
    const { moves, isRef } = savedBranches[bi];
    line.appendChild(mkSpan('tree-arrow ms-1', `[${moves.length}手]`));
    if (currentMove === moves.length && moves.every((m, i) => curPath[i] === `${m.x},${m.y}`)) {
      line.appendChild(mkSpan('tree-badge-now ms-1', '現在'));
    }
    if (!isRef) {
      const del = document.createElement('button');
      del.className = 'btn btn-outline-danger btn-sm tree-del-btn';
      del.textContent = '×';
      del.title = 'この手順を削除';
      del.onclick = e => { e.stopPropagation(); deleteBranch(bi); };
      line.appendChild(del);
    }
  }

  const refIdx = savedBranches.findIndex(b => b.isRef);
  const refMoves = refIdx >= 0 ? savedBranches[refIdx].moves : null;

  // 各非参照分岐の分岐インデックス（refMovesとの最初の相違点）
  const divIdxMap = new Map();
  savedBranches.forEach((b, i) => {
    if (i !== refIdx && refMoves) divIdxMap.set(i, findDivIdx(b.moves, refMoves));
  });

  // ── 参照棋譜 ──
  if (refIdx >= 0) {
    const refLen = refMoves.length;
    const refPairs = refMoves.map((m, i) => ({ move: m, gameIdx: i }));

    // ピン: 先頭2・末尾2・各分岐点前後・現在位置
    const pinIdxs = new Set();
    if (refLen >= 2) { pinIdxs.add(refLen - 2); pinIdxs.add(refLen - 1); }
    divIdxMap.forEach(d => {
      if (d > 0) pinIdxs.add(d - 1);
      if (d < refLen) pinIdxs.add(d);
    });
    // 現在位置が参照棋譜上にあれば追加
    if (currentMove > 0 && currentMove <= refLen &&
        refMoves.slice(0, currentMove).every((m, i) => curPath[i] === `${m.x},${m.y}`)) {
      pinIdxs.add(currentMove - 1);
    }

    const line = document.createElement('div');
    line.className = 'tree-line ref-line clickable';
    line.title = 'クリックでこの手順を読み込む';
    line.onclick = () => loadBranch(refIdx);
    line.appendChild(mkSpan('tree-ref-label', '参照'));

    renderSeq(line, refPairs, pinIdxs, 2, 2);
    appendLeafSuffix(line, refIdx);
    staging.appendChild(line);
  }

  // ── 分岐ツリー（参照以外） ──
  const nonRefIdxs = savedBranches.map((_, i) => i).filter(i => i !== refIdx);
  if (nonRefIdxs.length === 0) { commit(); return; }

  nonRefIdxs.forEach((bi, listIdx) => {
    const isLast = listIdx === nonRefIdxs.length - 1;
    const { moves } = savedBranches[bi];
    const startIdx = divIdxMap.has(bi) ? divIdxMap.get(bi) : 0;
    const branchPairs = moves.slice(startIdx).map((m, j) => ({ move: m, gameIdx: startIdx + j }));

    const pinIdxs = new Set();
    if (currentMove > startIdx && currentMove <= moves.length &&
        moves.slice(0, currentMove).every((m, i) => curPath[i] === `${m.x},${m.y}`)) {
      pinIdxs.add(currentMove - 1 - startIdx);
    }

    const line = document.createElement('div');
    line.className = 'tree-line clickable';
    line.title = 'クリックでこの手順を読み込む';
    line.dataset.branchidx = bi;
    line.onclick = () => loadBranch(bi);
    if (_branchPaddingCache.has(bi)) {
      line.style.paddingLeft = _branchPaddingCache.get(bi) + 'px';
    }
    line.appendChild(mkSpan('tree-connector', isLast ? '└─' : '├─'));

    renderSeq(line, branchPairs, pinIdxs, 2, 1);
    appendLeafSuffix(line, bi);
    staging.appendChild(line);
  });

  // 参照行の分岐点に揃える
  // staging はすでに DOM に挿入済みなので getBoundingClientRect が使える
  const needsRaf = refIdx >= 0 && nonRefIdxs.some(bi => !_branchPaddingCache.has(bi));
  if (!needsRaf) {
    // 全キャッシュ済み → 即時確定
    commit();
  } else {
    // 未キャッシュあり → 測定後に確定（container は古い表示を保持）
    requestAnimationFrame(() => {
      const refLine = staging.querySelector('.ref-line');
      if (refLine) {
        const baseLeft = refLine.getBoundingClientRect().left;
        nonRefIdxs.forEach(bi => {
          const divIdx = divIdxMap.get(bi);
          if (divIdx === undefined) return;
          const marker = refLine.querySelector(`[data-gameidx="${divIdx}"]`);
          if (!marker) return;
          const indent = Math.max(0, marker.getBoundingClientRect().left - baseLeft);
          const branchLine = staging.querySelector(`[data-branchidx="${bi}"]`);
          if (branchLine) {
            branchLine.style.paddingLeft = indent + 'px';
            _branchPaddingCache.set(bi, indent);
          }
        });
      }
      commit();
    });
  }
}

function inBounds(x, y) {
  return x >= 0 && x < 8 && y >= 0 && y < 8;
}

// ===== ビットボード終盤ソルバー =====
// ビット配置: bit(y*8+x) → 座標(x,y)  a1=bit0, h1=bit7, a8=bit56, h8=bit63
const BB_ALL   = 0xFFFFFFFFFFFFFFFFn;
const BB_NOT_A = 0xFEFEFEFEFEFEFEFEn; // 列aを除く（左シフト後のh→aラップ防止）
const BB_NOT_H = 0x7F7F7F7F7F7F7F7Fn; // 列hを除く（右シフト後のa→hラップ防止）

// player が置ける合法手のビットボードを返す
function bbMoves(player, opponent) {
  const empty = ~(player | opponent) & BB_ALL;
  let moves = 0n;

  // 8方向のシフトとマスク
  const dirs = [
    {shift: 1n,  mask: BB_NOT_A}, // E (<<1)
    {shift:-1n,  mask: BB_NOT_H}, // W (>>1)
    {shift: 8n,  mask: BB_ALL},   // S (<<8)
    {shift:-8n,  mask: BB_ALL},   // N (>>8)
    {shift: 9n,  mask: BB_NOT_A}, // SE (<<9)
    {shift:-9n,  mask: BB_NOT_H}, // NW (>>9)
    {shift: 7n,  mask: BB_NOT_H}, // SW (<<7)
    {shift:-7n,  mask: BB_NOT_A}, // NE (>>7)
  ];

  for (const {shift, mask} of dirs) {
    let t;
    if (shift > 0n) {
      t = ((player << shift) & mask) & opponent;
      // 最大6枚まで挟みうるので6回伸ばす
      t |= ((t << shift) & mask) & opponent;
      t |= ((t << shift) & mask) & opponent;
      t |= ((t << shift) & mask) & opponent;
      t |= ((t << shift) & mask) & opponent;
      t |= ((t << shift) & mask) & opponent;
      moves |= ((t << shift) & mask) & empty;
    } else {
      const r = -shift;
      t = ((player >> r) & mask) & opponent;
      t |= ((t >> r) & mask) & opponent;
      t |= ((t >> r) & mask) & opponent;
      t |= ((t >> r) & mask) & opponent;
      t |= ((t >> r) & mask) & opponent;
      t |= ((t >> r) & mask) & opponent;
      moves |= ((t >> r) & mask) & empty;
    }
  }
  
  return moves;

}
// pos に player が置いたときにひっくり返る相手石のビットボードを返す
function bbFlips(pos, player, opponent) {
  const sq = 1n << BigInt(pos);
  let f = 0n;
  { let g=(sq<<1n)&BB_NOT_A&opponent; g|=(g<<1n)&BB_NOT_A&opponent; g|=(g<<1n)&BB_NOT_A&opponent; g|=(g<<1n)&BB_NOT_A&opponent; g|=(g<<1n)&BB_NOT_A&opponent; g|=(g<<1n)&BB_NOT_A&opponent; if((g<<1n)&BB_NOT_A&player) f|=g; }
  { let g=(sq>>1n)&BB_NOT_H&opponent; g|=(g>>1n)&BB_NOT_H&opponent; g|=(g>>1n)&BB_NOT_H&opponent; g|=(g>>1n)&BB_NOT_H&opponent; g|=(g>>1n)&BB_NOT_H&opponent; g|=(g>>1n)&BB_NOT_H&opponent; if((g>>1n)&BB_NOT_H&player) f|=g; }
  { let g=(sq<<8n)&opponent; g|=(g<<8n)&opponent; g|=(g<<8n)&opponent; g|=(g<<8n)&opponent; g|=(g<<8n)&opponent; g|=(g<<8n)&opponent; if((g<<8n)&player) f|=g; }
  { let g=(sq>>8n)&opponent; g|=(g>>8n)&opponent; g|=(g>>8n)&opponent; g|=(g>>8n)&opponent; g|=(g>>8n)&opponent; g|=(g>>8n)&opponent; if((g>>8n)&player) f|=g; }
  { let g=(sq>>7n)&BB_NOT_A&opponent; g|=(g>>7n)&BB_NOT_A&opponent; g|=(g>>7n)&BB_NOT_A&opponent; g|=(g>>7n)&BB_NOT_A&opponent; g|=(g>>7n)&BB_NOT_A&opponent; g|=(g>>7n)&BB_NOT_A&opponent; if((g>>7n)&BB_NOT_A&player) f|=g; }
  { let g=(sq<<7n)&BB_NOT_H&opponent; g|=(g<<7n)&BB_NOT_H&opponent; g|=(g<<7n)&BB_NOT_H&opponent; g|=(g<<7n)&BB_NOT_H&opponent; g|=(g<<7n)&BB_NOT_H&opponent; g|=(g<<7n)&BB_NOT_H&opponent; if((g<<7n)&BB_NOT_H&player) f|=g; }
  { let g=(sq<<9n)&BB_NOT_A&opponent; g|=(g<<9n)&BB_NOT_A&opponent; g|=(g<<9n)&BB_NOT_A&opponent; g|=(g<<9n)&BB_NOT_A&opponent; g|=(g<<9n)&BB_NOT_A&opponent; g|=(g<<9n)&BB_NOT_A&opponent; if((g<<9n)&BB_NOT_A&player) f|=g; }
  { let g=(sq>>9n)&BB_NOT_H&opponent; g|=(g>>9n)&BB_NOT_H&opponent; g|=(g>>9n)&BB_NOT_H&opponent; g|=(g>>9n)&BB_NOT_H&opponent; g|=(g>>9n)&BB_NOT_H&opponent; g|=(g>>9n)&BB_NOT_H&opponent; if((g>>9n)&BB_NOT_H&player) f|=g; }
  return f;
}

function bbPopcount(b) { let n=0; while(b){b&=b-1n;n++;} return n; }
// 1bit(1n<<i) -> i の逆引きテーブル
const BB_POS = new Map();
for (let i = 0; i < 64; i++) BB_POS.set(1n << BigInt(i), i);

// 着手順の重みテーブル: コーナー優先、X/Cマス後回し
const BB_MOVE_WEIGHT = (() => {
  const w = new Array(64).fill(2);
  [0, 7, 56, 63].forEach(i => w[i] = 10);          // コーナー
  [9, 14, 49, 54].forEach(i => w[i] = -2);          // Xマス
  [1,6,8,15,48,55,57,62].forEach(i => w[i] = -1);   // Cマス
  return w;
})();

// アルファベータ探索（内部再帰用・score のみ返す）
function bbSolve(blackBB, whiteBB, blackToMove, alpha, beta) {
  if (_solverCancelFlag) throw 'solver_cancelled';
  const player   = blackToMove ? blackBB : whiteBB;
  const opponent = blackToMove ? whiteBB : blackBB;
  let moves = bbMoves(player, opponent);
  if (!moves) {
    if (!bbMoves(opponent, player))
      return bbPopcount(blackBB) - bbPopcount(whiteBB);
    return bbSolve(blackBB, whiteBB, !blackToMove, alpha, beta); // パス
  }

  // 合法手を重みでソート（降順）
  const moveList = [];
  let m = moves;
  while (m) {
    const lsb = m & -m;
    m ^= lsb;
    const pos = BB_POS.get(lsb);
    moveList.push({ pos, lsb, w: BB_MOVE_WEIGHT[pos] });
  }
  moveList.sort((a, b) => b.w - a.w);

  let best = blackToMove ? -65 : 65;
  for (const { pos, lsb } of moveList) {
    const flips = bbFlips(pos, player, opponent);
    const np = player | lsb | flips;
    const no = opponent ^ flips;
    const score = bbSolve(
      blackToMove ? np : no,
      blackToMove ? no : np,
      !blackToMove, alpha, beta
    );
    if (blackToMove) {
      if (score > best) best = score;
      if (best > alpha) alpha = best;
    } else {
      if (score < best) best = score;
      if (best < beta)  beta  = best;
    }
    if (alpha >= beta) break;
  }
  return best;
}

// トップレベルラッパー: 最善手の位置も返す
function bbSolveTop(blackBB, whiteBB, blackToMove) {
  const player   = blackToMove ? blackBB : whiteBB;
  const opponent = blackToMove ? whiteBB : blackBB;
  const moves = bbMoves(player, opponent);
  if (!moves) {
    return { score: bbPopcount(blackBB) - bbPopcount(whiteBB), bestPos: -1, line: [] };
  }

  const moveList = [];
  let m = moves;
  while (m) {
    const lsb = m & -m;
    m ^= lsb;
    const pos = BB_POS.get(lsb);
    moveList.push({ pos, lsb, w: BB_MOVE_WEIGHT[pos] });
  }
  moveList.sort((a, b) => b.w - a.w);

  let best = blackToMove ? -65 : 65, bestPos = moveList[0].pos;
  let alpha = -65, beta = 65;
  for (const { pos, lsb } of moveList) {
    const flips = bbFlips(pos, player, opponent);
    const np = player | lsb | flips;
    const no = opponent ^ flips;
    const score = bbSolve(
      blackToMove ? np : no,
      blackToMove ? no : np,
      !blackToMove, alpha, beta
    );
    if (blackToMove) {
      if (score > best) { best = score; bestPos = pos; }
      if (best > alpha) alpha = best;
    } else {
      if (score < best) { best = score; bestPos = pos; }
      if (best < beta)  beta  = best;
    }
    if (alpha >= beta) break;
  }

  // 最善スコアを辿って手順列を再構成（狭いウィンドウで軽量）
  const line = bbExtractLine(blackBB, whiteBB, blackToMove, best);
  return { score: best, bestPos, line };
}

// 最善スコアを維持する手を辿り手順列を返す
function bbExtractLine(blackBB, whiteBB, blackToMove, targetScore) {
  const line = [];
  let bBB = blackBB, wBB = whiteBB, btm = blackToMove;
  for (;;) {
    const pl = btm ? bBB : wBB;
    const op = btm ? wBB : bBB;
    const mvs = bbMoves(pl, op);
    if (!mvs) {
      if (!bbMoves(op, pl)) break; // 終局
      btm = !btm; // パス
      continue;
    }
    let found = false;
    let mm = mvs;
    while (mm) {
      const lsb = mm & -mm;
      mm ^= lsb;
      const pos = BB_POS.get(lsb);
      const flips = bbFlips(pos, pl, op);
      const np = pl | lsb | flips;
      const no = op ^ flips;
      const nbBB = btm ? np : no, nwBB = btm ? no : np;
      // 狭いウィンドウで確認（高速）
      const s = bbSolve(nbBB, nwBB, !btm, targetScore - 1, targetScore + 1);
      if (s === targetScore) {
        line.push({ x: pos & 7, y: pos >> 3 });
        bBB = nbBB; wBB = nwBB; btm = !btm;
        found = true;
        break;
      }
    }
    if (!found) break;
  }
  return line;
}

function getFlips(x, y, player) {
  if (board[y][x] !== 0) return [];
  const dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  let flips = [];
  for (let [dx, dy] of dirs) {
    let nx = x + dx;
    let ny = y + dy;
    let temp = [];
    while (inBounds(nx, ny) && board[ny][nx] === -player) {
      temp.push([nx, ny]);
      nx += dx;
      ny += dy;
    }
    if (inBounds(nx, ny) && board[ny][nx] === player && temp.length > 0) {
      flips = flips.concat(temp);
    }
  }
  return flips;
}

// 相手が置けない場合は手番をそのままにする（パス）
function applyPassIfNeeded() {
  if (getValidMoves(currentPlayer).length === 0 && getValidMoves(-currentPlayer).length > 0)
    currentPlayer *= -1;
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
    } else if (savedBranches.length < 5) {
      // prevPath がどこかの枝のプレフィックス → 初めて外れた瞬間だけ新規保存
      const currPath = moveHistory.slice(0, currentMove).map(m => `${m.x},${m.y}`);
      if (isPathPrefixOfAnyBranch(prevPath) && !isPathPrefixOfAnyBranch(currPath)) {
        _addBranch(moveHistory.slice(0, currentMove));
      }
    }
  }

  drawBoard();
}

function rebuildBoard() {
  resetBoardState();
  for (let i = 0; i < currentMove; i++) {
    const m = moveHistory[i];
    const flips = getFlips(m.x, m.y, m.player);
    board[m.y][m.x] = m.player;
    flips.forEach(([fx, fy]) => board[fy][fx] = m.player);
    currentPlayer = -m.player;
  }
  applyPassIfNeeded();
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
  _skipDraw = true;
  for (let i = 0; i < 10; i++) redo();
  _skipDraw = false;
  drawBoard();
}

function goToLast() {
  _skipDraw = true;
  let prev;
  do {
    prev = currentMove;
    redo();
  } while (currentMove !== prev);
  _skipDraw = false;
  drawBoard();
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

function coordToXY(coord) {
  const x = coord.charCodeAt(0) - 97;
  const y = parseInt(coord[1]) - 1;
  return {x, y};
}

function kifuToMoves(kifu) {
  initBoard();
  for (let i = 0; i + 1 < kifu.length; i += 2) {
    const {x, y} = coordToXY(kifu.substring(i, i + 2));
    const flips = getFlips(x, y, currentPlayer);
    if (flips.length === 0) break;
    moveHistory.push({x, y, player: currentPlayer});
    board[y][x] = currentPlayer;
    flips.forEach(([fx, fy]) => board[fy][fx] = currentPlayer);
    currentPlayer *= -1;
    applyPassIfNeeded();
    currentMove++;
  }
}

function applyKifu() {
  const kifu = document.getElementById("kifu-input").value.trim().toLowerCase();
  referenceKifu = [];
  for (let i = 0; i + 1 < kifu.length; i += 2)
    referenceKifu.push(coordToXY(kifu.substring(i, i + 2)));
  kifuToMoves(kifu);
  saveReferenceKifu();
  drawBoard();
}

function goToBranchPoint() {
  const len = Math.min(currentMove, referenceKifu.length);
  let i = 0;
  while (i < len && moveHistory[i].x === referenceKifu[i].x && moveHistory[i].y === referenceKifu[i].y) i++;
  currentMove = i;
  rebuildBoard();
}

function copyCurrentKifu() {
  const val = document.getElementById("current-kifu").value;
  navigator.clipboard.writeText(val);
}

function updateNames() {
  blackName = document.getElementById("black-name-input").value || "黒";
  whiteName = document.getElementById("white-name-input").value || "白";
  drawBoard();
}

function swapNames() {
  const bInput = document.getElementById("black-name-input");
  const wInput = document.getElementById("white-name-input");
  const tmp = bInput.value;
  bInput.value = wInput.value;
  wInput.value = tmp;
  updateNames();
}

function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  blackName = params.get("black") || "黒";
  whiteName = params.get("white") || "白";
  if (params.get("black")) document.getElementById("black-name-input").value = params.get("black");
  if (params.get("white")) document.getElementById("white-name-input").value = params.get("white");
  const kifu = params.get("kifu");
  if (!kifu) return;
  document.getElementById("kifu-input").value = kifu;
  referenceKifu = [];
  for (let i = 0; i + 1 < kifu.length; i += 2)
    referenceKifu.push(coordToXY(kifu.substring(i, i + 2)));
  kifuToMoves(kifu);
  saveReferenceKifu();
}

function copyShareURL() {
  const kifu = moveHistory.slice(0, currentMove)
    .map(m => String.fromCharCode(97 + m.x) + (m.y + 1))
    .join("");
  const black = document.getElementById("black-name-input").value.trim();
  const white = document.getElementById("white-name-input").value.trim();
  const params = new URLSearchParams();
  if (kifu) params.set("kifu", kifu);
  if (black) params.set("black", black);
  if (white) params.set("white", white);
  const url = window.location.origin + window.location.pathname +
    (params.toString() ? "?" + params.toString() : "");
  navigator.clipboard.writeText(url).then(() => {
    const msg = document.getElementById("url-copy-msg");
    msg.style.display = "";
    clearTimeout(msg._hideTimer);
    msg._hideTimer = setTimeout(() => { msg.style.display = "none"; }, 2000);
  });
}

function setSolverDepth(val) {
  const n = Math.min(24, Math.max(6, parseInt(val) || 20));
  document.getElementById('solver-depth').value = n;
  const warningEl = document.getElementById('depth-warning');
  if (n !== solverDepth) {
    if (n > 20) {
      warningEl.textContent = `残り ${n} 手からの全読みは計算に時間がかかる場合があります。`;
      warningEl.className = 'text-center small mt-1 text-warning';
      warningEl.style.display = '';
    } else {
      warningEl.style.display = 'none';
    }
  } else {
    warningEl.style.display = 'none';
  }
  solverDepth = n;
  localStorage.setItem('othello-solver-depth', n);
  drawBoard();
}

function toggleMoveNumbers() {
  showMoveNumbers = !showMoveNumbers;
  localStorage.setItem('othello-show-numbers', showMoveNumbers);
  document.getElementById('num-toggle').textContent = showMoveNumbers ? '着手順を隠す' : '着手順を表示';
  drawBoard();
}

// スコアを7段階の色に変換（黒視点: +で黒寄り / −で白寄り）
// 0 / ±1~5 / ±6~10 / ±11~
function evalScoreColor(score) {
  const a = Math.abs(score);
  const tier = a === 0 ? 0 : a <= 5 ? 1 : a <= 10 ? 2 : 3;
  const blackPalette = ['#c0c0c0', '#909090', '#505050', '#101010'];
  const whitePalette = ['#c0c0c0', '#dedede', '#f0f0f0', '#ffffff'];
  return score >= 0 ? blackPalette[tier] : whitePalette[tier];
}

// ===== 悪手検出 =====
// 各局面で全合法手を評価し、実際に打たれた手が平均より何石分悪かったかを計算
let mistakeCache = []; // [{moveIdx, dev}]  dev < 0 = 平均より悪い手
let mistakeCacheKifu = '';
let mistakeCacheMap = new Map(); // kifuKey -> mistakeCache（分岐ごとに保存）
let mistakeGeneration = 0;
let showMistakeList = false;

function toggleMistakeList() {
  showMistakeList = !showMistakeList;
  const btn = document.getElementById('mistake-analyze-btn');
  if (btn) btn.textContent = showMistakeList ? '悪手を隠す' : '悪手を表示';
  renderMistakeList();
  updateScoreGraph();
}

function computeMistakes() {
  if (!egaroucidReady) return;
  const kifuKey = moveHistory.map(m => `${m.x},${m.y}`).join('|');
  if (kifuKey === mistakeCacheKifu && mistakeCache.length > 0) return;
  // 別の分岐で計算済みなら即座に適用
  if (mistakeCacheMap.has(kifuKey)) {
    mistakeCache = mistakeCacheMap.get(kifuKey);
    mistakeCacheKifu = kifuKey;
    renderMistakeList();
    updateScoreGraph();
    return;
  }
  mistakeCacheKifu = kifuKey;
  mistakeCache = [];
  const gen = ++mistakeGeneration;

  const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];

  function movesOn(b, player) {
    const res = [];
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        if (b[y][x] !== 0) continue;
        for (const [dx, dy] of DIRS) {
          let nx = x+dx, ny = y+dy;
          if (nx<0||nx>=8||ny<0||ny>=8||b[ny][nx]!==-player) continue;
          nx+=dx; ny+=dy;
          while (nx>=0&&nx<8&&ny>=0&&ny<8&&b[ny][nx]===-player){nx+=dx;ny+=dy;}
          if (nx>=0&&nx<8&&ny>=0&&ny<8&&b[ny][nx]===player){res.push([x,y]);break;}
        }
      }
    return res;
  }

  function applyOn(b, x, y, player) {
    const nb = b.map(r => [...r]);
    nb[y][x] = player;
    for (const [dx, dy] of DIRS) {
      let nx=x+dx, ny=y+dy, tmp=[];
      while (nx>=0&&nx<8&&ny>=0&&ny<8&&nb[ny][nx]===-player){tmp.push([nx,ny]);nx+=dx;ny+=dy;}
      if (nx>=0&&nx<8&&ny>=0&&ny<8&&nb[ny][nx]===player) tmp.forEach(([fx,fy])=>{nb[fy][fx]=player;});
    }
    return nb;
  }

  let boardState = Array(8).fill().map(() => Array(8).fill(0));
  boardState[3][3] = -1; boardState[4][4] = -1; boardState[3][4] = 1; boardState[4][3] = 1;
  let cp = 1;
  let idx = 0;
  let validMoves = null; // 現在局面の合法手リスト
  let scores = [];       // 現在局面の評価値リスト
  let evalIdx = 0;       // 現在局面で何手目まで評価したか

  // 1回の setTimeout で 1手分の評価だけ行い UI をブロックしない
  function processNext() {
    if (gen !== mistakeGeneration) return; // キャンセル

    // 新しい局面の初期化
    if (validMoves === null) {
      if (idx >= moveHistory.length) {
        mistakeCacheMap.set(kifuKey, [...mistakeCache]);
        renderMistakeList();
        updateScoreGraph();
        return;
      }
      validMoves = movesOn(boardState, cp);
      scores = [];
      evalIdx = 0;
      // 合法手が1手以下なら評価不要：着手して次へ
      if (validMoves.length <= 1) {
        boardState = applyOn(boardState, moveHistory[idx].x, moveHistory[idx].y, cp);
        cp = -cp;
        if (movesOn(boardState, cp).length === 0 && movesOn(boardState, -cp).length > 0) cp = -cp;
        idx++;
        validMoves = null;
        setTimeout(processNext, 0);
        return;
      }
    }

    // 現局面の合法手を 1手ずつ評価
    if (evalIdx < validMoves.length) {
      const [x, y] = validMoves[evalIdx++];
      const nb = applyOn(boardState, x, y, cp);
      let empty = 0;
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (nb[r][c] === 0) empty++;
      const level = empty < 12 ? empty : evalLevel;
      const blackScore = evaluatePosition(nb, -cp, level);
      scores.push(cp === 1 ? blackScore : -blackScore);
      setTimeout(processNext, 0);
      return;
    }

    // 全合法手の評価が終わったら偏差を計算して次の局面へ
    const m = moveHistory[idx];
    const playedIdx = validMoves.findIndex(([x, y]) => x === m.x && y === m.y);
    if (playedIdx >= 0) {
      const mean = scores.reduce((a, v) => a + v, 0) / scores.length;
      const dev  = scores[playedIdx] - mean;
      const best = Math.max(...scores);
      const loss = best - scores[playedIdx]; // 最善手との差（0=最善、正=悪い）
      mistakeCache.push({ moveIdx: idx, dev, loss });
    }
    boardState = applyOn(boardState, m.x, m.y, cp);
    cp = -cp;
    if (movesOn(boardState, cp).length === 0 && movesOn(boardState, -cp).length > 0) cp = -cp;
    idx++;
    validMoves = null;
    setTimeout(processNext, 0);
  }

  requestAnimationFrame(processNext);
}

// リストとグラフで共通して使う「表示対象の悪手セット」を返す
function getShownMistakeSet() {
  const toShow = [...mistakeCache]
    .sort((a, b) => a.dev - b.dev)
    .slice(0, 7)
    .filter(e => e.loss >= 6);
  return new Map(toShow.map(e => [e.moveIdx, e]));
}

function getMistakeInfo(moveIdx) {
  const map = getShownMistakeSet();
  const entry = map.get(moveIdx);
  if (!entry) return null;
  if (entry.loss >= 12) return { loss: entry.loss, label: '×', cls: 'mistake-blunder', graphRadius: 5 };
  return { loss: entry.loss, label: '△', cls: 'mistake-mistake', graphRadius: 4 };
}

function renderMistakeList() {
  const el = document.getElementById('mistake-list');
  if (!el) return;
  if (!showMistakeList || !egaroucidReady || mistakeCache.length === 0) { el.innerHTML = ''; return; }

  const toShow = [...getShownMistakeSet().values()]
    .sort((a, b) => a.moveIdx - b.moveIdx); // 手番順
  function makeBadge({ moveIdx, loss }) {
    const m = moveHistory[moveIdx];
    if (!m) return null;
    const coord = String.fromCharCode(97 + m.x) + (m.y + 1);
    const cls   = loss >= 12 ? 'mistake-blunder' : 'mistake-mistake';
    const label = loss >= 12 ? ' ×' : ' △';
    const badge = document.createElement('span');
    badge.className = `mistake-badge ${cls}`;
    badge.textContent = `${moveIdx + 1}手 ${coord}${label}`;
    badge.title = `最善手との差: ${loss.toFixed(1)}`;
    badge.onclick = () => { currentMove = moveIdx; rebuildBoard(); };
    return badge;
  }

  function makeLine(icon, entries) {
    const row = document.createElement('div');
    row.className = 'd-flex flex-wrap align-items-center gap-1';
    const lbl = document.createElement('span');
    lbl.className = 'text-secondary graph-caption';
    lbl.textContent = `${icon}悪手:`;
    row.appendChild(lbl);
    entries.forEach(e => { const b = makeBadge(e); if (b) row.appendChild(b); });
    return row;
  }

  const blackMistakes = toShow.filter(e => moveHistory[e.moveIdx]?.player === 1);
  const whiteMistakes = toShow.filter(e => moveHistory[e.moveIdx]?.player === -1);

  el.innerHTML = '';
  el.appendChild(makeLine('⚫', blackMistakes));
  el.appendChild(makeLine('⚪', whiteMistakes));
}

// 候補手の評価値を1手ずつ非同期で計算してDOMに書き込む
// rAF で1フレーム描画を確実に挟んでから計算開始（iOS対応）
function scheduleMoveEvals(validMoves, gen, onComplete) {
  if (!showMoveEvals || !egaroucidReady || validMoves.length === 0) {
    if (onComplete) setTimeout(onComplete, 0);
    return;
  }
  let idx = 0;
  function next() {
    if (gen !== moveEvalGeneration) return; // キャンセル（onCompleteも呼ばない）
    if (idx >= validMoves.length) {
      if (onComplete) onComplete();
      return;
    }
    const [mx, my] = validMoves[idx++];
    const score = evaluateMove(mx, my);
    if (gen !== moveEvalGeneration) return;
    const cell = boardElement.querySelector(`.cell[data-pos="${mx},${my}"]`);
    if (cell) {
      const evalEl = document.createElement('div');
      evalEl.className = 'move-eval';
      evalEl.textContent = (score > 0 ? '+' : '') + score;
      evalEl.style.color = evalScoreColor(score);
      cell.appendChild(evalEl);
    }
    setTimeout(next, 0);
  }
  requestAnimationFrame(next);
}

function toggleMoveEvals() {
  showMoveEvals = !showMoveEvals;
  localStorage.setItem('othello-show-move-evals', showMoveEvals);
  const btn = document.getElementById('move-eval-toggle');
  if (btn) btn.textContent = showMoveEvals ? '評価値を隠す' : '候補手の評価値';
  drawBoard();
}

// 指定マスに打った後の局面をEgaroucidで評価（黒視点の予測石差: +で黒有利 / −で白有利）
function evaluateMove(x, y) {
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
  const b = board.map(row => [...row]);
  b[y][x] = currentPlayer;
  for (const [dx, dy] of DIRS) {
    let nx = x + dx, ny = y + dy, tmp = [];
    while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny][nx] === -currentPlayer) {
      tmp.push([nx, ny]); nx += dx; ny += dy;
    }
    if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny][nx] === currentPlayer)
      tmp.forEach(([fx, fy]) => { b[fy][fx] = currentPlayer; });
  }
  // 着手後の残り手数を数え、12未満ならその値をレベルに使う
  let empty = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++)
      if (b[r][c] === 0) empty++;
  const level = empty < 12 ? empty : evalLevel;
  return evaluatePosition(b, -currentPlayer, level); // 黒視点スコア
}

// ===== Egaroucid AI 評価 =====
function setEvalLevel(val) {
  const n = Math.min(15, Math.max(1, parseInt(val) || 5));
  evalLevel = n;
  localStorage.setItem('othello-eval-level', n);
  if (egaroucidReady) {
    evalKifu = ''; // キャッシュ無効化して再計算
    setAiStatus('計算中…', '#f97316');
    computeAllEvals();
  }
}

function toggleGraphMode() {
  graphMode = graphMode === 'ai' ? 'stone' : 'ai';
  localStorage.setItem('othello-graph-mode', graphMode);
  updateScoreGraph();
}


function setAiStatus(text, color) {
  const el = document.getElementById('ai-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '';
}

function onEgaroucidReady() {
  try {
    setAiStatus('AI初期化中…', '#f97316');
    const ptr = _malloc(4);
    const result = _init_ai(ptr);
    _free(ptr);
    if (result !== 0) {
      setAiStatus('AI初期化失敗', '#dc3545');
      console.warn('Egaroucid _init_ai returned', result);
      return;
    }
    egaroucidReady = true;
    clearTimeout(window._aiLoadTimer);
    setAiStatus('AI準備完了', '#1a7f37');
    computeAllEvals();
    // 初期化完了時点で分岐先端にいれば悪手解析を起動
    if (currentMove > 0) {
      const _atEnd = savedBranches.some(b =>
        b.moves.length === currentMove &&
        b.moves.every((m, i) => m.x === moveHistory[i].x && m.y === moveHistory[i].y)
      );
      if (_atEnd) computeMistakes();
    }
  } catch(e) {
    setAiStatus('AI読み込み失敗', '#dc3545');
    console.error('Egaroucid init failed:', e);
  }
}

// 盤面を WASM に渡して評価値（黒視点の予測石差）を返す
function evaluatePosition(b, player, level = evalLevel) {
  // player: 1=黒, -1=白
  // ゲーム終了（空マスなし）はそのまま石差を返す
  let black = 0, white = 0, empty = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (b[r][c] === 1) black++;
      else if (b[r][c] === -1) white++;
      else empty++;
    }
  if (empty === 0) return black - white;

  // WASM 形式に変換: 0=黒, 1=白, -1=空
  const res = new Int32Array(64);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const v = b[y][x];
      res[y * 8 + x] = v === 1 ? 0 : v === -1 ? 1 : -1;
    }
  const wasmPlayer = player === 1 ? 0 : 1;
  const ptr = _malloc(64 * 4);
  HEAP32.set(res, ptr >> 2);
  const val = _ai_js(ptr, level, wasmPlayer);
  _free(ptr);

  // 戻り値デコード: y*8000 + x*1000 + (dif_stones+100)
  const vy = Math.floor(val / 8000);
  const vx = Math.floor((val - vy * 8000) / 1000);
  const dif = val - vy * 8000 - vx * 1000 - 100;

  // 黒視点に正規化（白番なら符号反転）
  return wasmPlayer === 0 ? dif : -dif;
}

// moveHistory を先頭から再生しながら各局面を評価
function computeAllEvals() {
  if (!egaroucidReady) return;
  const kifuKey = moveHistory.map(m => `${m.x},${m.y}`).join('|');
  if (kifuKey === evalKifu && evalCache.length > 0) return;
  evalKifu = kifuKey;
  evalCache = [];

  const b = Array(8).fill().map(() => Array(8).fill(0));
  b[3][3] = -1; b[4][4] = -1; b[3][4] = 1; b[4][3] = 1;
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];

  let cp = 1; // 手番 (1=黒, -1=白)
  evalCache.push(evaluatePosition(b, cp));

  for (const m of moveHistory) {
    b[m.y][m.x] = m.player;
    for (const [dx, dy] of DIRS) {
      let nx = m.x + dx, ny = m.y + dy, tmp = [];
      while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny][nx] === -m.player) {
        tmp.push([nx, ny]); nx += dx; ny += dy;
      }
      if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny][nx] === m.player)
        tmp.forEach(([fx, fy]) => { b[fy][fx] = m.player; });
    }
    cp = -m.player;
    evalCache.push(evaluatePosition(b, cp));
  }

  updateScoreGraph();
}

// WASM に盤面を渡して最善手と評価値を取得（黒視点スコア）
// level は残り手数に合わせて呼び出し側でスケール（20手=10, 24手=21）
function wasmBestMove(b, pl, level) {
  const res = new Int32Array(64);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const v = b[y][x];
      res[y*8+x] = v === 1 ? 0 : v === -1 ? 1 : -1;
    }
  const wp = pl === 1 ? 0 : 1;
  const ptr = _malloc(64 * 4);
  HEAP32.set(res, ptr >> 2);
  const val = _ai_js(ptr, level ?? 10, wp);
  _free(ptr);
  const vy = Math.floor(val / 8000);
  const vx = Math.floor((val - vy * 8000) / 1000);
  const dif = val - vy * 8000 - vx * 1000 - 100;
  return { mx: vx, my: vy, score: wp === 0 ? dif : -dif };
}

// 残り手数からsolveレベルを決める（10=20手, 21=22手相当 で線形に補間）
function solveLevel(empty) {
  return empty <= 20 ? 10 : Math.min(21, 10 + Math.ceil((empty - 20) / 2));
}

// WASM で終盤全読みし { score, bestPos, line } を返す
function egaroucidSolveTop(boardIn, player, empty) {
  const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];

  function hasMove(b, pl) {
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++) {
        if (b[y][x] !== 0) continue;
        for (const [dx, dy] of DIRS) {
          let nx = x+dx, ny = y+dy;
          if (nx < 0||nx >= 8||ny < 0||ny >= 8||b[ny][nx] !== -pl) continue;
          nx += dx; ny += dy;
          while (nx >= 0&&nx < 8&&ny >= 0&&ny < 8&&b[ny][nx] === -pl) { nx += dx; ny += dy; }
          if (nx >= 0&&nx < 8&&ny >= 0&&ny < 8&&b[ny][nx] === pl) return true;
        }
      }
    return false;
  }

  function applyMove(b, x, y, pl) {
    const nb = b.map(r => [...r]);
    nb[y][x] = pl;
    for (const [dx, dy] of DIRS) {
      let nx = x+dx, ny = y+dy, tmp = [];
      while (nx >= 0&&nx < 8&&ny >= 0&&ny < 8&&nb[ny][nx] === -pl) {
        tmp.push([nx, ny]); nx += dx; ny += dy;
      }
      if (nx >= 0&&nx < 8&&ny >= 0&&ny < 8&&nb[ny][nx] === pl)
        tmp.forEach(([fx, fy]) => { nb[fy][fx] = pl; });
    }
    return nb;
  }

  // 最善手とスコアを取得
  const lv = solveLevel(empty ?? 20);
  const { mx, my, score } = wasmBestMove(boardIn, player, lv);
  const bestPos = my * 8 + mx;

  // 両者最善手を辿って手順列を構築
  const line = [];
  let b = boardIn.map(r => [...r]);
  let cp = player, passes = 0;
  for (;;) {
    if (!hasMove(b, cp)) {
      if (!hasMove(b, -cp)) break;
      cp = -cp;
      if (++passes > 1) break;
      continue;
    }
    passes = 0;
    const { mx: lx, my: ly } = wasmBestMove(b, cp, lv);
    line.push({ x: lx, y: ly });
    b = applyMove(b, lx, ly, cp);
    cp = -cp;
  }

  return { score, bestPos, line };
}

// ===== 石差グラフ =====
const yAxisMarkerPlugin = {
  id: 'yAxisMarker',
  afterDraw(chart) {
    const { ctx, chartArea: { top, bottom, left } } = chart;
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText('⚫', left + 3, top + 1);
    ctx.textBaseline = 'bottom';
    ctx.fillText('⚪', left + 3, bottom - 1);
    ctx.restore();
  }
};

function initScoreGraph() {
  const canvas = document.getElementById('score-graph');
  if (!canvas || typeof Chart === 'undefined') return;
  const isDark = () => document.documentElement.getAttribute('data-bs-theme') === 'dark';
  scoreChart = new Chart(canvas, {
    type: 'line',
    data: {
      labels: [],
      datasets: [
        {
          // メインデータ (index 0)
          data: [],
          borderWidth: 1.5,
          fill: false,
          tension: 0.15,
          pointRadius: [],
          pointBackgroundColor: [],
          pointHoverRadius: 5,
          pointHitRadius: 10,
        },
        {
          // ±0 参照線 (index 1)
          data: [],
          borderColor: 'rgba(128,128,128,0.45)',
          borderWidth: 1,
          borderDash: [5, 3],
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          tension: 0,
          tooltip: { enabled: false },
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      onClick: (event, elements) => {
        const el = elements.find(e => e.datasetIndex === 0);
        if (el === undefined) return;
        currentMove = el.index;
        rebuildBoard();
      },
      onHover: (event, elements) => {
        const el = elements.find(e => e.datasetIndex === 0);
        event.native.target.style.cursor = el !== undefined ? 'pointer' : 'default';
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          filter: (item) => item.datasetIndex === 0, // ゼロ線は除外
          callbacks: {
            title: (items) => items[0].label === '開始' ? '開始' : `${items[0].label}手目`,
            label: (item) => {
              const v = item.raw;
              return v > 0 ? `⚫ +${v}` : v < 0 ? `⚪ +${-v}` : '同数';
            }
          }
        }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 10, font: { size: 9 }, color: () => isDark() ? '#8b949e' : '#888' },
          grid: { display: false }
        },
        y: {
          suggestedMin: -10,
          suggestedMax: 10,
          ticks: { stepSize: 10, font: { size: 9 }, color: () => isDark() ? '#8b949e' : '#888' },
          grid: {
            color: (ctx) => ctx.tick.value === 0
              ? (isDark() ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)')
              : (isDark() ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.07)')
          }
        }
      }
    },
    plugins: [yAxisMarkerPlugin]
  });
}

function updateScoreGraph() {
  if (!scoreChart) return;
  const isDark = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  const lineCol = isDark ? '#9a9a9a' : '#444';

  let labels, diffs;
  const useAI = graphMode === 'ai' && egaroucidReady && evalCache.length > 0;

  // グラフモード切替ボタン更新
  const modeBtn = document.getElementById('graph-mode-btn');
  if (modeBtn) {
    modeBtn.textContent = useAI ? '石差の推移' : '予測石差';
    modeBtn.disabled = graphMode === 'ai' && !egaroucidReady;
  }

  if (useAI) {
    // AI 評価値（黒視点の予測石差）を使用
    labels = evalCache.map((_, i) => i === 0 ? '開始' : String(i));
    diffs = evalCache;
  } else {
    // 石差モード or AI 未準備: 実石数差
    const b = Array(8).fill().map(() => Array(8).fill(0));
    b[3][3] = -1; b[4][4] = -1; b[3][4] = 1; b[4][3] = 1;
    labels = ['開始'];
    diffs = [0];
    const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];
    for (const m of moveHistory) {
      b[m.y][m.x] = m.player;
      for (const [dx, dy] of DIRS) {
        let nx = m.x + dx, ny = m.y + dy, tmp = [];
        while (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny][nx] === -m.player) {
          tmp.push([nx, ny]); nx += dx; ny += dy;
        }
        if (nx >= 0 && nx < 8 && ny >= 0 && ny < 8 && b[ny][nx] === m.player)
          tmp.forEach(([fx, fy]) => { b[fy][fx] = m.player; });
      }
      let black = 0, white = 0;
      for (let r = 0; r < 8; r++)
        for (let c = 0; c < 8; c++) {
          if (b[r][c] === 1) black++;
          else if (b[r][c] === -1) white++;
        }
      labels.push(String(diffs.length));
      diffs.push(black - white);
    }
  }

  // キャプション更新
  const caption = document.querySelector('.graph-caption');
  if (caption) caption.innerHTML = useAI
    ? '<a href="https://www.egaroucid.nyanyan.dev/ja/web/" target="_blank" rel="noopener" class="text-secondary">Egaroucid</a> 予測石差（⚫+ / ⚪−）'
    : '石差の推移（⚫+ / ⚪−）';

  const ds = scoreChart.data.datasets[0];
  const zeroDs = scoreChart.data.datasets[1];
  scoreChart.data.labels = labels;
  ds.data = diffs;
  ds.borderColor = lineCol;
  const useMistakes = useAI && evalCache.length > 1 && showMistakeList;
  const mistakeMap = useMistakes ? getShownMistakeSet() : new Map();
  ds.pointStyle = diffs.map((_, i) => {
    if (i > 0 && mistakeMap.has(i - 1)) return 'rect';
    return 'circle';
  });
  ds.pointRadius = diffs.map((_, i) => {
    if (i === currentMove) return 5;
    if (i > 0) {
      const e = mistakeMap.get(i - 1);
      if (e) return e.loss >= 12 ? 5 : 4;
    }
    return 0;
  });
  ds.pointBackgroundColor = diffs.map((_, i) => {
    if (i === currentMove) return '#22c55e';
    if (i > 0) {
      const e = mistakeMap.get(i - 1);
      if (e) {
        const isBlack = moveHistory[i - 1]?.player === 1;
        // 黒: 赤系 / 白: 青系
        if (e.loss >= 12) return isBlack ? '#dc2626' : '#7c3aed';
        return isBlack ? '#f97316' : '#3b82f6';
      }
    }
    return lineCol;
  });
  // ±0 参照線: ラベル数分の 0 を設定
  zeroDs.data = new Array(labels.length).fill(0);
  zeroDs.borderColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';
  scoreChart.update();
  renderMistakeList();

  updateEndgameEl();
}

initBoard();
loadFromURL();
// 保存済みの設定をUIに反映
document.getElementById('solver-depth').value = solverDepth;
if (showMoveNumbers) document.getElementById('num-toggle').textContent = '着手順を隠す';
if (showMoveEvals) document.getElementById('move-eval-toggle').textContent = '評価値を隠す';
// 確定ボタン: iPhoneではonclickより先にblurを呼んでからvalueを読む
document.getElementById('confirm-depth-btn').addEventListener('click', function() {
  const input = document.getElementById('solver-depth');
  input.blur(); // iOSキーボードの入力を確定させる
  setSolverDepth(input.value);
});
drawBoard();
initScoreGraph();
updateScoreGraph();
