// ===== SOLVER STATE =====

let solverDepth = parseInt(localStorage.getItem(STORAGE_KEYS.SOLVER_DEPTH) || String(DEFAULT_SOLVER_DEPTH));

// ソルバーの状態をひとまとめに管理
const solverState = {
  cancelFlag: false, // 全読みキャンセル用フラグ
  result:     '',    // 現局面の全読み結果テキスト
  pending:    false, // ソルバーがまだ結果を出していない間 true
  score:      null,  // 全読み確定スコア（黒視点）。null=未確定
};

// ===== BITBOARD CONSTANTS =====

// ビット配置: bit(y*8+x) → 座標(x,y)  a1=bit0, h1=bit7, a8=bit56, h8=bit63
const BB_ALL   = 0xFFFFFFFFFFFFFFFFn;
const BB_NOT_A = 0xFEFEFEFEFEFEFEFEn; // 列aを除く（左シフト後のh→aラップ防止）
const BB_NOT_H = 0x7F7F7F7F7F7F7F7Fn; // 列hを除く（右シフト後のa→hラップ防止）

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

// ===== BITBOARD SOLVER =====

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

// アルファベータ探索（内部再帰用・score のみ返す）
function bbSolve(blackBB, whiteBB, blackToMove, alpha, beta) {
  if (solverState.cancelFlag) throw 'solver_cancelled';
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

// ===== EGAROUCID WASM INTEGRATION =====

let egaroucidReady = false;
let evalCache = [];
let evalKifu = '';
let evalLevel = parseInt(localStorage.getItem(STORAGE_KEYS.EVAL_LEVEL) || '8');
let showMoveEvals = localStorage.getItem(STORAGE_KEYS.SHOW_MOVE_EVALS) === 'true';
let moveEvalGeneration = 0; // drawBoard のたびに更新し、古い評価タスクを破棄

// 任意の盤面 b で player が合法手を持つか調べる純粋ヘルパー（グローバル board を使わない）
function hasAnyMove(b, pl) {
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      if (b[y][x] !== 0) continue;
      for (const [dx, dy] of DIRS) {
        let nx = x+dx, ny = y+dy;
        if (nx<0||nx>=8||ny<0||ny>=8||b[ny][nx]!==-pl) continue;
        nx+=dx; ny+=dy;
        while (nx>=0&&nx<8&&ny>=0&&ny<8&&b[ny][nx]===-pl){nx+=dx;ny+=dy;}
        if (nx>=0&&nx<8&&ny>=0&&ny<8&&b[ny][nx]===pl) return true;
      }
    }
  return false;
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

  let b = Array(8).fill().map(() => Array(8).fill(0));
  b[3][3] = -1; b[4][4] = -1; b[3][4] = 1; b[4][3] = 1;

  let cp = 1; // 手番 (1=黒, -1=白)
  evalCache.push(evaluatePosition(b, cp));

  for (const m of moveHistory) {
    b = applyBoardMove(b, m.x, m.y, m.player);
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
  // 最善手とスコアを取得
  const lv = solveLevel(empty ?? 20);
  const { mx, my, score } = wasmBestMove(boardIn, player, lv);
  const bestPos = my * 8 + mx;

  // 両者最善手を辿って手順列を構築
  const line = [];
  let b = boardIn.map(r => [...r]);
  let cp = player, passes = 0;
  for (;;) {
    if (!hasAnyMove(b, cp)) {
      if (!hasAnyMove(b, -cp)) break;
      cp = -cp;
      if (++passes > 1) break;
      continue;
    }
    passes = 0;
    const { mx: lx, my: ly } = wasmBestMove(b, cp, lv);
    line.push({ x: lx, y: ly });
    b = applyBoardMove(b, lx, ly, cp);
    cp = -cp;
  }

  // line を最後まで打ち切った盤面 b から実際の石数を数えてスコアを確定する。
  // wasmBestMove の返す score はヒューリスティック推定値でズレることがあるため使わない。
  let actB = 0, actW = 0, actE = 0;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      if (b[y][x] === 1) actB++;
      else if (b[y][x] === -1) actW++;
      else actE++;
    }
  // 空マスは勝者に加算（日本ルール）
  if (actB > actW) actB += actE;
  else if (actW > actB) actW += actE;
  const lineScore = actB - actW;

  return { score: lineScore, bestPos, line };
}

// ===== EVALUATION DISPLAY HELPERS =====

// スコアを7段階の色に変換（黒視点: +で黒寄り / −で白寄り）
// 0 / ±1~5 / ±6~10 / ±11~
function evalScoreColor(score) {
  const a = Math.abs(score);
  const tier = a === 0 ? 0 : a <= 5 ? 1 : a <= 10 ? 2 : 3;
  const blackPalette = ['#c0c0c0', '#909090', '#505050', '#101010'];
  const whitePalette = ['#c0c0c0', '#dedede', '#f0f0f0', '#ffffff'];
  return score >= 0 ? blackPalette[tier] : whitePalette[tier];
}

// 指定マスに打った後の局面をEgaroucidで評価（黒視点の予測石差: +で黒有利 / −で白有利）
function evaluateMove(x, y) {
  const b = applyBoardMove(board, x, y, currentPlayer);
  const { empty } = countStones(b);
  const level = empty < 12 ? empty : evalLevel;
  return evaluatePosition(b, -currentPlayer, level); // 黒視点スコア
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

// ===== EVAL LEVEL & MODE SETTINGS =====

function setEvalLevel(val) {
  const n = Math.min(15, Math.max(1, parseInt(val) || 5));
  evalLevel = n;
  localStorage.setItem(STORAGE_KEYS.EVAL_LEVEL, n);
  if (egaroucidReady) {
    evalKifu = ''; // キャッシュ無効化して再計算
    setAiStatus('計算中…', '#f97316');
    computeAllEvals();
  }
}

function toggleMoveEvals() {
  showMoveEvals = !showMoveEvals;
  localStorage.setItem(STORAGE_KEYS.SHOW_MOVE_EVALS, showMoveEvals);
  const btn = document.getElementById('move-eval-toggle');
  if (btn) btn.textContent = showMoveEvals ? '評価値を隠す' : '候補手の評価値';
  drawBoard();
}

// ===== ENDGAME DISPLAY =====

function _evalLabel() {
  const v = solverState.score !== null ? solverState.score
          : (egaroucidReady && currentMove < evalCache.length) ? evalCache[currentMove]
          : null;
  if (v === null) return '';
  const a = Math.abs(v), s = v >= 0 ? '+' : '';
  if (v === 0) return '互角';
  if (a < EVAL_ADVANTAGE_THRESHOLD) return v > 0 ? `黒有利(${s}${v})` : `白有利(${v})`;
  return v > 0 ? `黒勝勢(${s}${v})` : `白勝勢(${v})`;
}

function formatSolverResult(score) {
  if (score > 0)      return `黒が +${score} で勝ち`;
  else if (score < 0) return `白が +${Math.abs(score)} で勝ち`;
  else                return `引き分け`;
}

function updateEndgameEl(solverText) {
  if (solverText !== undefined) solverState.result = solverText;
  // ソルバーの結果が出るまで更新しない（緑枠を透明テキストで維持）
  if (solverState.pending) return;
  endgameEl.classList.remove('endgame-pending');
  const label = _evalLabel();
  const solving = solverState.result === '読み中…';
  if (!solving && label && solverState.result) {
    endgameEl.innerHTML = `${label}<br><span style="font-size:0.82em">${solverState.result}</span>`;
  } else {
    endgameEl.textContent = solving ? solverState.result : (solverState.result || label);
  }
}
