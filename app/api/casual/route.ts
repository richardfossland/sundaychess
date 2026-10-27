import { createCasualGame } from "@/lib/server/casual";
import { fail, ok, readJson, rateLimit, clientIp, withApi } from "@/lib/server/http";

// POST /api/casual — start a casual 1v1 session, returns the join code + the
// challenger's bearer identity. The opponent joins via /api/casual/join.
async function handlePost(req: Request): Promise<Response> {
  if (!rateLimit(`casual:${clientIp(req)}`, 20, 60_000)) {
    return fail(429, "rate_limited");
  }
  const body = await readJson<{ name?: string }>(req);
  const name = (body?.name ?? "").toString().trim();
  if (name.length < 1) return fail(400, "missing_name");

  const identity = await createCasualGame(name.slice(0, 40));
  return ok(identity);
}

// A DB failure is a transient 503 (stable code), not a bespoke 500.
export const POST = withApi(handlePost);
