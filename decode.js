const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const DIRS = [
  [-1,-1],[-1,0],[-1,1],
  [0,-1],        [0,1],
  [1,-1],[1,0],[1,1]
];

function initBoard() {
  const b = {};
  for (let c of "abcdefgh") {
    for (let r of "12345678") {
      b[c+r] = ".";
    }
  }
  b["d4"]="W"; b["e5"]="W";
  b["d5"]="B"; b["e4"]="B";
  return b;
}

function opponent(p){ return p==="B"?"W":"B"; }

function sqToXY(sq){
  return [sq.charCodeAt(0)-97, Number(sq[1])-1];
}

function xyToSq(x,y){
  return String.fromCharCode(97+x)+(y+1);
}

function inBounds(x,y){
  return x>=0 && x<8 && y>=0 && y<8;
}

function flips(board, player, sq){
  if(board[sq]!==".") return [];
  const [x,y]=sqToXY(sq);
  const opp=opponent(player);
  let res=[];

  for(const [dx,dy] of DIRS){
    let nx=x+dx, ny=y+dy;
    let tmp=[];
    while(inBounds(nx,ny)){
      let s=xyToSq(nx,ny);
      if(board[s]===opp){
        tmp.push(s);
      }else if(board[s]===player){
        if(tmp.length) res=res.concat(tmp);
        break;
      }else break;
      nx+=dx; ny+=dy;
    }
  }
  return res;
}

function legalMoves(board, player){
  return Object.keys(board).filter(sq=>flips(board,player,sq).length>0);
}

function sortKey(a,b){
  if(a[0]!==b[0]) return a.charCodeAt(0)-b.charCodeAt(0);
  return Number(a[1])-Number(b[1]);
}

function applyMove(board, player, move){
  const f = flips(board, player, move);
  if(!f.length) throw Error("illegal");
  const nb = {...board};
  nb[move]=player;
  for(const s of f) nb[s]=player;
  return nb;
}

function nextPlayer(board, player){
  const opp = opponent(player);
  if(legalMoves(board, opp).length) return opp;
  if(legalMoves(board, player).length) return player;
  return null;
}

function decodeBase64(s){
  let n = 0n;
  for(const ch of s){
    n = n*64n + BigInt(ALPHABET.indexOf(ch));
  }
  return n;
}

function decodeGame(encoded, moveCount=60){
  let rank = decodeBase64(encoded);

  let board = initBoard();
  let player = "B";
  let out = [];

  for(let i=0;i<moveCount;i++){
    let legal = legalMoves(board, player).sort(sortKey);
    let base = legal.length;

    let idx = Number(rank % BigInt(base));
    rank = rank / BigInt(base);

    let move = legal[idx];
    out.push(move);

    board = applyMove(board, player, move);
    player = nextPlayer(board, player);
    if(player===null) break;
  }

  return out.join("");
}