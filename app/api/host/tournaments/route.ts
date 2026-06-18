import { requireHost, authFail } from "@/lib/server/auth";
import { listTournamentsByOwner } from "@/lib/server/store";
import { fail, ok } from "@/lib/server/http";

// GET /api/host/tournaments — the signed-in Sunday Account host's own
// tournaments (no secrets returned beyond the host's own join PIN/host code,
// which they already own). 401 if not signed in, 403 if not allow-listed.
export async function GET() {
  try {
    const host = await requireHost();
    const rows = await listTournamentsByOwner(host.id);
    return ok({
      tournaments: rows.map((t) => ({
        id: t.id,
        title: t.title,
        status: t.status,
        joinPin: t.join_pin,
        hostCode: t.host_code,
        createdAt: t.created_at,
      })),
    });
  } catch (err) {
    const denied = authFail(err);
    if (denied) return denied;
    console.error("[host/tournaments GET]", err);
    return fail(503, "server_error");
  }
}
