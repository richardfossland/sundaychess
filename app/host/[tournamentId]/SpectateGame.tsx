"use client";

import dynamic from "next/dynamic";
import { EvalBar } from "@/lib/client/EvalBar";
import { CapturedPieces } from "@/lib/client/CapturedPieces";
import { initials } from "@/lib/client/Confetti";
import { no } from "@/lib/locale/no";

const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

function SpectatePlayer({
  name,
  side,
  fen,
}: {
  name: string;
  side: "white" | "black";
  fen: string;
}) {
  return (
    <div className="spread" style={{ width: "min(92vw, 520px)" }}>
      <div className="row" style={{ gap: 10 }}>
        <span
          className="avatar-lg"
          style={
            side === "black"
              ? {
                  background: "linear-gradient(180deg,var(--ink-soft),#1c212b)",
                  color: "var(--txt)",
                  border: "1px solid var(--ink-line-strong)",
                }
              : undefined
          }
        >
          {initials(name)}
        </span>
        <b style={{ fontSize: 18 }}>{name}</b>
      </div>
      <CapturedPieces fen={fen} side={side} />
    </div>
  );
}

/** Big-screen spectator view of one game: large read-only board with the
 * engine eval bar + captured pieces. Driven by `fen` from the parent (which
 * patches it live), so no own subscription. */
export function SpectateGame({
  fen,
  white,
  black,
  onClose,
}: {
  fen: string;
  white: string;
  black: string;
  onClose: () => void;
}) {
  return (
    <main className="center-screen">
      <div className="stack" style={{ alignItems: "center", gap: 14 }}>
        <button className="btn btn-ghost" style={{ alignSelf: "flex-start" }} onClick={onClose}>
          ← {no.host.liveToggle}
        </button>

        <SpectatePlayer name={black} side="black" fen={fen} />

        <div className="row" style={{ gap: 12, alignItems: "stretch" }}>
          <EvalBar fen={fen} />
          <div className="board-frame">
            <div className="board-shell-lg">
              <Chessboard
                options={{
                  position: fen,
                  allowDragging: false,
                  showNotation: true,
                  darkSquareStyle: { backgroundColor: "var(--board-dark)" },
                  lightSquareStyle: { backgroundColor: "var(--board-light)" },
                  id: "spectate-board",
                }}
              />
            </div>
          </div>
        </div>

        <SpectatePlayer name={white} side="white" fen={fen} />
      </div>
    </main>
  );
}
