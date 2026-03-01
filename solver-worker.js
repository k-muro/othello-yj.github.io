const BB_ALL   = 0xFFFFFFFFFFFFFFFFn;
const BB_NOT_A = 0xFEFEFEFEFEFEFEFEn;
const BB_NOT_H = 0x7F7F7F7F7F7F7F7Fn;

function bbMoves(player, opponent) {
  const empty = ~(player | opponent) & BB_ALL;
  let moves = 0n;
  const dirs = [
    {shift: 1n,  mask: BB_NOT_A},
    {shift:-1n,  mask: BB_NOT_H},
    {shift: 8n,  mask: BB_ALL},
    {shift:-8n,  mask: BB_ALL},
    {shift: 9n,  mask: BB_NOT_A},
    {shift:-9n,  mask: BB_NOT_H},
    {shift: 7n,  mask: BB_NOT_H},
    {shift:-7n,  mask: BB_NOT_A},
  ];
  for (const {shift, mask} of dirs) {
    let t;
    if (shift > 0n) {
      t = ((player << shift) & mask) & opponent;
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

function bbPopcount(b) { let n = 0; while (b) { b &= b - 1n; n++; } return n; }

const BB_POS = new Map();
for (let i = 0; i < 64; i++) BB_POS.set(1n << BigInt(i), i);

// 相手の着手数が少ない順に並べるαβ探索（枝刈り効率が大幅に向上）
function bbSolve(blackBB, whiteBB, blackToMove, alpha, beta) {
  const player   = blackToMove ? blackBB : whiteBB;
  const opponent = blackToMove ? whiteBB : blackBB;
  let moves = bbMoves(player, opponent);

  if (!moves) {
    if (!bbMoves(opponent, player))
      return { score: bbPopcount(blackBB) - bbPopcount(whiteBB), line: [] };
    return bbSolve(blackBB, whiteBB, !blackToMove, alpha, beta);
  }

  // 各手を展開し、相手の合法手数（少ない＝より良い候補）でソート
  const moveList = [];
  let m = moves;
  while (m) {
    const lsb = m & -m;
    m ^= lsb;
    const pos = BB_POS.get(lsb);
    const flips = bbFlips(pos, player, opponent);
    const np = player | lsb | flips;
    const no = opponent ^ flips;
    moveList.push({ pos, np, no, oppMob: bbPopcount(bbMoves(no, np)) });
  }
  moveList.sort((a, b) => a.oppMob - b.oppMob);

  let best = blackToMove ? -65 : 65, bestLine = [];
  for (const { pos, np, no } of moveList) {
    const { score, line } = bbSolve(
      blackToMove ? np : no,
      blackToMove ? no : np,
      !blackToMove,
      alpha, beta
    );
    const x = pos & 7, y = pos >> 3;
    if (blackToMove) {
      if (score > best) { best = score; bestLine = [{x, y}, ...line]; }
      if (best > alpha) alpha = best;
    } else {
      if (score < best) { best = score; bestLine = [{x, y}, ...line]; }
      if (best < beta)  beta  = best;
    }
    if (alpha >= beta) break;
  }
  return { score: best, line: bestLine };
}

self.onmessage = function(e) {
  const { blackStr, whiteStr, blackToMove } = e.data;
  const { score, line } = bbSolve(BigInt(blackStr), BigInt(whiteStr), blackToMove, -65, 65);
  self.postMessage({ score, line });
};
