// Delte typer og konstanter for sky-synk (M5a). Ingen server-/klientimport.

export type ReportResult = "1-0" | "0-1" | "½-½";
export const REPORT_RESULTS: readonly ReportResult[] = ["1-0", "0-1", "½-½"];
export type Reporter = "white" | "black" | "unknown";
export const REPORTERS: readonly Reporter[] = ["white", "black", "unknown"];
export type ReportStatus = "pending" | "approved" | "rejected";

export interface ReportDto {
  id: string;
  round: number;
  board: number;
  result: ReportResult;
  reporter: Reporter;
  status: ReportStatus;
  createdAt: string;
}

/** Maks størrelse på opplastet logg (tegn i JSON). */
export const MAX_LOG_BYTES = 4_000_000;
export const MAX_EVENTS = 20_000;
export const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
