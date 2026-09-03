import { expect, test, type BrowserContext } from "@playwright/test";

import { createMatch, openAs } from "./fixtures/match";
import { BoardPage } from "./pages/board";

// The end of the game is the last place a board is allowed to jump.
//
// Everything that disappears at checkmate — the turn banner, the draw/resign
// row, the reaction bar, the notice slot — is hidden with `visibility` and never
// unmounted (L2/L3), and the result card is a `position: fixed` overlay. So the
// mating move must change the page's geometry by exactly nothing: the board is
// in the same place, the reserved banner line is still the same height, and the
// page has not scrolled. That is what a student sees behind the blur, and if it
// lurches, the celebration is the first thing they distrust.
//
// Fool's mate is the shortest way there: 1. f3 e5 2. g4 Qh4#.

const PROPAGATION = 12_000;
const BOX_TOLERANCE = 0.5;

interface Geometry {
  scrollY: number;
  slotHeight: number;
  box: { x: number; y: number; width: number; height: number };
}

async function geometry(board: BoardPage): Promise<Geometry> {
  return {
    scrollY: await board.scrollY(),
    slotHeight: await board.turnSlotHeight(),
    box: await board.boardBox(),
  };
}

function assertUnchanged(after: Geometry, before: Geometry, who: string) {
  expect(after.scrollY, `${who}: the page scrolled when the game ended`).toBe(
    before.scrollY,
  );
  expect(
    Math.abs(after.slotHeight - before.slotHeight),
    `${who}: the reserved turn-banner slot changed height at game end (${before.slotHeight} → ${after.slotHeight})`,
  ).toBeLessThan(BOX_TOLERANCE);
  for (const side of ["x", "y", "width", "height"] as const) {
    expect(
      Math.abs(after.box[side] - before.box[side]),
      `${who}: board-shell.${side} moved at game end (${before.box[side]} → ${after.box[side]})`,
    ).toBeLessThan(BOX_TOLERANCE);
  }
}

test("checkmate lands on both devices without moving the board", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Ada", black: "Bo" });
  const contexts: BrowserContext[] = [];
  try {
    const whiteCtx = await browser.newContext();
    const blackCtx = await browser.newContext();
    contexts.push(whiteCtx, blackCtx);

    const [whitePage, blackPage] = await Promise.all([
      openAs(whiteCtx, match.white),
      openAs(blackCtx, match.black),
    ]);
    const white = new BoardPage(whitePage);
    const black = new BoardPage(blackPage);

    await white.clickMove("f2", "f3");
    await expect.poll(() => black.pieceAt("f3"), { timeout: PROPAGATION }).toBe("wP");

    await black.clickMove("e7", "e5");
    await expect.poll(() => white.pieceAt("e5"), { timeout: PROPAGATION }).toBe("bP");

    await white.clickMove("g2", "g4");
    await expect.poll(() => black.pieceAt("g4"), { timeout: PROPAGATION }).toBe("wP");

    // The snapshot the mating move is measured against — taken with the game
    // still live, on both devices.
    const before = { white: await geometry(white), black: await geometry(black) };

    // ---- Qh4# ----
    await black.clickMove("d8", "h4");

    await expect(
      black.resultCard(),
      "the winner never saw a result",
    ).toBeVisible({ timeout: PROPAGATION });
    await expect(
      white.resultCard(),
      "the loser never learned the game had ended",
    ).toBeVisible({ timeout: PROPAGATION });

    assertUnchanged(await geometry(white), before.white, "white");
    assertUnchanged(await geometry(black), before.black, "black");

    // The board itself is still there under the overlay, on the mating position.
    expect(await black.pieceAt("h4")).toBe("bQ");
    expect(await white.pieceAt("h4")).toBe("bQ");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
