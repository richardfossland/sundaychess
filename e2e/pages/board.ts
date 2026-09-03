import { expect, type Locator, type Page } from "@playwright/test";

// The player's board, addressed the way the DOM actually exposes it.
//
// react-chessboard v5 (node_modules/react-chessboard/dist/index.esm.js) renders
// one div per square carrying `data-square="e2"`, and renders the piece as that
// square's CHILD carrying `data-piece="wP"` (colour letter + upper-case piece
// letter). Those two attributes are the whole contract this page object needs —
// no class names, no ids, nothing that a restyle would move.

export type Square = string; // "e2", "h8", …

/** Piece code as react-chessboard writes it: "wP", "bK", … */
export type PieceCode = string;

export class BoardPage {
  constructor(readonly page: Page) {}

  /** The board's outer box — the element every geometry assertion measures. */
  shell(): Locator {
    return this.page.getByTestId("board-shell");
  }

  square(sq: Square): Locator {
    // Scoped to the board: the ReplayBoard in the result overlay renders its own
    // squares, and an unscoped `[data-square]` would match both.
    return this.shell().locator(`[data-square="${sq}"]`);
  }

  /**
   * Move by CLICK — select the origin square, then the destination. This is the
   * tap path a student on a school iPad actually uses, and the one GameView's
   * `onSquareClick` drives (selection → legal dots → move).
   */
  async clickMove(from: Square, to: Square): Promise<void> {
    await this.square(from).click();
    await this.square(to).click();
  }

  /**
   * Move by DRAG — a real pointer press, several intermediate moves, release.
   *
   * `dragTo()` is not usable here: react-chessboard v5 drives dnd-kit, whose
   * pointer sensor needs genuine intermediate `pointermove` events to start a
   * drag at all. A single jump from origin to destination is ignored, so the
   * steps below are load-bearing, not padding.
   */
  async dragMove(from: Square, to: Square, steps = 12): Promise<void> {
    const a = await this.square(from).boundingBox();
    const b = await this.square(to).boundingBox();
    expect(a, `square ${from} has no box`).toBeTruthy();
    expect(b, `square ${to} has no box`).toBeTruthy();

    const start = { x: a!.x + a!.width / 2, y: a!.y + a!.height / 2 };
    const end = { x: b!.x + b!.width / 2, y: b!.y + b!.height / 2 };

    await this.page.mouse.move(start.x, start.y);
    await this.page.mouse.down();
    // A first small nudge crosses dnd-kit's activation distance before the long
    // travel begins.
    await this.page.mouse.move(start.x + 4, start.y + 4, { steps: 2 });
    await this.page.mouse.move(end.x, end.y, { steps });
    await this.page.mouse.up();
  }

  /** The piece standing on `sq`, or null when the square is empty. */
  async pieceAt(sq: Square): Promise<PieceCode | null> {
    const piece = this.square(sq).locator("[data-piece]");
    if ((await piece.count()) === 0) return null;
    return piece.first().getAttribute("data-piece");
  }

  /** The single fixed banner slot: your turn / opponent's turn / pre-move. */
  turnBanner(): Locator {
    return this.page.getByTestId("turn-banner");
  }

  /** The transient error toast (2.2 s in GameView — read it promptly). */
  toast(): Locator {
    return this.page.getByTestId("toast");
  }

  /** SAN notation panel. */
  moveList(): Locator {
    return this.page.getByTestId("movelist");
  }

  /** End-of-game card. */
  resultCard(): Locator {
    return this.page.getByTestId("result-card");
  }

  /** The board's bounding box — for "does it fit / did it jump" assertions. */
  async boardBox(): Promise<{ x: number; y: number; width: number; height: number }> {
    const box = await this.shell().boundingBox();
    expect(box, "board-shell has no bounding box").toBeTruthy();
    return box!;
  }

  /** Current vertical scroll offset. The board must never push the page down. */
  scrollY(): Promise<number> {
    return this.page.evaluate(() => window.scrollY);
  }
}
