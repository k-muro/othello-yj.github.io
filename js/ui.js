// ===== AI STATUS & ENDGAME DISPLAY =====
// solver.js から移動: UI 操作を伴うため ui.js で管理する

// AI ステータス表示を更新する
function setAiStatus(text, color) {
  const el = document.getElementById('ai-status');
  if (!el) return;
  el.textContent  = text;
  el.style.color  = color || '';
}

// 現局面の評価ラベルテキストを返す（全読みスコア優先、なければ AI 評価値）
function _evalLabel() {
  const v = solverState.score !== null      ? solverState.score
          : (egaroucidReady && currentMove < evalCache.length) ? evalCache[currentMove]
          : null;
  if (v === null) return '';
  const a = Math.abs(v), s = v >= 0 ? '+' : '';
  if (v === 0) return '互角';
  if (a < EVAL_ADVANTAGE_THRESHOLD) return v > 0 ? `黒有利(${s}${v})` : `白有利(${v})`;
  return v > 0 ? `黒勝勢(${s}${v})` : `白勝勢(${v})`;
}

// 全読みスコアをわかりやすいテキストに変換する
function formatSolverResult(score) {
  if (score > 0)      return `黒が +${score} で勝ち`;
  else if (score < 0) return `白が +${Math.abs(score)} で勝ち`;
  else                return `引き分け`;
}

// #endgame 要素を更新する。ソルバーが pending 中は表示を保留する。
function updateEndgameEl(solverText) {
  if (solverText !== undefined) solverState.result = solverText;
  if (solverState.pending) return; // ソルバー結果待ちの間は更新しない
  endgameEl.classList.remove('endgame-pending');
  const label   = _evalLabel();
  const solving = solverState.result === '読み中…';
  if (!solving && label && solverState.result) {
    endgameEl.innerHTML = `${label}<br><span style="font-size:0.82em">${solverState.result}</span>`;
  } else {
    endgameEl.textContent = solving ? solverState.result : (solverState.result || label);
  }
}

// ===== DOM REFERENCES =====

const boardElement = document.getElementById("board");
const info         = document.getElementById("info");
const scBlack      = document.getElementById("sc-black");
const scWhite      = document.getElementById("sc-white");
const scEmpty      = document.getElementById("sc-empty");
const scBlackName  = document.getElementById("sc-black-name");
const scWhiteName  = document.getElementById("sc-white-name");
const balanceBar   = document.getElementById("balance-bar");
const endgameEl    = document.getElementById("endgame");

// ===== BRANCH TREE STATE =====

let savedBranches       = []; // 分岐ツリー（セッション内のみ、最大5手順）
let _branchPaddingCache = new Map(); // bi -> paddingLeft（フリッカー防止用）
let showOpenings    = localStorage.getItem(STORAGE_KEYS.SHOW_OPENINGS) === 'true';
let showBestMoveDot = localStorage.getItem(STORAGE_KEYS.SHOW_BEST_DOT) !== 'false'; // デフォルト表示

// URL コピー完了メッセージの非表示タイマー
let _urlCopyTimer = null;

// ===== BRANCH TREE FUNCTIONS =====

// savedBranches に手順を追加する（重複・上限チェックあり）
function _addBranch(moves, atFront = false) {
  if (savedBranches.length >= MAX_SAVED_BRANCHES || moves.length === 0) return false;
  const key = moves.map(m => `${m.x},${m.y}`).join('|');
  if (savedBranches.some(b => b.moves.map(m => `${m.x},${m.y}`).join('|') === key)) return false;
  _branchPaddingCache.clear();
  if (atFront) savedBranches.unshift({ moves });
  else         savedBranches.push({ moves });
  return true;
}

// path が savedBranches のいずれかの枝のプレフィックスかどうかを返す
function isPathPrefixOfAnyBranch(path) {
  if (path.length === 0) return true;
  return savedBranches.some(b => {
    if (path.length > b.moves.length) return false;
    return path.every((key, i) => key === `${b.moves[i].x},${b.moves[i].y}`);
  });
}

// 現在の手順を savedBranches に保存する
function saveBranch() {
  if (currentMove === 0) return;
  if (_addBranch(moveHistory.slice(0, currentMove))) renderBranchTree();
}

// 現在の手順を参照棋譜として savedBranches に登録する
function saveReferenceKifu() {
  if (currentMove === 0) return;
  const moves = moveHistory.slice(0, currentMove);
  const key   = moves.map(m => `${m.x},${m.y}`).join('|');
  // 既存エントリがあれば isRef を付与して先頭へ移動
  const existIdx = savedBranches.findIndex(b => b.moves.map(m => `${m.x},${m.y}`).join('|') === key);
  if (existIdx >= 0) {
    savedBranches[existIdx].isRef = true;
    if (existIdx !== 0) {
      const [entry] = savedBranches.splice(existIdx, 1);
      savedBranches.unshift(entry);
    }
    return;
  }
  if (savedBranches.length >= MAX_SAVED_BRANCHES) return;
  savedBranches.unshift({ moves, isRef: true });
}

// 指定インデックスの枝を削除する（参照棋譜は削除不可）
function deleteBranch(idx) {
  if (savedBranches[idx]?.isRef) return;
  _branchPaddingCache.clear();
  savedBranches.splice(idx, 1);
  renderBranchTree();
}

// 指定インデックスの枝を読み込んで盤面を再構築する
function loadBranch(idx) {
  const { moves } = savedBranches[idx];
  referenceKifu   = moves.map(m => ({ x: m.x, y: m.y }));
  const kifu = movesToKifuString(moves);
  kifuToMoves(kifu);
  drawBoard();
}

// ===== BRANCH TREE RENDERING HELPERS =====
// renderBranchTree 内でのみ使うが、モジュールレベルに置いて関数ネストを避ける

// 着手 m の座標文字列（"a1" 形式）を返す
function _branchCoord(m) {
  return String.fromCharCode(97 + m.x) + (m.y + 1);
}

// クラス付きの span 要素を生成する
function _mkSpan(cls, text) {
  const s = document.createElement('span');
  s.className  = cls;
  s.textContent = text;
  return s;
}

// 着手 m が現在の手順（curPath）上にあるかどうかを返す
function _branchOnPath(curPath, mi, m) {
  return mi < curPath.length && curPath[mi] === `${m.x},${m.y}`;
}

// line に着手 span を追加する
function _appendMove(line, curPath, move, gameIdx) {
  const mv = _mkSpan(
    'tree-move' + (_branchOnPath(curPath, gameIdx, move) ? ' tree-move-active' : ''),
    _branchCoord(move)
  );
  mv.dataset.gameidx = gameIdx;
  line.appendChild(mv);
}

// ランドマーク（現在位置・分岐点等）に基づいて手順を描画する
// pairs: [{move, gameIdx}]  pinIdxs: Set<number>（必ず表示するインデックス）
// baseHead: 先頭から必ず表示する手数  baseTail: 末尾から必ず表示する手数
function _renderSeq(line, curPath, pairs, pinIdxs, baseHead = 2, baseTail = 1) {
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
      if (gap > 0) line.appendChild(_mkSpan('tree-arrow', `…(${gap}手)…`));
      line.appendChild(_mkSpan('tree-arrow', '→'));
    }
    _appendMove(line, curPath, pairs[lmIdx].move, pairs[lmIdx].gameIdx);
    prev = lmIdx;
  });
}

// branchMoves が refMoves と最初に異なるインデックスを返す（分岐点の検出）
function _findDivIdx(branchMoves, refMoves) {
  const len = Math.min(branchMoves.length, refMoves.length);
  for (let i = 0; i < len; i++) {
    if (branchMoves[i].x !== refMoves[i].x || branchMoves[i].y !== refMoves[i].y) return i;
  }
  return len;
}

// 手数ラベル・現在バッジ・削除ボタンを line に追加する
function _appendLeafSuffix(line, bi, curPath) {
  const { moves, isRef } = savedBranches[bi];
  line.appendChild(_mkSpan('tree-arrow ms-1', `[${moves.length}手]`));
  if (currentMove === moves.length && moves.every((m, i) => curPath[i] === `${m.x},${m.y}`)) {
    line.appendChild(_mkSpan('tree-badge-now ms-1', '現在'));
  }
  if (!isRef) {
    const del = document.createElement('button');
    del.className  = 'btn btn-outline-danger btn-sm tree-del-btn';
    del.textContent = '×';
    del.title       = 'この手順を削除';
    del.onclick     = e => { e.stopPropagation(); deleteBranch(bi); };
    line.appendChild(del);
  }
}

// 分岐ツリー全体を再描画する
function renderBranchTree() {
  const container = document.getElementById('branch-tree-container');
  const saveBtn   = document.getElementById('save-branch-btn');
  if (!container) return;

  if (saveBtn) {
    saveBtn.disabled    = savedBranches.length >= MAX_SAVED_BRANCHES || currentMove === 0;
    saveBtn.textContent = `この手順を保存 (${savedBranches.length}/${MAX_SAVED_BRANCHES})`;
  }

  // staging に構築してから container へ差し替える（フリッカー防止）
  const staging = document.createElement('div');
  staging.style.cssText =
    'position:absolute;visibility:hidden;pointer-events:none;width:' + container.offsetWidth + 'px;';
  container.parentNode.insertBefore(staging, container.nextSibling);

  function commit() {
    container.innerHTML = '';
    while (staging.firstChild) container.appendChild(staging.firstChild);
    staging.remove();
  }

  if (savedBranches.length === 0) {
    const msg = document.createElement('div');
    msg.className   = 'text-secondary small text-center py-2';
    msg.textContent = '保存された手順はありません';
    staging.appendChild(msg);
    commit();
    return;
  }

  const curPath = moveHistory.slice(0, currentMove).map(m => `${m.x},${m.y}`);
  const refIdx  = savedBranches.findIndex(b => b.isRef);
  const refMoves = refIdx >= 0 ? savedBranches[refIdx].moves : null;

  // 各非参照分岐の分岐インデックス（refMoves との最初の相違点）
  const divIdxMap = new Map();
  savedBranches.forEach((b, i) => {
    if (i !== refIdx && refMoves) divIdxMap.set(i, _findDivIdx(b.moves, refMoves));
  });

  // ── 参照棋譜 ──
  if (refIdx >= 0) {
    const refLen   = refMoves.length;
    const refPairs = refMoves.map((m, i) => ({ move: m, gameIdx: i }));

    // ピン: 先頭2・末尾2・各分岐点前後・現在位置
    const pinIdxs = new Set();
    if (refLen >= 2) { pinIdxs.add(refLen - 2); pinIdxs.add(refLen - 1); }
    divIdxMap.forEach(d => {
      if (d > 0)      pinIdxs.add(d - 1);
      if (d < refLen) pinIdxs.add(d);
    });
    if (currentMove > 0 && currentMove <= refLen &&
        refMoves.slice(0, currentMove).every((m, i) => curPath[i] === `${m.x},${m.y}`)) {
      pinIdxs.add(currentMove - 1);
    }

    const line = document.createElement('div');
    line.className = 'tree-line ref-line clickable';
    line.title     = 'クリックでこの手順を読み込む';
    line.onclick   = () => loadBranch(refIdx);
    line.appendChild(_mkSpan('tree-ref-label', '参照'));
    _renderSeq(line, curPath, refPairs, pinIdxs, 2, 2);
    _appendLeafSuffix(line, refIdx, curPath);
    staging.appendChild(line);
  }

  // ── 分岐ツリー（参照以外） ──
  const nonRefIdxs = savedBranches.map((_, i) => i).filter(i => i !== refIdx);
  if (nonRefIdxs.length === 0) { commit(); return; }

  nonRefIdxs.forEach((bi, listIdx) => {
    const isLast    = listIdx === nonRefIdxs.length - 1;
    const { moves } = savedBranches[bi];
    const startIdx  = divIdxMap.has(bi) ? divIdxMap.get(bi) : 0;
    const branchPairs = moves.slice(startIdx).map((m, j) => ({ move: m, gameIdx: startIdx + j }));

    const pinIdxs = new Set();
    if (currentMove > startIdx && currentMove <= moves.length &&
        moves.slice(0, currentMove).every((m, i) => curPath[i] === `${m.x},${m.y}`)) {
      pinIdxs.add(currentMove - 1 - startIdx);
    }

    const line = document.createElement('div');
    line.className       = 'tree-line clickable';
    line.title           = 'クリックでこの手順を読み込む';
    line.dataset.branchidx = bi;
    line.onclick         = () => loadBranch(bi);
    if (_branchPaddingCache.has(bi)) line.style.paddingLeft = _branchPaddingCache.get(bi) + 'px';
    line.appendChild(_mkSpan('tree-connector', isLast ? '└─' : '├─'));
    _renderSeq(line, curPath, branchPairs, pinIdxs, 2, 1);
    _appendLeafSuffix(line, bi, curPath);
    staging.appendChild(line);
  });

  // 参照行の分岐点に合わせてインデントを揃える
  const needsRaf = refIdx >= 0 && nonRefIdxs.some(bi => !_branchPaddingCache.has(bi));
  if (!needsRaf) {
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

// 参照棋譜（isRef の枝 or referenceKifu）を返す
function _getRefMoves() {
  const refBranch = savedBranches.find(b => b.isRef);
  return refBranch ? refBranch.moves : referenceKifu;
}

// 現在の分岐点（参照棋譜と手順が最初に異なる位置）へ移動する
function goToBranchPoint() {
  const refMoves = _getRefMoves();
  const len = Math.min(currentMove, refMoves.length);
  let i = 0;
  while (i < len && moveHistory[i].x === refMoves[i].x && moveHistory[i].y === refMoves[i].y) i++;
  currentMove = i;
  rebuildBoard();
}

// ===== RENDERING HELPERS =====

// showMoveNumbers が true のとき着手順マップを構築して返す
function buildMoveNumMap() {
  const map = new Map();
  if (showMoveNumbers) {
    moveHistory.slice(0, currentMove).forEach((m, i) => {
      map.set(`${m.x},${m.y}`, { num: i + 1, player: m.player });
    });
  }
  return map;
}

// 参照棋譜の次の手のキー文字列（"x,y"）を返す。該当なければ null。
function computeNextRefKey() {
  const nextRef = currentMatchesReference() && currentMove < referenceKifu.length
    ? referenceKifu[currentMove] : null;
  return nextRef ? `${nextRef.x},${nextRef.y}` : null;
}

// #current-kifu の表示を現在の手順で更新する
function updateKifuInput() {
  document.getElementById("current-kifu").value = movesToKifuString(moveHistory.slice(0, currentMove));
}

// 「分岐点へ」ボタンの活性状態を更新する
function updateBranchButton() {
  const branchBtn = document.getElementById('branch-btn');
  if (!branchBtn) return;
  const refMoves = _getRefMoves();
  const len = Math.min(currentMove, refMoves.length);
  let hasBranch = false;
  for (let i = 0; i < len; i++) {
    if (moveHistory[i].x !== refMoves[i].x || moveHistory[i].y !== refMoves[i].y) {
      hasBranch = true; break;
    }
  }
  branchBtn.disabled = !hasBranch;
}

// 分岐の先端にいるときだけ悪手解析を自動起動する
function triggerMistakeAnalysisIfNeeded() {
  if (!egaroucidReady || currentMove === 0) return;
  const atBranchEnd = savedBranches.some(b =>
    b.moves.length === currentMove &&
    b.moves.every((m, i) => m.x === moveHistory[i].x && m.y === moveHistory[i].y)
  );
  if (atBranchEnd) setTimeout(computeMistakes, 0);
}

// ===== BOARD EDIT MODE =====

let boardEditMode    = false;  // 編集モード中かどうか
let editStone        = 1;      // 1=黒 / -1=白 / 0=消しゴム
let editTurn         = 1;      // 確定後の手番（1=黒 / -1=白）
let editBoard        = null;   // 編集中の盤面スナップショット
let customBoardStart = null;   // { board, turn } — 編集確定した開始局面（null=標準開始）

// 編集モードに入る
function enterBoardEditMode() {
  boardEditMode = true;
  editBoard     = board.map(r => [...r]); // 現在の盤面をコピー
  editStone     = 1;
  editTurn      = 1;
  _updateEditToolbar();
  document.getElementById('board-edit-toolbar').style.display = '';
  document.getElementById('board').classList.add('board-edit-mode');
  drawBoard();
}

// 置く石の種類を切り替える（1=黒 / -1=白 / 0=消しゴム）
function setEditStone(v) {
  editStone = v;
  _updateEditToolbar();
}

// 確定後の手番を切り替える
function setEditTurn(v) {
  editTurn = v;
  _updateEditToolbar();
}

// ツールバーのアクティブ状態を更新する
function _updateEditToolbar() {
  document.getElementById('edit-btn-black').classList.toggle('active', editStone ===  1);
  document.getElementById('edit-btn-white').classList.toggle('active', editStone === -1);
  document.getElementById('edit-btn-erase').classList.toggle('active', editStone ===  0);
  document.getElementById('edit-turn-black').classList.toggle('active', editTurn ===  1);
  document.getElementById('edit-turn-white').classList.toggle('active', editTurn === -1);
}

// 編集モード中にセル(x,y)をクリックしたときの処理
function handleEditCellClick(x, y) {
  if (editStone === 0) {
    editBoard[y][x] = 0; // 消しゴム
  } else if (editBoard[y][x] !== 0) {
    editBoard[y][x] = -editBoard[y][x]; // 既存の石は黒⇔白トグル
  } else {
    editBoard[y][x] = editStone; // 空マスには選択中の色を置く
  }
  drawBoard();
}

// 編集モード中にセル(x,y)を右クリックしたときの処理（石を消す）
function handleEditCellRightClick(x, y) {
  editBoard[y][x] = 0;
  drawBoard();
}

// 編集モード中に盤面を全消しする
function clearEditBoard() {
  for (let y = 0; y < 8; y++) editBoard[y].fill(0);
  drawBoard();
}

// 編集内容を確定して通常モードに戻る
function confirmBoardEdit() {
  // 編集後の盤面をグローバル board に反映
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++)
      board[y][x] = editBoard[y][x];

  // 履歴・手数・関連状態をリセットして編集局面を開始局面とする
  moveHistory   = [];
  currentMove   = 0;
  currentPlayer = editTurn;
  referenceKifu = [];
  savedBranches = [];
  evalCache           = [];
  solverState.result  = '';
  solverState.score   = null;
  solverState.pending = false;
  mistakeCache        = [];
  mistakeCacheKifu    = '';
  document.getElementById('kifu-input').value = '';
  // 編集開始局面として記録（URL共有で pos= として使用）
  customBoardStart = { board: editBoard.map(r => [...r]), turn: editTurn };

  _exitEditMode();
  drawBoard();
}

// 編集をキャンセルして元の盤面に戻る
function cancelBoardEdit() {
  _exitEditMode();
  drawBoard();
}

// 編集モードを終了する（内部用）
function _exitEditMode() {
  boardEditMode = false;
  editBoard     = null;
  document.getElementById('board-edit-toolbar').style.display = 'none';
  document.getElementById('board').classList.remove('board-edit-mode');
}

// ===== BOARD RENDERING =====

// ボードのグリッド・石・ヒント・着手順番号を描画する
function renderBoardGrid(validSet, lastMove, nextRefKey, moveNumMap) {
  const makeLabel = (text) => {
    const lbl = document.createElement("div");
    lbl.className   = "board-label";
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
      cell.className  = "cell";
      cell.dataset.pos = `${x},${y}`;
      cell.onclick    = boardEditMode ? () => handleEditCellClick(x, y) : () => playMove(x, y);
      if (boardEditMode) {
        // PC: 右クリックで消しゴム
        cell.oncontextmenu = (e) => { e.preventDefault(); handleEditCellRightClick(x, y); };
        // モバイル: 長押し(500ms)で消しゴム
        let _lpTimer = null;
        cell.addEventListener('touchstart', (e) => {
          _lpTimer = setTimeout(() => { e.preventDefault(); handleEditCellRightClick(x, y); _lpTimer = null; }, 500);
        }, { passive: false });
        cell.addEventListener('touchend',  () => { clearTimeout(_lpTimer); _lpTimer = null; });
        cell.addEventListener('touchmove', () => { clearTimeout(_lpTimer); _lpTimer = null; });
      }
      if (!boardEditMode && lastMove && lastMove.x === x && lastMove.y === y) cell.classList.add("last-move");

      // 編集モードでは editBoard を表示、通常モードは board を表示
      const cellVal = boardEditMode ? editBoard[y][x] : board[y][x];

      if (cellVal !== 0) {
        // 石を描画する
        const stone = document.createElement("div");
        stone.className = "stone " + (cellVal === 1 ? "black" : "white");

        cell.appendChild(stone);
        // 着手順番号を石の上に重ねる
        if (showMoveNumbers) {
          const entry = moveNumMap.get(`${x},${y}`);
          if (entry !== undefined) {
            const numEl = document.createElement("span");
            numEl.className   = "stone-num " + (entry.player === 1 ? "stone-num-by-black" : "stone-num-by-white");
            numEl.textContent = entry.num;
            cell.appendChild(numEl);
          }
        }
      } else if (!boardEditMode && validSet.has(`${x},${y}`)) {
        // 合法手ヒントを描画する（参照棋譜の次手は色を変える）
        const hint     = document.createElement("div");
        const isNextRef = `${x},${y}` === nextRefKey;
        hint.className  = "hint " + (isNextRef
          ? (currentPlayer === 1 ? "hint-ref-black" : "hint-ref-white")
          : (currentPlayer === 1 ? "hint-black"     : "hint-white"));
        cell.appendChild(hint);
        // 定石ガイドのドットを追加する
        if (showOpenings) {
          const om = getMatchingOpenings([...moveHistory.slice(0, currentMove), { x, y }]);
          if (om.length > 0) {
            const dotRow = document.createElement('div');
            dotRow.className = 'opening-dot-row';
            om.forEach(name => {
              const dot = document.createElement('div');
              dot.className = 'opening-dot';
              dot.style.backgroundColor = OPENING_COLORS[name];
              dotRow.appendChild(dot);
            });
            cell.appendChild(dotRow);
          }
        }
      }
      boardElement.appendChild(cell);
    }

    boardElement.appendChild(makeLabel(y + 1)); // 右ラベル
  }

  // 下段: コーナー + a-h + コーナー
  boardElement.appendChild(document.createElement("div"));
  for (let x = 0; x < 8; x++) boardElement.appendChild(makeLabel(String.fromCharCode(97 + x)));
  boardElement.appendChild(document.createElement("div"));
}

// スコアパネル（石数・バランスバー・名前）を更新し、空マス数を返す
function updateStoneDisplay() {
  const { black, white, empty } = countStones(board);
  scBlack.textContent     = black;
  scWhite.textContent     = white;
  scEmpty.textContent     = empty;
  scBlackName.textContent = blackName;
  scWhiteName.textContent = whiteName;
  const total = black + white;
  balanceBar.style.width = (total > 0 ? (black / total * 100) : 50).toFixed(1) + '%';
  return empty;
}

// 終局チェックを行い info テキストを更新する
function updateGameStatusDisplay(blackMoves, whiteMoves) {
  if (blackMoves.length === 0 && whiteMoves.length === 0) {
    showGameResult();
  } else {
    info.textContent = currentPlayer === 1
      ? `${blackName}（⚫）の番`
      : `${whiteName}（⚪）の番`;
  }
}

// 全読みを実行して結果をボード上に反映する（evaluateMove 完了コールバックとして呼ぶ）
function runSolverForPosition(snapBoard, snapPlayer, snapEmpty, snapGameOver, solverGen) {
  if (solverGen !== moveEvalGeneration) return;
  if (snapGameOver) { solverState.pending = false; updateEndgameEl(''); return; }
  if (snapEmpty > solverDepth) { solverState.pending = false; updateEndgameEl(); return; }

  updateEndgameEl('読み中…');
  solverState.cancelFlag = false;
  try {
    let score, bestPos, line;
    if (egaroucidReady) {
      // Egaroucid が使えるなら残り手数に関わらず WASM で解く
      ({ score, bestPos, line } = egaroucidSolveTop(snapBoard, snapPlayer, snapEmpty));
    } else if (snapEmpty <= 10) {
      // Egaroucid 未準備のときは JS ソルバー（≤10手のみ）
      let blackBB = 0n, whiteBB = 0n;
      for (let y = 0; y < 8; y++)
        for (let x = 0; x < 8; x++) {
          if (snapBoard[y][x] ===  1) blackBB |= 1n << BigInt(y * 8 + x);
          else if (snapBoard[y][x] === -1) whiteBB |= 1n << BigInt(y * 8 + x);
        }
      ({ score, bestPos, line } = bbSolveTop(blackBB, whiteBB, snapPlayer === 1));
    } else {
      solverState.pending = false;
      updateEndgameEl('AI読み込み後に全読みできます');
      return;
    }
    if (solverGen !== moveEvalGeneration) return;
    const lineStr = line.map(m => String.fromCharCode(97 + m.x) + (m.y + 1)).join(" ");
    const result  = formatSolverResult(score);

    // ===== デバッグ: line を snapBoard から実際に再生して石数を確認 =====
    // egaroucidSolveTop が返す score と実際の石数が一致するかを検証する。
    // パスは自動スキップ。最終的な石数を「黒X-白Y」形式で末尾に付記する。
    let dbBoard = snapBoard.map(r => [...r]);
    let dbCp = snapPlayer;
    for (const mv of line) {
      // パスが必要なら先にスキップ（line にはパス手が含まれないため）
      if (!hasAnyMove(dbBoard, dbCp)) {
        if (!hasAnyMove(dbBoard, -dbCp)) break;
        dbCp = -dbCp;
      }
      dbBoard = applyBoardMove(dbBoard, mv.x, mv.y, dbCp);
      dbCp = -dbCp;
    }
    const { black: dbB, white: dbW, empty: dbE } = countStones(dbBoard);
    let dbFinalB = dbB, dbFinalW = dbW;
    if (dbFinalB > dbFinalW) dbFinalB += dbE;
    else if (dbFinalW > dbFinalB) dbFinalW += dbE;
    const debugStr = ` [再生結果: 黒${dbFinalB}-白${dbFinalW}]`;
    // ===== デバッグここまで =====

    solverState.pending = false;
    solverState.score   = score; // 確定スコアを保存（以降の _evalLabel に使用）
    updateEndgameEl(`最善手を読み切り: ${result}　(${lineStr})${debugStr}`);
    // 最善手マーカー（青い点）をボード上に表示する（CSS クラスで表示/非表示を制御）
    if (bestPos >= 0) {
      const bx = bestPos & 7, by = bestPos >> 3;
      const bestCell = boardElement.querySelector(`[data-pos="${bx},${by}"]`);
      if (bestCell) {
        const dot = document.createElement("div");
        dot.className = "best-move-dot";
        bestCell.appendChild(dot);
      }
    }
  } catch (e) {
    if (e !== 'solver_cancelled') throw e;
  }
}

// ===== MAIN DRAW FUNCTION =====

// 現在の盤面状態に合わせて全 UI を更新する
function drawBoard() {
  if (_skipDraw) return;

  solverState.cancelFlag = true; // 実行中の全読みをキャンセル
  boardElement.innerHTML = "";

  const validMoves  = getValidMoves(currentPlayer);
  const validSet    = new Set(validMoves.map(([x, y]) => `${x},${y}`));
  const lastMove    = currentMove > 0 ? moveHistory[currentMove - 1] : null;
  const nextRefKey  = computeNextRefKey();
  const moveNumMap  = buildMoveNumMap();
  const currentEvalGen = ++moveEvalGeneration;

  renderBoardGrid(validSet, lastMove, nextRefKey, moveNumMap);

  // 直接入力した盤面の場合は評価値の信頼性に関する警告を表示する
  const warningEl = document.getElementById('custom-board-warning');
  if (warningEl) warningEl.style.display = customBoardStart ? '' : 'none';

  const empty = updateStoneDisplay();

  // ソルバー状態をリセットして評価待ち表示にする
  solverState.result = '';
  solverState.score  = null;
  endgameEl.classList.add('endgame-pending');

  updateKifuInput();

  const blackMoves = getValidMoves(1);
  const whiteMoves = getValidMoves(-1);
  updateGameStatusDisplay(blackMoves, whiteMoves);
  updateBranchButton();

  // 全読みが必要な局面かどうかを先に判定する
  const snapGameOver = blackMoves.length === 0 && whiteMoves.length === 0;
  solverState.pending = !snapGameOver && empty <= solverDepth;

  computeAllEvals();
  updateScoreGraph();
  updateNavButtons();
  renderBranchTree();
  updateOpeningDisplay();
  triggerMistakeAnalysisIfNeeded();

  // 評価値表示が終わったら全読みを起動する（盤面スナップショットをクロージャで渡す）
  const snapBoard  = board.map(r => [...r]);
  const snapPlayer = currentPlayer;
  const snapEmpty  = empty;
  const solverGen  = currentEvalGen;
  scheduleMoveEvals(validMoves, currentEvalGen, () =>
    runSolverForPosition(snapBoard, snapPlayer, snapEmpty, snapGameOver, solverGen)
  );
}

// ===== NAV BUTTONS =====

// 戻る/進むボタンの活性状態を更新する
function updateNavButtons() {
  const canBack    = currentMove > 0;
  const canForward = currentMove < moveHistory.length ||
    (currentMatchesReference() && currentMove < referenceKifu.length);

  const btnIds  = ['btn-first', 'btn-undo10', 'btn-undo', 'btn-redo', 'btn-redo10', 'btn-last'];
  const canNavs = [canBack, canBack, canBack, canForward, canForward, canForward];
  btnIds.forEach((id, i) => { document.getElementById(id).disabled = !canNavs[i]; });
}

// ===== GAME RESULT =====

// 終局時の最終結果を info と endgame 要素に表示する
function showGameResult() {
  const { black, white } = countStones(board);
  const bName = scBlackName.textContent;
  const wName = scWhiteName.textContent;

  if (black > white)       info.textContent = `⚫ ${bName} の勝ち！`;
  else if (white > black)  info.textContent = `⚪ ${wName} の勝ち！`;
  else                     info.textContent = `⚫⚪ 引き分け！`;

  let stoneResult;
  if (black > white)       stoneResult = `黒の ${black - white} 石勝ち`;
  else if (white > black)  stoneResult = `白の ${white - black} 石勝ち`;
  else                     stoneResult = `引き分け`;

  endgameEl.textContent = `最終結果：⚫ ${black} - ⚪ ${white}（${stoneResult}）`;
}

// ===== SETTINGS & UI =====

// プレイヤー名を入力フィールドから読み取って更新する
function updateNames() {
  blackName = document.getElementById("black-name-input").value || "黒";
  whiteName = document.getElementById("white-name-input").value || "白";
  drawBoard();
}

// 黒と白のプレイヤー名を入れ替える
function swapNames() {
  const bInput = document.getElementById("black-name-input");
  const wInput = document.getElementById("white-name-input");
  const tmp = bInput.value;
  bInput.value = wInput.value;
  wInput.value = tmp;
  updateNames();
}

// 着手順の表示/非表示を切り替える
function toggleMoveNumbers() {
  showMoveNumbers = !showMoveNumbers;
  localStorage.setItem(STORAGE_KEYS.SHOW_NUMBERS, showMoveNumbers);
  document.getElementById('num-toggle').textContent = showMoveNumbers ? '着手順を隠す' : '着手順を表示';
  drawBoard();
}

// 全読み開始残り手数を変更して再描画する
function setSolverDepth(val) {
  const n = Math.min(24, Math.max(6, parseInt(val) || DEFAULT_SOLVER_DEPTH));
  document.getElementById('solver-depth').value = n;
  const warningEl = document.getElementById('depth-warning');
  if (n !== solverDepth) {
    if (n > DEFAULT_SOLVER_DEPTH) {
      warningEl.textContent = `残り ${n} 手からの全読みは計算に時間がかかる場合があります。`;
      warningEl.className   = 'text-center small mt-1 text-warning';
      warningEl.style.display = '';
    } else {
      warningEl.style.display = 'none';
    }
  } else {
    warningEl.style.display = 'none';
  }
  solverDepth = n;
  localStorage.setItem(STORAGE_KEYS.SOLVER_DEPTH, n);
  drawBoard();
}

// 棋譜入力フィールドの内容を盤面に反映する
function applyKifu() {
  const kifu = document.getElementById("kifu-input").value.trim().toLowerCase();
  customBoardStart = null; // 標準開始局面に戻る
  referenceKifu = [];
  for (let i = 0; i + 1 < kifu.length; i += 2)
    referenceKifu.push(coordToXY(kifu.substring(i, i + 2)));
  kifuToMoves(kifu);
  saveReferenceKifu();
  drawBoard();
}

// URL パラメータ（kifu / k / black(b) / white(w)）を読み込んで盤面を初期化する
// b / w は black / white の短縮形。両方指定された場合は b / w を優先する
// k はエンコード済み棋譜。kifu より k を優先する
function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  const pBlack = params.get("b") ?? params.get("black");
  const pWhite = params.get("w") ?? params.get("white");
  blackName = pBlack || "黒";
  whiteName = pWhite || "白";
  if (pBlack) document.getElementById("black-name-input").value = pBlack;
  if (pWhite) document.getElementById("white-name-input").value = pWhite;

  const pos  = params.get("pos");
  // k= はエンコード済み棋譜。デコードして kifu 形式に変換する。kifu= より優先
  const rawK = params.get("k");
  const kifu = rawK ? decodeGame(rawK) : params.get("kifu");

  if (pos && /^[0-9a-f]{32}$/.test(pos)) {
    // 編集盤面からの復元
    const turn = params.get("turn") === "w" ? -1 : 1;
    const decoded = decodeBoardPos(pos);
    for (let y = 0; y < 8; y++)
      for (let x = 0; x < 8; x++)
        board[y][x] = decoded[y][x];
    customBoardStart = { board: decoded.map(r => [...r]), turn };
    moveHistory  = [];
    currentMove  = 0;
    currentPlayer = turn;
    evalCache    = [];
    // 続きの手順があれば盤面に適用する（initBoard() を呼ばずに直接着手）
    if (kifu) {
      document.getElementById("kifu-input").value = kifu;
      for (let i = 0; i + 1 < kifu.length; i += 2) {
        const { x, y } = coordToXY(kifu.substring(i, i + 2));
        if (getFlips(x, y, currentPlayer).length === 0) break;
        moveHistory.push({ x, y, player: currentPlayer });
        applyMoveToBoard(x, y, currentPlayer);
        applyPassIfNeeded();
        currentMove++;
      }
      referenceKifu = moveHistory.map(m => ({ x: m.x, y: m.y }));
      saveReferenceKifu();
    }
  } else if (kifu) {
    // 通常棋譜
    document.getElementById("kifu-input").value = kifu;
    referenceKifu = [];
    for (let i = 0; i + 1 < kifu.length; i += 2)
      referenceKifu.push(coordToXY(kifu.substring(i, i + 2)));
    kifuToMoves(kifu);
    saveReferenceKifu();
  }
}

// 現在の棋譜をクリップボードにコピーする
function copyCurrentKifu() {
  navigator.clipboard.writeText(document.getElementById("current-kifu").value);
}

// 現在の局面の共有 URL をクリップボードにコピーする
function copyShareURL() {
  const kifu  = movesToKifuString(moveHistory.slice(0, currentMove));
  const black = document.getElementById("black-name-input").value.trim();
  const white = document.getElementById("white-name-input").value.trim();
  const params = new URLSearchParams();
  if (customBoardStart) {
    // 編集盤面: pos= で開始局面をエンコード、その後の手順は kifu= で追記
    params.set("pos",  encodeBoardPos(customBoardStart.board));
    params.set("turn", customBoardStart.turn === 1 ? "b" : "w");
    if (kifu) params.set("kifu", kifu);
  } else {
    if (kifu) params.set("kifu", kifu);
  }
  if (black) params.set("black", black);
  if (white) params.set("white", white);
  const url = window.location.origin + window.location.pathname +
    (params.toString() ? "?" + params.toString() : "");
  navigator.clipboard.writeText(url).then(() => {
    const msg = document.getElementById("url-copy-msg");
    msg.style.display = "";
    clearTimeout(_urlCopyTimer);
    _urlCopyTimer = setTimeout(() => { msg.style.display = "none"; }, 2000);
  });
}

// ===== OPENING DISPLAY =====

// 定石名バッジを opening-name 要素に描画する
function updateOpeningDisplay() {
  const el = document.getElementById("opening-name");
  if (!el) return;
  el.innerHTML = '';
  if (!showOpenings) return;
  const matches = getMatchingOpenings(moveHistory.slice(0, currentMove));
  matches.forEach(name => {
    const badge = document.createElement('span');
    badge.className        = 'opening-badge';
    badge.style.backgroundColor = OPENING_COLORS[name];
    badge.textContent      = name;
    el.appendChild(badge);
  });
}

// 定石ガイドの表示/非表示を切り替える
function toggleOpenings() {
  showOpenings = !showOpenings;
  localStorage.setItem(STORAGE_KEYS.SHOW_OPENINGS, showOpenings);
  const btn = document.getElementById('opening-guide-btn');
  if (btn) btn.classList.toggle('active', showOpenings);
  drawBoard();
}

// 読み切りの最善手（青い点）の表示/非表示を切り替える
// CSS クラスで制御するためソルバーの再実行は不要
function toggleBestMoveDot() {
  showBestMoveDot = !showBestMoveDot;
  localStorage.setItem(STORAGE_KEYS.SHOW_BEST_DOT, showBestMoveDot);
  const btn = document.getElementById('best-dot-toggle-btn');
  if (btn) btn.classList.toggle('active', showBestMoveDot);
  boardElement.classList.toggle('hide-best-dot', !showBestMoveDot);
}

// ===== INITIALIZATION =====

initBoard();
loadFromURL();

// 保存済みの設定を UI に反映する
document.getElementById('solver-depth').value = solverDepth;
if (showMoveNumbers) document.getElementById('num-toggle').textContent        = '着手順を隠す';
if (showMoveEvals)   document.getElementById('move-eval-toggle').textContent  = '評価値を隠す';

// 確定ボタン: iOS ではクリック前に blur でキーボード入力を確定する
document.getElementById('confirm-depth-btn').addEventListener('click', function() {
  const input = document.getElementById('solver-depth');
  input.blur(); // iOS キーボードの入力を確定させる
  setSolverDepth(input.value);
});

drawBoard();
initScoreGraph();
updateScoreGraph();

// 定石ガイドボタンの初期状態を設定する
(function() {
  const btn = document.getElementById('opening-guide-btn');
  if (btn) btn.classList.toggle('active', showOpenings);
})();

// 読み切り青点ボタン・ボード要素の初期状態を設定する
(function() {
  const btn = document.getElementById('best-dot-toggle-btn');
  if (btn) btn.classList.toggle('active', showBestMoveDot);
  boardElement.classList.toggle('hide-best-dot', !showBestMoveDot);
})();

// パネルの開閉状態を localStorage に保持する
['analysis-panel', 'branch-tree-panel', 'settings-panel'].forEach(id => {
  const panel = document.getElementById(id);
  if (!panel) return;
  if (localStorage.getItem(STORAGE_KEYS.panel(id)) === 'open') {
    panel.classList.add('show');
    const toggle = document.querySelector(`[data-bs-target="#${id}"]`);
    if (toggle) {
      toggle.classList.remove('collapsed');
      toggle.setAttribute('aria-expanded', 'true');
    }
  }
  panel.addEventListener('show.bs.collapse', () => localStorage.setItem(STORAGE_KEYS.panel(id), 'open'));
  panel.addEventListener('hide.bs.collapse', () => localStorage.setItem(STORAGE_KEYS.panel(id), 'closed'));
});

// ===== BOARD THEME =====

// 盤面テーマを切り替える（#board のインラインCSS変数を直接書き換え）
function setBoardTheme(name) {
  const boardEl = document.getElementById('board');
  const themeName = BOARD_THEMES[name] ? name : 'green'; // 未知のテーマはgreenにフォールバック
  // テーマ名を属性として持たせ、CSS でテーマ別スタイルを適用できるようにする
  boardEl.dataset.boardTheme = themeName;
  // ミニ石などボード外の要素でもテーマを参照できるよう body にも伝播する
  document.body.dataset.boardTheme = themeName;
  localStorage.setItem(STORAGE_KEYS.BOARD_THEME, themeName);
}

// 起動時: 保存済みテーマを適用
(function() {
  const saved = localStorage.getItem(STORAGE_KEYS.BOARD_THEME) || 'green';
  setBoardTheme(saved);
})();

// ===== KEYBOARD SHORTCUTS =====
// PC のみ有効（スマホは除外）。入力欄フォーカス中・モーダル表示中は無効。
document.addEventListener('keydown', function(e) {
  if (!window.matchMedia('(min-width: 561px)').matches) return;
  const tag = document.activeElement.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (document.querySelector('.modal.show')) return;

  switch (e.key) {
    case 'ArrowLeft':
      e.preventDefault();
      e.shiftKey ? undo10() : undo();
      break;
    case 'ArrowRight':
      e.preventDefault();
      e.shiftKey ? redo10() : redo();
      break;
    case 'Home':
      e.preventDefault();
      goToFirst();
      break;
    case 'End':
      e.preventDefault();
      goToLast();
      break;
    case 'b': case 'B': goToBranchPoint(); break;
    case 'e': case 'E': toggleMoveEvals();  break;
    case 'm': case 'M': toggleMistakeList(); break;
    case 'o': case 'O': toggleOpenings();   break;
    case 'd': case 'D': toggleTheme();      break;
  }
});
