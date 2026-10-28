import { fail, ok, withApi } from "@/lib/server/http";
import { signBoardKey } from "@/lib/server/pair";
import { authPhysicalHost, hostCodeOf } from "@/lib/server/physical";

type Ctx = { params: Promise<{ id: string }> };

// GET /api/physical/[id]/keys?round=N&boards=40 — host auth. The board keys `k`
// for boards 1..boards of round N, to print in the QR on the board cards. The
// client caches them, so printing works offline after one fetch.
export const GET = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  const row = await authPhysicalHost(id, hostCodeOf(req), req);
  if (!row) return fail(401, "invalid_code");
  const q = new URL(req.url).searchParams;
  const round = Number(q.get("round"));
  const boards = Number(q.get("boards"));
  if (!Number.isInteger(round) || round < 1 || round > 99) return fail(400, "bad_request");
  if (!Number.isInteger(boards) || boards < 1 || boards > 300) return fail(400, "bad_request");
  const keys: Record<string, string> = {};
  for (let b = 1; b <= boards; b++) {
    const k = await signBoardKey(row.id, round, b);
    if (!k) return fail(503, "reports_unavailable");
    keys[`${round}|${b}`] = k;
  }
  return ok({ keys });
});
