import { authHost } from "@/lib/server/auth";
import { forceResolveRound } from "@/lib/server/league";
import { fail, ok, readJson, withApi } from "@/lib/server/http";

// POST /api/round/force — teacher force-resolves remaining live games to draws
// (½–½, result_source 'timeout_draw') so the round can advance. Works in league
// OR playoff (a stuck knockout round can be drawn out; advancePlayoff then
// applies tiebreak/draw-odds).
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  const body = await readJson<{ tournamentId?: string; hostCode?: string }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode, req);
  if (!t) return fail(401, "unauthorized");
  if (t.status !== "league" && t.status !== "playoff") {
    return fail(409, "not_in_progress");
  }

  try {
    await forceResolveRound(t);
    return ok({ ok: true });
  } catch (err) {
    console.error("[round/force]", err);
    return fail(500, "force_failed");
  }
}
