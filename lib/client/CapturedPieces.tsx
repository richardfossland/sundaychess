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
  // dark card. Give every glyph a contrasting outline (crisp text-stroke + a
  // soft halo) so both colours read clearly, and sit them on a subtle chip.
  const capturedBlack = side === "white";
  const fill = capturedBlack ? "#0c0e13" : "#f4f0e7";
  const outline = capturedBlack ? "rgba(255,255,255,.9)" : "rgba(0,0,0,.85)";
  const hasContent = pieces.length > 0 || adv > 0;

  // Both branches (empty and filled) render the SAME box — same display mode,
  // padding, and border width — so a capture never changes this element's
  // height (L2: nothing above .board-shell may change height mid-game). Only
  // colours differ (transparent when empty). `flexWrap:"nowrap"` +
  // `overflow:"hidden"` cap the height at one row instead of adding rows every
  // ~8 captures; the +N badge is rendered FIRST so it's never what gets
  // clipped when a long capture pile overflows the card.
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        minHeight: 26,
        boxSizing: "border-box",
        flexWrap: "nowrap",
        overflow: "hidden",
        maxWidth: "100%",
        padding: "2px 7px",
        borderRadius: 8,
        background: hasContent ? "rgba(255,255,255,0.06)" : "transparent",
        border: `1px solid ${hasContent ? "var(--ink-line)" : "transparent"}`,
      }}
    >
      {adv > 0 && (
        <b style={{ flexShrink: 0, marginRight: 2, fontSize: 13, color: "var(--gold)" }}>
          +{adv}
        </b>
      )}
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            flexShrink: 0,
            fontSize: 20,
            lineHeight: 1,
            color: fill,
            WebkitTextStroke: `0.7px ${outline}`,
            textShadow: `0 0 2px ${outline}`,
          }}
        >
          {glyph(p)}
        </span>
      ))}
    </span>
  );
}
