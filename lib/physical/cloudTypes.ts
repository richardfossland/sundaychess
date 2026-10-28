// Delte typer og konstanter for sky-synk (M5a). Ingen server-/klientimport.

export type ReportResult = "1-0" | "0-1" | "½-½";
export const REPORT_RESULTS: readonly ReportResult[] = ["1-0", "0-1", "½-½"];
export type Reporter = "white" | "black" | "unknown";
export const REPORTERS: readonly Reporter[] = ["white", "black", "unknown"];
export type ReportStatus = "pending" | "approved" | "rejected" | "superseded";

/** Hva den offentlige siden viser av navn. `initials` = «Ola N.», og ingen klubb/klasse. */
export type PublicNames = "full" | "initials";
export const PUBLIC_NAMES: readonly PublicNames[] = ["full", "initials"];
export const DEFAULT_PUBLIC_NAMES: PublicNames = "initials";

export interface ReportDto {
  id: string;
  round: number;
  board: number;
  result: ReportResult;
  reporter: Reporter;
  /** Tilfeldig enhets-id (localStorage hos melderen): to meldinger fra samme telefon er aldri «enige». */
  deviceId: string;
  /** `${hvit-id}|${svart-id}` slik parringen sto i skyen da meldingen kom. */
  pairingFp: string;
  status: ReportStatus;
  createdAt: string;
}

/** Grenser for opplastet logg. Håndheves i klienten (vennlig feil) og på serveren FØR avspilling. */
export const MAX_LOG_BYTES = 512 * 1024;
export const MAX_EVENTS = 5_000;
export const MAX_PLAYERS = 500;
/** Maks rå kroppsstørrelse for publish/PUT (loggen + litt innpakning). */
export const MAX_BODY_BYTES = MAX_LOG_BYTES + 8 * 1024;
/** Maks publiseringer per IP per døgn (DB-basert, scope `publish`). */
export const MAX_PUBLISHES_PER_DAY = 10;
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
export const DEVICE_ID_RE = REQUEST_ID_RE;

export type LogLimitCode = "too_many_events" | "too_many_players" | "payload_too_large";

/** Billig forhåndssjekk (ingen avspilling). null = innenfor grensene. */
export function logLimitError(events: readonly unknown[], opts: { skipBytes?: boolean } = {}): LogLimitCode | null {
  if (events.length > MAX_EVENTS) return "too_many_events";
  let players = 0;
  for (const e of events) if ((e as { type?: unknown } | null)?.type === "addPlayer" && ++players > MAX_PLAYERS) return "too_many_players";
  if (!opts.skipBytes && JSON.stringify(events).length > MAX_LOG_BYTES) return "payload_too_large";
  return null;
}
