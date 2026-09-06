"use client";

import { useEffect, useId } from "react";
import type { PromoPiece } from "@/lib/chess/promotion";
import { no } from "@/lib/locale/no";
import { Modal } from "@/lib/client/Modal";

// White / black Unicode glyphs per promotable piece, in the usual chooser order.
const PIECES: { p: PromoPiece; white: string; black: string }[] = [
  { p: "q", white: "♕", black: "♛" },
  { p: "r", white: "♖", black: "♜" },
  { p: "b", white: "♗", black: "♝" },
  { p: "n", white: "♘", black: "♞" },
];

// Accept both the chess.js letters (q/r/b/n) and the Norwegian piece initials
// (Dronning/Tårn/Løper/Springer) so the keyboard works for either reader.
const KEY_TO_PIECE: Record<string, PromoPiece> = {
  q: "q", d: "q",
  r: "r", t: "r",
  b: "b", l: "b",
  n: "n", s: "n",
};

/** Modal piece chooser shown before committing a promoting move. Pieces are
 * ≥44px tap targets; Queen is pre-focused. Keyboard: q/r/b/n (or d/t/l/s).
 * Escape CANCELS the pending move (same as backdrop click) — it never commits
 * a queen implicitly, since Escape is "back out of this", not "pick the
 * default". */
export function PromotionPicker({
  color,
  onPick,
  onCancel,
}: {
  color: "white" | "black";
  onPick: (piece: PromoPiece) => void;
  onCancel: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const piece = KEY_TO_PIECE[k];
      if (piece) {
        e.preventDefault();
        onPick(piece);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPick]);

  const titleId = useId();

  return (
    <Modal
      open
      onClose={onCancel}
      labelledBy={titleId}
      overlayClassName="promo-overlay"
      cardClassName="promo-card"
    >
      <p id={titleId} className="promo-title">
        {no.promo.title}
      </p>
      <div className="promo-row">
        {PIECES.map(({ p, white, black }) => (
          <button
            key={p}
            className="promo-btn"
            autoFocus={p === "q"}
            aria-label={no.promo[p]}
            title={no.promo[p]}
            onClick={() => onPick(p)}
          >
            {color === "white" ? white : black}
          </button>
        ))}
      </div>
      <p className="promo-hint">{no.promo.hint}</p>
    </Modal>
  );
}
