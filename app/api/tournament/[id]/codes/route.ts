import { authHost } from "@/lib/server/auth";
import { listPlayers } from "@/lib/server/store";
import { fail, ok, readJson, withApi } from "@/lib/server/http";
import { isUuid } from "@/lib/codes";

// POST /api/tournament/[id]/codes — teacher-only (host code). Returns each
// player's resume code so the teacher can read it back to a student who lost it.
// Codes are bearer tokens, so this is gated by the host code and never exposed
// in the public board state.
export const POST = withApi(handlePost);

async function handlePost(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  // Same malformed-id guard as the sibling GET /api/tournament/[id]: a bad
  // shape must answer "no such tournament", not throw into a false 503.
  if (!isUuid(id)) return fail(404, "not_found");
  const body = await readJson<{ hostCode?: string }>(req);

  const t = await authHost(id, body?.hostCode, req);
  if (!t) return fail(401, "unauthorized");

  const players = await listPlayers(id);
  return ok({
    players: players
      .filter((p) => p.status === "active")
      .map((p) => ({
        playerId: p.id,
        name: p.display_name,
        resumeCode: p.resume_code,
      })),
  });
}
