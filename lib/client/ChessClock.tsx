"use client";

import { memo, useEffect, useState } from "react";
import { fmtClock } from "@/lib/chess/clock";

/** One side's chess clock. `ms` is the remaining time at local time `at`
 * (receipt of the server snapshot); when `running`, it ticks down locally.
 *
 * memo'd: it owns its own ticker, so it must NOT re-render just because the
 * parent GameView did (e.g. a reaction float, a flag-banner tick). Only a real
 * prop change (new server snapshot, start/stop) should re-render it. The display
 * is second-granular, so a 250ms tick is plenty smooth at a quarter the
 * re-renders of the old 100ms — meaningful on a Chromebook. */
export const ChessClock = memo(function ChessClock({
  ms,
  at,
  running,
}: {
  ms: number;
  at: number;
  running: boolean;
}) {
  // local wall clock, ticked by an interval (same pattern as useCountdown);
  // a fresh snapshot (at > now) clamps elapsed to 0 until the next tick
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [running]);

  const shown = running ? Math.max(0, ms - Math.max(0, now - at)) : ms;

  return (
    <span
      className={`chess-clock mono ${running ? "clock-running" : ""} ${
        shown < 20_000 ? "clock-low" : ""
      }`}
    >
      {fmtClock(shown)}
    </span>
  );
});
