// ===== BRANCH TREE STATE =====

let savedBranches       = []; // 分岐ツリー（セッション内のみ、最大5手順）
let _branchPaddingCache = new Map(); // bi -> paddingLeft（フリッカー防止用）

// ===== BRANCH TREE CRUD =====

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
  s.className   = cls;
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
    del.className   = 'btn btn-outline-danger btn-sm tree-del-btn';
    del.textContent = '×';
    del.title       = 'この手順を削除';
    del.onclick     = e => { e.stopPropagation(); deleteBranch(bi); };
    line.appendChild(del);
  }
}

// ===== BRANCH TREE RENDERING =====

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

  const curPath  = moveHistory.slice(0, currentMove).map(m => `${m.x},${m.y}`);
  const refIdx   = savedBranches.findIndex(b => b.isRef);
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
    const isLast      = listIdx === nonRefIdxs.length - 1;
    const { moves }   = savedBranches[bi];
    const startIdx    = divIdxMap.has(bi) ? divIdxMap.get(bi) : 0;
    const branchPairs = moves.slice(startIdx).map((m, j) => ({ move: m, gameIdx: startIdx + j }));

    const pinIdxs = new Set();
    if (currentMove > startIdx && currentMove <= moves.length &&
        moves.slice(0, currentMove).every((m, i) => curPath[i] === `${m.x},${m.y}`)) {
      pinIdxs.add(currentMove - 1 - startIdx);
    }

    const line = document.createElement('div');
    line.className        = 'tree-line clickable';
    line.title            = 'クリックでこの手順を読み込む';
    line.dataset.branchidx = bi;
    line.onclick          = () => loadBranch(bi);
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

// ===== BRANCH NAVIGATION =====

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
