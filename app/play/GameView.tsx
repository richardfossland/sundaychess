"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import type { GameDetail } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";
import { api, ApiError } from "@/lib/client/api";
import { applyMove, legalDestinations } from "@/lib/chess/validateMove";
import { drawReasonFromFen } from "@/lib/chess/drawReason";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import type { StoredPlayer } from "@/lib/client/identity";
import { Confetti, initials } from "@/lib/client/Confetti";
import { CapturedPieces } from "@/lib/client/CapturedPieces";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { no } from "@/lib/locale/no";

/** A player's side panel (avatar, name, colour, captured pieces) — sits beside
 * the board on wide screens and stacks above/below it on narrow ones. */
function SidePanel({
  name,
  sub,
  fen,
  capSide,
  isMe,
  active,
}: {
  name: string;
  sub: string;
  fen: string;
  capSide: "white" | "black";
  isMe: boolean;
  active: boolean;
}) {
  return (
    <div className="card" style={{ padding: 15 }}>
      <div className="row" style={{ gap: 10 }}>
        <span
          className="avatar-lg"
          style={
            isMe
              ? undefined
              : {
                  background: "linear-gradient(180deg, var(--ink-soft), #1c212b)",
                  color: "var(--txt)",
                  border: "1px solid var(--ink-line-strong)",
                }
          }
        >
          {initials(name)}
        </span>
        <div style={{ lineHeight: 1.25, minWidth: 0, flex: 1 }}>
          <b>{name}</b>
          <div className="faint" style={{ fontSize: 12 }}>{sub}</div>
        </div>
        {active && (
          <span
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: "var(--turn)",
              boxShadow: "0 0 0 0 color-mix(in srgb, var(--turn) 70%, transparent)",
              animation: "ping 1.6s var(--ease-out) infinite",
            }}
          />
        )}
      </div>
      <div style={{ marginTop: 8 }}>
        <CapturedPieces fen={fen} side={capSide} />
      </div>
    </div>
  );
}

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
  timer,
}: {
  me: StoredPlayer;
  gameId: string;
  onFinished: () => void;
  timer?: { startedAt: string | null; durationSec: number } | null;
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
  const [drawSent, setDrawSent] = useState(false);

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

  // Poll backstop: realtime broadcasts are best-effort, so re-sync while waiting
  // for the opponent (and nothing in flight). Guarantees the board un-freezes
  // within ~3 s even if a "position" event was dropped — without disrupting my
  // own selection / optimistic move.
  useEffect(() => {
    if (status !== "live" || isMyTurn || pending) return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load().catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [status, isMyTurn, pending, load]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

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
      setIncomingDraw(false); // a move supersedes any pending draw offer
      setDrawSent(false);
    } else if (event === "result") {
      const p = payload as { status: GameStatus };
      setStatus(p.status);
    } else if (event === "draw_offer") {
      const p = payload as { by: string };
      if (p.by !== me.playerId) setIncomingDraw(true);
    } else if (event === "draw_declined") {
      const p = payload as { by: string };
      setIncomingDraw(false);
      if (p.by !== me.playerId) {
        // The opponent declined my offer.
        setDrawSent(false);
        flash(no.player.drawDeclined);
      }
    }
  });

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
        else if (code === "timeout" || code === "network") {
          // Request hung/dropped — re-sync authoritative state so the board
          // can't get stuck on a stale turn.
          flash(no.player.connection);
          load().catch(() => {});
        } else if (code === "stale" || code === "not_live") {
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
    if (status === "draw") resultText = no.player.drawReason[drawReasonFromFen(fen)];
    else resultText = iWon ? no.player.youWon : no.player.youLost;
  }

  const oppColor: "white" | "black" = myColor === "white" ? "black" : "white";

  return (
    <main className="center-screen">
      {iWon && <Confetti count={120} />}
      <div className="game-grid">
        {/* opponent — left on wide, top on narrow */}
        <div className="game-side panel-opp">
          <SidePanel
            name={opponent?.name ?? "?"}
            sub={oppColor === "white" ? no.player.white : no.player.black}
            fen={fen}
            capSide={oppColor}
            isMe={false}
            active={!ended && !isMyTurn}
          />
        </div>

        {/* centre: timer + turn banner + board + actions */}
        <div className="game-center">
          {timer && timer.startedAt && !ended && (
            <RoundTimer startedAt={timer.startedAt} durationSec={timer.durationSec} compact />
          )}

          {!ended && (
            <div
              className={`banner ${isMyTurn ? "banner-turn" : "banner-wait"}`}
              style={{ width: "100%" }}
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
                disabled={pending || drawSent}
                onClick={() =>
                  api.draw(gameId, me.playerId, me.resumeCode, "offer")
                    .then(() => setDrawSent(true))
                    .catch(() => flash(no.common.error))
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

          {drawSent && !ended && (
            <div className="banner banner-wait" style={{ width: "100%" }} role="status" aria-live="polite">
              ½ {no.player.drawSent}
            </div>
          )}

          {incomingDraw && !ended && (
            <div className="card stack" style={{ padding: 16, width: "100%" }}>
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

          {toast && <div className="banner banner-error" style={{ width: "100%" }}>{toast}</div>}
        </div>

        {/* me — right on wide, bottom on narrow */}
        <div className="game-side panel-me">
          <SidePanel
            name={me.displayName}
            sub={`${no.player.youAre} ${myColor === "white" ? no.player.white : no.player.black}`}
            fen={fen}
            capSide={myColor}
            isMe
            active={!ended && isMyTurn}
          />
        </div>
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
