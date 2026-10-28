import {
  DEFAULT_PUBLIC_NAMES,
  MAX_BODY_BYTES,
  MAX_PUBLISHES_PER_DAY,
  PUBLIC_NAMES,
  type PublicNames,
} from "@/lib/physical/cloudTypes";
import type { PhysicalEvent } from "@/lib/physical/schema";
import { generateHostCode, isUuid } from "@/lib/codes";
import { fail, ipKey, ok, rateLimit, readJsonLimited, withApi } from "@/lib/server/http";
import { registerCodeFailure } from "@/lib/server/attempts";
import { signPhysicalToken } from "@/lib/server/pair";
import {
  authPhysicalHost,
  getPhysical,
  hostCodeOf,
  insertPhysical,
  limitFailure,
  rowFields,
  supersedeStaleReports,
  updateLog,
  validateLog,
} from "@/lib/server/physical";

// POST /api/physical/publish { events, hostCode?, cloudId?, publicNames? } — first
// publish of a local physical tournament. Creates the row (id = cloudId, which is
// the local tournament id unless the client had to pick another one after an id
// collision), generates a host code and returns it together with a pair token.
//
// Order matters (anonymous endpoint): raw body size -> shape/caps -> DB-backed
// per-IP daily publish budget -> ONLY THEN the O(n) replay through the reducer.
// A second publish of an existing id needs the host code/token (an overwrite);
// without it: 409 `already_published` and the client retries with a fresh cloudId.
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`phys-pub:${ipKey(req)}`, 20, 600_000)) return fail(429, "rate_limited");
  const parsed = await readJsonLimited<{ events?: unknown; hostCode?: unknown; cloudId?: unknown; publicNames?: unknown }>(req, MAX_BODY_BYTES);
  if (parsed === "too_large") return fail(413, "payload_too_large");
  if (!parsed || !Array.isArray(parsed.body.events)) return fail(400, "bad_request");
  const body = parsed.body;
  const events = body.events as unknown[];
  const tooBig = limitFailure(events);
  if (tooBig) return tooBig;
  if (body.publicNames !== undefined && !PUBLIC_NAMES.includes(body.publicNames as PublicNames)) return fail(400, "bad_request");
  if (body.cloudId !== undefined && !isUuid(body.cloudId)) return fail(400, "bad_request");

  // Budget per IP per day, counted for EVERY publish (also the ones that turn out invalid).
  if (await registerCodeFailure("publish", req, { max: MAX_PUBLISHES_PER_DAY + 1, windowS: 86_400 })) return fail(429, "rate_limited");

  const first = events[0] as { tournamentId?: unknown } | undefined;
  const t = typeof first?.tournamentId === "string" ? validateLog(first.tournamentId, events as PhysicalEvent[]) : null;
  if (!t || !isUuid(t.id)) return fail(422, "invalid_log");
  const cloudId = (body.cloudId as string | undefined) ?? t.id;

  const existing = await getPhysical(cloudId);
  if (existing) {
    const row = await authPhysicalHost(cloudId, hostCodeOf(req, body), req);
    if (!row) return fail(409, "already_published");
    if (t.id !== (row.local_id ?? row.id)) return fail(409, "already_published");
    const fields = await rowFields(t, row.id, (body.publicNames as PublicNames | undefined) ?? row.public_names);
    const v = await updateLog(row.id, row.log_version, fields);
    if (v === null) return fail(409, "version_conflict");
    await supersedeStaleReports(row.id, fields.public_snapshot);
    return ok({ id: row.id, hostCode: row.host_code, pairToken: await signPhysicalToken(row.id, row.host_code), version: v, hash: fields.log_hash });
  }

  const hostCode = generateHostCode();
  const fields = await rowFields(t, cloudId, (body.publicNames as PublicNames | undefined) ?? DEFAULT_PUBLIC_NAMES);
  const res = await insertPhysical({ ...fields, id: cloudId, host_code: hostCode, local_id: cloudId === t.id ? null : t.id });
  if (res === "exists") return fail(409, "already_published"); // lost a race
  return ok({ id: cloudId, hostCode, pairToken: await signPhysicalToken(cloudId, hostCode), version: 1, hash: fields.log_hash }, { status: 201 });
}
