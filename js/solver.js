// ===== SOLVER STATE =====

let solverDepth = parseInt(localStorage.getItem(STORAGE_KEYS.SOLVER_DEPTH) || String(DEFAULT_SOLVER_DEPTH));

// ソルバーの実行状態をひとまとめに管理するオブジェクト
const solverState = {
  cancelFlag: false, // 全読みキャンセル用フラグ（drawBoard 時に true にして中断する）
  result:     '',    // 現局面の全読み結果テキスト
  pending:    false, // ソルバーが結果を出す前は true（endgame 表示を保留するために使用）
  score:      null,  // 全読み確定スコア（黒視点）。null=未確定
};

// ===== BITBOARD CONSTANTS =====
// ビット配置: bit(y*8+x) → 座標(x,y)  例: a1=bit0, h1=bit7, a8=bit56, h8=bit63

const BB_ALL   = 0xFFFFFFFFFFFFFFFFn;
const BB_NOT_A = 0xFEFEFEFEFEFEFEFEn; // a列を除くマスク（左シフト後のh→aラップ防止）
const BB_NOT_H = 0x7F7F7F7F7F7F7F7Fn; // h列を除くマスク（右シフト後のa→hラップ防止）

// 1bit(1n<<i) から i へ変換する逆引きテーブル
const BB_POS = new Map();
for (let i = 0; i < 64; i++) BB_POS.set(1n << BigInt(i), i);

// 着手順の重みテーブル: コーナー優先、X/Cマス後回し（alpha-beta の手順改善用）
const BB_MOVE_WEIGHT = (() => {
  const w = new Array(64).fill(2);
  [0, 7, 56, 63].forEach(i => w[i] = 10);         // コーナー
  [9, 14, 49, 54].forEach(i => w[i] = -2);         // Xマス
  [1,6,8,15,48,55,57,62].forEach(i => w[i] = -1);  // Cマス
  return w;
})();

// ===== BITBOARD SOLVER =====

// player が置ける合法手のビットボードを返す
function bbMoves(player, opponent) {
  const empty = ~(player | opponent) & BB_ALL;
  let moves = 0n;

  // 8方向ごとに「挟んだ相手石の先」が空マスなら合法手
  const dirs = [
    { shift:  1n, mask: BB_NOT_A }, // E
    { shift: -1n, mask: BB_NOT_H }, // W
    { shift:  8n, mask: BB_ALL   }, // S
    { shift: -8n, mask: BB_ALL   }, // N
    { shift:  9n, mask: BB_NOT_A }, // SE
    { shift: -9n, mask: BB_NOT_H }, // NW
    { shift:  7n, mask: BB_NOT_H }, // SW
    { shift: -7n, mask: BB_NOT_A }, // NE
  ];

  for (const { shift, mask } of dirs) {
    let t;
    if (shift > 0n) {
      t = ((player << shift) & mask) & opponent;
      // 最大6枚挟みうるので6回伸ばす
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

// ビットボード b のポップカウント（立っているビット数）を返す
function bbPopcount(b) { let n = 0; while (b) { b &= b - 1n; n++; } return n; }

// moves ビットボードから { pos, lsb, w } の配列を重み降順で返す（alpha-beta の手順改善用）
function bbBuildMoveList(moves) {
  const moveList = [];
  let m = moves;
  while (m) {
    const lsb = m & -m;
    m ^= lsb;
    const pos = BB_POS.get(lsb);
    moveList.push({ pos, lsb, w: BB_MOVE_WEIGHT[pos] });
  }
  moveList.sort((a, b) => b.w - a.w);
  return moveList;
}

// alpha-beta 探索（内部再帰用・スコアのみを返す）
function bbSolve(blackBB, whiteBB, blackToMove, alpha, beta) {
  if (solverState.cancelFlag) throw 'solver_cancelled';
  const player   = blackToMove ? blackBB : whiteBB;
  const opponent = blackToMove ? whiteBB : blackBB;
  let moves = bbMoves(player, opponent);
  if (!moves) {
    // 合法手なし → 相手も無ければ終局、あればパス
    if (!bbMoves(opponent, player))
      return bbPopcount(blackBB) - bbPopcount(whiteBB);
    return bbSolve(blackBB, whiteBB, !blackToMove, alpha, beta);
  }

  const moveList = bbBuildMoveList(moves);
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
    if (alpha >= beta) break; // カット
  }
  return best;
}

// トップレベルラッパー: 最善手の位置と最善スコアも返す
function bbSolveTop(blackBB, whiteBB, blackToMove) {
  const player   = blackToMove ? blackBB : whiteBB;
  const opponent = blackToMove ? whiteBB : blackBB;
  const moves = bbMoves(player, opponent);
  if (!moves) {
    return { score: bbPopcount(blackBB) - bbPopcount(whiteBB), bestPos: -1, line: [] };
  }

  const moveList = bbBuildMoveList(moves);
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

  // 最善スコアを維持する手順列を再構成（狭いウィンドウで高速化）
  const line = bbExtractLine(blackBB, whiteBB, blackToMove, best);
  return { score: best, bestPos, line };
}

// 最善スコアを維持する手を辿り、最善手順列を返す
function bbExtractLine(blackBB, whiteBB, blackToMove, targetScore) {
  const line = [];
  let bBB = blackBB, wBB = whiteBB, btm = blackToMove;
  for (;;) {
    const pl = btm ? bBB : wBB;
    const op = btm ? wBB : bBB;
    const mvs = bbMoves(pl, op);
    if (!mvs) {
      if (!bbMoves(op, pl)) break; // 終局
      btm = !btm;                  // パス
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
let evalCache = [];     // 初期局面から各手数まで評価値（黒視点の予測石差）
let evalKifu  = '';     // evalCache を計算した棋譜キー（重複計算を防ぐ）
let evalLevel = parseInt(localStorage.getItem(STORAGE_KEYS.EVAL_LEVEL) || '8');
let showMoveEvals = localStorage.getItem(STORAGE_KEYS.SHOW_MOVE_EVALS) === 'true';
let moveEvalGeneration = 0; // drawBoard のたびに更新し、古い評価タスクを破棄するための世代番号

// Egaroucid WASM の初期化完了時に呼ばれるコールバック
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
      const atEnd = savedBranches.some(b =>
        b.moves.length === currentMove &&
        b.moves.every((m, i) => m.x === moveHistory[i].x && m.y === moveHistory[i].y)
      );
      if (atEnd) computeMistakes();
    }
  } catch (e) {
    setAiStatus('AI読み込み失敗', '#dc3545');
    console.error('Egaroucid init failed:', e);
  }
}

// 盤面 b を WASM 形式の Int32Array に変換し HEAP に書き込んで ptr を返す
// 呼び出し元は使用後に必ず _free(ptr) を呼ぶこと
function encodeBoard(b) {
  const res = new Int32Array(64);
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const v = b[y][x];
      res[y * 8 + x] = v === 1 ? 0 : v === -1 ? 1 : -1;
    }
  const ptr = _malloc(64 * 4);
  HEAP32.set(res, ptr >> 2);
  return ptr;
}

// _ai_js の戻り値をデコードして { mx, my, score_raw } を返す
function decodeWasmResult(val) {
  const my = Math.floor(val / 8000);
  const mx = Math.floor((val - my * 8000) / 1000);
  const score_raw = val - my * 8000 - mx * 1000 - 100;
  return { mx, my, score_raw };
}

// 盤面を WASM に渡して評価値（黒視点の予測石差: +で黒有利 / −で白有利）を返す
function evaluatePosition(b, player, level = evalLevel) {
  let black = 0, white = 0, empty = 0;
  for (let r = 0; r < 8; r++)
    for (let c = 0; c < 8; c++) {
      if (b[r][c] ===  1) black++;
      else if (b[r][c] === -1) white++;
      else empty++;
    }
  // ゲーム終了（空マスなし）はそのまま実石差を返す
  if (empty === 0) return black - white;

  const wasmPlayer = player === 1 ? 0 : 1;
  const ptr = encodeBoard(b);
  const val = _ai_js(ptr, level, wasmPlayer);
  _free(ptr);

  const { score_raw } = decodeWasmResult(val);
  // 黒視点に正規化（白番なら符号反転）
  return wasmPlayer === 0 ? score_raw : -score_raw;
}

// moveHistory を先頭から再生しながら各局面を評価してグラフ用キャッシュを更新する
function computeAllEvals() {
  if (!egaroucidReady) return;
  const kifuKey = moveHistory.map(m => `${m.x},${m.y}`).join('|');
  if (kifuKey === evalKifu && evalCache.length > 0) return; // 同一棋譜はスキップ
  evalKifu = kifuKey;
  evalCache = [];

  // カスタム盤面が設定されている場合はその盤面・手番を起点にする
  let b  = customBoardStart ? customBoardStart.board.map(r => [...r]) : createInitialBoard();
  let cp = customBoardStart ? customBoardStart.turn : 1;
  evalCache.push(evaluatePosition(b, cp)); // 起点局面の評価値

  for (const m of moveHistory) {
    b  = applyBoardMove(b, m.x, m.y, m.player);
    cp = -m.player;
    evalCache.push(evaluatePosition(b, cp));
  }

  updateScoreGraph();
}

// WASM に盤面を渡して最善手と評価値を取得する（黒視点スコア）
// level は残り手数に合わせて呼び出し側でスケールする（20手=10, 24手=21）
function wasmBestMove(b, pl, level) {
  const wp  = pl === 1 ? 0 : 1;
  const ptr = encodeBoard(b);
  const val = _ai_js(ptr, level ?? 10, wp);
  _free(ptr);
  const { mx, my, score_raw } = decodeWasmResult(val);
  return { mx, my, score: wp === 0 ? score_raw : -score_raw };
}

// 残り手数から solve レベルを決める。
// Egaroucid の level N は「残り N 手以下で完全読みに切り替える」に対応するため、
// level < empty だと先頭の数手がヒューリスティックになり結果が不正確になる。
// そのため level = max(empty, 21) を渡して常に完全読みを保証する。
// （solverDepth が 21 超に設定されている場合はそのまま empty を使う）
function solveLevel(empty) {
  return Math.max(empty, 21);
}

// WASM で終盤全読みし { score, bestPos, line } を返す
function egaroucidSolveTop(boardIn, player, empty) {
  const lv = solveLevel(empty ?? 20);
  const { mx, my } = wasmBestMove(boardIn, player, lv);
  const bestPos = my * 8 + mx;

  // 両者最善手を辿って最善手順列を構築する
  const line = [];
  let b = boardIn.map(r => [...r]);
  let cp = player;
  for (;;) {
    if (!hasAnyMove(b, cp)) {
      if (!hasAnyMove(b, -cp)) break; // 両者とも合法手なし → 終局
      cp = -cp;                        // パス：手番だけ交代して継続
      continue;
    }
    const { mx: lx, my: ly } = wasmBestMove(b, cp, lv);
    line.push({ x: lx, y: ly });
    b  = applyBoardMove(b, lx, ly, cp);
    cp = -cp;
  }

  // line を最後まで打ち切った盤面から実際の石数を数えてスコアを確定する。
  // wasmBestMove の返す score はヒューリスティック推定値でズレることがあるため使わない。
  const { black: actB, white: actW, empty: actE } = countStones(b);
  let finalB = actB, finalW = actW;
  // 空マスは勝者に加算（日本ルール）
  if (finalB > finalW) finalB += actE;
  else if (finalW > finalB) finalW += actE;

  return { score: finalB - finalW, bestPos, line };
}

// ===== EVALUATION DISPLAY HELPERS =====

// スコアを7段階の色に変換（黒視点: +で黒寄り / −で白寄り）
// 0 / ±1〜5 / ±6〜10 / ±11〜 の4段階
function evalScoreColor(score) {
  const a = Math.abs(score);
  const tier = a === 0 ? 0 : a <= 5 ? 1 : a <= 10 ? 2 : 3;
  const blackPalette = ['#c0c0c0', '#909090', '#505050', '#101010'];
  const whitePalette = ['#c0c0c0', '#dedede', '#f0f0f0', '#ffffff'];
  return score >= 0 ? blackPalette[tier] : whitePalette[tier];
}

// 指定マスに打った後の局面を Egaroucid で評価して黒視点スコアを返す
function evaluateMove(x, y) {
  const b = applyBoardMove(board, x, y, currentPlayer);
  const { empty } = countStones(b);
  const level = empty < 12 ? empty : evalLevel;
  return evaluatePosition(b, -currentPlayer, level);
}

// 候補手の評価値を1手ずつ非同期で計算してDOMに書き込む
// rAF で1フレーム描画を確実に挟んでから計算開始（iOS 対応）
function scheduleMoveEvals(validMoves, gen, onComplete) {
  if (!showMoveEvals || !egaroucidReady || validMoves.length === 0) {
    if (onComplete) setTimeout(onComplete, 0);
    return;
  }
  let idx = 0;
  function next() {
    if (gen !== moveEvalGeneration) return; // 世代が変わったらキャンセル（onComplete も呼ばない）
    if (idx >= validMoves.length) { if (onComplete) onComplete(); return; }
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

// 評価レベルを変更してグラフを再計算する
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

// 候補手の評価値表示を切り替える
function toggleMoveEvals() {
  showMoveEvals = !showMoveEvals;
  localStorage.setItem(STORAGE_KEYS.SHOW_MOVE_EVALS, showMoveEvals);
  const btn = document.getElementById('move-eval-toggle');
  if (btn) btn.textContent = showMoveEvals ? '評価値を隠す' : '候補手評価';
  drawBoard();
}
