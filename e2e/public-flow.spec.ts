import { expect, test, type BrowserContext } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { openAs, publicFlowMatch } from "./fixtures/match";
import { BoardPage } from "./pages/board";

// The one spec that never touches the test seam.
//
// Every other file gets its board from /api/dev/quickmatch, which mints a
// tournament, two players and a live game in a single unauthenticated call. That
// shortcut is worth having and it is also the suite's biggest blind spot: if the
// real join flow drifted — a changed pairing rule, a join that no longer returns
// a resume code, a round that starts without a live game — the whole suite would
// still be green, because nothing in it walks that road.
//
// So this one does: POST /api/tournament, two POST /api/join on the PIN, POST
// /api/round/start, read the pairing back, and then play. Public routes only,
// exactly as scripts/smoke-features.mjs does it.
//
// ONE tournament per run, deliberately: /api/tournament is rate-limited to 10
// creates per minute per IP, and in CI every spec shares the runner's address.

test("a tournament created and joined through the public routes reaches a live board", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await publicFlowMatch(request, { white: "Ada", black: "Bo" });

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

    // The pairing decided the colours; both boards must agree about whose move
    // it is from the very first paint.
    await expect(white.turnBanner()).toContainText(no.player.yourTurn);
    await expect(black.turnBanner()).not.toContainText(no.player.yourTurn);

    // ---- one move each way, on the real path ----
    await white.clickMove("e2", "e4");
    await expect.poll(() => white.pieceAt("e4"), { timeout: 10_000 }).toBe("wP");
    await expect
      .poll(() => black.pieceAt("e4"), {
        timeout: 10_000,
        message: "a move made on the public flow never reached the other device",
      })
      .toBe("wP");
    await expect(black.turnBanner()).toContainText(no.player.yourTurn);

    await black.clickMove("e7", "e5");
    await expect.poll(() => black.pieceAt("e5"), { timeout: 10_000 }).toBe("bP");
    await expect.poll(() => white.pieceAt("e5"), { timeout: 10_000 }).toBe("bP");
    await expect(white.turnBanner()).toContainText(no.player.yourTurn);

    await expect(white.moveList()).toContainText("e5");
    await expect(black.moveList()).toContainText("e4");
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
