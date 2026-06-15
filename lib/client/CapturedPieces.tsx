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

  if (pieces.length === 0 && adv <= 0) {
    return <span style={{ minHeight: 22, display: "inline-block" }} />;
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        minHeight: 22,
        flexWrap: "wrap",
        padding: pieces.length ? "2px 7px" : 0,
        borderRadius: 8,
        background: pieces.length ? "rgba(255,255,255,0.06)" : "transparent",
        border: pieces.length ? "1px solid var(--ink-line)" : "none",
      }}
    >
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
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
      {adv > 0 && (
        <b style={{ marginLeft: 4, fontSize: 13, color: "var(--gold)" }}>+{adv}</b>
      )}
    </span>
  );
}
