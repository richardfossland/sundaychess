"use client";

import { useEffect, useState } from "react";
import { no } from "@/lib/locale/no";

/** Teacher-screen-only round countdown (one per round, not per player — spec
 * §0.3). Counts down from `startedAt + durationSec`. Display only: when it hits
 * zero the teacher decides socially; nothing is enforced. */
export function RoundTimer({
  startedAt,
  durationSec,
}: {
  startedAt: string | null;
  durationSec: number;
}) {
  const endMs = startedAt ? new Date(startedAt).getTime() + durationSec * 1000 : null;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!endMs) return null;
  const remainingMs = Math.max(0, endMs - now);
  const totalSec = Math.ceil(remainingMs / 1000);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  const up = remainingMs === 0;
  const low = !up && remainingMs < 60_000;

  return (
    <div
      className="stack text-center"
      style={{ gap: 2 }}
      role="timer"
      aria-live="polite"
      aria-label={no.host.timer}
    >
      <span className="eyebrow" style={{ color: "var(--txt-on-ink-dim)" }}>
        {no.host.timer}
      </span>
      <span className={`timer ${up ? "up" : low ? "low" : ""}`}>
        {up ? no.host.timeUp : `${mm}:${String(ss).padStart(2, "0")}`}
      </span>
    </div>
  );
}
