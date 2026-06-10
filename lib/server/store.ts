import "server-only";

import { createServiceClient } from "@/lib/supabase/service";
import {
  generateHostCode,
  generatePin,
  generateResumeCode,
  generateUnique,
} from "@/lib/codes";
import type {
  Game,
  Player,
  Round,
  Tournament,
  TournamentConfig,
} from "@/lib/types";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export const DEFAULT_CONFIG: TournamentConfig = {
  leagueRounds: 5,
  playoff: false,
  playoffSize: 0,
  roundTimerSec: null,
};

// ---------------- tournaments ----------------

export async function createTournament(
  title: string | null,
  config: TournamentConfig,
  hostUserId: string | null = null,
): Promise<Tournament> {
  const db = createServiceClient();

  // PIN must be globally unique (DB constraint backstops races).
  const { data: existing } = await db.from("tournaments").select("join_pin");
  const takenPins = new Set((existing ?? []).map((r) => r.join_pin as string));
  const join_pin = generateUnique(generatePin, takenPins);
  const host_code = generateHostCode();

  const { data, error } = await db
    .from("tournaments")
    .insert({
      join_pin,
      host_code,
      host_user_id: hostUserId,
      title,
      status: "lobby",
      config,
      current_round: 0,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Tournament;
}

export async function getTournament(id: string): Promise<Tournament | null> {
  const db = createServiceClient();
  const { data } = await db.from("tournaments").select("*").eq("id", id).maybeSingle();
  return (data as Tournament) ?? null;
}

export async function getTournamentByPin(pin: string): Promise<Tournament | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("tournaments")
    .select("*")
    .eq("join_pin", pin)
    .maybeSingle();
  return (data as Tournament) ?? null;
}

export async function openTournamentByHostCode(
  hostCode: string,
): Promise<Tournament | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("tournaments")
    .select("*")
    .eq("host_code", hostCode)
    .order("created_at", { ascending: false })
    .maybeSingle();
  return (data as Tournament) ?? null;
}

export async function updateTournament(
  id: string,
  patch: Partial<Pick<Tournament, "status" | "config" | "current_round" | "title">>,
): Promise<Tournament> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("tournaments")
    .update(patch)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Tournament;
}

// ---------------- players ----------------

export async function listPlayers(tournamentId: string): Promise<Player[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("players")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("joined_at", { ascending: true });
  return (data as Player[]) ?? [];
}

export async function addPlayer(
  tournamentId: string,
  displayName: string,
): Promise<Player> {
  const db = createServiceClient();
  const existing = await listPlayers(tournamentId);
  const taken = new Set(existing.map((p) => p.resume_code));
  const resume_code = generateUnique(generateResumeCode, taken);

  const { data, error } = await db
    .from("players")
    .insert({
      tournament_id: tournamentId,
      display_name: displayName.slice(0, 40),
      resume_code,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Player;
}

export async function getPlayerByResume(
  tournamentId: string,
  resumeCode: string,
): Promise<Player | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("players")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("resume_code", resumeCode)
    .maybeSingle();
  return (data as Player) ?? null;
}

export async function getPlayer(id: string): Promise<Player | null> {
  const db = createServiceClient();
  const { data } = await db.from("players").select("*").eq("id", id).maybeSingle();
  return (data as Player) ?? null;
}

export async function setPlayerSeed(
  playerId: string,
  seed: number,
): Promise<void> {
  const db = createServiceClient();
  await db.from("players").update({ seed }).eq("id", playerId);
}

export async function setPlayerStatus(
  playerId: string,
  status: Player["status"],
): Promise<void> {
  const db = createServiceClient();
  await db.from("players").update({ status }).eq("id", playerId);
}

// ---------------- rounds / games (used from Phase 2/3) ----------------

export async function getRound(id: string): Promise<Round | null> {
  const db = createServiceClient();
  const { data } = await db.from("rounds").select("*").eq("id", id).maybeSingle();
  return (data as Round) ?? null;
}

export async function listRounds(tournamentId: string): Promise<Round[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("rounds")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("number", { ascending: true });
  return (data as Round[]) ?? [];
}

export async function createRound(
  tournamentId: string,
  number: number,
  phase: Round["phase"],
  status: Round["status"] = "live",
): Promise<Round> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("rounds")
    .insert({
      tournament_id: tournamentId,
      number,
      phase,
      status,
      started_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Round;
}

export async function setRoundStatus(
  roundId: string,
  status: Round["status"],
): Promise<void> {
  const db = createServiceClient();
  await db.from("rounds").update({ status }).eq("id", roundId);
}

export async function listGamesForRound(roundId: string): Promise<Game[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("games")
    .select("*")
    .eq("round_id", roundId)
    .order("updated_at", { ascending: true });
  return (data as Game[]) ?? [];
}

interface NewGame {
  tournamentId: string;
  roundId: string;
  whitePlayerId: string;
  blackPlayerId: string | null;
  status?: Game["status"];
  resultSource?: Game["result_source"];
}

/** Create a game (or a bye when blackPlayerId is null). */
export async function createGame(g: NewGame): Promise<Game> {
  const db = createServiceClient();
  const isBye = g.blackPlayerId === null;
  const { data, error } = await db
    .from("games")
    .insert({
      tournament_id: g.tournamentId,
      round_id: g.roundId,
      white_player_id: g.whitePlayerId,
      black_player_id: g.blackPlayerId,
      fen: START_FEN,
      pgn: "",
      status: g.status ?? (isBye ? "bye" : "live"),
      result_source: g.resultSource ?? (isBye ? "bye" : null),
      turn: "w",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Game;
}

// ---------------- atomic RPCs (migration 0002) ----------------

export interface ApplyMoveArgs {
  gameId: string;
  expectedFen: string;
  newFen: string;
  newPgn: string;
  san: string;
  newTurn: "w" | "b";
  newStatus: Game["status"];
  resultSource: NonNullable<Game["result_source"]>;
  byPlayerId: string;
}

export interface RpcResult {
  ok: boolean;
  conflict?: string;
  ply?: number;
  status?: string;
}

export async function applyMoveRpc(a: ApplyMoveArgs): Promise<RpcResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("apply_move", {
    p_game_id: a.gameId,
    p_expected_fen: a.expectedFen,
    p_new_fen: a.newFen,
    p_new_pgn: a.newPgn,
    p_san: a.san,
    p_new_turn: a.newTurn,
    p_new_status: a.newStatus,
    p_result_source: a.resultSource,
    p_by_player_id: a.byPlayerId,
  });
  if (error) throw error;
  return data as RpcResult;
}

export async function resolveGameRpc(
  gameId: string,
  status: Game["status"],
  resultSource: NonNullable<Game["result_source"]>,
  requireLive = false,
): Promise<RpcResult> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("resolve_game", {
    p_game_id: gameId,
    p_new_status: status,
    p_result_source: resultSource,
    p_require_live: requireLive,
  });
  if (error) throw error;
  return data as RpcResult;
}

/** Set or clear the pending draw offer on a game (DB-backed, isolate-safe). */
export async function setDrawOffer(
  gameId: string,
  byPlayerId: string | null,
): Promise<void> {
  const db = createServiceClient();
  await db.from("games").update({ draw_offered_by: byPlayerId }).eq("id", gameId);
}

export async function recomputeScores(tournamentId: string): Promise<void> {
  const db = createServiceClient();
  await db.rpc("recompute_scores", { p_tournament_id: tournamentId });
}

export async function listGames(tournamentId: string): Promise<Game[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("games")
    .select("*")
    .eq("tournament_id", tournamentId)
    .order("updated_at", { ascending: true });
  return (data as Game[]) ?? [];
}

export async function getGame(id: string): Promise<Game | null> {
  const db = createServiceClient();
  const { data } = await db.from("games").select("*").eq("id", id).maybeSingle();
  return (data as Game) ?? null;
}


/** The current live (or most recent) game for a player, for resume/waiting. */
export async function currentGameForPlayer(
  tournamentId: string,
  playerId: string,
): Promise<Game | null> {
  const db = createServiceClient();
  const { data } = await db
    .from("games")
    .select("*")
    .eq("tournament_id", tournamentId)
    .or(`white_player_id.eq.${playerId},black_player_id.eq.${playerId}`)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Game) ?? null;
}

export { START_FEN };
