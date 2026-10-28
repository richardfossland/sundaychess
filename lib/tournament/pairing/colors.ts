import type { Colour, ColourState, HistoryGame } from "./types";

export const NO_COLOURS: ColourState = { diff: 0, last: null, run: 0 };

/** Fold a game history (any order) into per-player colour states. Byes and
 * unplayed (forfeit) games carry no colour (FIDE). */
export function colourStatesFromHistory(history: readonly HistoryGame[]): Map<string, ColourState> {
  const out = new Map<string, ColourState>();
  const games = history
    .filter((g) => g.black !== null && !g.forfeit)
    .map((g, i) => ({ g, i }))
    .sort((a, b) => a.g.round - b.g.round || a.i - b.i);
  const bump = (id: string, c: Colour) => {
    const s = out.get(id) ?? { ...NO_COLOURS };
    s.diff += c === "W" ? 1 : -1;
    s.run = s.last === c ? s.run + 1 : 1;
    s.last = c;
    out.set(id, s);
  };
  for (const { g } of games) {
    bump(g.white, "W");
    bump(g.black as string, "B");
  }
  return out;
}

/** Colour state from bare counts (legacy callers have no ordering). */
export function colourStateFromCounts(white: number, black: number): ColourState {
  return { diff: white - black, last: null, run: 0 };
}

const opp = (c: Colour): Colour => (c === "W" ? "B" : "W");

/** Colour the player MUST get next to stay legal (never 3 in a row, |diff| ≤ 2), else null. */
export function requiredColour(s: ColourState): Colour | null {
  if (s.run >= 2 && s.last) return opp(s.last);
  if (s.diff >= 2) return "B";
  if (s.diff <= -2) return "W";
  return null;
}

/** Soft preference: restore balance, otherwise alternate. strength 0 = no preference. */
export function preferredColour(s: ColourState): { colour: Colour | null; strength: number } {
  if (s.diff > 0) return { colour: "B", strength: s.diff };
  if (s.diff < 0) return { colour: "W", strength: -s.diff };
  if (s.last) return { colour: opp(s.last), strength: 0.5 };
  return { colour: null, strength: 0 };
}

/** True when both players are forced into the same colour: no legal allocation. */
export function colourConflict(a: ColourState, b: ColourState): boolean {
  const ra = requiredColour(a);
  return ra !== null && ra === requiredColour(b);
}

/**
 * Decide who has white. `hi` is the higher-ranked player and wins every conflict.
 * Order: hard requirement > bigger imbalance > alternation > hi gets white.
 */
export function allocateColours(
  hi: string,
  lo: string,
  hiState: ColourState = NO_COLOURS,
  loState: ColourState = NO_COLOURS,
): { white: string; black: string } {
  const hiWhite = { white: hi, black: lo };
  const loWhite = { white: lo, black: hi };
  const rh = requiredColour(hiState);
  const rl = requiredColour(loState);
  if (rh) return rh === "W" ? hiWhite : loWhite;
  if (rl) return rl === "W" ? loWhite : hiWhite;
  const ph = preferredColour(hiState);
  const pl = preferredColour(loState);
  if (ph.colour && pl.colour && ph.colour === pl.colour) {
    const hiWins = ph.strength >= pl.strength;
    const c = hiWins ? ph.colour : opp(ph.colour);
    return c === "W" ? hiWhite : loWhite;
  }
  if (ph.colour) return ph.colour === "W" ? hiWhite : loWhite;
  if (pl.colour) return pl.colour === "W" ? loWhite : hiWhite;
  return hiWhite;
}
