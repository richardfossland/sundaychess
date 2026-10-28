import { MAX_BODY_BYTES, MAX_PUBLISHES_PER_DAY } from "@/lib/physical/cloudTypes";
import { buildDigitalPlan, continueRefusal } from "@/lib/physical/toDigital";
import { registerCodeFailure } from "@/lib/server/attempts";
import { getHost } from "@/lib/server/auth";
import { createDigitalFromPlan } from "@/lib/server/fromPhysical";
import { fail, ipKey, ok, rateLimit, readJsonLimited, withApi } from "@/lib/server/http";
import { signPairToken } from "@/lib/server/pair";
import { limitFailure, validateLog } from "@/lib/server/physical";
import type { PhysicalEvent } from "@/lib/physical/schema";

// POST /api/tournament/from-physical { events } — continue a physical tournament
// DIGITALLY (M5b). Anonymous like /api/tournament (a signed-in Sunday Account host
// is stamped as owner). Same defences as /api/physical/publish, in the same order:
// raw body size -> event/player caps -> DB-backed per-IP daily budget (the SAME
// `publish` scope, so this cannot be used to get around it) -> ONLY THEN replay.
// Refusals (409, stable code): knockout, roundOpen, noRoundsLeft, tooManyRounds,
// tooFewPlayers.
export const POST = withApi(handlePost);

async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`phys-cont:${ipKey(req)}`, 20, 600_000)) return fail(429, "rate_limited");
  const parsed = await readJsonLimited<{ events?: unknown }>(req, MAX_BODY_BYTES);
  if (parsed === "too_large") return fail(413, "payload_too_large");
  if (!parsed || !Array.isArray(parsed.body.events)) return fail(400, "bad_request");
  const events = parsed.body.events as unknown[];
  const tooBig = limitFailure(events);
  if (tooBig) return tooBig;

  if (await registerCodeFailure("publish", req, { max: MAX_PUBLISHES_PER_DAY + 1, windowS: 86_400 })) {
    return fail(429, "rate_limited");
  }

  const t = validateLog(null, events as PhysicalEvent[]);
  if (!t) return fail(422, "invalid_log");
  const refusal = continueRefusal(t);
  if (refusal) return fail(409, refusal);

  const host = await getHost(); // null for anonymous — never throws
  const created = await createDigitalFromPlan(buildDigitalPlan(t), host?.id ?? null);
  return ok(
    {
      id: created.id,
      joinPin: created.join_pin,
      hostCode: created.host_code,
      pairToken: await signPairToken(created.id, created.host_code),
    },
    { status: 201 },
  );
}
