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

/** Postgres unique-constraint violation (concurrent PIN/resume-code/round
 * collisions surface as this and deserve a retry or a graceful response). */
export function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "23505"
  );
}

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

  // PIN must be globally unique. The pre-read avoids most collisions; the DB
  // constraint backstops races — on 23505 we regenerate and retry.
  const { data: existing } = await db.from("tournaments").select("join_pin");
  const takenPins = new Set((existing ?? []).map((r) => r.join_pin as string));
  const host_code = generateHostCode();

  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const join_pin = generateUnique(generatePin, takenPins);
    takenPins.add(join_pin); // don't re-pick it on the next attempt
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
    if (!error) return data as Tournament;
    lastError = error;
    if (!isUniqueViolation(error)) break; // only PIN races are retryable
  }
  throw lastError;
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
  teams: string[] = [],
): Promise<Player> {
  const db = createServiceClient();
  const existing = await listPlayers(tournamentId);
  const taken = new Set(existing.map((p) => p.resume_code));

  // Lagturnering: auto-assign to the currently smallest team so they stay
  // balanced regardless of join order.
  let team: string | null = null;
  if (teams.length >= 2) {
    const counts = new Map(teams.map((name) => [name, 0]));
    for (const p of existing) {
      if (p.team && counts.has(p.team)) counts.set(p.team, counts.get(p.team)! + 1);
    }
    team = teams.reduce((min, name) =>
      counts.get(name)! < counts.get(min)! ? name : min,
    );
  }

  const row: {
    tournament_id: string;
    display_name: string;
    resume_code: string;
    team?: string;
  } = {
    tournament_id: tournamentId,
    display_name: displayName.slice(0, 40),
    resume_code: "",
  };
  if (team) row.team = team;

  // Two failure modes, handled separately:
  //  * 23505 (concurrent join picked the same resume code) → regenerate + retry
  //  * anything else with team set (players.team not migrated, 0006) → drop team
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    row.resume_code = generateUnique(generateResumeCode, taken);
    taken.add(row.resume_code);
    const { data, error } = await db.from("players").insert(row).select("*").single();
    if (!error) return data as Player;
    lastError = error;
    if (isUniqueViolation(error)) continue; // new code next loop
    if (row.team) {
      delete row.team;
      const retry = await db.from("players").insert(row).select("*").single();
      if (!retry.error) return retry.data as Player;
      lastError = retry.error;
      if (isUniqueViolation(retry.error)) continue; // teamless + new code
    }
    break; // non-retryable
  }
  throw lastError;
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

export async function setRoundStartedAt(
  roundId: string,
  startedAt: string,
): Promise<void> {
  const db = createServiceClient();
  await db.from("rounds").update({ started_at: startedAt }).eq("id", roundId);
}

/** Atomically add 60s to a round's timer extension (RPC from 0007).
 * Throws when the RPC isn't migrated yet — callers fall back. */
export async function extendRoundRpc(roundId: string): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db.rpc("extend_round", { p_round_id: roundId });
  if (error) throw error;
  return data as number;
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
  /** Variant start position; defaults to the standard one. */
  startFen?: string;
  /** Bracket/pairing position within the round (0007). */
  slot?: number;
}

/** Create a game (or a bye when blackPlayerId is null). */
export async function createGame(g: NewGame): Promise<Game> {
  const db = createServiceClient();
  const isBye = g.blackPlayerId === null;
  const row: Record<string, unknown> = {
    tournament_id: g.tournamentId,
    round_id: g.roundId,
    white_player_id: g.whitePlayerId,
    black_player_id: g.blackPlayerId,
    fen: g.startFen ?? START_FEN,
    pgn: "",
    status: g.status ?? (isBye ? "bye" : "live"),
    result_source: g.resultSource ?? (isBye ? "bye" : null),
    turn: "w",
    slot: g.slot ?? 0,
  };
  const { data, error } = await db.from("games").insert(row).select("*").single();
  if (error) {
    // games.slot may not be migrated yet (0007) — retry without it
    delete row.slot;
    const retry = await db.from("games").insert(row).select("*").single();
    if (retry.error) throw error; // surface the ORIGINAL error
    return retry.data as Game;
  }
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


/** Move timestamps for clock computation (ply + created_at only). */
export async function listMoveStamps(
  gameId: string,
): Promise<{ ply: number; createdAt: string }[]> {
  const db = createServiceClient();
  const { data } = await db
    .from("moves")
    .select("ply, created_at")
    .eq("game_id", gameId)
    .order("ply", { ascending: true });
  return ((data as { ply: number; created_at: string }[]) ?? []).map((m) => ({
    ply: m.ply,
    createdAt: m.created_at,
  }));
}

// ---------------- predictions (tippemodus, migration 0005) ----------------
// All prediction helpers degrade gracefully (return/skip) if the predictions
// table hasn't been migrated yet, so the rest of the app never breaks on it.

export type PredictedResult = "white" | "black" | "draw";

export async function upsertPrediction(
  tournamentId: string,
  gameId: string,
  playerId: string,
  predicted: PredictedResult,
): Promise<boolean> {
  const db = createServiceClient();
  const { error } = await db.from("predictions").upsert(
    {
      tournament_id: tournamentId,
      game_id: gameId,
      player_id: playerId,
      predicted,
      correct: null,
    },
    { onConflict: "game_id,player_id" },
  );
  return !error;
}

/** Mark every prediction on a resolved game right/wrong. Draw counts too. */
export async function scorePredictions(
  gameId: string,
  status: Game["status"],
): Promise<void> {
  const map: Partial<Record<Game["status"], PredictedResult>> = {
    white_win: "white",
    black_win: "black",
    draw: "draw",
  };
  const actual = map[status];
  if (!actual) return; // aborted/bye → predictions stay void
  const db = createServiceClient();
  await db
    .from("predictions")
    .update({ correct: false })
    .eq("game_id", gameId)
    .neq("predicted", actual);
  await db
    .from("predictions")
    .update({ correct: true })
    .eq("game_id", gameId)
    .eq("predicted", actual);
}

/** Points per player (1 per correct prediction). Empty if unmigrated. */
export async function predictionPoints(
  tournamentId: string,
): Promise<{ playerId: string; points: number }[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("predictions")
    .select("player_id, correct")
    .eq("tournament_id", tournamentId)
    .eq("correct", true);
  if (error || !data) return [];
  const tally = new Map<string, number>();
  for (const row of data as { player_id: string }[]) {
    tally.set(row.player_id, (tally.get(row.player_id) ?? 0) + 1);
  }
  return [...tally.entries()]
    .map(([playerId, points]) => ({ playerId, points }))
    .sort((a, b) => b.points - a.points);
}

/** A player's own predictions in a tournament (gameId → predicted). */
export async function listPredictionsForPlayer(
  tournamentId: string,
  playerId: string,
): Promise<Record<string, PredictedResult>> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("predictions")
    .select("game_id, predicted")
    .eq("tournament_id", tournamentId)
    .eq("player_id", playerId);
  if (error || !data) return {};
  return Object.fromEntries(
    (data as { game_id: string; predicted: PredictedResult }[]).map((r) => [
      r.game_id,
      r.predicted,
    ]),
  );
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
