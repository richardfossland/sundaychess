"use client";

import { useMemo } from "react";
import { evaluateFen } from "@/lib/chess/bot";

/** Chess-engine evaluation bar (lichess/chess.com style) — White fills from the
 * bottom by win-probability. Big-screen spectator only (never on the player's
 * phone — no in-game help, no phone CPU). */
export function EvalBar({ fen }: { fen: string }) {
  const { cp, mate } = useMemo(() => evaluateFen(fen), [fen]);
  const p = mate != null ? (mate > 0 ? 1 : 0) : 1 / (1 + Math.pow(10, -cp / 400));
  const whitePct = Math.max(3, Math.min(97, p * 100));
  const label =
    mate != null ? (mate > 0 ? "#" : "-#") : `${cp >= 0 ? "+" : ""}${(cp / 100).toFixed(1)}`;
  const whiteAhead = p >= 0.5;

  return (
    <div
      aria-hidden
      style={{
        width: 26,
        alignSelf: "stretch",
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
        background: "#1a1d24",
        border: "1px solid var(--ink-line)",
        boxShadow: "inset 0 0 0 1px rgba(0,0,0,.3)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: `${whitePct}%`,
          background: "linear-gradient(180deg,#fbf7ee,#e7ddc8)",
          transition: "height 0.5s cubic-bezier(.22,.61,.36,1)",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          [whiteAhead ? "bottom" : "top"]: 4,
          textAlign: "center",
          fontSize: 11,
          fontWeight: 800,
          fontFamily: "var(--mono)",
          color: whiteAhead ? "#11141b" : "#f3efe6",
        } as React.CSSProperties}
      >
        {label}
      </span>
    </div>
  );
}
