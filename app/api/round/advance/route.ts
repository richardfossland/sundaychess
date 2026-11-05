import { authHost } from "@/lib/server/auth";
import { advanceRound, currentRoundResolved } from "@/lib/server/league";
import { advancePlayoff, playoffRoundResolved } from "@/lib/server/playoff";
import { fail, ok, readJson, withApi } from "@/lib/server/http";

// POST /api/round/advance — teacher clicks "Neste runde". Guarded: every game
// in the current round must be resolved (play it out, override, or force).
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{
    tournamentId?: string;
    hostCode?: string;
    // Playoff draw handling: "rematch" (default) spawns a swap-colours rematch;
    // "ranking" sends the higher seed straight through (no rematch).
    tiebreak?: "rematch" | "ranking";
  }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode, req);
  if (!t) return fail(401, "unauthorized");

  try {
    if (t.status === "league") {
      if (!(await currentRoundResolved(t))) return fail(409, "round_unresolved");
      const next = await advanceRound(t);
      return ok({ status: next });
    }
    if (t.status === "playoff") {
      if (!(await playoffRoundResolved(t))) return fail(409, "round_unresolved");
      const next = await advancePlayoff(t, {
        resolveDrawsBySeed: body?.tiebreak === "ranking",
      });
      return ok({ status: next });
    }
    return fail(409, "not_in_progress");
  } catch (err) {
    // A drawn playoff game has no winner — the teacher must decide it first.
    if (err instanceof Error && err.message === "needs_decision") {
      return fail(409, "needs_decision");
    }
    // Dobbeltklikk er håndtert i start_round (0018): finnes en HEL neste runde
    // allerede, svarer advanceRound/advancePlayoff normalt (200). En halvbygd
    // runde (arv fra før 0018) er IKKE «ferdig» – si det ærlig, ikke 200.
    if (err instanceof Error && err.message === "round_incomplete") {
      return fail(409, "round_incomplete");
    }
    console.error("[round/advance]", err);
    return fail(500, "advance_failed");
  }
}
