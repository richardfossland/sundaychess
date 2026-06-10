import "server-only";

import {
  createGame,
  createRound,
  listGames,
  listGamesForRound,
  listPlayers,
  listRounds,
  setPlayerSeed,
  setRoundStatus,
  updateTournament,
} from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { computeStandings } from "@/lib/tournament/score";
import {
  buildFirstRound,
  effectivePlayoffSize,
  type SeededPlayer,
} from "@/lib/tournament/bracket";
import { variantStartFen } from "@/lib/chess/variants";
import type { Game, Tournament } from "@/lib/types";

/** Winner of a resolved game, or null if it has no decisive winner (draw /
 * aborted → the teacher must decide a playoff game). */
function winnerOf(g: Game): string | null {
  if (g.status === "white_win") return g.white_player_id;
  if (g.status === "black_win") return g.black_player_id;
  return null;
}

function currentPlayoffRound(rounds: { number: number; phase: string; id: string }[], n: number) {
  return rounds.find((r) => r.phase === "playoff" && r.number === n);
}

/** Seed top N by (score, Buchholz), build the first single-elim round, create
 * its games. Returns true when a bracket was started. */
export async function maybeStartPlayoff(
  tournament: Tournament,
): Promise<boolean> {
  if (!tournament.config.playoff) return false;

  const [players, games] = await Promise.all([
    listPlayers(tournament.id),
    listGames(tournament.id),
  ]);
  const active = players.filter((p) => p.status === "active");
  const size = effectivePlayoffSize(tournament.config.playoffSize, active.length);
  if (size === 0) return false;

  const standings = computeStandings(active, games);
  const top = standings.slice(0, size);

  const seeded: SeededPlayer[] = top.map((s, i) => ({
    playerId: s.playerId,
    seed: i + 1,
  }));
  await Promise.all(seeded.map((s) => setPlayerSeed(s.playerId, s.seed)));

  const matches = buildFirstRound(seeded);
  const round = await createRound(tournament.id, 1, "playoff", "live");
  const startFen = variantStartFen(tournament.config.variant);
  for (const m of matches) {
    if (!m.topPlayerId || !m.bottomPlayerId) continue;
    await createGame({
      tournamentId: tournament.id,
      roundId: round.id,
      whitePlayerId: m.topPlayerId,
      blackPlayerId: m.bottomPlayerId,
      startFen,
    });
  }

  await updateTournament(tournament.id, { status: "playoff", current_round: 1 });
  return true;
}

/** Every game in the current playoff round is resolved (decisive or not). */
export async function playoffRoundResolved(
  tournament: Tournament,
): Promise<boolean> {
  const rounds = await listRounds(tournament.id);
  const cur = currentPlayoffRound(rounds, tournament.current_round);
  if (!cur) return false;
  const games = await listGamesForRound(cur.id);
  return games.length > 0 && games.every((g) => g.status !== "live");
}

/** Advance the bracket: pair adjacent winners into the next round, or finish
 * when the final is decided. Throws 'needs_decision' if a game is drawn (the
 * teacher must override it to a winner first — spec §6). */
export async function advancePlayoff(
  tournament: Tournament,
): Promise<"playoff" | "finished"> {
  const rounds = await listRounds(tournament.id);
  const cur = currentPlayoffRound(rounds, tournament.current_round);
  if (!cur) throw new Error("no_playoff_round");

  const games = await listGamesForRound(cur.id);
  const winners: string[] = [];
  for (const g of games) {
    const w = winnerOf(g);
    if (!w) throw new Error("needs_decision");
    winners.push(w);
  }

  await setRoundStatus(cur.id, "done");

  // Final decided → champion is the lone winner.
  if (winners.length === 1) {
    await updateTournament(tournament.id, { status: "finished" });
    await broadcast(channels.lobby(tournament.id), events.tournament, {
      finished: true,
      champion: winners[0],
    });
    return "finished";
  }

  // Pair adjacent winners (preserves bracket structure from seedOrder).
  const nextNumber = tournament.current_round + 1;
  const round = await createRound(tournament.id, nextNumber, "playoff", "live");
  const startFen = variantStartFen(tournament.config.variant);
  for (let i = 0; i < winners.length; i += 2) {
    await createGame({
      tournamentId: tournament.id,
      roundId: round.id,
      whitePlayerId: winners[i],
      blackPlayerId: winners[i + 1],
      startFen,
    });
  }
  await updateTournament(tournament.id, { current_round: nextNumber });
  await broadcast(channels.lobby(tournament.id), events.tournament, {
    playoffRound: nextNumber,
  });
  return "playoff";
}
