// Nedtelling for storskjermen. Ren tilstandsmaskin; lagres av UI-et i
// localStorage (ikke i hendelsesloggen – det er ikke turneringsdata).

export interface TimerState {
  /** Satt varighet i ms (det «Nullstill» går tilbake til). */
  durationMs: number;
  /** Gjenstående ved pause/stopp. */
  remainingMs: number;
  /** Epoch-ms da den ble startet, null = står stille. */
  startedAt: number | null;
}

export const MAX_TIMER_MIN = 600;

export function newTimer(minutes: number): TimerState {
  const ms = Math.round(Math.min(MAX_TIMER_MIN, Math.max(0, minutes)) * 60_000);
  return { durationMs: ms, remainingMs: ms, startedAt: null };
}

export function timerRemaining(s: TimerState, now: number): number {
  if (s.startedAt === null) return s.remainingMs;
  return Math.max(0, s.remainingMs - (now - s.startedAt));
}

export function timerRunning(s: TimerState, now: number): boolean {
  return s.startedAt !== null && timerRemaining(s, now) > 0;
}

export function startTimer(s: TimerState, now: number): TimerState {
  if (s.startedAt !== null || s.remainingMs <= 0) return s;
  return { ...s, startedAt: now };
}

export function pauseTimer(s: TimerState, now: number): TimerState {
  if (s.startedAt === null) return s;
  return { ...s, remainingMs: timerRemaining(s, now), startedAt: null };
}

export function resetTimer(s: TimerState): TimerState {
  return { ...s, remainingMs: s.durationMs, startedAt: null };
}

/** Legg til/trekk fra minutter på gjenstående (og varighet). */
export function adjustTimer(s: TimerState, now: number, deltaMin: number): TimerState {
  const rem = Math.max(0, timerRemaining(s, now) + deltaMin * 60_000);
  return {
    durationMs: Math.max(s.durationMs, rem),
    remainingMs: rem,
    startedAt: s.startedAt === null ? null : now,
  };
}

/** «mm:ss» (eller «h:mm:ss»). Rundes opp, slik at 0:00 først vises når tiden er ute. */
export function formatTimer(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const sec = total % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

export function parseTimer(raw: string | null): TimerState | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<TimerState>;
    if (
      typeof v.durationMs === "number" && typeof v.remainingMs === "number" &&
      (v.startedAt === null || typeof v.startedAt === "number") &&
      v.durationMs >= 0 && v.remainingMs >= 0
    ) {
      return { durationMs: v.durationMs, remainingMs: v.remainingMs, startedAt: v.startedAt ?? null };
    }
  } catch {
    /* ugyldig */
  }
  return null;
}

/** Del en liste i sider; sidetall for gitt «tikk» (roterer rundt). */
export function pageAt(tick: number, pages: number): number {
  return pages <= 1 ? 0 : ((tick % pages) + pages) % pages;
}
