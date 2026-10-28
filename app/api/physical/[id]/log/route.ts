import { fail, ok, readJson, withApi } from "@/lib/server/http";
import { signPhysicalToken } from "@/lib/server/pair";
import { authPhysicalHost, hashLog, hostCodeOf, getPhysical, updateLog, validateLog } from "@/lib/server/physical";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/physical/[id]/log — host auth. The full log, for opening the
// tournament on another device.
export const GET = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const row = await authPhysicalHost(id, hostCodeOf(req), req);
  if (!row) return fail(401, "invalid_code");
  // The caller just proved the host code, so hand back the code (normalised) and a
  // pair token too: that is how a second device ends up "paired" after opening.
  return ok({
    events: row.event_log,
    version: row.log_version,
    hash: row.log_hash,
    hostCode: row.host_code,
    pairToken: await signPhysicalToken(row.id, row.host_code),
  });
});

// PUT /api/physical/[id]/log { events, baseVersion, hostCode? } — push the log.
// Optimistic concurrency on log_version: 409 `version_conflict` (with the
// current version) when someone else pushed since baseVersion. Idempotent: a
// retry of a push that already landed (same hash) answers 200 with the version.
// The log is REPLAYED through the reducer before it is stored (422 otherwise).
export const PUT = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const body = await readJson<{ events?: unknown; baseVersion?: unknown; hostCode?: unknown }>(req);
  if (!body || !Number.isInteger(body.baseVersion) || (body.baseVersion as number) < 1) return fail(400, "bad_request");
  const row = await authPhysicalHost(id, hostCodeOf(req, body), req);
  if (!row) return fail(401, "invalid_code");
  const t = validateLog(row.id, body.events);
  if (!t) return fail(422, "invalid_log");
  const hash = await hashLog(t.events);
  const base = body.baseVersion as number;
  if (base === row.log_version) {
    const v = await updateLog(row.id, base, { title: t.title, event_log: t.events, log_hash: hash });
    if (v !== null) return ok({ version: v, hash });
  }
  // Lost the race, or stale base: re-read. Same content already stored -> idempotent success.
  const cur = (await getPhysical(row.id)) ?? row;
  if (cur.log_hash === hash) return ok({ version: cur.log_version, hash });
  return fail(409, "version_conflict", { version: cur.log_version });
});
