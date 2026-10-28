// Klientlogikk for QR-rapportering (M5a): send en melding med SAMME requestId på
// hvert forsøk, så et dårlig nett (mistet svar, dobbel sending) aldri gir to
// meldinger. Forbigående feil (nett, 5xx, 429) prøves på nytt; permanente stopper.

import type { ReportResult, Reporter } from "./cloudTypes";
import { newId } from "./events";

export interface ReportInput {
  id: string;
  round: number;
  board: number;
  result: ReportResult;
  reporter: Reporter;
  requestId: string;
  /** Tilfeldig enhets-id (localStorage). */
  deviceId: string;
  /** `${hvit-id}|${svart-id}` slik siden viste parringen; serveren avviser hvis den er endret. */
  fp?: string;
  k: string;
}

let memDeviceId: string | null = null;
const DEVICE_KEY = "sundaychess:report-device-id";

/** Tilfeldig id for denne telefonen (localStorage, minne som reserve). Skilles fra requestId: den er stabil på tvers av meldinger. */
export function getDeviceId(): string {
  try {
    const have = localStorage.getItem(DEVICE_KEY);
    if (have && /^[A-Za-z0-9_-]{8,64}$/.test(have)) return have;
    const id = memDeviceId ?? newId();
    memDeviceId = id;
    localStorage.setItem(DEVICE_KEY, id);
    return id;
  } catch {
    return (memDeviceId ??= newId());
  }
}

export type SendOutcome = { ok: true } | { ok: false; code: string };

/** Koder der et nytt forsøk er meningsløst. */
export const PERMANENT_CODES = new Set([
  "bad_key",
  "already_has_result",
  "round_closed",
  "round_not_open",
  "board_not_found",
  "not_found",
  "bad_request",
  "reports_unavailable",
  "request_id_taken",
  "pairing_changed",
]);

export interface SendDeps {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  maxAttempts?: number;
  onRetry?: (attempt: number) => void;
}

export async function sendReport(r: ReportInput, deps: SendDeps = {}): Promise<SendOutcome> {
  const f = deps.fetchFn ?? fetch;
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((res) => setTimeout(res, ms)));
  const max = deps.maxAttempts ?? 8;
  const { id, ...body } = r;
  let delay = 1500;
  for (let attempt = 1; attempt <= max; attempt++) {
    let code = "network";
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 10_000);
      const res = await f(`/api/physical/${id}/report`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(to));
      let data: { error?: unknown } = {};
      try {
        data = (await res.json()) as { error?: unknown };
      } catch {
        /* ikke vår API */
      }
      if (res.ok) return { ok: true };
      if (typeof data.error === "string") {
        code = data.error;
        if (PERMANENT_CODES.has(code)) return { ok: false, code };
      } // ellers: kant-/proxy-feilside -> forbigående
      if (res.status === 429) code = "rate_limited";
    } catch {
      code = "network";
    }
    if (attempt === max) return { ok: false, code };
    deps.onRetry?.(attempt);
    await sleep(delay);
    delay = Math.min(delay * 2, 15_000);
  }
  return { ok: false, code: "network" };
}
