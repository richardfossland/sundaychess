"use client";

import { useMemo } from "react";
import type { CSSProperties } from "react";
import { evaluateFen } from "@/lib/chess/bot";

const EASE = "cubic-bezier(0.34, 1.12, 0.64, 1)"; // gentle spring
const DUR = "0.7s";

/** Chess-engine evaluation bar (lichess/chess.com style) — White fills from the
 * bottom by win-probability, with a glowing boundary line and a gold pointer +
 * value pill that glides up/down to where the evaluation sits. Big-screen
 * spectator only (never on the player's phone). */
export function EvalBar({ fen }: { fen: string }) {
  const { cp, mate } = useMemo(() => evaluateFen(fen), [fen]);
  const p = mate != null ? (mate > 0 ? 1 : 0) : 1 / (1 + Math.pow(10, -cp / 400));
  const whitePct = Math.max(2, Math.min(98, p * 100));
  const label =
    mate != null
      ? mate > 0
        ? "#"
        : "−#"
      : `${cp >= 0 ? "+" : "−"}${Math.abs(cp / 100).toFixed(1)}`;
  const whiteAhead = p >= 0.5;

  const ride: CSSProperties = {
    bottom: `${whitePct}%`,
    transition: `bottom ${DUR} ${EASE}`,
  };

  return (
    <div
      aria-hidden
      style={{ position: "relative", width: 30, alignSelf: "stretch", overflow: "visible" }}
    >
      {/* the bar (clipped) */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 9,
          overflow: "hidden",
          background: "linear-gradient(180deg,#191d25,#12151b)",
          border: "1px solid var(--ink-line)",
          boxShadow: "inset 0 0 0 1px rgba(0,0,0,.25)",
        }}
      >
        {/* faint 50% reference tick */}
        <div style={{ position: "absolute", left: 0, right: 0, top: "50%", height: 1, background: "rgba(255,255,255,0.07)" }} />
        {/* White fill */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            height: `${whitePct}%`,
            background: "linear-gradient(180deg,#fdfaf2,#e7ddc7)",
            transition: `height ${DUR} ${EASE}`,
          }}
        />
        {/* glowing boundary line */}
        <div
          style={{
            position: "absolute",
            left: 0,
            right: 0,
            height: 2,
            marginBottom: -1,
            background: "var(--gold)",
            boxShadow: "0 0 9px 1px rgba(235,184,75,0.85)",
            ...ride,
          }}
        />
      </div>

      {/* pointer + value pill, riding the boundary on the left side */}
      <div
        style={{
          position: "absolute",
          left: 0,
          display: "flex",
          alignItems: "center",
          transform: "translate(-100%, 50%)",
          ...ride,
        }}
      >
        <span
          className="mono"
          style={{
            padding: "3px 8px",
            marginRight: 1,
            borderRadius: 7,
            fontSize: 13,
            fontWeight: 800,
            lineHeight: 1,
            color: "#1a1305",
            background: "var(--gold-grad)",
            boxShadow: "0 4px 14px -4px rgba(235,184,75,.6)",
            whiteSpace: "nowrap",
          }}
        >
          {label}
        </span>
        {/* triangle pointing right, into the bar */}
        <span
          style={{
            width: 0,
            height: 0,
            borderTop: "6px solid transparent",
            borderBottom: "6px solid transparent",
            borderLeft: "7px solid var(--gold)",
            filter: "drop-shadow(1px 0 2px rgba(235,184,75,.5))",
          }}
        />
      </div>

      <span style={{ position: "absolute", left: -9999 }}>{whiteAhead ? "Hvit leder" : "Svart leder"}</span>
    </div>
  );
}
