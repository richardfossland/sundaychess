import { authHost } from "@/lib/server/auth";
import { listPlayers } from "@/lib/server/store";
import { startLeague } from "@/lib/server/league";
import { fail, ok, readJson } from "@/lib/server/http";

// POST /api/round/start — teacher starts the league (lobby → league, round 1).
export async function POST(req: Request) {
  const body = await readJson<{ tournamentId?: string; hostCode?: string }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode);
  if (!t) return fail(401, "unauthorized");
  if (t.status !== "lobby") return fail(409, "already_started");

  const players = await listPlayers(t.id);
  if (players.filter((p) => p.status === "active").length < 2) {
    return fail(409, "not_enough_players");
  }

  try {
    await startLeague(t);
    return ok({ status: "league" });
  } catch (err) {
    console.error("[round/start]", err);
    return fail(500, "start_failed");
  }
}
