import { expect, test, type BrowserContext } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { createMatch, openAs } from "./fixtures/match";
import { BoardPage } from "./pages/board";

// The one journey everything else rests on: two students, two devices, one
// board — and a move made on one of them showing up on the other.
//
// Nothing is stubbed. The move goes through /api/move, the server applies it,
// and the opponent learns about it either from the Realtime broadcast or from
// GameView's 3 s poll backstop when that broadcast is lost. The 10 s budget
// below is deliberately larger than one poll cycle and smaller than the 11 s
// pending watchdog: it passes on the broadcast, it still passes on the poll,
// and it fails if the only thing that could have healed it was the watchdog.
//
// Runs on desktop-chromium AND mobile-chromium: the whole point of this app is
// a teacher's laptop and a pile of borrowed phones.

const PROPAGATION = 10_000;

test("two students play the opening moves and each sees the other's", async ({
  browser,
  request,
}) => {
  const match = await createMatch(request, { white: "Ada", black: "Bo" });

  // One context per student: separate localStorage, separate cookie jar,
  // separate `sjakk:player`. Sharing a context would trip GameView's
  // passive-tab takeover — two boards for one identity is exactly what that
  // guard exists to stop.
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

    // Both boards start from the standard position, seen from their own side.
    expect(await white.pieceAt("e2")).toBe("wP");
    expect(await black.pieceAt("e2")).toBe("wP");
    // White moves first, so the banners must disagree from the very first paint.
    await expect(white.turnBanner()).toContainText(no.player.yourTurn);
    await expect(black.turnBanner()).not.toContainText(no.player.yourTurn);

    // ---- 1. e4 — white clicks (the tap path a school iPad uses) ----
    await white.clickMove("e2", "e4");
    await expect
      .poll(() => white.pieceAt("e4"), { timeout: PROPAGATION })
      .toBe("wP");
    expect(await white.pieceAt("e2")).toBeNull();

    // …and it reaches the other device.
    await expect
      .poll(() => black.pieceAt("e4"), { timeout: PROPAGATION })
      .toBe("wP");
    expect(await black.pieceAt("e2")).toBeNull();
    await expect(black.turnBanner()).toContainText(no.player.yourTurn);

    // ---- 2. e5 — black answers, and white sees it ----
    await black.clickMove("e7", "e5");
    await expect
      .poll(() => black.pieceAt("e5"), { timeout: PROPAGATION })
      .toBe("bP");
    await expect
      .poll(() => white.pieceAt("e5"), { timeout: PROPAGATION })
      .toBe("bP");
    await expect(white.turnBanner()).toContainText(no.player.yourTurn);

    // Both notation panels agree on the game that was actually played.
    await expect(white.moveList()).toContainText("e4");
    await expect(white.moveList()).toContainText("e5");
    await expect(black.moveList()).toContainText("e4");
    await expect(black.moveList()).toContainText("e5");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
