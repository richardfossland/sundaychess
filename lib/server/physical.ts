import "server-only";

import { isUuid, normalizeResumeCode } from "@/lib/codes";
import { canonicalJson, sha256Hex } from "@/lib/export/hash";
import { logLimitError, type PublicNames, type ReportDto, type ReportResult, type Reporter } from "@/lib/physical/cloudTypes";
import { publicSnapshot, type PublicSnapshot } from "@/lib/physical/snapshot";
import { replay } from "@/lib/physical/reducer";
import type { PhysicalEvent, PhysicalTournament } from "@/lib/physical/schema";
import { createServiceClient } from "@/lib/supabase/service";
import { isCodeBlocked, registerCodeFailure } from "@/lib/server/attempts";
import { RateLimitedError, fail, must } from "@/lib/server/http";
import { PAIR_HEADER, verifyPhysicalToken } from "@/lib/server/pair";

export interface PhysicalRow {
  id: string;
  host_code: string;
  title: string;
  log_version: number;
  log_hash: string;
  public_names: PublicNames;
  /** Tournament id inside the log when it differs from `id` (cloud id after a collision). */
  local_id: string | null;
  updated_at: string;
  created_at: string;
}

const db = () => createServiceClient();

// The big columns (event_log, public_snapshot) are NEVER selected by auth or report paths.
const LIGHT_COLS = "id,host_code,title,log_version,log_hash,public_names,local_id,updated_at,created_at";

export async function getPhysical(id: string): Promise<PhysicalRow | null> {
  const { data, error } = await db().from("physical_tournaments").select(LIGHT_COLS).eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as PhysicalRow | null) ?? null;
}

/** The derived public view. Public GET and report POST read this and never replay. */
export async function getPublicSnapshot(id: string): Promise<{ snapshot: PublicSnapshot; version: number } | null> {
  const { data, error } = await db().from("physical_tournaments").select("public_snapshot,log_version").eq("id", id).maybeSingle();
  if (error) throw error;
  const row = data as { public_snapshot: PublicSnapshot | null; log_version: number } | null;
  if (!row) return null;
  if (!row.public_snapshot) throw new Error("missing_public_snapshot");
  return { snapshot: row.public_snapshot, version: row.log_version };
}

export async function getEventLog(id: string): Promise<PhysicalEvent[]> {
  const { data, error } = await db().from("physical_tournaments").select("event_log").eq("id", id).maybeSingle();
  if (error) throw error;
  return ((data as { event_log: PhysicalEvent[] } | null)?.event_log ?? []) as PhysicalEvent[];
}

export const hashLog = (events: readonly PhysicalEvent[]) => sha256Hex(canonicalJson(events));

/** Cheap pre-replay checks (event/player caps). Returns the HTTP failure or null. */
export function limitFailure(events: unknown): Response | null {
  if (!Array.isArray(events)) return fail(400, "bad_request");
  const code = logLimitError(events, { skipBytes: true }); // bytes were capped on the raw body
  if (code === "too_many_events" || code === "too_many_players") return fail(422, code);
  return null;
}

/** Validate an uploaded log: shape, size, then a full replay through the
 * reducer (every invariant the arbiter's own device enforces). Returns the
 * state or null when invalid (-> 422). Never throws. `expectedId` null = any. */
export function validateLog(expectedId: string | null, events: unknown): PhysicalTournament | null {
  if (!Array.isArray(events) || events.length === 0 || logLimitError(events, { skipBytes: true })) return null;
  try {
    const t = replay(events as PhysicalEvent[]);
    return expectedId === null || t.id === expectedId ? t : null;
  } catch {
    return null;
  }
}

export interface RowFields {
  title: string;
  event_log: PhysicalEvent[];
  log_hash: string;
  public_snapshot: PublicSnapshot;
  public_names: PublicNames;
  updated_at: string;
}

/** Everything derived from a validated log, computed once per host write. */
export async function rowFields(t: PhysicalTournament, cloudId: string, names: PublicNames): Promise<RowFields> {
  const updated_at = new Date().toISOString();
  return {
    title: t.title,
    event_log: t.events,
    log_hash: await hashLog(t.events),
    public_snapshot: publicSnapshot(t, updated_at, { id: cloudId, names }),
    public_names: names,
    updated_at,
  };
}

export async function insertPhysical(
  row: RowFields & { id: string; host_code: string; local_id: string | null },
): Promise<"created" | "exists"> {
  const { error } = await db().from("physical_tournaments").insert({ ...row, log_version: 1 });
  if (!error) return "created";
  if ((error as { code?: string }).code === "23505") return "exists";
  throw error;
}

/** Optimistic concurrency: updates only when log_version still equals `base`. */
export async function updateLog(id: string, base: number, fields: RowFields): Promise<number | null> {
  const { data, error } = await db()
    .from("physical_tournaments")
    .update({ ...fields, log_version: base + 1 })
    .eq("id", id)
    .eq("log_version", base)
    .select("log_version");
  if (error) throw error;
  return data && data.length > 0 ? (data[0] as { log_version: number }).log_version : null;
}

export async function deletePhysical(id: string): Promise<void> {
  must(await db().from("physical_tournaments").delete().eq("id", id));
}

/** Pairing fingerprint of a board in the PUBLIC snapshot (null = no such board / bye / draft). */
export function fingerprintOf(snap: PublicSnapshot, round: number, board: number): string | null {
  const p = snap.rounds.find((r) => r.number === round)?.pairings.find((x) => x.board === board);
  return p && p.black !== null ? `${p.white}|${p.black}` : null;
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
  device_id: string;
  pairing_fp: string;
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
  deviceId: r.device_id,
  pairingFp: r.pairing_fp,
  status: r.status,
  createdAt: r.created_at,
});

export async function findReportByRequestId(requestId: string): Promise<ReportRow | null> {
  const { data, error } = await db().from("physical_result_reports").select("*").eq("request_id", requestId).maybeSingle();
  if (error) throw error;
  return (data as ReportRow | null) ?? null;
}

/** Most pending reports kept per board (a QR key can be held by any phone). */
export const MAX_PENDING_PER_BOARD = 8;

/** Insert a report; a newer pending report from the same DEVICE for the same
 * board replaces the older one (never keyed by the claimed side: two players who
 * both tap "unknown" must not overwrite each other). Idempotent on request_id. */
export async function addReport(r: {
  tournamentId: string;
  round: number;
  board: number;
  result: ReportResult;
  reporter: Reporter;
  requestId: string;
  deviceId: string;
  pairingFp: string;
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
      .eq("device_id", r.deviceId)
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
      device_id: r.deviceId,
      pairing_fp: r.pairingFp,
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
  await trimBoard(r.tournamentId, r.round, r.board);
  return data as ReportRow;
}

async function trimBoard(tournamentId: string, round: number, board: number): Promise<void> {
  const { data, error } = await db()
    .from("physical_result_reports")
    .select("id")
    .eq("tournament_id", tournamentId)
    .eq("round", round)
    .eq("board", board)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(1000);
  if (error) throw error;
  const ids = ((data ?? []) as { id: string }[]).map((x) => x.id);
  for (const id of ids.slice(MAX_PENDING_PER_BOARD)) must(await db().from("physical_result_reports").delete().eq("id", id));
}

/** After a host write: pending reports whose board now has other players (or none) are superseded. */
export async function supersedeStaleReports(tournamentId: string, snap: PublicSnapshot): Promise<void> {
  for (const rep of await listPendingReports(tournamentId)) {
    if (fingerprintOf(snap, rep.round, rep.board) === rep.pairing_fp) continue;
    must(
      await db()
        .from("physical_result_reports")
        .update({ status: "superseded", decided_at: new Date().toISOString() })
        .eq("id", rep.id)
        .eq("status", "pending"),
    );
  }
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
