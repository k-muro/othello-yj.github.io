// ===== DOM REFERENCES =====

const boardElement = document.getElementById("board");
const info = document.getElementById("info");
const scBlack    = document.getElementById("sc-black");
const scWhite    = document.getElementById("sc-white");
const scEmpty    = document.getElementById("sc-empty");
const scBlackName = document.getElementById("sc-black-name");
const scWhiteName = document.getElementById("sc-white-name");
const balanceBar = document.getElementById("balance-bar");
const endgameEl = document.getElementById("endgame");

// ===== BRANCH TREE STATE =====

let savedBranches = []; // 分岐ツリー（セッション内のみ、最大5手順）
let _branchPaddingCache = new Map(); // bi -> paddingLeft（フリッカー防止用）
let showOpenings = localStorage.getItem(STORAGE_KEYS.SHOW_OPENINGS) === 'true';

// URL コピー完了メッセージの非表示タイマー
let _urlCopyTimer = null;

// ===== BRANCH TREE FUNCTIONS =====

function _addBranch(moves, atFront = false) {
  if (savedBranches.length >= MAX_SAVED_BRANCHES || moves.length === 0) return false;
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
  if (savedBranches.length >= MAX_SAVED_BRANCHES) return;
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
  const kifu = movesToKifuString(moves);
  kifuToMoves(kifu);
  drawBoard();
}

// ===== BRANCH TREE RENDERING HELPERS =====
// これらは renderBranchTree 内でのみ使うが、モジュールレベルに置くことで
// 関数定義のネストを避け可読性を高める。

function _branchCoord(m) {
  return String.fromCharCode(97 + m.x) + (m.y + 1);
}

function _mkSpan(cls, text) {
  const s = document.createElement('span');
  s.className = cls;
  s.textContent = text;
  return s;
}

function _branchOnPath(curPath, mi, m) {
  return mi < curPath.length && curPath[mi] === `${m.x},${m.y}`;
}

function _appendMove(line, curPath, move, gameIdx) {
  const mv = _mkSpan(
    'tree-move' + (_branchOnPath(curPath, gameIdx, move) ? ' tree-move-active' : ''),
    _branchCoord(move)
  );
  mv.dataset.gameidx = gameIdx;
  line.appendChild(mv);
}

// ランドマークに基づいて手順を描画する。
// pairs: [{move, gameIdx}]
// pinIdxs: Set<number> — pairs内で必ず表示するインデックス（現在位置・分岐点等）
// baseHead: 先頭から必ず表示する手数（デフォルト2）
// baseTail: 末尾から必ず表示する手数（デフォルト1）
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

// branchMoves が refMoves と最初に異なるインデックスを返す
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
    del.className = 'btn btn-outline-danger btn-sm tree-del-btn';
    del.textContent = '×';
    del.title = 'この手順を削除';
    del.onclick = e => { e.stopPropagation(); deleteBranch(bi); };
    line.appendChild(del);
  }
}

function renderBranchTree() {
  const container = document.getElementById('branch-tree-container');
  const saveBtn   = document.getElementById('save-branch-btn');
  if (!container) return;

  if (saveBtn) {
    saveBtn.disabled = savedBranches.length >= MAX_SAVED_BRANCHES || currentMove === 0;
    saveBtn.textContent = `この手順を保存 (${savedBranches.length}/${MAX_SAVED_BRANCHES})`;
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

  const refIdx = savedBranches.findIndex(b => b.isRef);
  const refMoves = refIdx >= 0 ? savedBranches[refIdx].moves : null;

  // 各非参照分岐の分岐インデックス（refMovesとの最初の相違点）
  const divIdxMap = new Map();
  savedBranches.forEach((b, i) => {
    if (i !== refIdx && refMoves) divIdxMap.set(i, _findDivIdx(b.moves, refMoves));
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
    line.appendChild(_mkSpan('tree-ref-label', '参照'));

    _renderSeq(line, curPath, refPairs, pinIdxs, 2, 2);
    _appendLeafSuffix(line, refIdx, curPath);
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
    line.appendChild(_mkSpan('tree-connector', isLast ? '└─' : '├─'));

    _renderSeq(line, curPath, branchPairs, pinIdxs, 2, 1);
    _appendLeafSuffix(line, bi, curPath);
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

function _getRefMoves() {
  const refBranch = savedBranches.find(b => b.isRef);
  return refBranch ? refBranch.moves : referenceKifu;
}

function goToBranchPoint() {
  const refMoves = _getRefMoves();
  const len = Math.min(currentMove, refMoves.length);
  let i = 0;
  while (i < len && moveHistory[i].x === refMoves[i].x && moveHistory[i].y === refMoves[i].y) i++;
  currentMove = i;
  rebuildBoard();
}

// ===== RENDERING =====

// ボードのグリッド・石・ヒントを描画する
function renderBoardGrid(validSet, lastMove, nextRefKey, moveNumMap) {
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
  scBlack.textContent = black;
  scWhite.textContent = white;
  scEmpty.textContent = empty;
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

function drawBoard() {
  if (_skipDraw) return;
  solverState.cancelFlag = true;  // 実行中の全読みをキャンセル
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

  renderBoardGrid(validSet, lastMove, nextRefKey, moveNumMap);

  const empty = updateStoneDisplay();

  solverState.result = '';
  solverState.score = null;
  endgameEl.classList.add('endgame-pending');

  document.getElementById("current-kifu").value = movesToKifuString(moveHistory.slice(0, currentMove));

  // ===== 終局チェック =====
  const blackMoves = getValidMoves(1);
  const whiteMoves = getValidMoves(-1);

  updateGameStatusDisplay(blackMoves, whiteMoves);

  const branchBtn = document.getElementById('branch-btn');
  if (branchBtn) {
    const refMoves = _getRefMoves();
    const len = Math.min(currentMove, refMoves.length);
    let hasBranch = false;
    for (let i = 0; i < len; i++) {
      if (moveHistory[i].x !== refMoves[i].x || moveHistory[i].y !== refMoves[i].y) {
        hasBranch = true;
        break;
      }
    }
    branchBtn.disabled = !hasBranch;
  }
  solverState.pending = !(blackMoves.length === 0 && whiteMoves.length === 0) && empty <= solverDepth;
  computeAllEvals();
  updateScoreGraph();
  updateNavButtons();
  renderBranchTree();
  updateOpeningDisplay();

  // 分岐の先端にいる間は悪手解析を自動実行
  if (egaroucidReady && currentMove > 0) {
    const _atBranchEnd = savedBranches.some(b =>
      b.moves.length === currentMove &&
      b.moves.every((m, i) => m.x === moveHistory[i].x && m.y === moveHistory[i].y)
    );
    if (_atBranchEnd) setTimeout(computeMistakes, 0);
  }

  // 評価値表示が終わったら全読みを起動
  const solverGen = currentEvalGen;
  const snapBoard = board.map(r => [...r]);
  const snapPlayer = currentPlayer;
  const snapEmpty = empty;
  const snapGameOver = blackMoves.length === 0 && whiteMoves.length === 0;
  function runSolver() {
    if (solverGen !== moveEvalGeneration) return;
    if (snapGameOver) { solverState.pending = false; updateEndgameEl(''); return; }
    if (snapEmpty > solverDepth) { solverState.pending = false; updateEndgameEl(); return; }
    updateEndgameEl('読み中…');
    solverState.cancelFlag = false;
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
        solverState.pending = false;
        updateEndgameEl('AI読み込み後に全読みできます');
        return;
      }
      if (solverGen !== moveEvalGeneration) return;
      const lineStr = line.map(m => String.fromCharCode(97 + m.x) + (m.y + 1)).join(" ");
      const result = formatSolverResult(score);
      solverState.pending = false;
      solverState.score = score; // 黒視点の確定スコアを保存（以降の _evalLabel に使用）
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
  const canBack    = currentMove > 0;
  const canForward = currentMove < moveHistory.length ||
    (currentMatchesReference() && currentMove < referenceKifu.length);

  const btnIds  = ['btn-first', 'btn-undo10', 'btn-undo', 'btn-redo', 'btn-redo10', 'btn-last'];
  const canNavs = [canBack, canBack, canBack, canForward, canForward, canForward];
  btnIds.forEach((id, i) => {
    document.getElementById(id).disabled = !canNavs[i];
  });
}

function showGameResult() {
  const { black, white } = countStones(board);

  const bName = scBlackName.textContent;
  const wName = scWhiteName.textContent;

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
  endgameEl.textContent = `最終結果：⚫ ${black} - ⚪ ${white}（${stoneResult}）`;
}

// ===== SETTINGS & UI =====

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

function toggleMoveNumbers() {
  showMoveNumbers = !showMoveNumbers;
  localStorage.setItem(STORAGE_KEYS.SHOW_NUMBERS, showMoveNumbers);
  document.getElementById('num-toggle').textContent = showMoveNumbers ? '着手順を隠す' : '着手順を表示';
  drawBoard();
}

function setSolverDepth(val) {
  const n = Math.min(24, Math.max(6, parseInt(val) || DEFAULT_SOLVER_DEPTH));
  document.getElementById('solver-depth').value = n;
  const warningEl = document.getElementById('depth-warning');
  if (n !== solverDepth) {
    if (n > DEFAULT_SOLVER_DEPTH) {
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
  localStorage.setItem(STORAGE_KEYS.SOLVER_DEPTH, n);
  drawBoard();
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

function loadFromURL() {
  const params = new URLSearchParams(window.location.search);
  const pBlack = params.get("black");
  const pWhite = params.get("white");
  blackName = pBlack || "黒";
  whiteName = pWhite || "白";
  if (pBlack) document.getElementById("black-name-input").value = pBlack;
  if (pWhite) document.getElementById("white-name-input").value = pWhite;
  const kifu = params.get("kifu");
  if (!kifu) return;
  document.getElementById("kifu-input").value = kifu;
  referenceKifu = [];
  for (let i = 0; i + 1 < kifu.length; i += 2)
    referenceKifu.push(coordToXY(kifu.substring(i, i + 2)));
  kifuToMoves(kifu);
  saveReferenceKifu();
}

function copyCurrentKifu() {
  const val = document.getElementById("current-kifu").value;
  navigator.clipboard.writeText(val);
}

function copyShareURL() {
  const kifu = movesToKifuString(moveHistory.slice(0, currentMove));
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
    clearTimeout(_urlCopyTimer);
    _urlCopyTimer = setTimeout(() => { msg.style.display = "none"; }, 2000);
  });
}

// ===== INITIALIZATION =====

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
(function() {
  const btn = document.getElementById('opening-guide-btn');
  if (btn) btn.classList.toggle('active', showOpenings);
})();

function updateOpeningDisplay() {
  const el = document.getElementById("opening-name");
  if (!el) return;
  el.innerHTML = '';
  if (!showOpenings) return;
  const matches = getMatchingOpenings(moveHistory.slice(0, currentMove));
  matches.forEach(name => {
    const badge = document.createElement('span');
    badge.className = 'opening-badge';
    badge.style.backgroundColor = OPENING_COLORS[name];
    badge.textContent = name;
    el.appendChild(badge);
  });
}

function toggleOpenings() {
  showOpenings = !showOpenings;
  localStorage.setItem(STORAGE_KEYS.SHOW_OPENINGS, showOpenings);
  const btn = document.getElementById('opening-guide-btn');
  if (btn) btn.classList.toggle('active', showOpenings);
  drawBoard();
}

// パネルの開閉状態を保持
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
