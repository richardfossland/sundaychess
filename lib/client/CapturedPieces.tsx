"use client";

import { capturedFromFen, glyph } from "@/lib/chess/captured";

/** Pieces `side` has captured (its opponent's removed pieces) + a material
 * advantage badge. Derived from the FEN. */
export function CapturedPieces({
  fen,
  side,
}: {
  fen: string;
  side: "white" | "black";
}) {
  const cap = capturedFromFen(fen);
  const pieces = side === "white" ? cap.byWhite : cap.byBlack;
  const adv = side === "white" ? cap.materialDiff : -cap.materialDiff;
  // captured pieces belong to the opponent's colour
  const pieceColor = side === "white" ? "#11141b" : "#f3efe6";

  if (pieces.length === 0 && adv <= 0) {
    return <span style={{ minHeight: 20, display: "inline-block" }} />;
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 1, minHeight: 20, flexWrap: "wrap" }}>
      {pieces.map((p, i) => (
        <span
          key={i}
          style={{
            fontSize: 18,
            lineHeight: 1,
            color: pieceColor,
            textShadow: side === "white" ? "0 0 1px rgba(255,255,255,.5)" : "none",
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
