import { authHost } from "@/lib/server/auth";
import { forceResolveRound } from "@/lib/server/league";
import { fail, ok, readJson } from "@/lib/server/http";

// POST /api/round/force — teacher force-resolves remaining live games to draws
// (½–½, result_source 'timeout_draw') so the round can advance.
export async function POST(req: Request) {
  const body = await readJson<{ tournamentId?: string; hostCode?: string }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode);
  if (!t) return fail(401, "unauthorized");
  if (t.status !== "league") return fail(409, "not_in_league");

  try {
    await forceResolveRound(t);
    return ok({ ok: true });
  } catch (err) {
    console.error("[round/force]", err);
    return fail(500, "force_failed");
  }
}
