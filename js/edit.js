// ===== BOARD EDIT MODE =====

let boardEditMode    = false;  // 編集モード中かどうか
let editStone        = 1;      // 1=黒 / -1=白 / 0=消しゴム
let editTurn         = 1;      // 確定後の手番（1=黒 / -1=白）
let editBoard        = null;   // 編集中の盤面スナップショット
let customBoardStart = null;   // { board, turn } — 編集確定した開始局面（null=標準開始）

// 編集モードをトグルする（✏ボタンから呼ばれる）
// 既に編集モードなら終了。編集データがある場合は確認ダイアログを表示する
function enterBoardEditMode() {
  if (boardEditMode) {
    const hasData = editBoard && editBoard.some(row => row.some(v => v !== 0));
    if (hasData && !confirm('編集中のデータを破棄して編集モードを終了しますか？')) return;
    cancelBoardEdit();
    return;
  }
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
