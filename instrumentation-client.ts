// Next 16 client instrumentation (node_modules/next/dist/docs/01-app/03-api-reference/
// 03-file-conventions/instrumentation-client.md): this file runs after the HTML
// loads and BEFORE React hydrates, which is exactly when we want the global
// error hooks installed — a crash during hydration is the one that leaves a
// student staring at a blank screen with nothing in any log.
//
// Keep it lightweight (Next warns above 16 ms) and keep it defensive: an error
// in the error reporter is the worst kind of error. Everything is wrapped, and
// `report()` itself never throws.

import { ownTopFrame, report } from "@/lib/client/telemetry";

function message(v: unknown): string {
  if (v instanceof Error) return String(v.message ?? "").slice(0, 200);
  if (typeof v === "string") return v.slice(0, 200);
  return "non-error throw";
}

try {
  window.addEventListener("error", (e: ErrorEvent) => {
    // Ingen ramme fra vår egen origin = nettleserutvidelse / skript fra andre
    // (eller «Script error.» uten stack): ikke vår feil, så den droppes helt.
    const at = ownTopFrame(e.error instanceof Error ? e.error.stack : undefined, window.location.origin);
    if (!at) return;
    report("js_error", { message: message(e.error ?? e.message), at });
  });

  window.addEventListener("unhandledrejection", (e: PromiseRejectionEvent) => {
    const reason: unknown = e.reason;
    const at = ownTopFrame(reason instanceof Error ? reason.stack : undefined, window.location.origin);
    if (!at) return;
    report("js_error", { message: message(reason), at, rejection: true });
  });
} catch {
  // No window (an exotic runtime), or listeners refused. Nothing to do — the
  // app must not care whether its telemetry got installed.
}
