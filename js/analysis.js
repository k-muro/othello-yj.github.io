// ===== MISTAKE ANALYSIS STATE =====

let mistakeCache    = [];        // [{moveIdx, dev, loss}]  dev < 0 = 平均より悪い手
let mistakeCacheKifu = '';       // mistakeCache を計算した棋譜キー
let mistakeCacheMap  = new Map(); // kifuKey -> mistakeCache（分岐ごとにキャッシュ）
let mistakeGeneration = 0;       // computeMistakes の世代番号（古いタスクを破棄）
let showMistakeList   = false;
let graphMode = localStorage.getItem(STORAGE_KEYS.GRAPH_MODE) || 'ai'; // 'ai' | 'stone'
let scoreChart = null;

// ===== MISTAKE ANALYSIS =====

// 悪手リストの表示/非表示を切り替える
function toggleMistakeList() {
  showMistakeList = !showMistakeList;
  const btn = document.getElementById('mistake-analyze-btn');
  if (btn) btn.textContent = showMistakeList ? '悪手を隠す' : '悪手表示';
  renderMistakeList();
  updateScoreGraph();
}

// moveHistory 全手を非同期で評価して mistakeCache を構築する
// 1回の setTimeout で1手ずつ処理し UI をブロックしない
function computeMistakes() {
  if (!egaroucidReady) return;
  const kifuKey = moveHistory.map(m => `${m.x},${m.y}`).join('|');
  if (kifuKey === mistakeCacheKifu && mistakeCache.length > 0) return; // 同一棋譜はスキップ
  // 別の分岐で計算済みなら即座に適用
  if (mistakeCacheMap.has(kifuKey)) {
    mistakeCache     = mistakeCacheMap.get(kifuKey);
    mistakeCacheKifu = kifuKey;
    setTimeout(() => { renderMistakeList(); updateScoreGraph(); }, 0);
    return;
  }
  mistakeCacheKifu = kifuKey;
  mistakeCache     = [];
  const gen = ++mistakeGeneration;

  let boardState = createInitialBoard();
  let cp = 1;
  let idx = 0;
  let validMoves = null; // 現在局面の合法手リスト
  let scores     = [];   // 現在局面の各合法手評価値リスト
  let evalIdx    = 0;    // 現在局面で何手目まで評価したか

  function processNext() {
    if (gen !== mistakeGeneration) return; // キャンセル

    // 新しい局面の初期化
    if (validMoves === null) {
      if (idx >= moveHistory.length) {
        // 全手の評価完了 → キャッシュ保存してレンダリング
        mistakeCacheMap.set(kifuKey, [...mistakeCache]);
        renderMistakeList();
        updateScoreGraph();
        return;
      }
      validMoves = getValidMovesOnBoard(boardState, cp);
      scores  = [];
      evalIdx = 0;
      // 合法手が1手以下なら評価不要 → 着手して次へ
      if (validMoves.length <= 1) {
        boardState = applyBoardMove(boardState, moveHistory[idx].x, moveHistory[idx].y, cp);
        cp = -cp;
        if (!hasAnyMove(boardState, cp) && hasAnyMove(boardState, -cp)) cp = -cp;
        idx++;
        validMoves = null;
        setTimeout(processNext, 0);
        return;
      }
    }

    // 現局面の合法手を1手ずつ評価
    if (evalIdx < validMoves.length) {
      const [x, y] = validMoves[evalIdx++];
      const nb = applyBoardMove(boardState, x, y, cp);
      const { empty } = countStones(nb);
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
    boardState = applyBoardMove(boardState, m.x, m.y, cp);
    cp = -cp;
    if (!hasAnyMove(boardState, cp) && hasAnyMove(boardState, -cp)) cp = -cp;
    idx++;
    validMoves = null;
    setTimeout(processNext, 0);
  }

  requestAnimationFrame(processNext);
}

// リストとグラフで共通して使う「表示対象の悪手セット」を返す（moveIdx → entry の Map）
function getShownMistakeSet() {
  const toShow = [...mistakeCache]
    .sort((a, b) => a.dev - b.dev)
    .slice(0, MAX_SHOWN_MISTAKES)
    .filter(e => e.loss >= MIN_LOSS_FOR_MISTAKE);
  return new Map(toShow.map(e => [e.moveIdx, e]));
}

// moveIdx の手が悪手かどうかを返す。該当しない場合は null。
function getMistakeInfo(moveIdx) {
  const map   = getShownMistakeSet();
  const entry = map.get(moveIdx);
  if (!entry) return null;
  if (entry.loss >= BLUNDER_THRESHOLD) return { loss: entry.loss, label: '×', cls: 'mistake-blunder', graphRadius: 5 };
  return { loss: entry.loss, label: '△', cls: 'mistake-mistake', graphRadius: 4 };
}

// ===== MISTAKE LIST RENDERING =====

// 悪手バッジ要素を生成する
function _makeMistakeBadge({ moveIdx, loss }) {
  const m = moveHistory[moveIdx];
  if (!m) return null;
  const coord = String.fromCharCode(97 + m.x) + (m.y + 1);
  const cls   = loss >= BLUNDER_THRESHOLD ? 'mistake-blunder' : 'mistake-mistake';
  const label = loss >= BLUNDER_THRESHOLD ? ' ×' : ' △';
  const badge = document.createElement('span');
  badge.className   = `mistake-badge ${cls}`;
  badge.textContent = `${moveIdx + 1}手 ${coord}${label}`;
  badge.title       = `最善手との差: ${loss.toFixed(1)}`;
  badge.onclick     = () => { currentMove = moveIdx; rebuildBoard(); };
  return badge;
}

// アイコン付きの悪手行（⚫/⚪）を生成する
function _makeMistakeLine(icon, entries) {
  const row = document.createElement('div');
  row.className = 'd-flex flex-wrap align-items-center gap-1';
  const lbl = document.createElement('span');
  lbl.className   = 'text-secondary graph-caption';
  lbl.textContent = `${icon}悪手:`;
  row.appendChild(lbl);
  entries.forEach(e => { const b = _makeMistakeBadge(e); if (b) row.appendChild(b); });
  return row;
}

// 悪手リストを DOM に描画する
function renderMistakeList() {
  const el = document.getElementById('mistake-list');
  if (!el) return;
  if (!showMistakeList || !egaroucidReady || mistakeCache.length === 0) { el.innerHTML = ''; return; }

  const toShow = [...getShownMistakeSet().values()].sort((a, b) => a.moveIdx - b.moveIdx);
  const blackMistakes = toShow.filter(e => moveHistory[e.moveIdx]?.player ===  1);
  const whiteMistakes = toShow.filter(e => moveHistory[e.moveIdx]?.player === -1);

  el.innerHTML = '';
  el.appendChild(_makeMistakeLine('⚫', blackMistakes));
  el.appendChild(_makeMistakeLine('⚪', whiteMistakes));
}

// ===== SCORE GRAPH =====

const GRAPH_MAX = 61; // グラフのX軸固定幅: 開始(0) + 最大60手

// グラフモードを切り替える（'ai' ↔ 'stone'）
function toggleGraphMode() {
  graphMode = graphMode === 'ai' ? 'stone' : 'ai';
  localStorage.setItem(STORAGE_KEYS.GRAPH_MODE, graphMode);
  updateScoreGraph();
}

// graphMode が 'ai' かつ AI 評価値が利用可能かを返す
function isUsingAI() {
  return graphMode === 'ai' && egaroucidReady && evalCache.length > 0;
}

// AI評価値または石差からグラフデータ（labels, diffs）を構築して返す
function buildGraphData(useAI) {
  if (useAI) {
    return {
      labels: evalCache.map((_, i) => i === 0 ? '開始' : String(i)),
      diffs:  [...evalCache], // evalCache を直接使わずコピーする（パディング時の汚染防止）
    };
  }
  // 石差モード or AI 未準備: 実石数差を計算
  let b = createInitialBoard();
  const labels = ['開始'], diffs = [0];
  for (const m of moveHistory) {
    b = applyBoardMove(b, m.x, m.y, m.player);
    const { black, white } = countStones(b);
    labels.push(String(diffs.length));
    diffs.push(black - white);
  }
  return { labels, diffs };
}

// labels/diffs を GRAPH_MAX 個になるまで null でパディングする（破壊的）
function padGraphData(labels, diffs) {
  while (labels.length < GRAPH_MAX) {
    labels.push(String(labels.length));
    diffs.push(null);
  }
}

// グラフモード切替ボタンのテキストと活性状態を更新する
function updateGraphModeButton(useAI) {
  const btn = document.getElementById('graph-mode-btn');
  if (!btn) return;
  btn.textContent = useAI ? '石差の推移' : '予測石差';
  btn.disabled    = graphMode === 'ai' && !egaroucidReady;
}

// グラフのキャプションテキストを更新する
function updateGraphCaption(useAI) {
  const caption = document.querySelector('.graph-caption');
  if (!caption) return;
  caption.innerHTML = useAI
    ? '<a href="https://www.egaroucid.nyanyan.dev/ja/web/" target="_blank" rel="noopener" class="text-secondary">Egaroucid</a> 予測石差（⚫+ / ⚪−）'
    : '石差の推移（⚫+ / ⚪−）';
}

// 各データ点のスタイル（形・半径・色）を計算して返す
function buildPointStyles(diffs, mistakeMap, lineCol) {
  const pointStyle = diffs.map((_, i) => {
    if (i > 0 && mistakeMap.has(i - 1)) return 'rect';
    return 'circle';
  });
  const pointRadius = diffs.map((_, i) => {
    if (i === currentMove) return 5;
    if (i > 0) {
      const e = mistakeMap.get(i - 1);
      if (e) return e.loss >= BLUNDER_THRESHOLD ? 5 : 4;
    }
    return 0;
  });
  const pointBackgroundColor = diffs.map((_, i) => {
    if (i === currentMove) return '#22c55e';
    if (i > 0) {
      const e = mistakeMap.get(i - 1);
      if (e) {
        const isBlack = moveHistory[i - 1]?.player === 1;
        // 黒の悪手: 赤系 / 白の悪手: 紫〜青系
        if (e.loss >= BLUNDER_THRESHOLD) return isBlack ? '#dc2626' : '#7c3aed';
        return isBlack ? '#f97316' : '#3b82f6';
      }
    }
    return lineCol;
  });
  return { pointStyle, pointRadius, pointBackgroundColor };
}

// y軸に ⚫/⚪ マーカーを描画するカスタムプラグイン
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

// グラフ（Chart.js）を初期化する（ページ読み込み時に1回呼ぶ）
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
          // index 0: メインデータ（AI評価値 or 石差）
          data: [],
          borderWidth: 1.5,
          fill: false,
          tension: 0.15,
          spanGaps: false,     // null 区間で線を切断する
          pointRadius: [],
          pointBackgroundColor: [],
          pointHoverRadius: 5,
          pointHitRadius: 10,
        },
        {
          // index 1: ±0 参照線（破線）
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
          // ゼロ線と null 空白はツールチップを表示しない
          filter: (item) => item.datasetIndex === 0 && item.raw !== null,
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
          suggestedMax:  10,
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

// グラフのデータとスタイルを更新する（描画モード変更・手順変化のたびに呼ぶ）
function updateScoreGraph() {
  if (!scoreChart) return;
  const isDark  = document.documentElement.getAttribute('data-bs-theme') === 'dark';
  const lineCol = isDark ? '#9a9a9a' : '#444';
  const useAI   = isUsingAI();

  updateGraphModeButton(useAI);

  // グラフデータを構築してパディング
  const { labels, diffs } = buildGraphData(useAI);
  padGraphData(labels, diffs);

  updateGraphCaption(useAI);

  // 悪手マーカー用の mistakeMap を取得（表示中の場合のみ）
  const useMistakes = useAI && evalCache.length > 1 && showMistakeList;
  const mistakeMap  = useMistakes ? getShownMistakeSet() : new Map();
  const { pointStyle, pointRadius, pointBackgroundColor } = buildPointStyles(diffs, mistakeMap, lineCol);

  // dataset[0]: メインライン
  const ds = scoreChart.data.datasets[0];
  scoreChart.data.labels  = labels;
  ds.data                 = diffs;
  ds.borderColor          = lineCol;
  ds.pointStyle           = pointStyle;
  ds.pointRadius          = pointRadius;
  ds.pointBackgroundColor = pointBackgroundColor;

  // dataset[1]: ±0 参照線（常に GRAPH_MAX 個の 0）
  const zeroDs       = scoreChart.data.datasets[1];
  zeroDs.data        = new Array(GRAPH_MAX).fill(0);
  zeroDs.borderColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.35)';

  scoreChart.update();
  renderMistakeList();
  updateEndgameEl();
}
