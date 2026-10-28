import type { PhysicalEvent, PhysicalTournament } from "@/lib/physical/schema";
import { generateHostCode, isUuid } from "@/lib/codes";
import { fail, ipKey, ok, rateLimit, readJson, withApi } from "@/lib/server/http";
import { signPhysicalToken } from "@/lib/server/pair";
import {
  authPhysicalHost,
  getPhysical,
  hashLog,
  hostCodeOf,
  insertPhysical,
  updateLog,
  validateLog,
} from "@/lib/server/physical";

// POST /api/physical/publish { events, hostCode? } — first publish of a local
// physical tournament. Creates the row (id = local tournament id), generates a
// host code and returns it together with a pair token. The log is replayed
// through the same reducer the arbiter's device uses, so an invalid log is a 422.
// A second publish of an already-published id needs the host code/token (then it
// is an overwrite: re-publish after the arbiter lost their local cloud state).
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`phys-pub:${ipKey(req)}`, 20, 600_000)) return fail(429, "rate_limited");
  const body = await readJson<{ events?: unknown; hostCode?: unknown }>(req);
  if (!body || !Array.isArray(body.events)) return fail(400, "bad_request");
  const t = validateAnyId(body.events);
  if (!t || !isUuid(t.id)) return fail(422, "invalid_log");
  const hash = await hashLog(t.events);

  const existing = await getPhysical(t.id);
  if (existing) {
    const row = await authPhysicalHost(t.id, hostCodeOf(req, body), req);
    if (!row) return fail(409, "already_published");
    const v = await updateLog(row.id, row.log_version, { title: t.title, event_log: t.events, log_hash: hash });
    if (v === null) return fail(409, "version_conflict");
    return ok({ id: row.id, hostCode: row.host_code, pairToken: await signPhysicalToken(row.id, row.host_code), version: v, hash });
  }

  const hostCode = generateHostCode();
  const res = await insertPhysical({ id: t.id, host_code: hostCode, title: t.title, event_log: t.events, log_hash: hash });
  if (res === "exists") return fail(409, "already_published"); // lost a race
  return ok({ id: t.id, hostCode, pairToken: await signPhysicalToken(t.id, hostCode), version: 1, hash }, { status: 201 });
}

/** Validate with the id taken from the log itself (publish does not know it up front). */
function validateAnyId(events: unknown[]): PhysicalTournament | null {
  const first = events[0] as { tournamentId?: unknown } | undefined;
  return typeof first?.tournamentId === "string" ? validateLog(first.tournamentId, events as PhysicalEvent[]) : null;
}
