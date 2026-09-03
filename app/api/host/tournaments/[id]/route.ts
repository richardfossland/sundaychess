import { requireHost, authFail } from "@/lib/server/auth";
import { deleteTournamentOwned } from "@/lib/server/store";
import { fail, ok } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";

// DELETE /api/host/tournaments/[id] — delete a tournament the signed-in host
// OWNS. Authorization layers: requireHost() (401 no session / 403 not allow-
// listed), then deleteTournamentOwned double-gates on host_user_id so the host
// can only delete their OWN tournaments (404 otherwise). Children cascade.
export async function DELETE(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  try {
    const host = await requireHost();
    const { id } = await ctx.params;
    // Malformed id is a client error, not an outage: a non-UUID `.eq("id", id)`
    // throws 22P02 in Postgres. Answer the same not_found a real-but-unowned
    // id gets, rather than letting the query throw into a false 503.
    if (!isUuid(id)) return fail(404, "not_found");
    const deleted = await deleteTournamentOwned(id, host.id);
    if (!deleted) return fail(404, "not_found");
    return ok({ ok: true });
  } catch (err) {
    const denied = authFail(err);
    if (denied) return denied;
    console.error("[host/tournaments DELETE]", err);
    return fail(503, "server_error");
  }
}
