"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Chess } from "chess.js";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import type { GameDetail } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";
import { api, ApiError } from "@/lib/client/api";
import { applyMove, legalDestinations } from "@/lib/chess/validateMove";
import { needsPromotion, type PromoPiece } from "@/lib/chess/promotion";
import { PromotionPicker } from "@/lib/client/PromotionPicker";
import { resolvePremove, pieceColorAt } from "@/lib/chess/premove";
import { drawReasonFromPgn } from "@/lib/chess/drawReason";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { plyOf } from "@/lib/chess/ply";
import { channels } from "@/lib/realtime";
import { useChannel } from "@/lib/client/useChannel";
import type { StoredPlayer } from "@/lib/client/identity";
import { Confetti, initials } from "@/lib/client/Confetti";
import { CapturedPieces } from "@/lib/client/CapturedPieces";
import { ChessClock } from "@/lib/client/ChessClock";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { sound } from "@/lib/client/sound";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import {
  ReactionBar,
  ReactionOverlay,
  type ReactionHandle,
} from "@/lib/client/Reactions";
import { ReplayBoard } from "@/lib/client/ReplayBoard";
import { MoveList, sansFromPgn } from "@/lib/client/MoveList";
import { ReviewView } from "./ReviewView";
import { no } from "@/lib/locale/no";

/** Hard ceiling on how long the optimistic-move `pending` lock may stay set.
 * Must exceed the API timeout (8 s) so the normal timeout/catch always wins
 * first; this only fires if something truly wedges the request. */
const PENDING_CEILING_MS = 11000;

/** Piece count from a FEN board field — a drop between positions = capture. */
function pieceCount(fen: string): number {
  return (fen.split(" ")[0].match(/[a-zA-Z]/g) ?? []).length;
}

/** Pick the sound cue for arriving at `fen` from `prevFen`. */
function moveCue(prevFen: string, fen: string): "move" | "capture" | "check" {
  try {
    if (new Chess(fen).inCheck()) return "check";
  } catch {
    // unparseable fen → fall through to the count check
  }
  return prevFen && pieceCount(fen) < pieceCount(prevFen) ? "capture" : "move";
}

/** Client copy of a server clock snapshot, stamped with local receipt time. */
interface ClockState {
  whiteMs: number;
  blackMs: number;
  turn: Turn;
  running: boolean;
  at: number;
}

function clockRemaining(c: ClockState, side: Turn): number {
  const base = side === "w" ? c.whiteMs : c.blackMs;
  return c.running && c.turn === side
    ? Math.max(0, base - (Date.now() - c.at))
    : base;
}

/** The two clock-flag banners (opponent flagged → claim win; I flagged → out of
 * time). Owns its OWN half-second ticker so detecting a flag re-renders only
 * this little component, never the parent GameView (and its board). */
function ClockFlagBanners({
  clock,
  status,
  myTurnLetter,
  acting,
  onClaim,
}: {
  clock: ClockState | null;
  status: GameStatus;
  myTurnLetter: Turn;
  acting: boolean;
  onClaim: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!clock?.running || status !== "live") return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [clock, status]);

  const oppTurnLetter: Turn = myTurnLetter === "w" ? "b" : "w";
  const myClockMs = clock ? clockRemaining(clock, myTurnLetter) : null;
  const oppClockMs = clock ? clockRemaining(clock, oppTurnLetter) : null;
  const oppFlagged = status === "live" && oppClockMs !== null && oppClockMs <= 0;
  const meFlagged = status === "live" && myClockMs !== null && myClockMs <= 0;

  return (
    <>
      {oppFlagged && (
        <div
          className="banner banner-turn"
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
          <span>{no.player.oppOutOfTime}</span>
          <button
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
            disabled={acting}
            onClick={onClaim}
          >
            ⏱ {no.player.claimWin}
          </button>
        </div>
      )}
      {meFlagged && (
        <div className="banner banner-error" style={{ width: "100%" }} role="status" aria-live="polite">
          ⏱ {no.player.myTimeOut}
        </div>
      )}
    </>
  );
}

/** A player's side panel (avatar, name, colour, captured pieces) — sits beside
 * the board on wide screens and stacks above/below it on narrow ones. */
function ColorChip({ color, label }: { color: "white" | "black"; label: string }) {
  return (
    <span className={`color-chip color-chip-${color}`}>
      <span className="color-chip-glyph">{color === "white" ? "♔" : "♚"}</span>
      {label}
    </span>
  );
}

function SidePanel({
  name,
  color,
  colorLabel,
  fen,
  capSide,
  isMe,
  active,
  baselineFen,
  clock,
}: {
  name: string;
  color: "white" | "black";
  colorLabel: string;
  fen: string;
  capSide: "white" | "black";
  isMe: boolean;
  active: boolean;
  baselineFen?: string;
  clock?: { ms: number; at: number; running: boolean } | null;
}) {
  return (
    <div className={`card player-card player-card-${color}`} style={{ padding: 15 }}>
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
        <div style={{ lineHeight: 1.3, minWidth: 0, flex: 1 }}>
          <b>{name}</b>
          <div style={{ marginTop: 3 }}>
            <ColorChip color={color} label={colorLabel} />
          </div>
        </div>
        {clock && <ChessClock ms={clock.ms} at={clock.at} running={clock.running} />}
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
        <CapturedPieces fen={fen} side={capSide} baselineFen={baselineFen} />
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
  reactionsEnabled = false,
  variantFen,
}: {
  me: StoredPlayer;
  gameId: string;
  onFinished: () => void;
  timer?: {
    startedAt: string | null;
    durationSec: number;
    extendedMs?: number;
  } | null;
  reactionsEnabled?: boolean;
  /** the tournament's variant start position (for captured-piece baselines) */
  variantFen?: string;
}) {
  const [detail, setDetail] = useState<GameDetail | null>(null);
  const [fen, setFen] = useState<string>("");
  const [turn, setTurn] = useState<Turn>("w");
  const [status, setStatus] = useState<GameStatus>("live");
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [legal, setLegal] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  // Single pre-move: a move queued while it's the opponent's turn, fired the
  // instant it becomes mine (blitz / online multiplayer). null = none.
  const [preMove, setPreMove] = useState<{ from: string; to: string } | null>(null);
  const [promo, setPromo] = useState<{ from: string; to: string } | null>(null);
  const [confirmResign, setConfirmResign] = useState(false);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [incomingDraw, setIncomingDraw] = useState(false);
  const [drawSent, setDrawSent] = useState(false);
  const [replayPgn, setReplayPgn] = useState<string | null>(null);
  const [showReview, setShowReview] = useState(false);
  // Authoritative final PGN, fetched once the game ends — needed to name a
  // threefold-repetition draw (the live `detail.pgn` predates the final move,
  // since the poll stops at game end).
  const [finalPgn, setFinalPgn] = useState<string | null>(null);
  // Live SAN move list. Rebuilt authoritatively from the PGN on load()/end, and
  // appended optimistically per move so it tracks play without waiting for a poll.
  const [sans, setSans] = useState<string[]>([]);
  const [clock, setClock] = useState<ClockState | null>(null);
  // Imperative handle to the reaction overlay — adding a float never re-renders
  // GameView (and therefore never re-renders the board).
  const reactionRef = useRef<ReactionHandle>(null);

  const takeClock = useCallback(
    (c: { whiteMs: number; blackMs: number; turn: Turn; running: boolean } | null | undefined) => {
      if (c) setClock({ ...c, at: Date.now() });
    },
    [],
  );

  // Append a SAN to the move list only when it advances exactly one ply — this
  // dedups against the authoritative rebuild (load) and ignores out-of-order /
  // missed updates; the next load() rebuild self-heals any gap.
  const appendSan = useCallback((san: string | undefined, fenAfter: string) => {
    if (!san) return;
    setSans((prev) => (plyOf(fenAfter) === prev.length + 1 ? [...prev, san] : prev));
  }, []);

  // Last server-confirmed FEN — the rollback target for a failed optimistic move.
  const confirmedFen = useRef<string>("");

  // game-start jingle (also nudges the AudioContext awake on mount)
  useEffect(() => {
    sound.play("start");
  }, []);

  const myColor: Color = detail?.black?.id === me.playerId ? "black" : "white";
  const myTurnLetter: Turn = myColor === "white" ? "w" : "b";
  const isMyTurn = status === "live" && turn === myTurnLetter;

  const load = useCallback(async () => {
    const d = await api.game(gameId);
    setDetail(d); // names/pgn are always safe to refresh
    // Ply-guard exactly like the broadcast handler: a slow in-flight GET that
    // resolves AFTER a fresher move (mine or the opponent's) must not roll the
    // board back to a stale ply. Only adopt the fetched position if it's at
    // least as fresh as the last confirmed one.
    const fresh = plyOf(d.fen) >= plyOf(confirmedFen.current || d.fen);
    if (fresh) {
      setFen(d.fen);
      setTurn(d.turn);
      setLastMove(d.lastMove ? { from: d.lastMove.from, to: d.lastMove.to } : null);
      confirmedFen.current = d.fen;
      takeClock(d.clock);
      setSans(sansFromPgn(d.pgn)); // authoritative move-list rebuild
    }
    // A terminal status must be honoured even when the ply didn't advance (a
    // resign / teacher-resolve emits no position move); a stale "live" must
    // never un-end a finished game.
    if (fresh || d.status !== "live") setStatus(d.status);
    // Reconcile draw banners from the authoritative offer state, so a lost
    // decline/offer broadcast can never leave a banner stuck (3s poll heals).
    if (d.drawOfferedBy !== undefined) {
      setIncomingDraw(d.drawOfferedBy != null && d.drawOfferedBy !== me.playerId);
      setDrawSent(d.drawOfferedBy === me.playerId);
    }
  }, [gameId, takeClock, me.playerId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
      .then(() => setLoadError(false))
      .catch((e) => {
        console.warn("[game] initial load failed", e);
        setLoadError(true);
      });
  }, [load]);

  // Reconnect hardening: re-sync the authoritative position when the tab
  // regains focus or the network returns (recovers any missed broadcast).
  useEffect(() => {
    const resync = () => {
      if (document.visibilityState === "visible") load().catch(() => {});
    };
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [load]);

  // Poll backstop: realtime broadcasts are best-effort, so re-sync on a timer
  // whenever the game is live — on EITHER turn, and even while `pending` is set
  // (both deliberately kept OUT of the guard). A game-end on MY turn (opponent
  // resign / teacher resolve emits only a "result" event, no position broadcast)
  // would otherwise leave me stuck thinking it's still my move if that event is
  // lost. load() only adopts authoritative server state and confirmedFen
  // ply-guards stale broadcasts, so it can't undo my own optimistic move.
  // Guarantees the board un-freezes within ~3 s no matter how state got stuck.
  useEffect(() => {
    if (status !== "live") return;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") load().catch(() => {});
    }, 3000);
    return () => clearInterval(id);
  }, [status, load]);

  // Pending watchdog: an absolute ceiling so the optimistic-move lock can NEVER
  // freeze the board permanently. If `pending` somehow outlives the API timeout
  // (e.g. a stalled response body), force-release it and re-sync. The cleanup
  // resets the timer on every toggle, so a normal fast move never trips it.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      setPending(false);
      load().catch(() => {});
    }, PENDING_CEILING_MS);
    return () => clearTimeout(t);
  }, [pending, load]);

  const flash = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2200);
  };

  // Run a one-shot meta action (offer/accept/decline draw, resign): guard against
  // double-fire, and on failure reconcile to authoritative state via load() so no
  // optimistic banner can get stuck (the server may already have resolved it).
  const runMeta = (action: Promise<unknown>, onOk?: () => void) => {
    if (acting) return;
    setActing(true);
    action
      .then(() => onOk?.())
      .catch(() => {
        flash(no.common.error);
        load().catch(() => {});
      })
      .finally(() => setActing(false));
  };

  // Result sound — fires once when the game flips from live to a result.
  useEffect(() => {
    if (status === "live") return;
    if (status === "bye" || status === "aborted") return;
    const won =
      (status === "white_win" && myColor === "white") ||
      (status === "black_win" && myColor === "black");
    sound.play(status === "draw" ? "draw" : won ? "win" : "lose");
  }, [status, myColor]);

  // On game end, fetch the authoritative final PGN once so a threefold draw is
  // named correctly (the live poll has stopped, so detail.pgn is now stale).
  useEffect(() => {
    if (status === "live" || status === "bye" || status === "aborted") return;
    let live = true;
    api
      .game(gameId)
      .then((d) => {
        if (!live) return;
        setFinalPgn(d.pgn);
        setSans(sansFromPgn(d.pgn)); // complete, authoritative move list at end
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [status, gameId]);

  // The chess-clock flag state ("krev seier på tid" / "tiden din er ute") is
  // computed inside <ClockFlagBanners>, which owns its own ticker — so ticking
  // it twice a second does NOT re-render the board/clocks here.
  const oppTurnLetter: Turn = myTurnLetter === "w" ? "b" : "w";

  // Authoritative updates from the game channel.
  const sendOnGame = useChannel(channels.game(gameId), (event, payload) => {
    if (event === "position") {
      const p = payload as {
        fen: string;
        turn: Turn;
        status: GameStatus;
        lastMove?: { from: string; to: string; san?: string } | null;
        clock?: { whiteMs: number; blackMs: number; turn: Turn; running: boolean } | null;
      };
      // Ignore a delayed / out-of-order broadcast that would roll the board back
      // to an older position (the ref tracks the freshest confirmed FEN).
      const fresh = plyOf(p.fen) >= plyOf(confirmedFen.current || fen);
      if (fresh) {
        // The opponent moved (self-broadcasts are off) — audible cue.
        if (p.fen !== fen) sound.play(moveCue(fen, p.fen));
        setFen(p.fen);
        setTurn(p.turn);
        takeClock(p.clock);
        confirmedFen.current = p.fen;
        if (p.lastMove) setLastMove({ from: p.lastMove.from, to: p.lastMove.to });
        appendSan(p.lastMove?.san, p.fen); // extend the move list (opponent's move)
        setSelected(null);
        setLegal([]);
        setIncomingDraw(false); // a move supersedes any pending draw offer
        setDrawSent(false);
      }
      // A terminal status can arrive with (or just behind) the final position —
      // honour it regardless of ply, but a stale "live" must never un-end a game.
      if (fresh || p.status !== "live") setStatus(p.status);
    } else if (event === "reaction") {
      const p = payload as { emoji?: string };
      if (typeof p.emoji === "string" && p.emoji.length <= 8)
        reactionRef.current?.add(p.emoji);
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
  }, (s) => {
    // Broadcasts silently stopped (channel error/timeout) → refetch truth now;
    // the ~3 s poll then keeps it fresh until the socket re-joins.
    if (s === "CHANNEL_ERROR" || s === "TIMED_OUT") load().catch(() => {});
  });

  // Attempt a move: optimistic render, then server reconcile / rollback.
  const tryMove = useCallback(
    async (from: string, to: string, promotion?: PromoPiece) => {
      if (!isMyTurn || pending) return false;

      // Promoting move with no piece chosen yet → open the chooser, defer.
      if (!promotion && needsPromotion(fen, from, to)) {
        setPromo({ from, to });
        return false;
      }
      const piece = promotion ?? "q";

      const local = applyMove(fen, { from, to, promotion: piece });
      if (!local.ok) return false;
      sound.play(moveCue(fen, local.fen));

      setFen(local.fen);
      setTurn(local.turn);
      setLastMove({ from, to });
      appendSan(local.san, local.fen); // extend the move list (my move)
      setSelected(null);
      setLegal([]);
      setPending(true);

      try {
        const res = await api.move({
          gameId,
          from,
          to,
          promotion: piece,
          playerId: me.playerId,
          resumeCode: me.resumeCode,
        });
        // Reconcile to the server's authoritative result.
        setFen(res.fen);
        setTurn(res.turn);
        setStatus(res.status);
        confirmedFen.current = res.fen;
        takeClock(res.clock);
      } catch (e) {
        // Roll back to the last CONFIRMED position (the ref tracks load(),
        // own-move success AND broadcasts) — never a stale local capture; a
        // broadcast that landed mid-flight must not be undone. Turn derives
        // from that FEN so isMyTurn can't lie.
        const confirmed = confirmedFen.current || fen;
        setFen(confirmed);
        setTurn(confirmed.split(" ")[1] === "b" ? "b" : "w");
        const code = e instanceof ApiError ? e.code : "";
        const httpStatus = e instanceof ApiError ? e.status : 0;
        if (code === "not_your_turn") flash(no.player.notYourTurn);
        else if (code === "flagged") {
          // My time ran out — the server resolved the game; sync the result.
        } else if (code === "timeout" || code === "network") {
          // Request hung/dropped.
          flash(no.player.connection);
        } else if (httpStatus === 400) {
          // The server genuinely rejected the move's legality (rare — the client
          // pre-validates with applyMove before POSTing). This is the ONLY path
          // that may say "illegal move".
          flash(no.player.illegalMove);
        } else if (httpStatus >= 500 || httpStatus === 0) {
          // 5xx / 503 / a Cloudflare 1102 (HTML) / unknown transport error — a
          // SERVER problem, NOT an illegal move. Don't accuse the student.
          flash(no.player.connection);
        } else {
          // 403/404/409 (stale / not_live / conflict / no_game): just resync.
          flash(no.common.error);
        }
        // Always re-sync to authoritative state so the board can't get stuck.
        load().catch(() => {});
      } finally {
        setPending(false);
      }
      return true;
    },
    [appendSan, fen, gameId, isMyTurn, load, me.playerId, me.resumeCode, pending, takeClock],
  );

  // Fire a queued pre-move the instant it becomes my turn: resolve it against
  // the (opponent-moved) position; play it if still legal, else discard with a
  // gentle note. Runs once per turn-flip (it clears the queue immediately).
  useEffect(() => {
    if (!isMyTurn || !preMove || pending) return;
    const resolved = resolvePremove(fen, preMove);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreMove(null);
    if (resolved) void tryMove(resolved.from, resolved.to);
    else flash(no.player.premoveCancelled);
  }, [isMyTurn, preMove, fen, pending, tryMove]);

  /** True if `square` holds one of my pieces (for pre-move selection while it
   * isn't my turn — chess.js can't generate moves for the side not to move). */
  const myPieceAt = (square: string) => pieceColorAt(fen, square) === myTurnLetter;

  function onDrop({ sourceSquare, targetSquare }: PieceDropHandlerArgs): boolean {
    if (!targetSquare) return false;
    if (isMyTurn) {
      void tryMove(sourceSquare, targetSquare);
      return true;
    }
    // Not my turn yet → queue a pre-move (only my own pieces). Reject the visual
    // move (false) and show it as a highlight instead; it fires on my turn.
    if (status === "live" && myPieceAt(sourceSquare)) {
      setPreMove({ from: sourceSquare, to: targetSquare });
    }
    return false;
  }

  function onSquareClick({ square, piece }: SquareHandlerArgs) {
    if (isMyTurn) {
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
      return;
    }
    // Not my turn → pre-move selection (no legal-dot hints; legality is checked
    // when the move actually fires).
    if (status !== "live") return;
    if (selected) {
      if (square !== selected) setPreMove({ from: selected, to: square });
      setSelected(null);
      setLegal([]);
    } else if (myPieceAt(square)) {
      setSelected(square);
      setLegal([]);
    } else {
      setPreMove(null); // tap empty/opponent square to cancel a queued pre-move
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
  // Queued pre-move — distinct orange so it reads differently from a real move.
  if (preMove && status === "live") {
    const pm = { background: "rgba(235,140,60,0.55)" };
    squareStyles[preMove.from] = { ...pm };
    squareStyles[preMove.to] = { ...pm };
  }

  if (!detail) {
    if (loadError) {
      return (
        <main className="center-screen">
          <div className="card card-narrow stack text-center">
            <h2>{no.common.error}</h2>
            <p className="muted">{no.player.gameLoadFailed}</p>
            <div className="row">
              <button
                className="btn btn-primary grow"
                onClick={() =>
                  load()
                    .then(() => setLoadError(false))
                    .catch(() => setLoadError(true))
                }
              >
                {no.common.retry}
              </button>
              <button className="btn grow" onClick={onFinished}>
                {no.common.back}
              </button>
            </div>
          </div>
        </main>
      );
    }
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
    if (status === "draw")
      resultText = no.player.drawReason[drawReasonFromPgn(finalPgn ?? detail.pgn, fen)];
    else resultText = iWon ? no.player.youWon : no.player.youLost;
  }

  const oppColor: "white" | "black" = myColor === "white" ? "black" : "white";

  return (
    <main className="center-screen is-game">
      {iWon && <Confetti count={120} />}
      <div className="game-grid">
        {/* opponent — left on wide, top on narrow */}
        <div className="game-side panel-opp">
          <SidePanel
            name={opponent?.name ?? "?"}
            color={oppColor}
            colorLabel={oppColor === "white" ? no.player.white : no.player.black}
            fen={fen}
            capSide={oppColor}
            isMe={false}
            active={!ended && !isMyTurn}
            baselineFen={variantFen}
            clock={
              clock
                ? {
                    ms: oppTurnLetter === "w" ? clock.whiteMs : clock.blackMs,
                    at: clock.at,
                    running: clock.running && clock.turn === oppTurnLetter && !ended,
                  }
                : null
            }
          />
        </div>

        {/* centre: timer + turn banner + board + actions */}
        <div className="game-center">
          {timer && timer.startedAt && !ended && (
            <RoundTimer
              startedAt={timer.startedAt}
              durationSec={timer.durationSec}
              extendedMs={timer.extendedMs ?? 0}
              compact
            />
          )}

          {!ended && (
            // One fixed banner slot (never a second element that pushes the
            // board down): shows your turn, the opponent's turn, or — when you've
            // queued a pre-move on the opponent's turn — the pre-move indicator.
            <div
              className={`banner ${isMyTurn ? "banner-turn" : "banner-wait"}`}
              style={{
                width: "100%",
                ...(!isMyTurn && preMove ? { borderColor: "rgba(235,140,60,0.6)" } : {}),
              }}
              role="status"
              aria-live="polite"
            >
              {isMyTurn
                ? `♟ ${no.player.yourTurn}`
                : preMove
                  ? `⏩ ${no.player.premoveSet}`
                  : no.player.opponentTurn}
            </div>
          )}

          <div className="board-frame">
            <div
              className="board-shell"
              role="group"
              aria-label={isMyTurn ? `${no.player.yourTurn} – ${no.player.boardLabel}` : no.player.boardLabel}
            >
              <Chessboard
                options={{
                  position: fen || undefined,
                  boardOrientation: myColor,
                  // Draggable on my turn AND the opponent's (to queue a pre-move).
                  allowDragging: !ended,
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
            <ReactionOverlay ref={reactionRef} />
          </div>

          {reactionsEnabled && !ended && (
            <ReactionBar
              onSend={(emoji) => {
                reactionRef.current?.add(emoji); // self-broadcast off → show mine locally
                sendOnGame("reaction", { emoji, by: me.playerId });
              }}
            />
          )}

          {!ended && (
            <div className="row">
              <button
                className="btn btn-ghost"
                disabled={pending || drawSent || acting}
                onClick={() =>
                  runMeta(
                    api.draw(gameId, me.playerId, me.resumeCode, "offer"),
                    () => setDrawSent(true),
                  )
                }
              >
                ½ {no.player.offerDraw}
              </button>
              <button
                className="btn btn-danger"
                disabled={pending || acting}
                onClick={() => setConfirmResign(true)}
              >
                {no.player.resign}
              </button>
            </div>
          )}

          <ClockFlagBanners
            clock={clock}
            status={status}
            myTurnLetter={myTurnLetter}
            acting={acting}
            onClaim={() => runMeta(api.claimTime(gameId, me.playerId, me.resumeCode))}
          />

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
                  disabled={acting}
                  onClick={() =>
                    runMeta(
                      api.draw(gameId, me.playerId, me.resumeCode, "accept"),
                      () => setIncomingDraw(false),
                    )
                  }
                >
                  {no.player.accept}
                </button>
                <button
                  className="btn grow"
                  disabled={acting}
                  onClick={() =>
                    runMeta(
                      api.draw(gameId, me.playerId, me.resumeCode, "decline"),
                      () => setIncomingDraw(false),
                    )
                  }
                >
                  {no.player.decline}
                </button>
              </div>
            </div>
          )}

          {toast && <div className="banner banner-error" style={{ width: "100%" }}>{toast}</div>}

          {sans.length > 0 && <MoveList sans={sans} />}
        </div>

        {/* me — right on wide, bottom on narrow */}
        <div className="game-side panel-me">
          <SidePanel
            name={me.displayName}
            color={myColor}
            colorLabel={`${no.player.youAre} ${myColor === "white" ? no.player.white : no.player.black}`}
            fen={fen}
            capSide={myColor}
            isMe
            active={!ended && isMyTurn}
            baselineFen={variantFen}
            clock={
              clock
                ? {
                    ms: myTurnLetter === "w" ? clock.whiteMs : clock.blackMs,
                    at: clock.at,
                    running: clock.running && clock.turn === myTurnLetter && !ended,
                  }
                : null
            }
          />
        </div>
      </div>

      {ended && (
        <div className="result-overlay">
          {replayPgn !== null ? (
            <div className="result-card" style={{ maxWidth: 680, width: "100%" }}>
              <ReplayBoard
                pgn={replayPgn}
                orientation={myColor}
                whiteName={detail.white.name}
                blackName={detail.black?.name ?? "?"}
                onClose={() => setReplayPgn(null)}
              />
            </div>
          ) : showReview ? (
            <ReviewView me={me} gameId={gameId} onClose={() => setShowReview(false)} />
          ) : (
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
              <button
                className="btn btn-ghost"
                onClick={() =>
                  // refetch: `detail.pgn` predates the final moves
                  api
                    .game(gameId)
                    .then((d) => setReplayPgn(d.pgn))
                    .catch(() => setReplayPgn(detail.pgn))
                }
              >
                ♟ {no.replay.cta}
              </button>
              <button className="btn btn-ghost" onClick={() => setShowReview(true)}>
                {no.review.cta}
              </button>
            </div>
          )}
        </div>
      )}

      {promo && (
        <PromotionPicker
          color={myColor}
          onPick={(piece) => {
            const { from, to } = promo;
            setPromo(null);
            void tryMove(from, to, piece);
          }}
          onCancel={() => setPromo(null)}
        />
      )}

      {confirmResign && (
        <ConfirmDialog
          message={no.player.resignConfirm}
          confirmLabel={no.player.resign}
          danger
          onConfirm={() => {
            setConfirmResign(false);
            runMeta(api.resign(gameId, me.playerId, me.resumeCode));
          }}
          onCancel={() => setConfirmResign(false)}
        />
      )}

      <SoundToggle />
      <FullscreenToggle />
    </main>
  );
}
