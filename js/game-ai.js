// ===== AI GAME STATE =====

let isPlayingVsAI = false; // 対局モード中かどうか
let aiPlayer      = -1;    // AI の手番（1=黒, -1=白）
let _aiMoveTimer  = null;  // AI 着手スケジュールタイマー

// ===== AI GAME CONTROL =====

// 現在の局面から対局を開始する（userColor: 1=黒, -1=白 でユーザーの手番を指定）
function startAIGame(userColor) {
  aiPlayer      = -userColor;
  isPlayingVsAI = true;
  drawBoard(); // drawBoard 末尾の scheduleAIMoveIfNeeded が AI 先手を処理する
}

// 対局モードを解除して解析モードに戻る（棋譜・盤面は保持）
function stopAIGame() {
  clearTimeout(_aiMoveTimer);
  isPlayingVsAI = false;
  drawBoard();
}

// 投了する（確認ダイアログ → 対局終了・棋譜保持）
function resignVsAI() {
  if (!confirm('投了しますか？')) return;
  const userPlayer = -aiPlayer;
  clearTimeout(_aiMoveTimer);
  isPlayingVsAI = false;
  drawBoard();
  // drawBoard が info を上書きするため、同期処理完了後に投了メッセージを設定する
  document.getElementById('info').textContent =
    userPlayer === 1 ? '⚫ 黒の投了' : '⚪ 白の投了';
}

// ===== AI MOVE =====

// drawBoard の末尾から呼ばれる: AI の手番なら着手をスケジュールする
function scheduleAIMoveIfNeeded() {
  clearTimeout(_aiMoveTimer);
  _updateAIGameStatus(); // ステータスバーを描画のたびに同期する

  if (!isPlayingVsAI) return;

  // 終局検出: 対局モードを解除する（棋譜・表示はそのまま）
  if (checkGameEnd()) {
    isPlayingVsAI = false;
    _updateAIGameStatus();
    return;
  }

  if (currentPlayer !== aiPlayer) return;
  // 少し間を置いてから着手する（即時だと不自然なため）
  _aiMoveTimer = setTimeout(_executeAIMove, 400);
}

// AI が実際に着手する
function _executeAIMove() {
  if (!isPlayingVsAI || currentPlayer !== aiPlayer) return;

  if (!egaroucidReady) {
    // AI 未準備: 合法手からランダムにフォールバック
    const moves = getValidMoves(aiPlayer);
    if (moves.length === 0) return;
    const [x, y] = moves[Math.floor(Math.random() * moves.length)];
    playMove(x, y);
    return;
  }

  const { mx, my } = wasmBestMove(board, aiPlayer, evalLevel);
  if (mx >= 0 && my >= 0) playMove(mx, my);
}

// ===== UNDO =====

// 対局中の「待った」: AI の応手＋自分の直前手の2手をまとめて戻す
// 対局外では通常の1手戻しにフォールバックする
function undoVsAI() {
  if (!isPlayingVsAI) { undo(); return; }
  clearTimeout(_aiMoveTimer);
  // withSkipDraw で中間の drawBoard を抑制し、最後に1回だけ描画する
  withSkipDraw(() => {
    if (currentMove === 0) return;
    undo(); // 1手戻す（_skipDraw=true のため drawBoard はスキップ）
    // 戻した後も AI の手番なら（= 自分の手がまだ残っている）もう1手戻す
    if (currentMove > 0 && currentPlayer === aiPlayer) undo();
  });
}

// ===== UI =====

// 対局ステータスバーの表示内容を現在の状態に合わせて更新する
function _updateAIGameStatus() {
  const statusEl = document.getElementById('ai-game-status');
  if (!statusEl) return;

  if (!isPlayingVsAI) {
    statusEl.classList.add('d-none');
    return;
  }

  statusEl.classList.remove('d-none');
  const infoEl = document.getElementById('ai-game-info');
  if (!infoEl) return;

  const userPlayer = -aiPlayer;
  if (checkGameEnd()) {
    infoEl.textContent = '終局';
  } else if (currentPlayer === userPlayer) {
    infoEl.textContent = userPlayer === 1 ? 'あなたの番（⚫）' : 'あなたの番（⚪）';
  } else {
    infoEl.textContent = 'AI思考中…';
  }
}
