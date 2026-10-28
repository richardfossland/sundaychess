import { MAX_BODY_BYTES, PUBLIC_NAMES, type PublicNames } from "@/lib/physical/cloudTypes";
import { fail, ok, readJsonLimited, withApi } from "@/lib/server/http";
import { signPhysicalToken } from "@/lib/server/pair";
import {
  authPhysicalHost,
  getEventLog,
  getPhysical,
  hostCodeOf,
  limitFailure,
  rowFields,
  supersedeStaleReports,
  updateLog,
  validateLog,
} from "@/lib/server/physical";

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
    events: await getEventLog(row.id),
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
  // Size first: refuse before buffering/parsing/authing anything big.
  const parsed = await readJsonLimited<{ events?: unknown; baseVersion?: unknown; hostCode?: unknown; publicNames?: unknown }>(req, MAX_BODY_BYTES);
  if (parsed === "too_large") return fail(413, "payload_too_large");
  const body = parsed?.body;
  if (!body || !Number.isInteger(body.baseVersion) || (body.baseVersion as number) < 1) return fail(400, "bad_request");
  if (body.publicNames !== undefined && !PUBLIC_NAMES.includes(body.publicNames as PublicNames)) return fail(400, "bad_request");
  const row = await authPhysicalHost(id, hostCodeOf(req, body), req);
  if (!row) return fail(401, "invalid_code");
  const tooBig = limitFailure(body.events);
  if (tooBig) return tooBig;
  const t = validateLog(row.local_id ?? row.id, body.events);
  if (!t) return fail(422, "invalid_log");
  const fields = await rowFields(t, row.id, (body.publicNames as PublicNames | undefined) ?? row.public_names);
  const base = body.baseVersion as number;
  if (base === row.log_version) {
    const v = await updateLog(row.id, base, fields);
    if (v !== null) {
      await supersedeStaleReports(row.id, fields.public_snapshot);
      return ok({ version: v, hash: fields.log_hash });
    }
  }
  // Lost the race, or stale base: re-read. Same content already stored -> idempotent success.
  const cur = (await getPhysical(row.id)) ?? row;
  if (cur.log_hash === fields.log_hash) return ok({ version: cur.log_version, hash: fields.log_hash });
  return fail(409, "version_conflict", { version: cur.log_version });
});
