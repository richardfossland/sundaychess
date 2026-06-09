"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import type { GameDetail } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";
import { api, ApiError } from "@/lib/client/api";
import { applyMove, legalDestinations } from "@/lib/chess/validateMove";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import type { StoredPlayer } from "@/lib/client/identity";
import { Confetti, initials } from "@/lib/client/Confetti";
import { no } from "@/lib/locale/no";

// DnD board: render client-only to avoid SSR/window issues.
const Chessboard = dynamic(
  () => import("react-chessboard").then((m) => m.Chessboard),
  { ssr: false },
);

type Color = "white" | "black";

export function GameView({
  me,
  gameId,
  onFinished,
}: {
  me: StoredPlayer;
  gameId: string;
  onFinished: () => void;
}) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [fen, setFen] = useState<string>("");
  const [turn, setTurn] = useState<Turn>("w");
  const [status, setStatus] = useState<GameStatus>("live");
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [incomingDraw, setIncomingDraw] = useState(false);

  // Last server-confirmed FEN — the rollback target for a failed optimistic move.
  const confirmedFen = useRef<string>("");

  const myColor: Color = detail?.black?.id === me.playerId ? "black" : "white";
  const myTurnLetter: Turn = myColor === "white" ? "w" : "b";
  const isMyTurn = status === "live" && turn === myTurnLetter;

  const load = useCallback(async () => {
    const d = await api.game(gameId);
    setDetail(d);
    setFen(d.fen);
    setTurn(d.turn);
    setStatus(d.status);
    setLastMove(d.lastMove ? { from: d.lastMove.from, to: d.lastMove.to } : null);
    confirmedFen.current = d.fen;
  }, [gameId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch(() => setToast(no.common.error));
  }, [load]);

  // Reconnect hardening: re-sync the authoritative position when the tab
  // regains focus or the network returns (recovers any missed broadcast).
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") load().catch(() => {});
    };
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);
    return () => {
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
    };
  }, [load]);

  // Authoritative updates from the game channel.
  useChannel(channels.game(gameId), (event, payload) => {
    if (event === "position") {
      const p = payload as {
        fen: string;
        turn: Turn;
        status: GameStatus;
        lastMove?: { from: string; to: string } | null;
      };
      setFen(p.fen);
      setTurn(p.turn);
      setStatus(p.status);
      confirmedFen.current = p.fen;
      if (p.lastMove) setLastMove({ from: p.lastMove.from, to: p.lastMove.to });
      setSelected(null);
      setLegal([]);
    } else if (event === "result") {
      const p = payload as { status: GameStatus };
      setStatus(p.status);
    } else if (event === "draw_offer") {
      const p = payload as { by: string };
      if (p.by !== me.playerId) setIncomingDraw(true);
    } else if (event === "draw_declined") {
      setIncomingDraw(false);
    }
  });

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  // Attempt a move: optimistic render, then server reconcile / rollback.
  const tryMove = useCallback(
    async (from: string, to: string) => {
      if (!isMyTurn || pending) return false;

      // Auto-queen on promotion (custom promotion UI is a Phase 6 open question).
      const local = applyMove(fen, { from, to, promotion: "q" });
      if (!local.ok) return false;

      const before = fen;
      setFen(local.fen);
      setTurn(local.turn);
      setLastMove({ from, to });
      setSelected(null);
      setLegal([]);
      setPending(true);

      try {
        const res = await api.move({
          gameId,
          from,
          to,
          promotion: "q",
          playerId: me.playerId,
          resumeCode: me.resumeCode,
        });
        // Reconcile to the server's authoritative result.
        setFen(res.fen);
        setTurn(res.turn);
        setStatus(res.status);
        confirmedFen.current = res.fen;
      } catch (e) {
        // Roll back to the last confirmed position.
        setFen(before);
        setTurn(myTurnLetter);
        const code = e instanceof ApiError ? e.code : "";
        if (code === "not_your_turn") flash(no.player.notYourTurn);
        else if (code === "stale" || code === "not_live") {
          flash(no.common.error);
          load().catch(() => {});
        } else flash(no.player.illegalMove);
      } finally {
        setPending(false);
      }
      return true;
    },
    [fen, gameId, isMyTurn, load, me.playerId, me.resumeCode, myTurnLetter, pending],
  );

  function onDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false;
    void tryMove(sourceSquare, targetSquare);
    return true;
  }

  function onSquareClick({ square, piece }: SquareHandlerArgs) {
    if (!isMyTurn) return;
    if (selected && legal.includes(square)) {
      void tryMove(selected, square);
      return;
    }
    if (piece) {
      setSelected(square);
      setLegal(legalDestinations(fen, square));
    } else {
      setSelected(null);
      setLegal([]);
    }
  }

  // Build square highlight styles (selection, last move, legal dots).
  const squareStyles: Record<string, React.CSSProperties> = {};
  if (lastMove) {
    const hl = { background: "rgba(235,184,75,0.35)" };
    squareStyles[lastMove.from] = { ...hl };
    squareStyles[lastMove.to] = { ...hl };
  }
  if (selected) {
    squareStyles[selected] = { background: "rgba(86,192,106,0.45)" };
  }
  for (const sq of legal) {
    squareStyles[sq] = {
      ...(squareStyles[sq] ?? {}),
      backgroundImage:
        "radial-gradient(circle, rgba(86,192,106,0.7) 22%, transparent 24%)",
    };
  }

  if (!detail) {
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );
  }

  const opponent = myColor === "white" ? detail.black : detail.white;
  const ended = status !== "live";

  const iWon =
    ended &&
    ((status === "white_win" && myColor === "white") ||
      (status === "black_win" && myColor === "black"));
  let resultText = "";
  if (ended) {
    if (status === "draw") resultText = no.player.gameDraw;
    else resultText = iWon ? no.player.youWon : no.player.youLost;
  }

  const oppAvatar: React.CSSProperties = {
    background: "linear-gradient(180deg, var(--ink-soft), #1c212b)",
    color: "var(--txt)",
    border: "1px solid var(--ink-line-strong)",
  };

  return (
    <main className="center-screen">
      {iWon && <Confetti count={120} />}
      <div className="stack" style={{ alignItems: "center", width: "100%", maxWidth: 600, gap: 16 }}>
        {/* player vs player */}
        <div className="spread" style={{ width: "min(92vw,560px)" }}>
          <div className="row" style={{ gap: 10 }}>
            <span className="avatar-lg">{initials(me.displayName)}</span>
            <div style={{ lineHeight: 1.25 }}>
              <b>{me.displayName}</b>
              <div className="faint" style={{ fontSize: 12 }}>
                {no.player.youAre} {myColor === "white" ? no.player.white : no.player.black}
              </div>
            </div>
          </div>
          <span className="faint" style={{ fontStyle: "italic" }}>{no.player.vs}</span>
          <div className="row" style={{ gap: 10 }}>
            <div style={{ lineHeight: 1.25, textAlign: "right" }}>
              <b>{opponent?.name ?? "?"}</b>
              <div className="faint" style={{ fontSize: 12 }}>
                {myColor === "white" ? no.player.black : no.player.white}
              </div>
            </div>
            <span className="avatar-lg" style={oppAvatar}>{initials(opponent?.name ?? "?")}</span>
          </div>
        </div>

        {!ended && (
          <div
            className={`banner ${isMyTurn ? "banner-turn" : "banner-wait"}`}
            style={{ width: "min(92vw,560px)" }}
            role="status"
            aria-live="polite"
          >
            {isMyTurn ? `♟ ${no.player.yourTurn}` : no.player.opponentTurn}
          </div>
        )}

        <div className="board-frame">
          <div className="board-shell">
            <Chessboard
              options={{
                position: fen || undefined,
                boardOrientation: myColor,
                allowDragging: isMyTurn,
                onPieceDrop: onDrop,
                onSquareClick,
                squareStyles,
                darkSquareStyle: { backgroundColor: "var(--board-dark)" },
                lightSquareStyle: { backgroundColor: "var(--board-light)" },
                animationDurationInMs: 180,
                id: "play-board",
              }}
            />
          </div>
        </div>

        {!ended && (
          <div className="row">
            <button
              className="btn btn-ghost"
              disabled={pending}
              onClick={() =>
                api.draw(gameId, me.playerId, me.resumeCode, "offer").then(() =>
                  flash(no.player.drawOffered),
                ).catch(() => flash(no.common.error))
              }
            >
              ½ {no.player.offerDraw}
            </button>
            <button
              className="btn btn-danger"
              disabled={pending}
              onClick={() => {
                if (!confirm(no.player.resignConfirm)) return;
                api
                  .resign(gameId, me.playerId, me.resumeCode)
                  .catch(() => flash(no.common.error));
              }}
            >
              {no.player.resign}
            </button>
          </div>
        )}

        {incomingDraw && !ended && (
          <div className="card stack" style={{ padding: 16, width: "min(92vw,560px)" }}>
            <p>{no.player.drawOfferedByOpponent}</p>
            <div className="row">
              <button
                className="btn btn-primary grow"
                onClick={() =>
                  api
                    .draw(gameId, me.playerId, me.resumeCode, "accept")
                    .then(() => setIncomingDraw(false))
                    .catch(() => flash(no.common.error))
                }
              >
                {no.player.accept}
              </button>
              <button
                className="btn grow"
                onClick={() =>
                  api
                    .draw(gameId, me.playerId, me.resumeCode, "decline")
                    .then(() => setIncomingDraw(false))
                    .catch(() => {})
                }
              >
                {no.player.decline}
              </button>
            </div>
          </div>
        )}

        {toast && <div className="banner banner-error">{toast}</div>}
      </div>

      {ended && (
        <div className="result-overlay">
          <div className="result-card stack" style={{ alignItems: "center", gap: 12 }}>
            <div className="result-emoji">
              {status === "draw" ? "🤝" : iWon ? "🎉" : "😔"}
            </div>
            <h1 style={{ fontSize: "clamp(36px,9vw,64px)" }}>{resultText}</h1>
            <p className="muted">
              {status === "draw"
                ? "Godt spilt av begge."
                : iWon
                  ? "Sterkt spilt!"
                  : "Bedre lykke neste runde."}
            </p>
            <button className="btn btn-primary btn-lg" style={{ marginTop: 6 }} onClick={onFinished}>
              {no.common.next} →
            </button>
          </div>
        </div>
      )}
    </main>
  );
}
