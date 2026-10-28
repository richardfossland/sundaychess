import { isUuid } from "@/lib/codes";
import {
  DEVICE_ID_RE,
  REPORTERS,
  REPORT_RESULTS,
  REQUEST_ID_RE,
  type ReportResult,
  type Reporter,
} from "@/lib/physical/cloudTypes";
import { fail, ipKey, ok, rateLimit, readJson, withApi } from "@/lib/server/http";
import { signBoardKey, verifyBoardKey } from "@/lib/server/pair";
import { addReport, findReportByRequestId, fingerprintOf, getPublicSnapshot, RequestIdTaken, toReportDto } from "@/lib/server/physical";

type Ctx = { params: Promise<{ id: string }> };

// POST /api/physical/[id]/report — PUBLIC, from the QR on a board card.
// { round, board, result, reporter, requestId, k }. `k` = HMAC(PAIR_SECRET,
// "board|<id>|<round>|<board>") printed in the QR: only someone holding that
// card can report. Idempotent on requestId (a flaky-network retry is safe). One
// pending report per (round, board, DEVICE); a newer one replaces the older.
// `deviceId` is a random id the phone keeps in localStorage. `fp` (optional) =
// "<white id>|<black id>" as the phone saw it: if the arbiter has since swapped
// the board the report is refused (409 pairing_changed) instead of being credited
// to the wrong players. The server stores the CURRENT fingerprint with the report.
// Reads the stored public snapshot only: never replays the log.
// Only for a published, not-completed round whose board has no result yet.
// The report is a PROPOSAL: the arbiter's client applies it as a setResult event.
export const POST = withApi(async (req: Request, { params }: Ctx) => {
  const { id } = await params;
  if (!isUuid(id)) return fail(404, "not_found");
  // A hall = one public IP, ~30 phones, one report each per round.
  if (!rateLimit(`phys-rep:${ipKey(req)}`, 120, 600_000)) return fail(429, "rate_limited");
  if (!rateLimit(`phys-rep-t:${id}`, 600, 600_000)) return fail(429, "rate_limited");
  const b = await readJson<Record<string, unknown>>(req);
  if (!b) return fail(400, "bad_request");
  const { round, board, result, reporter, requestId, k, deviceId, fp } = b;
  if (!Number.isInteger(round) || (round as number) < 1 || (round as number) > 99) return fail(400, "bad_request");
  if (!Number.isInteger(board) || (board as number) < 1 || (board as number) > 999) return fail(400, "bad_request");
  if (!REPORT_RESULTS.includes(result as ReportResult)) return fail(400, "bad_request");
  if (!REPORTERS.includes(reporter as Reporter)) return fail(400, "bad_request");
  if (typeof requestId !== "string" || !REQUEST_ID_RE.test(requestId)) return fail(400, "bad_request");
  if (typeof deviceId !== "string" || !DEVICE_ID_RE.test(deviceId)) return fail(400, "bad_request");
  if (fp !== undefined && (typeof fp !== "string" || fp.length > 100)) return fail(400, "bad_request");
  if (!(await signBoardKey(id, 1, 1))) return fail(503, "reports_unavailable");
  if (!(await verifyBoardKey(id, round as number, board as number, k))) return fail(403, "bad_key");

  const got = await getPublicSnapshot(id);
  if (!got) return fail(404, "not_found");
  const r = got.snapshot.rounds.find((x) => x.number === round);
  if (!r) return fail(409, "round_not_open"); // drafts are not in the public snapshot
  const p = r.pairings.find((x) => x.board === board);
  if (!p || p.black === null) return fail(404, "board_not_found");
  const currentFp = fingerprintOf(got.snapshot, round as number, board as number) as string;

  // Retry of a report that already landed answers the same, whatever the board looks like now.
  try {
    if (r.status === "completed" || p.result) {
      const prev = await findReportByRequestId(requestId);
      if (prev && prev.tournament_id === id) return ok({ report: toReportDto(prev) });
      return fail(409, r.status === "completed" ? "round_closed" : "already_has_result");
    }
    if (typeof fp === "string" && fp !== currentFp) {
      const prev = await findReportByRequestId(requestId);
      if (prev && prev.tournament_id === id) return ok({ report: toReportDto(prev) });
      return fail(409, "pairing_changed");
    }
    const rep = await addReport({
      tournamentId: id,
      round: round as number,
      board: board as number,
      result: result as ReportResult,
      reporter: reporter as Reporter,
      requestId,
      deviceId,
      pairingFp: currentFp,
    });
    return ok({ report: toReportDto(rep) });
  } catch (e) {
    if (e instanceof RequestIdTaken) return fail(409, "request_id_taken");
    throw e;
  }
});
