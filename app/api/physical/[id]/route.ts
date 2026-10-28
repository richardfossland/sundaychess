import { isUuid } from "@/lib/codes";
import { clientIp, fail, ok, rateLimit, withApi } from "@/lib/server/http";
import { authPhysicalHost, deletePhysical, getPublicSnapshot, hostCodeOf } from "@/lib/server/physical";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/physical/[id] — PUBLIC. Derived snapshot only (title, rounds,
// pairings, results, standings; names per the publish option). Never the host
// code, never the raw log.
export const GET = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!isUuid(id)) return fail(404, "not_found");
  if (!rateLimit(`phys-get:${clientIp(req)}`, 600, 60_000)) return fail(429, "rate_limited");
  // Reads the stored derived snapshot: never replays the log on a public request.
  const got = await getPublicSnapshot(id);
  if (!got) return fail(404, "not_found");
  return ok(
    { ...got.snapshot, version: got.version },
    { headers: { "cache-control": "public, max-age=3" } },
  );
});

// DELETE /api/physical/[id] — unpublish (host auth). The local tournament stays.
export const DELETE = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const row = await authPhysicalHost(id, hostCodeOf(req), req);
  if (!row) return fail(401, "invalid_code");
  await deletePhysical(row.id);
  return ok({ ok: true });
});
