// ===== AI STATUS & ENDGAME DISPLAY =====
// solver.js から移動: UI 操作を伴うため ui.js で管理する

// AI ステータス表示を更新する
function setAiStatus(text, color) {
  const el = document.getElementById('ai-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = color || '';
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
const scMove       = document.getElementById("sc-move");
const scBlackName  = document.getElementById("sc-black-name");
const scWhiteName  = document.getElementById("sc-white-name");
const balanceBar   = document.getElementById("balance-bar");
const endgameEl    = document.getElementById("endgame");

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
      cell.className   = "cell";
      cell.dataset.pos = `${x},${y}`;
      cell.onclick     = boardEditMode ? () => handleEditCellClick(x, y) : () => playMove(x, y);
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
        const hint      = document.createElement("div");
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

// ===== SCORE DISPLAY =====

// スコアパネル（石数・バランスバー・名前）を更新し、空マス数を返す
function updateStoneDisplay() {
  const { black, white, empty } = countStones(board);
  scBlack.textContent     = black;
  scWhite.textContent     = white;
  scEmpty.textContent     = empty;
  scMove.textContent      = currentMove;
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

// 終局時の最終結果を info と endgame 要素に表示する
function showGameResult() {
  const { black, white } = countStones(board);
  const bName = scBlackName.textContent;
  const wName = scWhiteName.textContent;

  if (black > white)      info.textContent = `⚫ ${bName} の勝ち！`;
  else if (white > black) info.textContent = `⚪ ${wName} の勝ち！`;
  else                    info.textContent = `⚫⚪ 引き分け！`;

  let stoneResult;
  if (black > white)      stoneResult = `黒の ${black - white} 石勝ち`;
  else if (white > black) stoneResult = `白の ${white - black} 石勝ち`;
  else                    stoneResult = `引き分け`;

  endgameEl.textContent = `最終結果：⚫ ${black} - ⚪ ${white}（${stoneResult}）`;
}

// ===== SOLVER =====

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

  const validMoves     = getValidMoves(currentPlayer);
  const validSet       = new Set(validMoves.map(([x, y]) => `${x},${y}`));
  const lastMove       = currentMove > 0 ? moveHistory[currentMove - 1] : null;
  const nextRefKey     = computeNextRefKey();
  const moveNumMap     = buildMoveNumMap();
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
  const snapGameOver  = blackMoves.length === 0 && whiteMoves.length === 0;
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

  // AI対局モード: AI の手番なら着手をスケジュールする（game-ai.js で定義）
  if (typeof scheduleAIMoveIfNeeded === 'function') scheduleAIMoveIfNeeded();
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
