import "server-only";

// Duel orchestration: the two server-side state transitions that the generic
// tournament flow doesn't cover.
//   • startDuel    — once the second player has joined, create game 1.
//   • advanceDuel  — after each game resolves, either create the next game
//                    (colours swapped) or finish the match.
// Both are idempotent: re-running is a no-op once the target state exists, and
// the rounds (tournament_id, phase, number) unique constraint dedups any racing
// double-advance. Errors are swallowed so they never break a move response —
// realtime/poll will resync the authoritative state regardless.

import {
  createGame,
  createRound,
  getTournament,
  listGames,
  listPlayers,
  updateTournament,
} from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { variantStartFen } from "@/lib/chess/variants";
import {
  duelState,
  hasLiveGame,
  nextGameColours,
  normalizeBestOf,
} from "@/lib/duel/match";
import type { Tournament } from "@/lib/types";

function isDuel(t: Tournament | null): t is Tournament {
  return !!t && t.config?.format === "duel";
}

async function nudgeLobby(tournamentId: string): Promise<void> {
  await broadcast(channels.lobby(tournamentId), events.tournament, {
    duel: true,
  }).catch(() => {});
}

/** Create game 1 of a duel once both players are present. Returns true if it
 * started the match (or it was already running), false if not ready. */
export async function startDuel(tournamentId: string): Promise<boolean> {
  try {
    const t = await getTournament(tournamentId);
    if (!isDuel(t) || t.status !== "lobby") return false;

    const players = await listPlayers(tournamentId); // ordered by joined_at
    if (players.length < 2) return false;

    const existing = await listGames(tournamentId);
    if (existing.length > 0) return true; // already started

    const [p1, p2] = players;
    const round = await createRound(tournamentId, 1, "league", "live");
    const { whitePlayerId, blackPlayerId } = nextGameColours(0, p1.id, p2.id);
    await createGame({
      tournamentId,
      roundId: round.id,
      whitePlayerId,
      blackPlayerId,
      startFen: variantStartFen(t.config.variant),
    });
    await updateTournament(tournamentId, { status: "league", current_round: 1 });
    await nudgeLobby(tournamentId);
    return true;
  } catch (err) {
    console.error("[duel:start]", err);
    return false;
  }
}

/** After a duel game resolves: finish the match or create the next game with
 * colours alternated. No-op for non-duel tournaments and while a game is live. */
export async function advanceDuel(tournamentId: string): Promise<void> {
  try {
    const t = await getTournament(tournamentId);
    if (!isDuel(t) || t.status === "finished") return;

    const players = await listPlayers(tournamentId);
    if (players.length < 2) return;
    const [p1, p2] = players;

    const games = await listGames(tournamentId);
    if (hasLiveGame(games)) return; // current game still in progress

    const state = duelState(games, p1.id, p2.id, normalizeBestOf(t.config.bestOf));

    if (state.decided) {
      // t.status is already known not to be "finished" (early return above).
      await updateTournament(tournamentId, { status: "finished" });
      await nudgeLobby(tournamentId);
      return;
    }

    // Match continues → create the next game (colours swap each game).
    const gameIndex = games.length;
    const number = gameIndex + 1;
    const round = await createRound(tournamentId, number, "league", "live");
    const { whitePlayerId, blackPlayerId } = nextGameColours(
      gameIndex,
      p1.id,
      p2.id,
    );
    await createGame({
      tournamentId,
      roundId: round.id,
      whitePlayerId,
      blackPlayerId,
      startFen: variantStartFen(t.config.variant),
    });
    await updateTournament(tournamentId, { current_round: number });
    await nudgeLobby(tournamentId);
  } catch (err) {
    console.error("[duel:advance]", err);
  }
}
