import "server-only";

import { isUuid, normalizeResumeCode } from "@/lib/codes";
import { canonicalJson, sha256Hex } from "@/lib/export/hash";
import { MAX_EVENTS, MAX_LOG_BYTES, type ReportDto, type ReportResult, type Reporter } from "@/lib/physical/cloudTypes";
import { replay } from "@/lib/physical/reducer";
import type { PhysicalEvent, PhysicalTournament } from "@/lib/physical/schema";
import { createServiceClient } from "@/lib/supabase/service";
import { isCodeBlocked, registerCodeFailure } from "@/lib/server/attempts";
import { RateLimitedError, must } from "@/lib/server/http";
import { PAIR_HEADER, verifyPhysicalToken } from "@/lib/server/pair";

export interface PhysicalRow {
  id: string;
  host_code: string;
  title: string;
  event_log: PhysicalEvent[];
  log_version: number;
  log_hash: string;
  updated_at: string;
  created_at: string;
}

const db = () => createServiceClient();

export async function getPhysical(id: string): Promise<PhysicalRow | null> {
  const { data, error } = await db().from("physical_tournaments").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as PhysicalRow | null) ?? null;
}

export const hashLog = (events: readonly PhysicalEvent[]) => sha256Hex(canonicalJson(events));

/** Validate an uploaded log: shape, size, then a full replay through the
 * reducer (every invariant the arbiter's own device enforces). Returns the
 * state or null when invalid (-> 422). Never throws. */
export function validateLog(id: string, events: unknown): PhysicalTournament | null {
  if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS) return null;
  try {
    if (JSON.stringify(events).length > MAX_LOG_BYTES) return null;
    const t = replay(events as PhysicalEvent[]);
    return t.id === id ? t : null;
  } catch {
    return null;
  }
}

export async function insertPhysical(
  row: Pick<PhysicalRow, "id" | "host_code" | "title" | "event_log" | "log_hash">,
): Promise<"created" | "exists"> {
  const { error } = await db().from("physical_tournaments").insert({ ...row, log_version: 1 });
  if (!error) return "created";
  if ((error as { code?: string }).code === "23505") return "exists";
  throw error;
}

/** Optimistic concurrency: updates only when log_version still equals `base`. */
export async function updateLog(
  id: string,
  base: number,
  fields: { title: string; event_log: PhysicalEvent[]; log_hash: string },
): Promise<number | null> {
  const { data, error } = await db()
    .from("physical_tournaments")
    .update({ ...fields, log_version: base + 1, updated_at: new Date().toISOString() })
    .eq("id", id)
    .eq("log_version", base)
    .select("log_version");
  if (error) throw error;
  return data && data.length > 0 ? (data[0] as { log_version: number }).log_version : null;
}

export async function deletePhysical(id: string): Promise<void> {
  must(await db().from("physical_tournaments").delete().eq("id", id));
}

/** Host auth for a physical tournament. Mirrors authHost (lib/server/auth.ts):
 * a valid pair token for the CURRENT host code wins outright; otherwise a
 * blocked IP gets RateLimitedError, a wrong code is counted, and a correct code
 * re-checks the block with `fresh` (no oracle). Scope `phys:<id>`. */
export async function authPhysicalHost(
  id: unknown,
  hostCode: unknown,
  req: Request,
): Promise<PhysicalRow | null> {
  if (!isUuid(id)) return null;
  const token = req.headers.get(PAIR_HEADER) ?? null;
  const code = typeof hostCode === "string" ? hostCode : "";
  if (!token && !code) return null;
  const scope = `phys:${id}`;
  const blocked = !token ? isCodeBlocked(scope, req) : undefined;
  const row = await getPhysical(id);
  if (!row) {
    void blocked?.catch(() => {});
    return null;
  }
  if (token && (await verifyPhysicalToken(row.id, row.host_code, token))) return row;
  if (await (blocked ?? isCodeBlocked(scope, req))) throw new RateLimitedError();
  if (code && row.host_code === normalizeResumeCode(code)) {
    if (await isCodeBlocked(scope, req, { fresh: true })) throw new RateLimitedError();
    return row;
  }
  if (await registerCodeFailure(scope, req)) throw new RateLimitedError();
  return null;
}

// ---- rapporter ----

interface ReportRow {
  id: string;
  tournament_id: string;
  round: number;
  board: number;
  result: ReportResult;
  reporter: Reporter;
  request_id: string;
  status: ReportDto["status"];
  created_at: string;
  decided_at: string | null;
}

export const toReportDto = (r: ReportRow): ReportDto => ({
  id: r.id,
  round: r.round,
  board: r.board,
  result: r.result,
  reporter: r.reporter,
  status: r.status,
  createdAt: r.created_at,
});

export async function findReportByRequestId(requestId: string): Promise<ReportRow | null> {
  const { data, error } = await db().from("physical_result_reports").select("*").eq("request_id", requestId).maybeSingle();
  if (error) throw error;
  return (data as ReportRow | null) ?? null;
}

/** Insert a report; a newer pending report from the same reporter for the same
 * board replaces the older one. Idempotent on request_id. */
export async function addReport(r: {
  tournamentId: string;
  round: number;
  board: number;
  result: ReportResult;
  reporter: Reporter;
  requestId: string;
}): Promise<ReportRow> {
  const existing = await findReportByRequestId(r.requestId);
  if (existing) {
    if (existing.tournament_id !== r.tournamentId) throw new RequestIdTaken();
    return existing;
  }
  must(
    await db()
      .from("physical_result_reports")
      .delete()
      .eq("tournament_id", r.tournamentId)
      .eq("round", r.round)
      .eq("board", r.board)
      .eq("reporter", r.reporter)
      .eq("status", "pending"),
  );
  const { data, error } = await db()
    .from("physical_result_reports")
    .insert({
      tournament_id: r.tournamentId,
      round: r.round,
      board: r.board,
      result: r.result,
      reporter: r.reporter,
      request_id: r.requestId,
    })
    .select("*")
    .single();
  if (error) {
    if ((error as { code?: string }).code === "23505") {
      const again = await findReportByRequestId(r.requestId);
      if (again && again.tournament_id === r.tournamentId) return again;
      throw new RequestIdTaken();
    }
    throw error;
  }
  return data as ReportRow;
}

export class RequestIdTaken extends Error {
  constructor() {
    super("request_id_taken");
  }
}

export async function listPendingReports(tournamentId: string): Promise<ReportRow[]> {
  const { data, error } = await db()
    .from("physical_result_reports")
    .select("*")
    .eq("tournament_id", tournamentId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(500);
  if (error) throw error;
  return (data ?? []) as ReportRow[];
}

export async function decideReport(
  tournamentId: string,
  reportId: string,
  status: "approved" | "rejected",
): Promise<ReportRow | null> {
  const { data, error } = await db()
    .from("physical_result_reports")
    .select("*")
    .eq("id", reportId)
    .eq("tournament_id", tournamentId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const cur = data as ReportRow;
  if (cur.status !== "pending") return cur; // idempotent: already decided
  const upd = await db()
    .from("physical_result_reports")
    .update({ status, decided_at: new Date().toISOString() })
    .eq("id", reportId)
    .eq("status", "pending")
    .select("*");
  if (upd.error) throw upd.error;
  return ((upd.data?.[0] as ReportRow | undefined) ?? cur);
}

/** Host code from JSON body or the `x-host-code` header (GET/DELETE have no body). */
export function hostCodeOf(req: Request, body?: { hostCode?: unknown } | null): string {
  const b = body?.hostCode;
  if (typeof b === "string") return b;
  return req.headers.get("x-host-code") ?? "";
}
