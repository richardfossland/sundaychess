import "server-only";

import { generateResumeCode, generateUnique } from "@/lib/codes";
import { variantStartFen } from "@/lib/chess/variants";
import type { DigitalPlan } from "@/lib/physical/toDigital";
import {
  createRound,
  createTournament,
  deleteTournament,
  insertFinishedGames,
  insertPreRegisteredPlayers,
  recomputeScores,
  updateTournament,
} from "@/lib/server/store";
import type { Tournament } from "@/lib/types";

/** Write a DigitalPlan: tournament in the LOBBY (so students can claim names),
 * `current_round` = completed physical rounds, every round `done` with result-only
 * games, scores recomputed through the normal RPC. Cleans up on failure. */
export async function createDigitalFromPlan(
  plan: DigitalPlan,
  hostUserId: string | null,
): Promise<Tournament> {
  const t = await createTournament(plan.title.slice(0, 80) || null, plan.config, hostUserId);
  try {
    const taken = new Set<string>();
    const rows = plan.players.map((p) => {
      const resume_code = generateUnique(generateResumeCode, taken);
      taken.add(resume_code);
      return {
        display_name: p.name.slice(0, 40),
        resume_code,
        rating: p.rating ?? null,
        club: p.club ?? null,
        start_no: p.startNo,
        status: p.status,
      };
    });
    const inserted = await insertPreRegisteredPlayers(t.id, rows);
    // Rows come back in insert order only per chunk; map by start_no to be safe.
    const idByKey = new Map<string, string>();
    const byStart = new Map(inserted.map((p) => [p.start_no, p.id]));
    for (const p of plan.players) {
      const id = byStart.get(p.startNo);
      if (!id) throw new Error("player_insert_mismatch");
      idByKey.set(p.key, id);
    }
    const fen = variantStartFen(undefined);
    for (const r of plan.rounds) {
      const round = await createRound(t.id, r.number, "league", "done");
      await insertFinishedGames(
        t.id,
        r.games.map((g) => ({
          roundId: round.id,
          whitePlayerId: idByKey.get(g.white)!,
          blackPlayerId: g.black ? idByKey.get(g.black)! : null,
          status: g.status,
          resultSource: g.resultSource,
          slot: g.slot,
        })),
        fen,
      );
    }
    const updated = await updateTournament(t.id, { current_round: plan.rounds.length });
    await recomputeScores(t.id);
    return updated;
  } catch (e) {
    await deleteTournament(t.id).catch(() => {});
    throw e;
  }
}
