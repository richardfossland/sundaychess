// Mate-in-1 puzzle pack for waiting players. Every position is verified by
// test/puzzles.test.ts (side to move has at least one checkmating move), so a
// broken FEN can never ship. Solutions are not stored — the client simply
// checks "did your move give checkmate?", which also accepts alternate mates.

export interface Puzzle {
  id: string;
  fen: string;
}

export const PUZZLES: Puzzle[] = [
  // back-rank mates
  { id: "backrank-rook", fen: "6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1" },
  { id: "backrank-queen", fen: "6k1/5ppp/8/8/8/8/8/Q3K3 w - - 0 1" },
  { id: "backrank-real", fen: "6k1/r4ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1" },
  { id: "backrank-black", fen: "r3k3/8/8/8/8/8/5PPP/6K1 b - - 0 1" },
  // smothered mates
  { id: "smothered", fen: "6rk/6pp/8/6N1/8/8/8/7K w - - 0 1" },
  { id: "smothered-black", fen: "7k/8/8/8/6n1/8/6PP/6RK b - - 0 1" },
  // queen mates with king support
  { id: "queen-h7", fen: "7k/8/6K1/8/8/8/8/7Q w - - 0 1" },
  { id: "queen-kiss", fen: "4k3/1Q6/4K3/8/8/8/8/8 w - - 0 1" },
  { id: "queen-kiss-black", fen: "8/8/8/8/8/4k3/q7/4K3 b - - 0 1" },
  // rook technique
  { id: "ladder", fen: "7k/R7/8/8/8/8/1R6/7K w - - 0 1" },
  { id: "opposition-rook", fen: "7k/8/6K1/8/8/8/8/R7 w - - 0 1" },
  { id: "arabian", fen: "7k/8/5N2/8/8/8/8/6KR w - - 0 1" },
  { id: "anastasia", fen: "8/4N1pk/8/8/8/8/6K1/1R6 w - - 0 1" },
  // classics
  { id: "fools-mate", fen: "rnbqkbnr/pppp1ppp/8/4p3/6P1/5P2/PPPPP2P/RNBQKBNR b KQkq g3 0 2" },
  { id: "scholars-mate", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4" },
  { id: "epaulette", fen: "3rkr2/8/8/8/8/8/6K1/4Q3 w - - 0 1" },
  { id: "two-bishops", fen: "7k/8/6K1/8/8/8/B7/4B3 w - - 0 1" },
  { id: "greek-gift", fen: "5rk1/5ppp/8/6NQ/8/8/8/6K1 w - - 0 1" },
  // ---- expanded pack (every FEN verified by test/puzzles.test.ts) ----
  // queen + king "kiss" mates (king-supported), one per edge
  { id: "queen-kiss-h", fen: "7k/Q7/6K1/8/8/8/8/8 w - - 0 1" },
  { id: "queen-kiss-e", fen: "4k3/8/3K4/8/7Q/8/8/8 w - - 0 1" },
  { id: "queen-kiss-c", fen: "2k5/8/3K4/Q7/8/8/8/8 w - - 0 1" },
  { id: "queen-kiss-d", fen: "3k4/8/4K3/8/Q7/8/8/8 w - - 0 1" },
  { id: "queen-corner", fen: "7k/5Q2/6K1/8/8/8/8/8 w - - 0 1" },
  { id: "queen-seventh", fen: "6k1/3Q4/7P/8/8/8/8/K7 w - - 0 1" },
  { id: "queen-pawn-support", fen: "5k2/5P2/5K2/8/8/8/8/7Q w - - 0 1" },
  // back-rank mates against a full pawn shield, varying the heavy-piece file
  { id: "backrank-e", fen: "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1" },
  { id: "backrank-c", fen: "6k1/5ppp/8/8/8/8/8/2R3K1 w - - 0 1" },
  { id: "backrank-a", fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1" },
  { id: "backrank-q", fen: "6k1/5ppp/8/8/8/8/8/4Q1K1 w - - 0 1" },
  { id: "backrank-h-corner", fen: "7k/6pp/8/8/8/8/8/3R2K1 w - - 0 1" },
  { id: "bishop-rook", fen: "6k1/5ppp/8/8/8/8/6B1/3R2K1 w - - 0 1" },
  { id: "bishop-queen", fen: "6k1/5ppp/8/8/8/1B6/8/3Q2K1 w - - 0 1" },
  // two-rook ladder and the king-and-rook box on different edges
  { id: "rook-ladder", fen: "7k/R7/8/8/8/8/8/1R5K w - - 0 1" },
  { id: "rook-ladder-2", fen: "6k1/R7/1R6/8/8/8/8/7K w - - 0 1" },
  { id: "box-edge", fen: "k7/8/1K6/8/8/8/8/7R w - - 0 1" },
  { id: "box-center", fen: "2k5/8/2K5/8/8/8/8/7R w - - 0 1" },
  // knight motifs: smothered, knight-covered back rank, arabian
  { id: "smothered-corner", fen: "kr6/pp6/8/3N4/8/8/8/7K w - - 0 1" },
  { id: "knight-backrank", fen: "7k/4N1pp/8/8/8/8/8/3R2K1 w - - 0 1" },
  { id: "arabian-mate", fen: "7k/6p1/5N2/8/8/8/1K6/R7 w - - 0 1" },
  // two bishops and a promotion mate
  { id: "two-bishops-2", fen: "7k/8/6K1/8/8/8/B7/2B5 w - - 0 1" },
  { id: "promotion-rook", fen: "k7/2P5/1K6/8/8/8/8/8 w - - 0 1" },
  // black to move, for variety
  { id: "backrank-black-2", fen: "3r2k1/8/8/8/8/8/5PPP/6K1 b - - 0 1" },
];

/** Side to move in a puzzle FEN. */
export function puzzleTurn(p: Puzzle): "w" | "b" {
  return p.fen.split(" ")[1] === "b" ? "b" : "w";
}
