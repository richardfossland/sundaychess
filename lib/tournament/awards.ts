// Tournament awards ("utmerkelser") computed from finished games' PGNs.
// Pure + client-safe: replays each decided game once with chess.js. Display
// strings live in the locale; this module returns data only.

import { Chess } from "chess.js";

export interface AwardGame {
  id: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  status: string; // white_win | black_win | draw | ...
  pgn: string;
}

export type AwardKey =
  | "fastest_mate"
  | "most_captures"
  | "longest_game"
  | "comeback";

export interface Award {
  key: AwardKey;
  playerIds: string[];
  /** key-specific number: plies (fastest/longest), captures, or the material
   * deficit (in pawns) that was overcome */
  value: number;
}

const PIECE_VALUE: Record<string, number> = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

interface Replay {
  plies: number;
  isMate: boolean;
  whiteCaptures: number;
  blackCaptures: number;
  /** worst material balance (white − black, in pawns) white sat at, ≤ 0 */
  whiteWorst: number;
  /** worst balance from black's perspective, ≤ 0 */
  blackWorst: number;
}

function replay(pgn: string): Replay | null {
  if (!pgn.trim()) return null;
  const chess = new Chess();
  try {
    chess.loadPgn(pgn);
  } catch {
    return null;
  }
  const hist = chess.history({ verbose: true });
  if (hist.length === 0) return null;

  let whiteCaptures = 0;
  let blackCaptures = 0;
  let balance = 0; // white − black material, pawns
  let whiteWorst = 0;
  let blackWorst = 0;

  for (const m of hist) {
    const captured = m.captured ? PIECE_VALUE[m.captured] : 0;
    if (m.color === "w") {
      if (m.captured) whiteCaptures++;
      balance += captured;
      if (m.promotion) balance += PIECE_VALUE[m.promotion] - 1;
    } else {
      if (m.captured) blackCaptures++;
      balance -= captured;
      if (m.promotion) balance -= PIECE_VALUE[m.promotion] - 1;
    }
    whiteWorst = Math.min(whiteWorst, balance);
    blackWorst = Math.min(blackWorst, -balance);
  }

  return {
    plies: hist.length,
    isMate: chess.isCheckmate(),
    whiteCaptures,
    blackCaptures,
    whiteWorst,
    blackWorst,
  };
}

/** A winner counts as a comeback if they were down at least this much
 * material at some point and still won. */
const COMEBACK_DEFICIT = 3;

export function computeAwards(games: AwardGame[]): Award[] {
  const decided = games.filter(
    (g) =>
      g.blackPlayerId &&
      (g.status === "white_win" || g.status === "black_win" || g.status === "draw"),
  );

  // Ties share the award: equal-plies mates and equal capture counts all win.
  let fastestMate: { playerIds: string[]; plies: number } | null = null;
  let longest: { ids: string[]; plies: number } | null = null;
  let comeback: { playerId: string; deficit: number } | null = null;
  const captures = new Map<string, number>();

  for (const g of decided) {
    const r = replay(g.pgn);
    if (!r) continue;
    const black = g.blackPlayerId as string;

    captures.set(g.whitePlayerId, (captures.get(g.whitePlayerId) ?? 0) + r.whiteCaptures);
    captures.set(black, (captures.get(black) ?? 0) + r.blackCaptures);

    if (r.isMate && (g.status === "white_win" || g.status === "black_win")) {
      const winner = g.status === "white_win" ? g.whitePlayerId : black;
      if (!fastestMate || r.plies < fastestMate.plies) {
        fastestMate = { playerIds: [winner], plies: r.plies };
      } else if (r.plies === fastestMate.plies && !fastestMate.playerIds.includes(winner)) {
        fastestMate.playerIds.push(winner);
      }
    }

    if (!longest || r.plies > longest.plies) {
      longest = { ids: [g.whitePlayerId, black], plies: r.plies };
    }

    if (g.status === "white_win" || g.status === "black_win") {
      const winnerIsWhite = g.status === "white_win";
      const deficit = -(winnerIsWhite ? r.whiteWorst : r.blackWorst);
      if (deficit >= COMEBACK_DEFICIT && (!comeback || deficit > comeback.deficit)) {
        comeback = {
          playerId: winnerIsWhite ? g.whitePlayerId : black,
          deficit,
        };
      }
    }
  }

  const awards: Award[] = [];
  if (fastestMate) {
    awards.push({ key: "fastest_mate", playerIds: fastestMate.playerIds, value: fastestMate.plies });
  }
  let maxCaptures = 0;
  for (const n of captures.values()) maxCaptures = Math.max(maxCaptures, n);
  if (maxCaptures > 0) {
    const ids = [...captures.entries()]
      .filter(([, n]) => n === maxCaptures)
      .map(([id]) => id);
    awards.push({ key: "most_captures", playerIds: ids, value: maxCaptures });
  }
  if (longest && longest.plies >= 10) {
    awards.push({ key: "longest_game", playerIds: longest.ids, value: longest.plies });
  }
  if (comeback) {
    awards.push({ key: "comeback", playerIds: [comeback.playerId], value: comeback.deficit });
  }
  return awards;
}
