// Data-transfer shapes returned by the API. Deliberately omit secrets:
// resume_code is a bearer token and must NEVER appear in board/public payloads.

import type {
  Game,
  GameStatus,
  Player,
  Tournament,
  TournamentConfig,
  TournamentStatus,
  Turn,
} from "@/lib/types";
import type { StandingRow } from "@/lib/tournament/score";

export type { StandingRow };

export interface PublicPlayer {
  id: string;
  displayName: string;
  score: number;
  tiebreak: number;
  status: "active" | "left";
  seed: number | null;
  team: string | null;
}

export interface PublicGame {
  id: string;
  roundId: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  fen: string;
  status: GameStatus;
  turn: Turn;
  /** Present only once the game is decided — feeds replay + awards without a
   * per-game fetch. Live games omit it (don't ship the full history each poll). */
  pgn?: string;
}

export interface BoardState {
  tournament: {
    id: string;
    title: string | null;
    joinPin: string;
    status: TournamentStatus;
    config: TournamentConfig;
    currentRound: number;
  };
  players: PublicPlayer[];
  games: PublicGame[];
  standings: StandingRow[];
  /** Rounds with their numbers/phase/status for the board. */
  rounds: {
    id: string;
    number: number;
    phase: string;
    status: string;
    startedAt: string | null;
  }[];
  /** Tipping leaderboard (1 point per correct prediction). Empty/absent until
   * the predictions migration is applied. */
  tipping?: { playerId: string; points: number }[];
}

export function toPublicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    displayName: p.display_name,
    score: Number(p.score),
    tiebreak: Number(p.tiebreak),
    status: p.status,
    seed: p.seed,
    team: p.team ?? null,
  };
}

export function toPublicGame(g: Game): PublicGame {
  const decided =
    g.status === "white_win" || g.status === "black_win" || g.status === "draw";
  return {
    id: g.id,
    roundId: g.round_id,
    whitePlayerId: g.white_player_id,
    blackPlayerId: g.black_player_id,
    fen: g.fen,
    status: g.status,
    turn: g.turn,
    ...(decided && g.pgn ? { pgn: g.pgn } : {}),
  };
}

export interface GameDetail {
  id: string;
  tournamentId: string;
  roundId: string;
  fen: string;
  pgn: string;
  status: GameStatus;
  turn: Turn;
  white: { id: string; name: string };
  black: { id: string; name: string } | null;
  lastMove: { from: string; to: string; san: string } | null;
  /** Chess-clock snapshot (lyn/blitz); null/absent when no clock configured.
   * Clients tick the `turn` side down locally from receipt. */
  clock?: {
    whiteMs: number;
    blackMs: number;
    turn: Turn;
    running: boolean;
  } | null;
}

export function toBoardTournament(t: Tournament) {
  return {
    id: t.id,
    title: t.title,
    joinPin: t.join_pin,
    status: t.status,
    config: t.config,
    currentRound: t.current_round,
  };
}
