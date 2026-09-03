import { describe, expect, it } from "vitest";
import { arePropsEqual, type PlayBoardProps } from "@/lib/client/PlayBoard";

// L5: <PlayBoard> is the memo boundary that stops GameView's re-renders from
// reaching react-chessboard (whose context provider value is an unmemoized
// object literal, so ONE board render = 64 squares + every piece).
//
// The truth table below IS the contract: value props gate the render, handler
// identity never does. The reasoning that makes ignoring the handlers safe is
// in the header of lib/client/PlayBoard.tsx.

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

function props(over: Partial<PlayBoardProps> = {}): PlayBoardProps {
  return {
    id: "play-board",
    fen: START,
    orientation: "white",
    allowDragging: true,
    squareStyles: {},
    stylesKey: "|||||live",
    onDrop: () => true,
    onSquareClick: () => {},
    ...over,
  };
}

describe("PlayBoard arePropsEqual", () => {
  it("is true when nothing the board displays changed", () => {
    expect(arePropsEqual(props(), props())).toBe(true);
  });

  it.each([
    ["fen", { fen: AFTER_E4 }],
    ["stylesKey", { stylesKey: "e2|e4||||live" }],
    ["orientation", { orientation: "black" as const }],
    ["allowDragging", { allowDragging: false }],
    ["id", { id: "other-board" }],
    ["showNotation", { showNotation: false }],
  ])("is false when %s changes", (_label, over) => {
    expect(arePropsEqual(props(), props(over))).toBe(false);
  });

  it("treats omitted showNotation the same as explicit true (react-chessboard's own default, L8)", () => {
    const a = props(); // showNotation left unset
    const b = props({ showNotation: true });
    expect(arePropsEqual(a, b)).toBe(true);
  });

  it("IGNORES handler identity — new closures alone must not re-render the board", () => {
    // GameView memoizes none of its handlers (tryMove's dependency list is
    // deliberately untouched by this PR), so onDrop/onSquareClick are new
    // functions on EVERY render. If they counted, the memo would never hit.
    const a = props();
    const b = props({ onDrop: () => false, onSquareClick: () => {} });
    expect(b.onDrop).not.toBe(a.onDrop);
    expect(b.onSquareClick).not.toBe(a.onSquareClick);
    expect(arePropsEqual(a, b)).toBe(true);
  });

  it("IGNORES squareStyles identity — stylesKey is the thing compared", () => {
    // Same highlights, fresh object: the board already holds an equal one.
    const a = props({ squareStyles: { e4: { background: "red" } } });
    const b = props({ squareStyles: { e4: { background: "red" } } });
    expect(b.squareStyles).not.toBe(a.squareStyles);
    expect(arePropsEqual(a, b)).toBe(true);
  });

  it("re-renders on a stylesKey change even when squareStyles is the same object", () => {
    // The pathological direction: GameView derives BOTH from the same tuple in
    // the same render, so this cannot happen — but the key must win if it ever did.
    const shared = { e4: { background: "red" } };
    const a = props({ squareStyles: shared, stylesKey: "e2|e4||||live" });
    const b = props({ squareStyles: shared, stylesKey: "e2|e4|e4|||live" });
    expect(arePropsEqual(a, b)).toBe(false);
  });

  it("sees a change in each value prop independently of the others", () => {
    // Guards against an accidental `||` — every clause must be able to fail alone.
    const changed: Partial<PlayBoardProps>[] = [
      { fen: AFTER_E4 },
      { stylesKey: "x" },
      { orientation: "black" },
      { allowDragging: false },
      { id: "b2" },
      { showNotation: false },
    ];
    for (const over of changed) {
      expect(arePropsEqual(props(over), props(over))).toBe(true); // equal to itself
      expect(arePropsEqual(props(), props(over))).toBe(false); // but not to the base
    }
  });
});
