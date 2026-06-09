import { authHost } from "@/lib/server/auth";
import { advanceRound, currentRoundResolved } from "@/lib/server/league";
import { advancePlayoff, playoffRoundResolved } from "@/lib/server/playoff";
import { fail, ok, readJson } from "@/lib/server/http";

// POST /api/round/advance — teacher clicks "Neste runde". Guarded: every game
// in the current round must be resolved (play it out, override, or force).
export async function POST(req: Request) {
  const body = await readJson<{ tournamentId?: string; hostCode?: string }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode);
  if (!t) return fail(401, "unauthorized");

  try {
    if (t.status === "league") {
      if (!(await currentRoundResolved(t))) return fail(409, "round_unresolved");
      const next = await advanceRound(t);
      return ok({ status: next });
    }
    if (t.status === "playoff") {
      if (!(await playoffRoundResolved(t))) return fail(409, "round_unresolved");
      const next = await advancePlayoff(t);
      return ok({ status: next });
    }
    return fail(409, "not_in_progress");
  } catch (err) {
    // A drawn playoff game has no winner — the teacher must decide it first.
    if (err instanceof Error && err.message === "needs_decision") {
      return fail(409, "needs_decision");
    }
    console.error("[round/advance]", err);
    return fail(500, "advance_failed");
  }
}
