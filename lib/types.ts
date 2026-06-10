// Shared domain types for SundayChess.
// Mirrors the Postgres schema in supabase/migrations/0001_schema.sql.

export type TournamentStatus = "lobby" | "league" | "playoff" | "finished";
export type RoundPhase = "league" | "playoff";
export type RoundStatus = "pairing" | "live" | "done";
export type GameStatus =
  | "live"
  | "white_win"
  | "black_win"
  | "draw"
  | "bye"
  | "aborted";
export type ResultSource =
  | "play"
  | "teacher_override"
  | "bye"
  | "timeout_draw"
  | "walkover"
  | "opponent_absent";
export type PlayerStatus = "active" | "left";
export type Turn = "w" | "b";

/** playoffSize 0 = no playoff. */
export interface TournamentConfig {
  /** "league" (default): Swiss rounds, optional playoff. "cup": straight to
   * the knockout bracket with everyone in (byes fill a non-power-of-two). */
  format?: "league" | "cup";
  leagueRounds: number; // 3..7
  playoff: boolean;
  playoffSize: 0 | 4 | 8 | 16;
  roundTimerSec: number | null;
  /** Players can send emoji reactions in-game. Optional (older rows lack it);
   * default OFF — the organizer opts in. */
  reactions?: boolean;
  /** Theme variant: alternative start position, standard rules. Optional;
   * missing/unknown ⇒ standard. */
  variant?: "standard" | "no_queens" | "pawn_war";
  /** Per-player chess clock in seconds (lyn/blitz). null/absent = no clock. */
  clockSec?: number | null;
  /** Team names (lagturnering). Players are auto-assigned at join to keep the
   * teams balanced. Empty/absent = individual tournament. */
  teams?: string[];
}

export interface Tournament {
  id: string;
  join_pin: string;
  host_code: string;
  host_user_id: string | null;
  title: string | null;
  status: TournamentStatus;
  config: TournamentConfig;
  current_round: number;
  created_at: string;
}

export interface Player {
  id: string;
  tournament_id: string;
  display_name: string;
  resume_code: string;
  score: number;
  tiebreak: number;
  status: PlayerStatus;
  seed: number | null;
  /** Team name (lagturnering, migration 0006); null/undefined = no team. */
  team?: string | null;
  joined_at: string;
}

export interface Round {
  id: string;
  tournament_id: string;
  number: number;
  phase: RoundPhase;
  status: RoundStatus;
  started_at: string | null;
  /** Accumulated "+1 min" extensions in ms (migration 0007). Round end =
   * started_at + timer + extended_ms; chess-clock t0 stays at started_at. */
  extended_ms?: number;
}

export interface Game {
  id: string;
  tournament_id: string;
  round_id: string;
  white_player_id: string;
  black_player_id: string | null; // null = bye
  fen: string;
  pgn: string;
  status: GameStatus;
  result_source: ResultSource | null;
  turn: Turn;
  draw_offered_by: string | null;
  /** Bracket/pairing position within the round (migration 0007). Optional —
   * pre-migration rows lack it; sort with (slot ?? 0). */
  slot?: number;
  updated_at: string;
}

export interface MoveRow {
  id: string;
  game_id: string;
  ply: number;
  san: string;
  fen_after: string;
  by_player_id: string;
  created_at: string;
}

/** The identity a student presents on every state-changing request. */
export interface PlayerIdentity {
  playerId: string;
  resumeCode: string;
}

/** Realtime broadcast payload sent when a game's position changes. */
export interface PositionEvent {
  type: "position";
  fen: string;
  turn: Turn;
  lastMove: { from: string; to: string; san: string } | null;
  status: GameStatus;
}

/** Realtime broadcast payload for non-move game/tournament events. */
export interface ResultEvent {
  type: "result";
  gameId: string;
  status: GameStatus;
  resultSource: ResultSource;
}
