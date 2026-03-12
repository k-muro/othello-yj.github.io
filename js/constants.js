// ===== STORAGE KEYS =====
// localStorage に保存する各設定値のキー名を一元管理する
const STORAGE_KEYS = {
  SOLVER_DEPTH:    'othello-solver-depth',
  SHOW_NUMBERS:    'othello-show-numbers',
  GRAPH_MODE:      'othello-graph-mode',
  EVAL_LEVEL:      'othello-eval-level',
  SHOW_MOVE_EVALS: 'othello-show-move-evals',
  panel:           id => `othello-panel-${id}`,
  SHOW_OPENINGS:   'othello-show-openings',
  BOARD_THEME:     'othello-board-theme',
  SHOW_BEST_DOT:   'othello-show-best-dot',
};

// ===== NUMERIC CONSTANTS =====

const MAX_SAVED_BRANCHES       = 5;   // 保存できる手順の最大数
const DEFAULT_SOLVER_DEPTH     = 20;  // 全読み開始残り手数のデフォルト値
const EVAL_ADVANTAGE_THRESHOLD = 15;  // 「勝勢」と判定するスコア閾値
const MAX_SHOWN_MISTAKES       = 7;   // 悪手リストの最大表示件数
const MIN_LOSS_FOR_MISTAKE     = 6;   // 悪手と判定する最善手との差の下限
const BLUNDER_THRESHOLD        = 12;  // ブランダー（×）と判定する差の閾値

// ===== BOARD THEMES =====
// 盤面カラーテーマの定義（#board のインラインCSS変数として直接適用）
const BOARD_THEMES = {
  green:   { '--board-bg': '#1b3a2d', '--cell-bg': '#2d6a4f', '--cell-hover-bg': '#3a7d5e' },
  wood:    { '--board-bg': '#5c3a1e', '--cell-bg': '#8b6343', '--cell-hover-bg': '#9b7253' },
  blue:    { '--board-bg': '#060e18', '--cell-bg': '#2e6aaa', '--cell-hover-bg': '#3a7ec4' },
  dark:    { '--board-bg': '#5a0090', '--cell-bg': '#08000f', '--cell-hover-bg': '#180028' },
  classic: { '--board-bg': '#000000', '--cell-bg': '#2e7a3e', '--cell-hover-bg': '#3a9050' },
  urushi:  { '--board-bg': '#120605', '--cell-bg': '#b02010', '--cell-hover-bg': '#cc2a14' },
  metal:   { '--board-bg': '#1c1c1c', '--cell-bg': '#a0a0a0', '--cell-hover-bg': '#bcbcbc' },
  sky:     { '--board-bg': '#023d60', '--cell-bg': '#5aa6c9ff', '--cell-hover-bg': '#b3e5fc' },
  retro:   { '--board-bg': '#1a1a1a', '--cell-bg': '#888888', '--cell-hover-bg': '#a0a0a0' },
};

// ===== BOARD DIRECTIONS =====
// 8方向の差分ベクトル [dx, dy]（水平・垂直・斜めの全8方向）
const DIRS = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,-1],[1,-1],[-1,1]];

// ===== OPENING DATA =====

// 盤面の対称変換テーブル（黒白を入れ替えない変換のみ使用）
// 90°/270° 回転は黒白を入れ替えるため除外
const OPENING_TRANSFORMS = [
  (x, y) => [x, y],         // 恒等変換
  (x, y) => [7 - x, 7 - y], // 180°回転
  (x, y) => [y, x],         // 主対角反転
  (x, y) => [7 - y, 7 - x], // 副対角反転
];

// 定石名と棋譜文字列の対応表（起動時に座標配列へ変換済み）
const OPENINGS = [
  { name: 'ウサギ',       kifu: 'f5d6c5f4e3c6d3f6e6d7' },
  { name: '馬',           kifu: 'f5d6c5f4d3e3g4g5e6c4' },
  { name: '虎',           kifu: 'f5d6c3d3c4f4' },
  { name: 'ネズミ',       kifu: 'f5f4e3f6d3c5d6c4e6' },
  { name: '牛',           kifu: 'f5f6e6f4e3c5c4e7c6e2' },
  { name: '蛇',           kifu: 'f5f6e6f4g6c5g4g5' },
  { name: 'バッファロー', kifu: 'f5f6e6f4c3d7e3d6e7c5' },
].map(o => ({
  name: o.name,
  moves: Array.from({ length: o.kifu.length / 2 }, (_, i) => ({
    x: o.kifu.charCodeAt(i * 2) - 97,
    y: parseInt(o.kifu[i * 2 + 1]) - 1,
  })),
}));

// 色相環を定石数で等分し、各定石に固有の色を割り当てる
const OPENING_COLORS = Object.fromEntries(
  OPENINGS.map((op, i) => [op.name, `hsl(${Math.round(360 * i / OPENINGS.length)}, 70%, 50%)`])
);
