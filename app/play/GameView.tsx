"use client";

import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import type { PieceDropHandlerArgs, SquareHandlerArgs } from "react-chessboard";
import type { GameDetail } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";
import { api, ApiError, NON_JSON } from "@/lib/client/api";
import { apiKind, errDetail, report } from "@/lib/client/telemetry";
import { applyMove, legalDestinations } from "@/lib/chess/validateMove";
import { needsPromotion, type PromoPiece } from "@/lib/chess/promotion";
import { PromotionPicker } from "@/lib/client/PromotionPicker";
import { resolvePremove, pieceColorAt } from "@/lib/chess/premove";
import { drawReasonFromPgn } from "@/lib/chess/drawReason";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { plyOf } from "@/lib/chess/ply";
import { channels } from "@/lib/realtime";
import {
  createReactionGate,
  isValidDrawEvent,
  isValidPositionPayload,
  isValidResultPayload,
  nextStamp,
  resolveAuthoritative,
  type ClockWire,
  type Provisional,
} from "@/lib/realtimeTrust";
import { useChannel } from "@/lib/client/useChannel";
import { useActiveTab } from "@/lib/client/useActiveTab";
import { useTabHidden } from "@/lib/client/useTabHidden";
import type { StoredPlayer } from "@/lib/client/identity";
import { Confetti, initials } from "@/lib/client/Confetti";
import { CapturedPieces } from "@/lib/client/CapturedPieces";
import { ChessClock } from "@/lib/client/ChessClock";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { sound } from "@/lib/client/sound";
import { SoundToggle } from "@/lib/client/SoundToggle";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { NotifyToggle } from "@/lib/client/NotifyToggle";
import { useTurnCue } from "@/lib/client/turnCue";
import {
  REACTION_EMOJIS,
  ReactionBar,
  ReactionOverlay,
  type ReactionHandle,
} from "@/lib/client/Reactions";
import { ReplayBoard } from "@/lib/client/ReplayBoard";
import { PlayBoard } from "@/lib/client/PlayBoard";
import { moveCue } from "@/lib/chess/moveCue";
import { sameDetail } from "@/lib/client/equal";
import { MoveList, sansFromPgn } from "@/lib/client/MoveList";
import { ReviewView } from "./ReviewView";
import { no } from "@/lib/locale/no";

/** Hard ceiling on how long the optimistic-move `pending` lock may stay set.
 * Must exceed the API timeout (8 s) so the normal timeout/catch always wins
 * first; this only fires if something truly wedges the request. */
const PENDING_CEILING_MS = 11000;

/** How long a burst of broadcasts is coalesced into ONE authoritative refetch.
 * Every broadcast on the game channel is now followed by a `safeLoad()` (see
 * the trust model at the handler): that is what turns a payload from a claim
 * into a hint, and it also caps what a flood of forged events can cost us —
 * whatever arrives inside this window is a single GET, not one per event. */
const BROADCAST_REFETCH_MS = 250;

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

/** How far the server's remaining time may sit from what we already predict
 * locally before we adopt the new snapshot. A no-op poll (same side still
 * thinking, nothing else happened) lands within network latency + clock skew of
 * the local tick; anything a real event caused — a move, a flag, the game
 * ending — flips `turn`/`running` or jumps far past this. */
const CLOCK_DRIFT_TOLERANCE_MS = 250;

/** L5: is this snapshot telling us anything we don't already show?
 *
 * The server ticks the side to move down live (see lib/chess/clock.ts), so the
 * running side's `whiteMs`/`blackMs` is DIFFERENT on every 3 s poll even when
 * nothing happened — which is why the old unconditional `setClock` allocated a
 * new object (and a new `at`) every poll, busting both `ChessClock` memos and
 * re-rendering GameView. Comparing against `clockRemaining` instead of the raw
 * stored value handles both sides in one rule: for the IDLE side it is the
 * stored number, so this is plain equality; for the RUNNING side it is our own
 * local prediction, so a poll that merely confirms the tick is a no-op. */
function clockUnchanged(prev: ClockState, c: ClockWire): boolean {
  if (prev.turn !== c.turn || prev.running !== c.running) return false;
  return (
    Math.abs(c.whiteMs - clockRemaining(prev, "w")) < CLOCK_DRIFT_TOLERANCE_MS &&
    Math.abs(c.blackMs - clockRemaining(prev, "b")) < CLOCK_DRIFT_TOLERANCE_MS
  );
}

/** The clock-flag banners (opponent flagged → claim win; I flagged → out of
 * time) and the "draw offer sent" banner share ONE fixed-height `.notice-slot`
 * below the action row, showing at most one message at a time by priority —
 * I flagged > opponent flagged > my draw offer is pending — so the slot never
 * changes height as a flag lands, an offer goes out, or it's declined (L3).
 * Always mounted; visibility:hidden (never unmounted) once the game ends, same
 * as .turn-slot. Owns its OWN half-second ticker so detecting a flag re-renders
 * only this little component, never the parent GameView (and its board). */
function NoticeSlot({
  clock,
  status,
  myTurnLetter,
  drawSent,
  incomingDraw,
  drawDialogOpen,
  acting,
  onClaim,
  onReopenDraw,
}: {
  clock: ClockState | null;
  status: GameStatus;
  myTurnLetter: Turn;
  drawSent: boolean;
  /** An opponent's draw offer is pending on me. */
  incomingDraw: boolean;
  /** Whether the offer's ConfirmDialog is currently shown — false right
   * after the student dismisses it (Escape/backdrop) without answering,
   * while the offer itself is still pending (`incomingDraw` stays true). */
  drawDialogOpen: boolean;
  acting: boolean;
  onClaim: () => void;
  /** Reopens the dismissed draw-offer dialog. */
  onReopenDraw: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!clock?.running || status !== "live") return;
    const t = setInterval(() => tick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, [clock, status]);

  const ended = status !== "live";
  const oppTurnLetter: Turn = myTurnLetter === "w" ? "b" : "w";
  const myClockMs = clock ? clockRemaining(clock, myTurnLetter) : null;
  const oppClockMs = clock ? clockRemaining(clock, oppTurnLetter) : null;
  const oppFlagged = status === "live" && oppClockMs !== null && oppClockMs <= 0;
  const meFlagged = status === "live" && myClockMs !== null && myClockMs <= 0;

  return (
    <div className="notice-slot" style={ended ? { visibility: "hidden" } : undefined}>
      {meFlagged ? (
        <div className="banner banner-error" style={{ width: "100%" }} role="status" aria-live="polite">
          <span className="banner-line">⏱ {no.player.myTimeOut}</span>
        </div>
      ) : oppFlagged ? (
        <div
          className="banner banner-turn"
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
          <span className="banner-line">{no.player.oppOutOfTime}</span>
          <button
            className="btn btn-primary"
            style={{ flexShrink: 0 }}
            disabled={acting}
            onClick={onClaim}
          >
            ⏱ {no.player.claimWin}
          </button>
        </div>
      ) : drawSent ? (
        <div className="banner banner-wait" style={{ width: "100%" }} role="status" aria-live="polite">
          <span className="banner-line">½ {no.player.drawSent}</span>
        </div>
      ) : incomingDraw && !drawDialogOpen ? (
        // The offer's dialog was dismissed (Esc/backdrop) without an answer —
        // it is still pending (L3/notice-slot rule: never lose track of it),
        // so this is the way back to it.
        <div
          className="banner banner-wait"
          style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}
        >
          <span className="banner-line">½ {no.player.drawOfferedByOpponent}</span>
          <button className="btn btn-ghost" style={{ flexShrink: 0 }} onClick={onReopenDraw}>
            {no.player.answerDrawOffer}
          </button>
        </div>
      ) : null}
    </div>
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
        {/* Always mounted, reserved 9x9 — toggling `active` only changes
            visibility/animation, never removes the element, so its own
            width/gap can't come and go and nudge the row (L2). */}
        <span
          style={{
            width: 9,
            height: 9,
            flexShrink: 0,
            borderRadius: "50%",
            background: "var(--turn)",
            visibility: active ? "visible" : "hidden",
            boxShadow: "0 0 0 0 color-mix(in srgb, var(--turn) 70%, transparent)",
            animation: active ? "ping 1.6s var(--ease-out) infinite" : "none",
          }}
        />
      </div>
      <div style={{ marginTop: 8 }}>
        <CapturedPieces fen={fen} side={capSide} baselineFen={baselineFen} />
      </div>
    </div>
  );
}

type Color = "white" | "black";

/** L5: `memo`'d. WaitingRoom is this component's always-mounted parent and
 * re-renders on board polls, presence events and its own state — none of which
 * the board cares about. Every prop below is a primitive or a stable reference
 * (see the derivation block in WaitingRoom), so the default shallow comparison
 * is enough; `<PlayBoard>` inside is a SECOND memo boundary that additionally
 * absorbs GameView's own re-renders (clock ticks, toasts, sync badges). */
export const GameView = memo(function GameView({
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
  // Consecutive failed background syncs (poll / resync / channel-drop / rollback
  // resync) — NOT the mount load above, which has its own loadError gate. Drives
  // the fixed "reconnecting" badge (R7) so a run of quiet `load()` failures is
  // visible instead of the board just appearing to freeze.
  const [syncFailures, setSyncFailures] = useState(0);
  const [incomingDraw, setIncomingDraw] = useState(false);
  // Whether the incoming-draw ConfirmDialog is CURRENTLY SHOWN — distinct from
  // `incomingDraw` (the offer being pending) so that dismissing the dialog
  // (Escape/backdrop click) can hide it WITHOUT declining: the offer stays
  // pending, and the notice slot's "Svar på remistilbudet" button reopens it.
  const [drawDialogOpen, setDrawDialogOpen] = useState(false);
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

  const takeClock = useCallback((c: ClockWire | null | undefined) => {
    if (!c) return;
    // Keep the previous snapshot (and its `at` baseline) when this one says
    // nothing new — see clockUnchanged above. Functional form so the callback
    // stays dependency-free: `load` and `tryMove` both list it.
    setClock((prev) =>
      prev && clockUnchanged(prev, c) ? prev : { ...c, at: Date.now() },
    );
  }, []);

  // Append a SAN to the move list only when it advances exactly one ply — this
  // dedups against the authoritative rebuild (load) and ignores out-of-order /
  // missed updates; the next load() rebuild self-heals any gap.
  const appendSan = useCallback((san: string | undefined, fenAfter: string) => {
    if (!san) return;
    setSans((prev) => (plyOf(fenAfter) === prev.length + 1 ? [...prev, san] : prev));
  }, []);

  // Freshest FEN we treat as settled — the rollback target for a failed
  // optimistic move, and the left-hand side of the ply guard. Fed by load(),
  // by our own move's reply, AND by broadcasts (a mid-flight opponent move must
  // not be undone by a rollback) — so it can hold an UNTRUSTED value, which is
  // precisely what `provisional` below records and bounds.
  const confirmedFen = useRef<string>("");
  // Non-null while the position on screen rests on a broadcast nobody
  // authenticated. Set by the position handler, cleared the moment an
  // authoritative response that was issued after it lands — see
  // resolveAuthoritative in lib/realtimeTrust.ts.
  const provisional = useRef<Provisional | null>(null);
  // Last PGN we parsed into the move list — lets the poll skip a full chess.js
  // re-parse when the position is unchanged (the common no-op poll).
  const lastPgn = useRef<string>("");
  // Mirror of `syncFailures` for the telemetry hook in safeLoad — see there.
  const syncFails = useRef(0);

  // game-start jingle (also nudges the AudioContext awake on mount)
  useEffect(() => {
    sound.play("start");
  }, []);

  const myColor: Color = detail?.black?.id === me.playerId ? "black" : "white";
  const myTurnLetter: Turn = myColor === "white" ? "w" : "b";
  const isMyTurn = status === "live" && turn === myTurnLetter;

  // Background "your turn" cue (title flash, vibration, opt-in notification)
  // — see lib/client/turnCue.ts. A flat no-op while the tab is visible, so
  // this can never touch the turn-banner text/layout or interfere with the
  // e2e specs (which run with the tab visible).
  useTurnCue({ isMyTurn, live: status === "live" });

  // Only one tab per player may be the active board (others POSTing moves with
  // the same identity collide → "can't move"). Passive tabs show a "play here".
  const { active: tabActive, claim: claimTab } = useActiveTab(
    `${me.tournamentId}:${me.playerId}`,
  );

  // T5: this tab just became the PASSIVE one. From the student's seat that looks
  // exactly like "the board stopped working" (it stops polling by design, R5),
  // so it is one of the likeliest things behind a "det hang seg" report — and
  // the only way to tell it apart afterwards is to record it. `tabActive`
  // starts true, so this fires on the flip, never on mount.
  useEffect(() => {
    if (!tabActive) report("tab_passive", { gameId });
  }, [tabActive, gameId]);

  const load = useCallback(async () => {
    // Stamped at ISSUE, not at arrival: the server broadcasts only after it has
    // committed a move, so a request sent after a broadcast landed reads state
    // at or past whatever that broadcast claimed — which is what lets the answer
    // overrule a provisional position no matter how high a ply it claimed.
    const issuedStamp = nextStamp();
    const wasProvisional = provisional.current !== null;
    const d = await api.game(gameId);
    // Names/pgn are always safe to refresh — but L5: only as a NEW object when
    // a field the UI reads actually changed. This runs every 3 s, and between
    // two moves every field is identical; adopting the fetched object anyway
    // re-rendered GameView (and its 64 squares) for nothing. The ply-guarded
    // position writes below are untouched and remain authoritative.
    setDetail((prev) => (sameDetail(prev, d) ? prev : d));
    // Ply-guard, but ONLY against another authoritative source: a slow in-flight
    // GET that resolves after a fresher move (mine, or one the opponent's own
    // reply confirmed) must not roll the board back to a stale ply. Against a
    // PROVISIONAL position — one only a broadcast vouched for — this response
    // wins outright, so a forged high ply cannot freeze the board.
    const fresh = resolveAuthoritative(
      { ply: plyOf(confirmedFen.current || d.fen) },
      { ply: plyOf(d.fen), issuedStamp },
      provisional.current,
    );
    if (fresh) {
      provisional.current = null; // truth has landed
      setFen(d.fen);
      setTurn(d.turn);
      setLastMove(d.lastMove ? { from: d.lastMove.from, to: d.lastMove.to } : null);
      confirmedFen.current = d.fen;
      takeClock(d.clock);
      // Authoritative move-list rebuild — but only when the PGN actually changed
      // (skip the full chess.js parse on a no-op poll). `wasProvisional` forces
      // it anyway: a broadcast may have appended a SAN the server never played,
      // and the pgn-unchanged shortcut would otherwise leave that phantom move
      // in the list forever.
      if (d.pgn !== lastPgn.current || wasProvisional) {
        lastPgn.current = d.pgn;
        setSans(sansFromPgn(d.pgn));
      }
    }
    // Status comes from HERE and nowhere else (see the trust model at the
    // broadcast handler). A terminal status must be honoured even when the ply
    // didn't advance (a resign / teacher-resolve emits no position move); a
    // stale "live" must never un-end a finished game.
    if (fresh || d.status !== "live") setStatus(d.status);
    // Reconcile draw banners from the authoritative offer state, so a lost
    // decline/offer broadcast can never leave a banner stuck (3s poll heals).
    if (d.drawOfferedBy !== undefined) {
      setIncomingDraw(d.drawOfferedBy != null && d.drawOfferedBy !== me.playerId);
      setDrawSent(d.drawOfferedBy === me.playerId);
    }
  }, [gameId, takeClock, me.playerId]);

  // Fire-and-forget wrapper for every background resync site below: never
  // throws (so callers can call it bare in a setInterval/listener), and counts
  // consecutive failures so the UI can show a "reconnecting" badge instead of
  // silently going stale. A success — including one that follows a string of
  // failures, e.g. after a channel drop — resets the counter immediately.
  const safeLoad = useCallback(() => {
    return load()
      .then(() => {
        syncFails.current = 0;
        setSyncFailures(0);
      })
      .catch((e) => {
        setSyncFailures((n) => n + 1);
        // T5: report the THIRD consecutive failure — the point at which the
        // student sees a stuck board rather than a blink. Counted in a ref, not
        // read from state, so the updater stays pure and `safeLoad`'s identity
        // (and therefore the poll interval) doesn't churn on every failure.
        syncFails.current += 1;
        if (syncFails.current === 3) {
          report(apiKind(e), { ...errDetail(e), gameId });
        }
      });
  }, [load, gameId]);

  // Ask for the truth behind a broadcast. Coalescing (not a trailing debounce):
  // the FIRST event in a quiet period schedules the fetch and everything inside
  // the window rides along, so a burst of moves — or a flood of forged events —
  // costs exactly one GET per 250 ms and can never starve the fetch entirely.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestAuthoritative = useCallback(() => {
    if (refetchTimer.current !== null) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      safeLoad();
    }, BROADCAST_REFETCH_MS);
  }, [safeLoad]);
  useEffect(
    () => () => {
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
    },
    [],
  );

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
      if (document.visibilityState === "visible") safeLoad();
    };
    window.addEventListener("focus", resync);
    window.addEventListener("online", resync);
    document.addEventListener("visibilitychange", resync);
    return () => {
      window.removeEventListener("focus", resync);
      window.removeEventListener("online", resync);
      document.removeEventListener("visibilitychange", resync);
    };
  }, [safeLoad]);

  // Poll backstop: realtime broadcasts are best-effort, so re-sync on a timer
  // whenever the game is live — on EITHER turn, and even while `pending` is set
  // (both deliberately kept OUT of the guard). A game-end on MY turn (opponent
  // resign / teacher resolve emits only a "result" event, no position broadcast)
  // would otherwise leave me stuck thinking it's still my move if that event is
  // lost. load() only adopts authoritative server state and confirmedFen
  // ply-guards stale broadcasts, so it can't undo my own optimistic move.
  // Guarantees the board un-freezes within ~3 s no matter how state got stuck.
  // Slower (20 s) while hidden rather than skipped outright (R11): a
  // backgrounded tab whose channel silently died must still come back current
  // within a bounded time, not only at the next visibilitychange→visible
  // refresh — still gated on tabActive, per R5, since a passive tab must never
  // poll at all (it isn't the live board for this player).
  const hidden = useTabHidden();
  useEffect(() => {
    if (status !== "live" || !tabActive) return; // passive tab: don't poll
    const id = setInterval(safeLoad, hidden ? 20000 : 3000);
    return () => clearInterval(id);
  }, [status, safeLoad, tabActive, hidden]);

  // Pending watchdog: an absolute ceiling so the optimistic-move lock can NEVER
  // freeze the board permanently. If `pending` somehow outlives the API timeout
  // (e.g. a stalled response body), force-release it and re-sync. The cleanup
  // resets the timer on every toggle, so a normal fast move never trips it.
  useEffect(() => {
    if (!pending) return;
    const t = setTimeout(() => {
      report("watchdog", { gameId, ms: PENDING_CEILING_MS });
      setPending(false);
      safeLoad();
    }, PENDING_CEILING_MS);
    return () => clearTimeout(t);
  }, [pending, safeLoad, gameId]);

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
        safeLoad();
      })
      .finally(() => setActing(false));
  };

  // Mirror the draw-offer dialog's visibility onto `incomingDraw`: a NEW
  // offer (this flips false→true, from load() or the `draw_offer` broadcast)
  // reopens it, and the offer resolving one way or another (this flips
  // true→false) closes it. A manual dismiss in between (Escape/backdrop) sets
  // `drawDialogOpen` false directly, without touching `incomingDraw` — so it
  // is NOT undone here, since this effect only reacts to `incomingDraw`
  // actually changing.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDrawDialogOpen(incomingDraw);
  }, [incomingDraw]);

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

  // Result overlay (.result-overlay below) accessibility: the id its heading
  // gets (referenced by the overlay's aria-labelledby, only while the main
  // result-card branch — not replay/review — is actually showing), and
  // moving focus to the primary "Neste" action the moment the game ends,
  // returning it to whatever had it once the overlay is gone (component
  // unmount on "Neste", typically). `ended` itself isn't computed until below
  // the early returns further down, so this is keyed on `status` directly.
  const resultHeadingId = useId();
  const resultNextBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (status === "live") return;
    const prevActive = document.activeElement;
    resultNextBtnRef.current?.focus();
    return () => {
      if (prevActive instanceof HTMLElement) prevActive.focus();
    };
  }, [status]);

  // The chess-clock flag state ("krev seier på tid" / "tiden din er ute") is
  // computed inside <NoticeSlot>, which owns its own ticker — so ticking
  // it twice a second does NOT re-render the board/clocks here.
  const oppTurnLetter: Turn = myTurnLetter === "w" ? "b" : "w";

  // The only two ids allowed to say anything on this channel. Empty until the
  // first load() answers, which is the safe direction: an unattributable event
  // is dropped rather than trusted.
  const whiteId = detail?.white.id;
  const blackId = detail?.black?.id;
  const knownPlayers = useMemo(
    () => new Set([whiteId, blackId].filter((id): id is string => !!id)),
    [whiteId, blackId],
  );
  // Emoji reactions are client→client — no server ever sees one, so there is no
  // authoritative version to fall back on and the gate IS the defence
  // (allowlist + known sender + 5/s). Created once so its rate-limit window
  // survives every re-render.
  const reactionGate = useMemo(() => createReactionGate(REACTION_EMOJIS), []);

  // --- TRUST MODEL FOR EVERYTHING BELOW (full reasoning: lib/realtimeTrust.ts)
  //
  // This channel is NOT authenticated. Every classmate's browser holds the same
  // public anon key, and `chess:game:<id>` is derivable from the unauthenticated
  // tournament payload, so a payload arriving here may have been typed into a
  // console two desks away. It is a HINT, never truth:
  //
  //   • Shape-checked first; anything that isn't what the server emits is
  //     dropped whole.
  //   • `status` is NEVER read off a payload. A forged `result` used to end a
  //     classmate's game for good — the poll stops the instant status leaves
  //     "live", so nothing healed it. Now a `result` only asks for a refetch.
  //   • A `position` is still applied immediately, because that snappiness is
  //     the point of realtime — but it marks the board PROVISIONAL, and the
  //     refetch it schedules overrules it whatever ply it claimed. Before this,
  //     a forged position with a huge ply was accepted by the monotonic guard
  //     and then BLOCKED every authoritative load from ever landing again.
  const sendOnGame = useChannel(channels.game(gameId), (event, payload) => {
    if (event === "position") {
      if (!isValidPositionPayload(payload)) return;
      const p = payload;
      // Our own move comes back to us as a SERVER broadcast (`self: false` only
      // mutes what this client sends). Nothing new to show, nothing to verify.
      if (p.fen === confirmedFen.current) return;
      // Ignore a delayed / out-of-order broadcast that would roll the board back
      // to an older position (the ref tracks the freshest confirmed FEN).
      const fresh = plyOf(p.fen) >= plyOf(confirmedFen.current || fen);
      if (fresh) {
        // The opponent moved (self-broadcasts are off) — audible cue. The SAN
        // rides along on the broadcast, so the cue costs no FEN parse (L5); it
        // falls back to parsing when a payload carries no lastMove.san.
        if (p.fen !== fen) sound.play(moveCue(fen, p.fen, p.lastMove?.san));
        setFen(p.fen);
        setTurn(p.turn);
        takeClock(p.clock);
        confirmedFen.current = p.fen;
        // Everything just written rests on an unauthenticated payload until the
        // fetch below comes back and says otherwise.
        provisional.current = { stamp: nextStamp() };
        if (p.lastMove) setLastMove({ from: p.lastMove.from, to: p.lastMove.to });
        appendSan(p.lastMove?.san, p.fen); // extend the move list (opponent's move)
        setSelected(null);
        setLegal([]);
        setIncomingDraw(false); // a move supersedes any pending draw offer
        setDrawSent(false);
      }
      // Deliberately NOT `setStatus(p.status)`. A real game-end arrives here one
      // round-trip later instead, via load().
      requestAuthoritative();
    } else if (event === "reaction") {
      const emoji = reactionGate(payload, knownPlayers);
      if (emoji) reactionRef.current?.add(emoji);
    } else if (event === "result") {
      // Shape-checked so a malformed event doesn't even cost a fetch — but the
      // status inside is never used. Only `load()` may end this game.
      if (isValidResultPayload(payload)) requestAuthoritative();
    } else if (event === "draw_offer") {
      if (!isValidDrawEvent(payload, knownPlayers)) return;
      if (payload.by !== me.playerId) setIncomingDraw(true);
    } else if (event === "draw_declined") {
      if (!isValidDrawEvent(payload, knownPlayers)) return;
      setIncomingDraw(false);
      if (payload.by !== me.playerId) {
        // The opponent declined my offer.
        setDrawSent(false);
        flash(no.player.drawDeclined);
      }
    }
  }, (s) => {
    // Broadcasts silently stopped (channel error/timeout/CLOSED) → refetch
    // truth now; the poll then keeps it fresh until the socket re-joins.
    // channelRegistry recreates the channel itself in the background (R11),
    // but that takes a moment — this immediate fetch catches whatever the
    // drop swallowed instead of waiting for it.
    if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") {
      report("channel_error", { status: s, gameId });
      safeLoad();
    }
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
      sound.play(moveCue(fen, local.fen, local.san));

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
        // Reconcile to the server's authoritative result — my own move's reply
        // is a first-party answer, so it also settles anything a broadcast had
        // talked us into meanwhile.
        provisional.current = null;
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
        // T5: the move was rolled back. The pair (code, status) is exactly what
        // the teacher's readout needs to tell "the server said no" apart from
        // "the network ate it".
        report("move_rollback", { code, status: httpStatus, gameId });
        if (code === "not_your_turn") flash(no.player.notYourTurn);
        else if (code === "flagged") {
          // My time ran out — the server resolved the game; sync the result.
        } else if (code === "timeout" || code === "network" || code === NON_JSON) {
          // Request hung/dropped — or the reply was never our API's (an HTML
          // edge page / WAF challenge / proxy). A 400 from one of those is not
          // a ruling on the move, so it must not reach the "illegal move"
          // branch below and accuse the student.
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
        safeLoad();
      } finally {
        setPending(false);
      }
      return true;
    },
    [appendSan, fen, gameId, isMyTurn, safeLoad, me.playerId, me.resumeCode, pending, takeClock],
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
  //
  // L5: the SEVEN primitives below are the complete input to these styles.
  // `stylesKey` is their digest and is what <PlayBoard> compares — so the
  // board re-renders exactly when a highlight changes and never merely because
  // a poll handed GameView a new object. Deriving both from the same tuple in
  // the same render is what makes them impossible to drift apart.
  const lastFrom = lastMove?.from ?? null;
  const lastTo = lastMove?.to ?? null;
  const preFrom = preMove?.from ?? null;
  const preTo = preMove?.to ?? null;
  const stylesKey = [
    lastFrom ?? "",
    lastTo ?? "",
    selected ?? "",
    legal.join(","),
    preFrom ?? "",
    preTo ?? "",
    status,
  ].join("|");
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (lastFrom && lastTo) {
      const hl = { background: "rgba(235,184,75,0.35)" };
      styles[lastFrom] = { ...hl };
      styles[lastTo] = { ...hl };
    }
    if (selected) {
      styles[selected] = { background: "rgba(86,192,106,0.45)" };
    }
    for (const sq of legal) {
      styles[sq] = {
        ...(styles[sq] ?? {}),
        backgroundImage:
          "radial-gradient(circle, rgba(86,192,106,0.7) 22%, transparent 24%)",
      };
    }
    // Queued pre-move — distinct orange so it reads differently from a real move.
    if (preFrom && preTo && status === "live") {
      const pm = { background: "rgba(235,140,60,0.55)" };
      styles[preFrom] = { ...pm };
      styles[preTo] = { ...pm };
    }
    return styles;
  }, [lastFrom, lastTo, selected, legal, preFrom, preTo, status]);

  // Another tab on this device took over this player's session. Show a prompt
  // instead of a second live board (two boards → conflicting moves → "can't
  // move"). The poll is already paused while passive.
  if (!tabActive) {
    return (
      <main className="center-screen" data-testid="passive-tab">
        <div
          className="card card-narrow stack text-center"
          style={{ alignItems: "center", gap: 12 }}
        >
          <div style={{ fontSize: 40 }}>♟</div>
          <h2>{no.player.otherTabTitle}</h2>
          <p className="muted">{no.player.otherTabBody}</p>
          <button className="btn btn-primary btn-lg" onClick={claimTab}>
            {no.player.otherTabResume}
          </button>
        </div>
      </main>
    );
  }

  if (!detail) {
    if (loadError) {
      return (
        <main className="center-screen" data-testid="load-error">
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
      {syncFailures >= 1 && (
        // Fixed-position, out of document flow: a background sync hiccup must
        // never move the board or block a drag-drop in progress. Escalates to
        // an explicit retry only once it's been failing for a while (>=3) —
        // one blip shouldn't invite a button-mash.
        <div
          className="banner banner-wait"
          style={{
            position: "fixed",
            top: 16,
            left: 20,
            zIndex: 40,
            padding: "6px 12px",
            display: "flex",
            alignItems: "center",
            gap: 10,
          }}
          role="status"
          aria-live="polite"
        >
          {no.player.reconnecting}
          {syncFailures >= 3 && (
            <button className="btn btn-ghost" style={{ padding: "2px 10px" }} onClick={() => safeLoad()}>
              {no.player.refreshNow}
            </button>
          )}
        </div>
      )}
      {/* L3: a true toast — fixed/out of flow (see .toast in globals.css) so a
          transient error message can never change .center-screen's height and
          re-centre (or on /solo, jump) the board underneath it. Auto-clears
          after 2.2s (see `flash`). */}
      {toast && (
        <div className="banner banner-error toast" data-testid="toast" role="status" aria-live="polite">
          {toast}
        </div>
      )}
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
          {timer && timer.startedAt && (
            // Kept mounted (visibility, not unmount) once the round timer has
            // ever been present, so its slot's height never disappears out
            // from under the banner/board when the game ends (L2). Never
            // rendered at all when no timer is configured for this round —
            // that's a fixed property of the round, not a mid-game change.
            <div style={ended ? { visibility: "hidden" } : undefined}>
              <RoundTimer
                startedAt={timer.startedAt}
                durationSec={timer.durationSec}
                extendedMs={timer.extendedMs ?? 0}
                compact
              />
            </div>
          )}

          {/* One fixed banner slot, ALWAYS mounted (L2: visibility:hidden at
              game end, never unmounted) so nothing above .board-shell can
              change height mid-game: shows your turn, the opponent's turn, or
              — when you've queued a pre-move on the opponent's turn — the
              pre-move indicator. .turn-slot reserves one line of .banner
              (~57px, see globals.css) and .banner-line clips with an ellipsis
              instead of wrapping to a second line. */}
          <div className="turn-slot" style={ended ? { visibility: "hidden" } : undefined}>
            <div
              className={`banner ${isMyTurn ? "banner-turn" : "banner-wait"}`}
              data-testid="turn-banner"
              style={{
                width: "100%",
                ...(!isMyTurn && preMove ? { borderColor: "rgba(235,140,60,0.6)" } : {}),
              }}
              role="status"
              aria-live="polite"
            >
              <span
                className="banner-line"
                title={!isMyTurn && preMove ? no.player.premoveSetTitle : undefined}
              >
                {isMyTurn
                  ? `♟ ${no.player.yourTurn}`
                  : preMove
                    ? `⏩ ${no.player.premoveSet}`
                    : no.player.opponentTurn}
              </span>
            </div>
          </div>

          <div className="board-frame">
            <div
              className="board-shell"
              data-testid="board-shell"
              role="group"
              aria-label={isMyTurn ? `${no.player.yourTurn} – ${no.player.boardLabel}` : no.player.boardLabel}
            >
              {/* L5: memo'd wrapper — same board, same handlers, but it only
                  re-renders when something it DISPLAYS changed. See
                  lib/client/PlayBoard.tsx for why ignoring the handlers'
                  identity is safe (they are routed through refs, and every
                  state they read is a function of the props compared here). */}
              <PlayBoard
                id="play-board"
                fen={fen}
                orientation={myColor}
                // Draggable on my turn AND the opponent's (to queue a pre-move).
                allowDragging={!ended}
                squareStyles={squareStyles}
                stylesKey={stylesKey}
                onDrop={onDrop}
                onSquareClick={onSquareClick}
              />
            </div>
            <ReactionOverlay ref={reactionRef} />
          </div>

          {/* L3: kept mounted (visibility, not unmount) once reactions are
              enabled for this round, so its removal at game end — which sits
              below the board but above the result overlay's fade-in — can't
              read as a flash beneath the overlay. */}
          {reactionsEnabled && (
            <div style={ended ? { visibility: "hidden" } : undefined}>
              <ReactionBar
                onSend={(emoji) => {
                  reactionRef.current?.add(emoji); // self-broadcast off → show mine locally
                  sendOnGame("reaction", { emoji, by: me.playerId });
                }}
              />
            </div>
          )}

          {/* L3: same reasoning — always mounted, visibility:hidden (not
              unmounted) at game end. */}
          <div className="row" style={ended ? { visibility: "hidden" } : undefined}>
            <button
              className="btn btn-ghost"
              disabled={pending || drawSent || acting || ended}
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
              disabled={pending || acting || ended}
              onClick={() => setConfirmResign(true)}
            >
              {no.player.resign}
            </button>
          </div>

          <NoticeSlot
            clock={clock}
            status={status}
            myTurnLetter={myTurnLetter}
            drawSent={drawSent}
            incomingDraw={incomingDraw}
            drawDialogOpen={drawDialogOpen}
            acting={acting}
            onClaim={() => runMeta(api.claimTime(gameId, me.playerId, me.resumeCode))}
            onReopenDraw={() => setDrawDialogOpen(true)}
          />

          {/* Always mounted (L2) — MoveList already renders a "–" placeholder
              for an empty list, and .movelist now has a fixed height, so it's
              the same block from the very first render, not something that
              pops in and grows over the first ~6 moves. */}
          <MoveList sans={sans} />
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
        <div
          className="result-overlay"
          role="dialog"
          aria-modal="true"
          // Only the main result-card branch below actually renders the
          // heading this points at — the replay/review branches have their
          // own headings/controls instead.
          aria-labelledby={
            replayPgn === null && !showReview ? resultHeadingId : undefined
          }
        >
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
            <div
              className="result-card stack"
              data-testid="result-card"
              style={{ alignItems: "center", gap: 12 }}
            >
              <div className="result-emoji">
                {status === "draw" ? "🤝" : iWon ? "🎉" : "😔"}
              </div>
              <h1 id={resultHeadingId} style={{ fontSize: "clamp(36px,9vw,64px)" }}>
                {resultText}
              </h1>
              <p className="muted">
                {status === "draw"
                  ? "Godt spilt av begge."
                  : iWon
                    ? "Sterkt spilt!"
                    : "Bedre lykke neste runde."}
              </p>
              <button
                ref={resultNextBtnRef}
                className="btn btn-primary btn-lg"
                style={{ marginTop: 6 }}
                onClick={onFinished}
              >
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

      {/* L3: was an in-flow card below the board (grew the layout by a whole
          card whenever an offer arrived, sliding the board on a top-aligned
          screen). A modal dialog — same one used for resign — moves it out of
          flow entirely; accept/decline are wired to the same handlers as
          before.
          Dismissing (Escape/backdrop) is deliberately NOT the same as
          "Avslå": it only hides the dialog (`onDismiss`), leaving the offer
          itself pending — a student who hit Escape by reflex must not have
          just declined a draw for them. `onCancel` (the explicit button) is
          the one that actually declines. */}
      {drawDialogOpen && !ended && (
        <ConfirmDialog
          message={no.player.drawOfferedByOpponent}
          confirmLabel={no.player.accept}
          cancelLabel={no.player.decline}
          dismissLabel={no.player.drawOfferDismissHint}
          onConfirm={() =>
            runMeta(
              api.draw(gameId, me.playerId, me.resumeCode, "accept"),
              () => setIncomingDraw(false),
            )
          }
          onCancel={() =>
            runMeta(
              api.draw(gameId, me.playerId, me.resumeCode, "decline"),
              () => setIncomingDraw(false),
            )
          }
          onDismiss={() => setDrawDialogOpen(false)}
        />
      )}

      <SoundToggle />
      <FullscreenToggle />
      <NotifyToggle />
    </main>
  );
});
