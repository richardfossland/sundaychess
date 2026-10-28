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
import { pairRound } from "@/lib/tournament/pairing";
import type { PairingPlayer } from "@/lib/tournament/pairing/types";
import { computeStandings as computeTiebreakStandings, resolveTiebreaks } from "@/lib/tournament/tiebreaks";
import { variantStartFen } from "@/lib/chess/variants";
import {
  byeCounts,
  colorCounts,
  computeStandings,
  gamesToHistory,
  metBeforeSet,
} from "@/lib/tournament/score";
import { maybeStartPlayoff } from "@/lib/server/playoff";
import type { Game, Player, Round, Tournament } from "@/lib/types";

/** Pair a league round with the configured engine (`config.pairingSystem`):
 * real start numbers, ratings, bye types and forfeit-aware history — so rounds
 * carried over from a physical tournament count exactly as they did there.
 * Exported for tests. Returns the pairings as `{white, black, byeType}` in board order. */
export function enginePairings(
  tournament: Tournament,
  players: Player[],
  games: Game[],
  rounds: Round[],
  roundNumber: number,
) {
  const system = tournament.config.pairingSystem!;
  const history = gamesToHistory(games, rounds);
  const order = resolveTiebreaks(tournament.config.tiebreaks);
  const table = computeTiebreakStandings(
    players.map((p) => ({ id: p.id, rating: p.rating ?? undefined })),
    history,
    order,
  );
  const byId = new Map(table.map((r) => [r.playerId, r]));
  // Start numbers: stored ones first; players without (free joiners) follow in join order.
  let next = players.reduce((m, p) => Math.max(m, p.start_no ?? 0), 0);
  const pairing: PairingPlayer[] = players.map((p) => ({
    id: p.id,
    startNo: p.start_no ?? ++next,
    rating: p.rating ?? undefined,
    score: byId.get(p.id)?.score ?? 0,
    tiebreak: byId.get(p.id)?.values.buchholz ?? 0,
    status: p.status === "active" ? "active" : "withdrawn",
  }));
  const out = pairRound(
    system,
    { players: pairing, history, round: roundNumber },
    { double: !!tournament.config.doubleRoundRobin },
  );
  const halfBye = tournament.config.byePoints === 0.5 && system !== "roundRobin";
  return out.pairings.map((b) => ({
    white: b.white,
    black: b.black,
    byeType: b.black === null ? (b.byeType === "full" || !b.byeType ? (halfBye ? ("half" as const) : ("full" as const)) : b.byeType) : undefined,
  }));
}

/** Build pairings for a league round from current standings + history, then
 * create the round and its games (including a bye game when odd). */
async function pairLeagueRound(
  tournament: Tournament,
  roundNumber: number,
): Promise<void> {
  const [players, games, rounds] = await Promise.all([
    listPlayers(tournament.id),
    listGames(tournament.id),
    listRounds(tournament.id),
  ]);
  const startFen = variantStartFen(tournament.config.variant);

  if (tournament.config.pairingSystem) {
    const pairings = enginePairings(tournament, players, games, rounds, roundNumber);
    const round = await createRound(tournament.id, roundNumber, "league", "live");
    for (let i = 0; i < pairings.length; i++) {
      const p = pairings[i];
      const bt = p.byeType;
      await createGame({
        tournamentId: tournament.id,
        roundId: round.id,
        whitePlayerId: p.white,
        blackPlayerId: p.black,
        startFen,
        slot: i,
        ...(p.black === null && bt && bt !== "full"
          ? {
              status: bt === "half" ? ("draw" as const) : ("aborted" as const),
              resultSource: "physical" as const,
            }
          : {}),
      });
    }
    await recomputeScores(tournament.id);
    return;
  }

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
    byeCounts: byeCounts(games),
    colors: colorCounts(games),
    // Real colour sequences (round numbers + forfeit flag) so "never 3 of the
    // same colour in a row" holds in the league, and forfeits give no colour.
    history: gamesToHistory(games, rounds),
  });

  const round = await createRound(tournament.id, roundNumber, "league", "live");

  for (let i = 0; i < pairings.length; i++) {
    const p = pairings[i];
    await createGame({
      tournamentId: tournament.id,
      roundId: round.id,
      whitePlayerId: p.whiteId,
      blackPlayerId: p.blackId,
      startFen,
      slot: i,
    });
  }
  // Byes immediately award a point.
  await recomputeScores(tournament.id);
}

/** Start the league: lobby → league, pair the next round (round 1, or — for a
 * tournament continued from a physical one — the round after the carried-over
 * ones), broadcast. */
export async function startLeague(tournament: Tournament): Promise<void> {
  const next = (tournament.current_round ?? 0) + 1;
  await pairLeagueRound(tournament, next);
  await updateTournament(tournament.id, { status: "league", current_round: next });
  await broadcast(channels.lobby(tournament.id), events.tournament, {
    started: true,
    round: next,
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
  // length>0: an empty (0-game) round is NOT "resolved" — treating it as resolved
  // let advance wedge on a round that can never be force-resolved or advanced.
  return games.length > 0 && games.every((g) => g.status !== "live");
}

/** Force-resolve: set every still-live game in the current round to a draw
 * (½–½), result_source = 'timeout_draw'. Works in either phase — a playoff round
 * reuses league round numbers, so we key off the tournament's current phase to
 * pick the right round (otherwise an abandoned playoff round can't be resolved).
 * A drawn playoff game then flows through advancePlayoff's tiebreak/draw-odds. */
export async function forceResolveRound(tournament: Tournament): Promise<void> {
  const rounds = await listRounds(tournament.id);
  const phase = tournament.status === "playoff" ? "playoff" : "league";
  const cur = rounds.find(
    (r) => r.number === tournament.current_round && r.phase === phase,
  );
  if (!cur) return;
  const games = await listGamesForRound(cur.id);
  let resolvedAny = false;
  for (const g of games) {
    if (g.status === "live") {
      await resolveGameRpc(g.id, "draw", "timeout_draw");
      // skipRecompute: the full-tournament score aggregate is run ONCE below
      // instead of once per board (it was firing N identical writes per round).
      await afterGameResolved(g, "draw", "timeout_draw", { skipRecompute: true });
      resolvedAny = true;
    }
  }
  if (resolvedAny) await recomputeScores(tournament.id);
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
    // If everyone has left, pairing would create an empty, un-advanceable round
    // that wedges the tournament. Finish instead.
    const active = (await listPlayers(tournament.id)).filter(
      (p) => p.status === "active",
    );
    if (active.length < 2) {
      await updateTournament(tournament.id, { status: "finished" });
      await broadcast(channels.lobby(tournament.id), events.tournament, {
        finished: true,
      });
      return "finished";
    }
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
