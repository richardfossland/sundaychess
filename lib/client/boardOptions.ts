import { useSyncExternalStore } from "react";
import type { CSSProperties } from "react";

/**
 * L4: shared react-chessboard v5 `options` defaults.
 *
 * Spread this FIRST in every board's `options` object —
 * `{ ...BOARD_BASE_OPTIONS, position, ... }` — so a call site's own values
 * still win. Every file that imports `Chessboard` (statically or via
 * `next/dynamic`) from `react-chessboard` must also import this constant;
 * see `test/boardOptions.test.ts` for the guard.
 *
 * v5's own defaults are tuned for a mouse and a single static board, not a
 * classroom of phones polling a live game. Each field below overrides one of
 * those defaults — see `node_modules/react-chessboard/dist/index.js` for the
 * values being overridden.
 */
export const BOARD_BASE_OPTIONS = {
  // `allowDrawingArrows` defaults to true, and `clearArrowsOnClick` /
  // `clearArrowsOnPositionChange` each default to true too — every left
  // mousedown on a square, and every position change (our 5 s board poll,
  // a scrubbed replay, a live spectate update), calls `setInternalArrows([])`
  // with a FRESH empty array, forcing a context re-render even when there
  // were no arrows to clear. Turning off arrow-drawing alone doesn't stop
  // this churn — the two `clearArrowsOn*` flags fire independently of
  // whether arrows are enabled, so all three must be set together.
  allowDrawingArrows: false,
  clearArrowsOnClick: false,
  clearArrowsOnPositionChange: false,
  // Default is 1 px: a finger's natural wobble on a tap is enough to start a
  // drag, so tap-to-move (`onSquareClick`) reads as flaky on phones. 8 px
  // absorbs a tap without meaningfully delaying a deliberate drag.
  dragActivationDistance: 8,
  showAnimations: true,
  animationDurationInMs: 180,
  // Square colors — identical across every board before this change; kept
  // here so the palette moves in one place. A call site with a different
  // duration or palette still wins by listing its own value after the
  // spread.
  darkSquareStyle: { backgroundColor: "var(--board-dark)" },
  lightSquareStyle: { backgroundColor: "var(--board-light)" },
} as const;

// ---------------------------------------------------------------------------
// D2: board colour themes.
//
// A theme is a handful of CSS custom properties, applied by `GameLayout`
// (`data-board-theme` on its root) — so every board inside a game view follows
// the player's choice, while the big-screen mini boards keep the default green
// from `:root`. The square highlights below are the ONLY place the highlight
// colours live; `highlightStyles` turns them into react-chessboard
// `squareStyles` using the same CSS variables, so a theme switch needs no
// re-render of the board itself.
// ---------------------------------------------------------------------------

export type BoardTheme = "green" | "wood" | "gold";

export const BOARD_THEME_KEY = "chess:boardTheme";
export const BOARD_THEMES: readonly BoardTheme[] = ["green", "wood", "gold"];
export const DEFAULT_BOARD_THEME: BoardTheme = "green";

/** The palette per theme. Mirrors the `[data-board-theme]` blocks in
 * globals.css (a test keeps the two in step) and is what the contrast test
 * measures: light vs dark square must be at least 1.6:1 apart in luminance. */
export const BOARD_PALETTES: Record<
  BoardTheme,
  { light: string; dark: string; last: string; selected: string }
> = {
  green: {
    light: "#ecd9b0",
    dark: "#6f8f6a",
    last: "rgba(240, 196, 40, 0.62)",
    selected: "rgba(40, 120, 230, 0.55)",
  },
  wood: {
    light: "#f0d9b5",
    dark: "#a97a50",
    last: "rgba(60, 160, 255, 0.5)",
    selected: "rgba(30, 140, 70, 0.55)",
  },
  gold: {
    light: "#f1e2b8",
    dark: "#5a678a",
    last: "rgba(255, 190, 40, 0.7)",
    selected: "rgba(30, 190, 130, 0.62)",
  },
};

export function isBoardTheme(v: unknown): v is BoardTheme {
  return v === "green" || v === "wood" || v === "gold";
}

export function loadBoardTheme(): BoardTheme {
  try {
    const v = window.localStorage.getItem(BOARD_THEME_KEY);
    return isBoardTheme(v) ? v : DEFAULT_BOARD_THEME;
  } catch {
    return DEFAULT_BOARD_THEME;
  }
}

const THEME_EVENT = "chess:boardTheme-change";

export function saveBoardTheme(theme: BoardTheme): void {
  try {
    window.localStorage.setItem(BOARD_THEME_KEY, theme);
  } catch {
    /* private mode / blocked storage: the choice just lasts until reload */
    memoryTheme = theme;
  }
  window.dispatchEvent(new Event(THEME_EVENT));
}

// Fallback for when localStorage throws — keeps the choice for this page view.
let memoryTheme: BoardTheme | null = null;

function snapshot(): BoardTheme {
  const stored = loadBoardTheme();
  if (stored !== DEFAULT_BOARD_THEME) return stored;
  return memoryTheme ?? stored;
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(THEME_EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(THEME_EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** The player's chosen board theme (server snapshot: the default). Shared by
 * every component through the event above, so changing it in one place
 * updates all boards on screen. */
export function useBoardTheme(): [BoardTheme, (t: BoardTheme) => void] {
  const theme = useSyncExternalStore(subscribe, snapshot, () => DEFAULT_BOARD_THEME);
  return [theme, saveBoardTheme];
}

/** Square highlight styles (last move, selection, legal-move dots) built from
 * the theme's CSS variables. Pass `null` for parts that do not apply. */
export function highlightStyles(opts: {
  last?: { from: string; to: string } | null;
  selected?: string | null;
  legal?: readonly string[];
}): Record<string, CSSProperties> {
  const styles: Record<string, CSSProperties> = {};
  if (opts.last) {
    styles[opts.last.from] = { background: "var(--board-last)" };
    styles[opts.last.to] = { background: "var(--board-last)" };
  }
  if (opts.selected) styles[opts.selected] = { background: "var(--board-selected)" };
  for (const sq of opts.legal ?? []) {
    styles[sq] = {
      ...(styles[sq] ?? {}),
      backgroundImage: "radial-gradient(circle, var(--board-dot) 22%, transparent 24%)",
    };
  }
  return styles;
}
