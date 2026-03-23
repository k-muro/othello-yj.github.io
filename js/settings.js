// ===== SETTINGS STATE =====

let showOpenings    = localStorage.getItem(STORAGE_KEYS.SHOW_OPENINGS) === 'true';
let showBestMoveDot = localStorage.getItem(STORAGE_KEYS.SHOW_BEST_DOT) !== 'false'; // デフォルト表示

// URL コピー完了メッセージの非表示タイマー
let _urlCopyTimer = null;

// ===== PLAYER NAMES =====

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

// ===== DISPLAY TOGGLES =====

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

// ===== KIFU INPUT =====

// 棋譜入力フィールドの feedback 要素にメッセージを表示する
// type: 'error' | 'success' | '' (非表示)
function _showKifuFeedback(type, message) {
  const el = document.getElementById('kifu-feedback');
  el.textContent = message;
  el.className   = type === 'error'   ? 'small text-danger mt-1'
                 : type === 'success' ? 'small text-success mt-1'
                 : '';
}

// 棋譜入力フィールドの内容を盤面に反映する
function applyKifu() {
  const kifu  = document.getElementById("kifu-input").value.trim().toLowerCase();
  const error = validateKifu(kifu);

  if (error) {
    // バリデーション失敗: エラー内容を表示して処理を中断
    const where = error.moveNum != null
      ? `${error.moveNum}手目 "${error.coord}": `
      : '';
    _showKifuFeedback('error', `⚠ ${where}${error.reason}`);
    return;
  }

  // バリデーション成功: 盤面に反映
  _showKifuFeedback('success', `✓ ${kifu.length / 2}手を反映しました`);
  customBoardStart = null; // 標準開始局面に戻る
  referenceKifu = [];
  for (let i = 0; i + 1 < kifu.length; i += 2)
    referenceKifu.push(coordToXY(kifu.substring(i, i + 2)));
  kifuToMoves(kifu);
  saveReferenceKifu();
  drawBoard();
}

// ===== URL SHARING =====

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
    moveHistory   = [];
    currentMove   = 0;
    currentPlayer = turn;
    evalCache     = [];
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
    badge.className             = 'opening-badge';
    badge.style.backgroundColor = OPENING_COLORS[name];
    badge.textContent           = name;
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

// ===== BOARD THEME =====

// 盤面テーマを切り替える（#board のインラインCSS変数を直接書き換え）
function setBoardTheme(name) {
  const boardEl   = document.getElementById('board');
  const themeName = BOARD_THEMES[name] ? name : 'green'; // 未知のテーマはgreenにフォールバック
  // テーマ名を属性として持たせ、CSS でテーマ別スタイルを適用できるようにする
  boardEl.dataset.boardTheme = themeName;
  // ミニ石などボード外の要素でもテーマを参照できるよう body にも伝播する
  document.body.dataset.boardTheme = themeName;
  localStorage.setItem(STORAGE_KEYS.BOARD_THEME, themeName);
}

// ===== INITIALIZATION =====

initBoard();
loadFromURL();

// 保存済みの設定を UI に反映する
document.getElementById('solver-depth').value = solverDepth;
if (showMoveNumbers) document.getElementById('num-toggle').textContent       = '着手順を隠す';
if (showMoveEvals)   document.getElementById('move-eval-toggle').textContent = '評価値を隠す';

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
