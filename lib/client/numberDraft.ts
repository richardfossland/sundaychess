// Pure helpers for NumberField: the field edits a *text draft*, so typing
// "clear, then 3" never jumps through min/max on the way (the old inputs
// clamped on every keystroke: «3» typed into an emptied 1–12 field became 12).

export type DraftState = "empty" | "ok" | "low" | "high";

/** Keep only what a whole number may contain: digits, and a single leading "-"
 * when negatives are allowed. Leading zeros are dropped ("02" -> "2", "007" -> "7")
 * but a lone "0" stays. "12abc" -> "12". */
export function sanitizeDraft(raw: string, allowNegative: boolean): string {
  const negative = allowNegative && raw.trimStart().startsWith("-");
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  return negative ? `-${digits}` : digits;
}

/** The integer a draft stands for, or null while it is empty / just "-". */
export function parseDraft(draft: string): number | null {
  if (!/^-?\d+$/.test(draft)) return null;
  const n = Number(draft);
  return Number.isSafeInteger(n) ? n : null;
}

/** Classify a draft against [min, max]. */
export function draftState(draft: string, min: number, max: number): DraftState {
  const n = parseDraft(draft);
  if (n === null) {
    // A huge digit string is past max; "" and "-" are merely unfinished.
    return /^\d{16,}$/.test(draft) ? "high" : "empty";
  }
  if (n < min) return "low";
  if (n > max) return "high";
  return "ok";
}

/** The value to report *while typing*: only a draft already inside [min, max]
 * counts; anything else (empty, "-", too small, too large) reports nothing. */
export function liveValue(draft: string, min: number, max: number): number | null {
  return draftState(draft, min, max) === "ok" ? parseDraft(draft) : null;
}

/** The value to settle on at blur / Enter: out-of-range drafts clamp to the
 * nearest bound; an empty one falls back to `min`. */
export function commitDraft(draft: string, min: number, max: number): number {
  const n = parseDraft(draft);
  if (n === null) return Math.min(max, Math.max(min, /^\d{16,}$/.test(draft) ? max : min));
  return Math.min(max, Math.max(min, n));
}

/** Hint text for an out-of-range draft («Maks 12» / «Minst 2»), else null. */
export function draftHint(
  draft: string,
  min: number,
  max: number,
  words: { max: (n: number) => string; min: (n: number) => string },
): string | null {
  const s = draftState(draft, min, max);
  if (s === "high") return words.max(max);
  if (s === "low") return words.min(min);
  return null;
}
