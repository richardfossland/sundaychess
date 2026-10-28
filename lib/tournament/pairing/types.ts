// Shared, engine-independent pairing types. Everything in lib/tournament/pairing
// is pure: no DB, no Date.now, no Math.random — same input, same output.

export type PlayerStatus = "active" | "withdrawn" | "absent";
/** full = automatic/regular bye (1 pt), half = requested ½ pt, zero = requested 0 pt. */
export type ByeType = "full" | "half" | "zero";
export type GameResult = "1-0" | "0-1" | "1/2-1/2" | "0-0" | "bye";

export interface PairingPlayer {
  id: string;
  /** Start number (1-based). Final tie-break of the Monrad order. */
  startNo: number;
  rating?: number;
  /** Points so far — decides the score group. */
  score: number;
  /** Optional secondary key inside a score group (e.g. Buchholz); higher ranks first. */
  tiebreak?: number;
  status: PlayerStatus;
  /** Player asked for a bye this round: excluded from pairing, gets this bye. */
  byeRequest?: "half" | "zero";
}

export interface HistoryGame {
  round: number;
  white: string;
  /** null = bye for `white`. */
  black: string | null;
  result: GameResult;
  /** Only for byes. Absent = "full". */
  byeType?: ByeType;
  /** The game was never played (forfeit / walkover / opponent absent). FIDE: an
   * unplayed game is neither a "met before" pairing nor a colour — it counts for
   * points only. Absent = played. */
  forfeit?: boolean;
}

export interface PairingInput {
  players: PairingPlayer[];
  history: HistoryGame[];
  /** The round being paired (1-based). */
  round: number;
}

export interface BoardPairing {
  /** 1-based board number; byes come last. */
  board: number;
  white: string;
  /** null = bye */
  black: string | null;
  byeType?: ByeType;
  /** Set when a repeat pairing was unavoidable. */
  rematch?: boolean;
}

export interface PairingOutput {
  pairings: BoardPairing[];
  /** Set when the matching search hit its node budget and the pairing was built
   * with relaxed constraints (colour rules dropped / greedy fallback). */
  relaxed?: "budget";
}

export type Colour = "W" | "B";

/** Colour history of one player. */
export interface ColourState {
  /** whites minus blacks. */
  diff: number;
  last: Colour | null;
  /** Length of the current same-colour run (0 when no games). */
  run: number;
}

/** Pre-digested history used by the pairing core. */
export interface PairingContext {
  /** Unordered "a|b" keys of pairs that already met. */
  met: ReadonlySet<string>;
  /** Byes received so far (all kinds). */
  byeCounts: ReadonlyMap<string, number>;
  colours: ReadonlyMap<string, ColourState>;
}
