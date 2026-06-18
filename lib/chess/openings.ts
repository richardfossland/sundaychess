// A tiny opening book for the strongest ("umulig") bot, so it plays principled
// first moves instead of shuffling pieces in the opening. PURE + deterministic.
//
// The book is built at module load by REPLAYING short SAN lines with chess.js,
// so every key is a guaranteed-correct normalized FEN (no hand-written FENs to
// get wrong, especially castling / en-passant fields). Each position along a
// line maps to the move that continues it, so the book answers for both colours.

import { Chess } from "chess.js";
import type { MoveIntent } from "@/lib/chess/validateMove";

type Reply = { from: string; to: string };

// Solid mainlines (a handful is plenty for a class bot). SAN, from the start.
const LINES: string[][] = [
  ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6", "Ba4"], // Ruy López
  ["e4", "e5", "Nf3", "Nc6", "Bc4"], // Italian
  ["e4", "c5", "Nf3", "d6", "d4", "cxd4", "Nxd4"], // Sicilian (open)
  ["e4", "e6", "d4", "d5", "Nc3"], // French
  ["e4", "c6", "d4", "d5", "Nc3"], // Caro-Kann
  ["d4", "d5", "c4", "e6", "Nc3"], // Queen's Gambit Declined
  ["d4", "Nf6", "c4", "g6", "Nc3", "Bg7"], // King's Indian
  ["c4", "e5", "Nc3"], // English
  ["Nf3", "d5", "d4"], // Réti → d4
];

/** Normalize a FEN to the fields that define the position (drop move clocks). */
function normalize(fen: string): string {
  return fen.split(" ").slice(0, 4).join(" ");
}

const BOOK = new Map<string, Reply[]>();
for (const line of LINES) {
  const chess = new Chess();
  for (const san of line) {
    const key = normalize(chess.fen());
    let mv;
    try {
      mv = chess.move(san);
    } catch {
      break; // a typo in a line shouldn't poison the whole book
    }
    if (!mv) break;
    const reply: Reply = { from: mv.from, to: mv.to };
    const arr = BOOK.get(key) ?? [];
    if (!arr.some((r) => r.from === reply.from && r.to === reply.to)) arr.push(reply);
    BOOK.set(key, arr);
  }
}

/** A book reply for `fen`, or null if the position isn't in the book. `rng`
 * (optional) picks among equally-good book moves for a little variety; the
 * default is deterministic (first line). */
export function bookMove(
  fen: string,
  rng: () => number = () => 0,
): MoveIntent | null {
  const arr = BOOK.get(normalize(fen));
  if (!arr || arr.length === 0) return null;
  const pick = arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
  return { from: pick.from, to: pick.to, promotion: "q" };
}

/** Exposed for tests. */
export const __bookSize = BOOK.size;
