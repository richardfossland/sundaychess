import { authHost } from "@/lib/server/auth";
import { listRounds, setRoundStartedAt } from "@/lib/server/store";
import { broadcast } from "@/lib/server/broadcast";
import { channels, events } from "@/lib/realtime";
import { fail, ok, readJson } from "@/lib/server/http";

// POST /api/round/extend — teacher adds +1 minute to the current round timer by
// pushing the round's start time 60s later (the countdown = startedAt + timer).
export async function POST(req: Request) {
  const body = await readJson<{ tournamentId?: string; hostCode?: string }>(req);
  const t = await authHost(body?.tournamentId, body?.hostCode);
  if (!t) return fail(401, "unauthorized");

  const phase = t.status === "playoff" ? "playoff" : "league";
  const rounds = await listRounds(t.id);
  const cur = rounds.find((r) => r.number === t.current_round && r.phase === phase);
  if (!cur || !cur.started_at) return fail(409, "no_round");

  const next = new Date(new Date(cur.started_at).getTime() + 60_000).toISOString();
  await setRoundStartedAt(cur.id, next);
  await broadcast(channels.lobby(t.id), events.tournament, { timerExtended: cur.id });

  return ok({ startedAt: next });
}
