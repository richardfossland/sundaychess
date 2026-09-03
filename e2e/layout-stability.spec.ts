import { expect, test, type BrowserContext } from "@playwright/test";

import { createMatch, openAs } from "./fixtures/match";
import { installCls, readCls } from "./helpers/cls";
import { BoardPage } from "./pages/board";

// The spec the whole L-series exists for: a board that does not move.
//
// Twelve half-moves of a real opening, played alternately on two devices, with
// every single one of them followed by the same four questions on BOTH screens:
//
//   * did the page scroll?                    (window.scrollY)
//   * did the board move or resize?           (board-shell's box, ±0.5 px)
//   * did the opponent's move shift anything? (CLS delta < 0.01)
//   * is the latest move still visible?       (the move list is pinned)
//
// The CLS delta is read only on the WATCHING device, and that is the whole
// point: a shift within 500 ms of your own tap carries `hadRecentInput` and the
// Web Vitals definition excludes it. The move you did not make has no such
// excuse — it is the incoming update that used to shove the board around.
//
// The fourth question is what pins L1. The move list keeps the newest move in
// view by setting its OWN `scrollTop` (lib/client/MoveList.tsx). The bug it
// replaced used `scrollIntoView()`, which scrolls every scrollable ancestor —
// including the document — so the page crept downward under the student's
// fingers on every move. Assert both halves: the row is visible in the list AND
// the page did not scroll. Either one alone passes the bug.
//
// Runs on desktop-chromium AND mobile-chromium: at 390 px the page is taller
// than the viewport, which is precisely where a stray document scroll shows up.

/** One 3 s poll cycle plus room for the broadcast to lose and the poll to win. */
const PROPAGATION = 10_000;

/** Sub-pixel jitter in a fractional layout is not a layout shift. */
const BOX_TOLERANCE = 0.5;

/** Giuoco Piano, six moves deep — every one legal from the standard position. */
const OPENING: { from: string; to: string; piece: string; san: string }[] = [
  { from: "e2", to: "e4", piece: "wP", san: "1. e4" },
  { from: "e7", to: "e5", piece: "bP", san: "1… e5" },
  { from: "g1", to: "f3", piece: "wN", san: "2. Nf3" },
  { from: "b8", to: "c6", piece: "bN", san: "2… Nc6" },
  { from: "f1", to: "c4", piece: "wB", san: "3. Bc4" },
  { from: "f8", to: "c5", piece: "bB", san: "3… Bc5" },
  { from: "d2", to: "d3", piece: "wP", san: "4. d3" },
  { from: "d7", to: "d6", piece: "bP", san: "4… d6" },
  { from: "b1", to: "c3", piece: "wN", san: "5. Nc3" },
  { from: "g8", to: "f6", piece: "bN", san: "5… Nf6" },
  { from: "c1", to: "g5", piece: "wB", san: "6. Bg5" },
  { from: "h7", to: "h6", piece: "bP", san: "6… h6" },
];

interface Frame {
  scrollY: number;
  box: { x: number; y: number; width: number; height: number };
}

async function frame(board: BoardPage): Promise<Frame> {
  return { scrollY: await board.scrollY(), box: await board.boardBox() };
}

const sameBox = (a: Frame["box"], b: Frame["box"]) =>
  Math.abs(a.x - b.x) < BOX_TOLERANCE &&
  Math.abs(a.y - b.y) < BOX_TOLERANCE &&
  Math.abs(a.width - b.width) < BOX_TOLERANCE &&
  Math.abs(a.height - b.height) < BOX_TOLERANCE;

/**
 * The baseline, taken once the board has stopped settling.
 *
 * MOUNT is allowed to move things (a lazy chunk resolving, a font swapping);
 * this spec is about what happens once the game is underway, so it waits for two
 * identical reads before it starts holding the app to a number.
 */
async function settled(board: BoardPage): Promise<Frame> {
  let prev = await frame(board);
  for (let i = 0; i < 12; i++) {
    await board.page.waitForTimeout(250);
    const next = await frame(board);
    if (next.scrollY === prev.scrollY && sameBox(prev.box, next.box)) return next;
    prev = next;
  }
  throw new Error("board-shell never stopped moving before the first move");
}

function assertFrame(actual: Frame, baseline: Frame, who: string, when: string) {
  expect(actual.scrollY, `${who}: the page scrolled ${when}`).toBe(baseline.scrollY);
  expect(
    sameBox(actual.box, baseline.box),
    `${who}: board-shell moved ${when} — ${JSON.stringify(baseline.box)} → ${JSON.stringify(actual.box)}`,
  ).toBe(true);
}

test("twelve half-moves and neither board moves a pixel", async ({
  browser,
  request,
}) => {
  // Twelve moves × two propagation budgets is comfortably past the 90 s default.
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Ada", black: "Bo" });

  const contexts: BrowserContext[] = [];
  try {
    const whiteCtx = await browser.newContext();
    const blackCtx = await browser.newContext();
    contexts.push(whiteCtx, blackCtx);

    // On the CONTEXT, not the page: `openAs` owns the newPage()/goto() pair, so
    // by the time a page object exists the first paint is already behind us.
    await installCls(whiteCtx);
    await installCls(blackCtx);

    const [whitePage, blackPage] = await Promise.all([
      openAs(whiteCtx, match.white),
      openAs(blackCtx, match.black),
    ]);
    const white = new BoardPage(whitePage);
    const black = new BoardPage(blackPage);

    const baseline = {
      white: await settled(white),
      black: await settled(black),
    };

    for (const [i, move] of OPENING.entries()) {
      const whiteToMove = i % 2 === 0;
      const mover = whiteToMove ? white : black;
      const watcher = whiteToMove ? black : white;
      const watcherName = whiteToMove ? "black" : "white";

      // Read the watcher's CLS BEFORE the move: everything it accumulates from
      // here until the move has landed is the incoming update's doing.
      const clsBefore = await readCls(watcher.page);

      await mover.clickMove(move.from, move.to);

      await expect
        .poll(() => mover.pieceAt(move.to), {
          timeout: PROPAGATION,
          message: `${move.san} never appeared on the board that played it`,
        })
        .toBe(move.piece);
      await expect
        .poll(() => watcher.pieceAt(move.to), {
          timeout: PROPAGATION,
          message: `${move.san} never reached the ${watcherName} device`,
        })
        .toBe(move.piece);

      const clsAfter = await readCls(watcher.page);
      expect(
        clsAfter - clsBefore,
        `${watcherName} saw layout shift while ${move.san} arrived`,
      ).toBeLessThan(0.01);

      assertFrame(await frame(white), baseline.white, "white", `after ${move.san}`);
      assertFrame(await frame(black), baseline.black, "black", `after ${move.san}`);

      // The newest move must be visible INSIDE the list — the half of L1 that a
      // page-level scroll assertion cannot see. Polled on the watcher because
      // its list is rebuilt when the update lands, not when the click happened.
      expect(
        await mover.movelistPinned(),
        `the move list on the ${whiteToMove ? "white" : "black"} device is not showing ${move.san}`,
      ).toBe(true);
      await expect
        .poll(() => watcher.movelistPinned(), {
          timeout: PROPAGATION,
          message: `the move list on the ${watcherName} device is not showing ${move.san}`,
        })
        .toBe(true);
    }

    // Both notation panels agree on the game that was actually played.
    await expect(white.moveList()).toContainText("Bg5");
    await expect(black.moveList()).toContainText("Bg5");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
