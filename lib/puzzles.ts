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
];

/** Side to move in a puzzle FEN. */
export function puzzleTurn(p: Puzzle): "w" | "b" {
  return p.fen.split(" ")[1] === "b" ? "b" : "w";
}
