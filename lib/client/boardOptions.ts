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
