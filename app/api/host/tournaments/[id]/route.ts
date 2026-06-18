import { requireHost, authFail } from "@/lib/server/auth";
import { deleteTournamentOwned } from "@/lib/server/store";
import { fail, ok } from "@/lib/server/http";

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
