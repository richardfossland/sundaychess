"use client";

import { useEffect } from "react";
import type { PromoPiece } from "@/lib/chess/promotion";
import { no } from "@/lib/locale/no";

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
 * ≥44px tap targets; Queen is pre-focused (Enter/Space = queen). Keyboard:
 * q/r/b/n (or d/t/l/s), Esc = queen (the quick default). Backdrop = cancel. */
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
      if (k === "escape") {
        e.preventDefault();
        onPick("q"); // Esc = queen, the standard default
        return;
      }
      const piece = KEY_TO_PIECE[k];
      if (piece) {
        e.preventDefault();
        onPick(piece);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPick]);

  return (
    <div
      className="promo-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={no.promo.title}
      onClick={onCancel}
    >
      <div className="promo-card" onClick={(e) => e.stopPropagation()}>
        <p className="promo-title">{no.promo.title}</p>
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
      </div>
    </div>
  );
}
