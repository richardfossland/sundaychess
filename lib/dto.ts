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

export interface PublicPlayer {
  id: string;
  displayName: string;
  score: number;
  tiebreak: number;
  status: "active" | "left";
  seed: number | null;
}

export interface PublicGame {
  id: string;
  roundId: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  fen: string;
  status: GameStatus;
  turn: Turn;
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
}

export function toPublicPlayer(p: Player): PublicPlayer {
  return {
    id: p.id,
    displayName: p.display_name,
    score: Number(p.score),
    tiebreak: Number(p.tiebreak),
    status: p.status,
    seed: p.seed,
  };
}

export function toPublicGame(g: Game): PublicGame {
  return {
    id: g.id,
    roundId: g.round_id,
    whitePlayerId: g.white_player_id,
    blackPlayerId: g.black_player_id,
    fen: g.fen,
    status: g.status,
    turn: g.turn,
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
