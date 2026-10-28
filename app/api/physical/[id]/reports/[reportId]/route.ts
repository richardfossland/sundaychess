import { isUuid } from "@/lib/codes";
import { fail, ok, readJson, withApi } from "@/lib/server/http";
import { authPhysicalHost, decideReport, hostCodeOf, toReportDto } from "@/lib/server/physical";

// POST /api/physical/[id]/reports/[reportId] { action: 'approve'|'reject' } —
// host auth. Only records the decision. Approving does NOT write a result on
// the server: the arbiter's client applies a setResult event (source
// 'player_report') locally and pushes the log. Idempotent.
export const POST = withApi(
  async (req: Request, { params }: { params: Promise<{ id: string; reportId: string }> }) => {
    const { id, reportId } = await params;
    const body = await readJson<{ action?: unknown; hostCode?: unknown }>(req);
    const row = await authPhysicalHost(id, hostCodeOf(req, body), req);
    if (!row) return fail(401, "invalid_code");
    if (!isUuid(reportId)) return fail(404, "not_found");
    if (body?.action !== "approve" && body?.action !== "reject") return fail(400, "bad_request");
    const rep = await decideReport(row.id, reportId, body.action === "approve" ? "approved" : "rejected");
    if (!rep) return fail(404, "not_found");
    return ok({ report: toReportDto(rep) });
  },
);
