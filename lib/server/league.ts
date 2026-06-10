import "server-only";

import {
  createGame,
  createRound,
  listGames,
  listGamesForRound,
  listPlayers,
  listRounds,
  recomputeScores,
  resolveGameRpc,
  setRoundStatus,
  updateTournament,
} from "@/lib/server/store";
import { afterGameResolved } from "@/lib/server/gameEvents";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { pair, type PairablePlayer } from "@/lib/tournament/pair";
import { variantStartFen } from "@/lib/chess/variants";
import {
  colorCounts,
  computeStandings,
  hadByeSet,
  metBeforeSet,
} from "@/lib/tournament/score";
import { maybeStartPlayoff } from "@/lib/server/playoff";
import type { Game, Tournament } from "@/lib/types";

/** Build pairings for a league round from current standings + history, then
 * create the round and its games (including a bye game when odd). */
async function pairLeagueRound(
  tournament: Tournament,
  roundNumber: number,
): Promise<void> {
  const [players, games] = await Promise.all([
    listPlayers(tournament.id),
    listGames(tournament.id),
  ]);
  const active = players.filter((p) => p.status === "active");
  const standings = computeStandings(active, games);
  const scoreById = new Map(standings.map((s) => [s.playerId, s]));

  const pairable: PairablePlayer[] = active.map((p) => ({
    id: p.id,
    score: scoreById.get(p.id)?.score ?? 0,
    tiebreak: scoreById.get(p.id)?.tiebreak ?? 0,
  }));

  const pairings = pair({
    players: pairable,
    round: roundNumber,
    metBefore: metBeforeSet(games),
    hadBye: hadByeSet(games),
    colors: colorCounts(games),
  });

  const round = await createRound(tournament.id, roundNumber, "league", "live");

  const startFen = variantStartFen(tournament.config.variant);
  for (const p of pairings) {
    await createGame({
      tournamentId: tournament.id,
      roundId: round.id,
      whitePlayerId: p.whiteId,
      blackPlayerId: p.blackId,
      startFen,
    });
  }
  // Byes immediately award a point.
  await recomputeScores(tournament.id);
}

/** Start the league: lobby → league, pair round 1, broadcast. */
export async function startLeague(tournament: Tournament): Promise<void> {
  await pairLeagueRound(tournament, 1);
  await updateTournament(tournament.id, { status: "league", current_round: 1 });
  await broadcast(channels.lobby(tournament.id), events.tournament, {
    started: true,
    round: 1,
  });
}

/** Are all non-bye games in the current round resolved? */
export async function currentRoundResolved(
  tournament: Tournament,
): Promise<boolean> {
  const rounds = await listRounds(tournament.id);
  const cur = rounds.find(
    (r) => r.number === tournament.current_round && r.phase === "league",
  );
  if (!cur) return false;
  const games = await listGamesForRound(cur.id);
  return games.every((g) => g.status !== "live");
}

/** Force-resolve: set every still-live game in the current round to a draw
 * (½–½), result_source = 'timeout_draw'. */
export async function forceResolveRound(tournament: Tournament): Promise<void> {
  const rounds = await listRounds(tournament.id);
  const cur = rounds.find(
    (r) => r.number === tournament.current_round && r.phase === "league",
  );
  if (!cur) return;
  const games = await listGamesForRound(cur.id);
  for (const g of games) {
    if (g.status === "live") {
      await resolveGameRpc(g.id, "draw", "timeout_draw");
      await afterGameResolved(g, "draw", "timeout_draw");
    }
  }
}

/** Advance to the next round. Caller must ensure the current round is resolved
 * (or call forceResolveRound first). Returns the new tournament status. */
export async function advanceRound(
  tournament: Tournament,
): Promise<"league" | "playoff" | "finished"> {
  // Mark the current league round done.
  const rounds = await listRounds(tournament.id);
  const cur = rounds.find(
    (r) => r.number === tournament.current_round && r.phase === "league",
  );
  if (cur) await setRoundStatus(cur.id, "done");

  const next = tournament.current_round + 1;

  if (next <= tournament.config.leagueRounds) {
    await pairLeagueRound(tournament, next);
    await updateTournament(tournament.id, { current_round: next });
    await broadcast(channels.lobby(tournament.id), events.tournament, {
      round: next,
    });
    return "league";
  }

  // League exhausted → playoff (if configured) or finish.
  const startedPlayoff = await maybeStartPlayoff(tournament);
  if (startedPlayoff) {
    await broadcast(channels.lobby(tournament.id), events.tournament, {
      playoff: true,
    });
    return "playoff";
  }

  await updateTournament(tournament.id, { status: "finished" });
  await broadcast(channels.lobby(tournament.id), events.tournament, {
    finished: true,
  });
  return "finished";
}

export type { Game };
