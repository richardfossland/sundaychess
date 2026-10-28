import { fail, ok, withApi } from "@/lib/server/http";
import { authPhysicalHost, hostCodeOf, listPendingReports, toReportDto } from "@/lib/server/physical";

// GET /api/physical/[id]/reports — host auth. Pending reports.
export const GET = withApi(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const row = await authPhysicalHost(id, hostCodeOf(req), req);
  if (!row) return fail(401, "invalid_code");
  return ok({ reports: (await listPendingReports(row.id)).map(toReportDto) });
});
