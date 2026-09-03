import { expect, test, type BrowserContext } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { createMatch, openAs } from "./fixtures/match";
import { readIdentity } from "./helpers/identity";
import { BoardPage } from "./pages/board";

// A phone that loses the network in the middle of a game.
//
// The two failures this locks down are the ones a student actually notices:
//
//   1. The board VANISHES. A failed background poll must never take the game
//      away — no join screen, no "noe gikk galt", no lost resume code. The board
//      simply goes stale, and catches up on its own when the network returns.
//   2. The board FREEZES. An optimistic move whose POST never lands must roll
//      back and release the `pending` lock, so the next tap is accepted. The
//      absolute ceiling on that lock is PENDING_CEILING_MS (11 s, GameView), and
//      a dropped connection should be far quicker than the ceiling — but never
//      slower.
//
// Nothing here shortens a shipped timing: `context.setOffline` is the network
// going away, and every budget below is derived from the app's own constants
// (8 s fetch deadline, 3 s poll, 11 s pending ceiling).

/** Both of these wait on shipped timeouts rather than on the app being quick. */
test.describe.configure({ mode: "serial" });

test("the network drops, the board stays, and it catches up by itself", async ({
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

    // A normal first move, so both devices are demonstrably in sync before the
    // network is taken away.
    await white.clickMove("e2", "e4");
    await expect.poll(() => black.pieceAt("e4"), { timeout: 10_000 }).toBe("wP");

    // ---- white goes offline; black plays on ----
    await whiteCtx.setOffline(true);
    await black.clickMove("e7", "e5");
    await expect.poll(() => black.pieceAt("e5"), { timeout: 10_000 }).toBe("bP");

    // For four seconds — more than one 3 s poll cycle, so `safeLoad` has
    // certainly failed at least once — white keeps the position it had and
    // keeps the screen it was on.
    for (let i = 0; i < 4; i++) {
      await whitePage.waitForTimeout(1000);
      expect(await white.pieceAt("e5"), "white saw a move it could not have received").toBeNull();
      expect(await white.pieceAt("e4"), "white lost its own last move").toBe("wP");
      await expect(whitePage.getByTestId("join-screen")).toHaveCount(0);
      await expect(whitePage.getByTestId("load-error")).toHaveCount(0);
      await expect(white.shell()).toBeVisible();
    }

    // The badge is the honest signal that syncing is failing (R7) — the board
    // going quiet without saying so is the bug it replaced.
    await expect(whitePage.getByText(no.player.reconnecting)).toBeVisible();

    // ---- and back ----
    await whiteCtx.setOffline(false);
    // Budget: the `online` listener resyncs immediately; if that event is lost,
    // the 3 s poll backstop still has three cycles inside twelve seconds.
    await expect
      .poll(() => white.pieceAt("e5"), {
        timeout: 12_000,
        message: "white never caught up after the network returned",
      })
      .toBe("bP");
    await expect(whitePage.getByText(no.player.reconnecting)).toHaveCount(0);

    // The blip cost the student nothing: same page, same identity.
    expect(new URL(whitePage.url()).pathname).toBe("/play");
    const stored = await readIdentity(whitePage);
    expect(stored?.playerId, "the resume identity was wiped by a network blip").toBe(
      match.white.playerId,
    );
    expect(stored?.resumeCode).toBe(match.white.resumeCode);
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});

test("a move posted into a dead network rolls back and releases the lock", async ({
  browser,
  request,
}) => {
  test.setTimeout(120_000);

  const match = await createMatch(request, { white: "Cam", black: "Dee" });
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

    await whiteCtx.setOffline(true);

    // The optimistic render happens in the click handler, before any network
    // call resolves — the student sees their move immediately, as designed.
    await white.clickMove("e2", "e4");
    await expect.poll(() => white.pieceAt("e4"), { timeout: 2_000 }).toBe("wP");

    // …and then it is taken back, with a word about why. 9 s is inside the 11 s
    // pending ceiling on purpose: the rollback must come from the failed POST
    // (8 s deadline at the very worst), never from the watchdog.
    await expect(white.toast(), "no toast explained the failed move").toBeVisible({
      timeout: 9_000,
    });
    await expect(white.toast()).toContainText(no.player.connection);
    await expect
      .poll(() => white.pieceAt("e2"), {
        timeout: 9_000,
        message: "the board never rolled back to the confirmed position",
      })
      .toBe("wP");
    expect(await white.pieceAt("e4")).toBeNull();

    // `pending` is what would freeze the board, and the resign button is
    // `disabled={pending || …}` — so an enabled button IS a released lock.
    // Asserted inside the ceiling: released BECAUSE the POST settled.
    await expect(
      white.resignButton(),
      "the pending lock outlived PENDING_CEILING_MS",
    ).toBeEnabled({ timeout: 11_000 });

    // …and a SECOND tap is accepted rather than swallowed. `tryMove` returns
    // immediately while `pending` is set, so it would produce no toast at all —
    // a fresh toast is therefore proof that the attempt was taken. (The
    // optimistic render itself is not assertable here: offline, the POST rejects
    // in well under one poll interval, so the piece is on e4 and gone again
    // before any observer could see it.)
    await expect(white.toast(), "the 2.2 s toast never cleared").toHaveCount(0, {
      timeout: 6_000,
    });
    await white.clickMove("e2", "e4");
    await expect(
      white.toast(),
      "a second move attempt was swallowed — the pending lock is still on",
    ).toBeVisible({ timeout: 9_000 });

    // ---- back online: the move goes through and both boards agree ----
    await whiteCtx.setOffline(false);
    await expect
      .poll(() => white.pieceAt("e2"), { timeout: 12_000 })
      .toBe("wP");
    await white.clickMove("e2", "e4");
    await expect.poll(() => white.pieceAt("e4"), { timeout: 12_000 }).toBe("wP");
    await expect
      .poll(() => black.pieceAt("e4"), {
        timeout: 15_000,
        message: "the two devices never converged after the network returned",
      })
      .toBe("wP");
    expect(await black.pieceAt("e2")).toBeNull();
  } finally {
    await Promise.all(contexts.map((c) => c.close()));
  }
});
