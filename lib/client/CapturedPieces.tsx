"use client";

import { capturedFromFen, glyph } from "@/lib/chess/captured";

/** Pieces `side` has captured (its opponent's removed pieces) + a material
 * advantage badge. Derived from the FEN. Pass `baselineFen` for theme
 * variants so never-existing pieces aren't shown as captured. */
export function CapturedPieces({
  fen,
  side,
  baselineFen,
}: {
  fen: string;
  side: "white" | "black";
  baselineFen?: string;
}) {
  const cap = capturedFromFen(fen, baselineFen);
  const pieces = side === "white" ? cap.byWhite : cap.byBlack;
  const adv = side === "white" ? cap.materialDiff : -cap.materialDiff;
  // Captured pieces belong to the OPPONENT's colour. The white player's pile is
  // therefore black pieces — near-black glyphs that used to vanish against the
  // dark card. `.captured-black/-white` give every glyph a contrasting outline
  // (crisp text-stroke + a soft halo) so both colours read clearly.
  const pieceClass = side === "white" ? "captured-black" : "captured-white";
  const hasContent = pieces.length > 0 || adv > 0;

  // Both branches (empty and filled) render the SAME box — same display mode,
  // padding, and border width — so a capture never changes this element's
  // height (L2: nothing above .board-shell may change height mid-game). Only
  // colours differ (transparent when empty). The row is `nowrap` + `overflow:
  // hidden` so it never adds lines every ~8 captures; the +N badge is rendered
  // FIRST so it's never what gets clipped when a long pile overflows.
  return (
    <span className={`captured ${hasContent ? "has-content" : ""}`}>
      {adv > 0 && <b className="captured-adv">+{adv}</b>}
      {pieces.map((p, i) => (
        <span key={i} className={`captured-piece ${pieceClass}`}>
          {glyph(p)}
        </span>
      ))}
    </span>
  );
}
