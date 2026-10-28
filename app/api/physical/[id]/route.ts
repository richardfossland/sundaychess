import { isUuid } from "@/lib/codes";
import { publicSnapshot } from "@/lib/physical/snapshot";
import { clientIp, fail, ok, rateLimit, withApi } from "@/lib/server/http";
import { authPhysicalHost, deletePhysical, getPhysical, hostCodeOf, validateLog } from "@/lib/server/physical";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/physical/[id] — PUBLIC. Derived snapshot only (title, rounds,
// pairings, results, standings). Never the host code, never the raw log.
export const GET = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!isUuid(id)) return fail(404, "not_found");
  if (!rateLimit(`phys-get:${clientIp(req)}`, 600, 60_000)) return fail(429, "rate_limited");
  const row = await getPhysical(id);
  if (!row) return fail(404, "not_found");
  const t = validateLog(id, row.event_log);
  if (!t) return fail(503, "server_error");
  return ok(
    { ...publicSnapshot(t, row.updated_at), version: row.log_version },
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
