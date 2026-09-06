"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type { BoardState } from "@/lib/dto";
import type { GameStatus, Turn } from "@/lib/types";
import { channels } from "@/lib/realtime";
import {
  isValidSpectatePosition,
  isValidSpectateResult,
} from "@/lib/realtimeTrust";
import { useChannel } from "@/lib/client/useChannel";
import { ChessClock } from "@/lib/client/ChessClock";
import { PlayBoard } from "@/lib/client/PlayBoard";
import { no } from "@/lib/locale/no";
import { variantStartFen } from "@/lib/chess/variants";
import { plyOf } from "@/lib/chess/ply";
import { SpectateGame } from "./SpectateGame";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { Confetti } from "@/lib/client/Confetti";

// L8: the grid never highlights squares (that's the single-game spectate
// view's job) — a stable empty object + constant key so every mini/big board
// shares one reference and the memo comparison is trivially cheap.
const NO_SQUARE_STYLES: Record<string, CSSProperties> = {};
const NO_STYLES_KEY = "";
// Read-only boards: identity is ignored by <PlayBoard>'s own memo anyway (see
// lib/client/PlayBoard.tsx), but stable module-level no-ops keep the intent
// obvious at each call site.
const NOOP_DROP = () => false;
const NOOP_CLICK = () => {};

/** Client clock snapshot, stamped with local receipt time so ChessClock can
 * tick the running side down. */
type ClockSnap = {
  whiteMs: number;
  blackMs: number;
  turn: Turn;
  running: boolean;
  at: number;
};

/** One side's clock for a spectated game (static unless it's that side's turn). */
function SideClock({ clk, side }: { clk: ClockSnap | undefined; side: Turn }) {
  if (!clk) return null;
  const ms = side === "w" ? clk.whiteMs : clk.blackMs;
  return <ChessClock ms={ms} at={clk.at} running={clk.running && clk.turn === side} />;
}

/** The spectate feed is unauthenticated like every other topic (lib/realtimeTrust.ts):
 * anyone holding the public anon key can send a `position` for any game id in
 * the tournament. So a broadcast here is an OVERLAY on the authoritative board
 * poll, never a merge into it — it fills the gap between two polls and stops
 * counting the moment the poll reaches the same ply, or this long after it
 * arrived, whichever comes first. Longer than a refetch round-trip so a real
 * move never flickers back off the projector; short enough that a forged
 * position is gone while the teacher is still looking at it. */
const PATCH_TTL_MS = 4000;

/** How long a burst of spectate broadcasts is coalesced into one board refetch.
 * A round with fifteen boards emits a lot of these; without the window every
 * move in the room would be its own GET. */
const PATCH_REFETCH_MS = 1000;

/** A position a broadcast claims for one game, pending the next board poll. */
type Patch = { fen: string; ply: number; clock: ClockSnap | null; at: number };

/** Column min-width for the responsive grid: fewer live games ⇒ bigger boards
 * so the projector stays readable as a round winds down. (1 game is special-
 * cased to a single large board.) */
function gridMin(liveCount: number): number {
  if (liveCount <= 3) return 440;
  if (liveCount <= 6) return 320;
  return 220;
}

export function LiveGamesView({
  state,
  onStale,
  onExitLive,
}: {
  state: BoardState;
  onStale?: () => void;
  /** Leave live mode back to the arranging view (bracket / league control). */
  onExitLive?: () => void;
}) {
  const { tournament, players, games, rounds } = state;
  const nameById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.displayName]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : no.host.bye);
  }, [players]);

  const playerIds = useMemo(() => new Set(players.map((p) => p.id)), [players]);

  // Broadcast overlay per game: realtime patches the projector instantly, the
  // 5 s board poll is what it is checked against. Held SEPARATELY from `games`
  // (rather than merged into a fenMap that then had to be un-merged) so the
  // authoritative fen is always one field away — a patch stops applying by
  // itself the moment the poll catches up, and it can never wedge a board.
  const [patch, setPatch] = useState<Record<string, Patch>>({});
  // Clocks straight off the board poll, stamped once per poll that actually
  // changed something (`games` keeps its identity across a no-op poll, L5), so
  // ChessClock's countdown anchor doesn't jump on every render. Stamped in the
  // effect below, never during render — `Date.now()` is not render-pure.
  const [pollClocks, setPollClocks] = useState<Record<string, ClockSnap>>({});
  const fenOf = (g: { id: string; fen: string }) => {
    const p = patch[g.id];
    return p && p.ply > plyOf(g.fen) ? p.fen : g.fen;
  };
  const clockOf = (g: { id: string; fen: string }): ClockSnap | undefined => {
    const p = patch[g.id];
    return p?.clock && p.ply > plyOf(g.fen) ? p.clock : pollClocks[g.id];
  };
  const [openId, setOpenId] = useState<string | null>(null);
  // Games we've seen finish this session — drop them from the grid the instant
  // the result event arrives, without waiting for the next board poll.
  const [finished, setFinished] = useState<Set<string>>(() => new Set());
  // Result of the currently-open game (drives the winner animation + auto-close).
  const [openResult, setOpenResult] = useState<GameStatus | null>(null);
  // A brief "X vant!" flash over the grid when any game finishes in live mode.
  const [winFlash, setWinFlash] = useState<string | null>(null);

  // Expire the overlay. One timer, armed for the oldest patch — when it fires,
  // everything past its TTL is dropped and the authoritative fen shows again.
  // This is what bounds a forged position: no matter what ply it claimed, it is
  // off the projector within PATCH_TTL_MS.
  useEffect(() => {
    const ats = Object.values(patch).map((p) => p.at);
    if (ats.length === 0) return;
    const due = Math.max(0, PATCH_TTL_MS - (Date.now() - Math.min(...ats)));
    const t = setTimeout(() => {
      setPatch((prev) => {
        const now = Date.now();
        const next: Record<string, Patch> = {};
        for (const [id, p] of Object.entries(prev)) {
          if (now - p.at < PATCH_TTL_MS) next[id] = p;
        }
        // Same object when nothing expired — React bails out, and this effect
        // (which depends on `patch`) doesn't re-arm in a loop.
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, due);
    return () => clearTimeout(t);
  }, [patch]);

  useEffect(() => {
    // Self-heal the "finished" veto: the authoritative poll wins. Drop any id the
    // poll now reports as live again (so a stale/duplicate result event or a
    // re-activated slot can't permanently hide a live board), and prune the rest
    // so the set can't grow for a whole projector session.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFinished((s) => {
      if (s.size === 0) return s;
      const liveNow = new Set(games.filter((g) => g.status === "live").map((g) => g.id));
      const present = new Set(games.map((g) => g.id));
      // Keep only ids the poll still reports as present-and-NOT-live (a transient
      // hide). Drop ids the poll says are live again (un-hide) or that vanished.
      const next = new Set<string>();
      for (const id of s) if (present.has(id) && !liveNow.has(id)) next.add(id);
      return next.size === s.size ? s : next;
    });
    const at = Date.now();
    const clocks: Record<string, ClockSnap> = {};
    for (const g of games) if (g.status === "live" && g.clock) clocks[g.id] = { ...g.clock, at };
    setPollClocks(clocks);
  }, [games]);

  // Coalesced board refetch behind a spectate broadcast — the truth every patch
  // below is waiting on.
  const refetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestBoard = useCallback(() => {
    if (refetchTimer.current !== null) return;
    refetchTimer.current = setTimeout(() => {
      refetchTimer.current = null;
      onStale?.();
    }, PATCH_REFETCH_MS);
  }, [onStale]);
  useEffect(
    () => () => {
      if (refetchTimer.current !== null) clearTimeout(refetchTimer.current);
    },
    [],
  );

  // See lib/realtimeTrust.ts. The spectate topic is derivable from the public
  // tournament payload and reachable with the public anon key, so nothing that
  // arrives here is trusted: payloads are shape-checked, positions become an
  // expiring overlay on the board poll rather than a merge into it, and a
  // `result` only HIDES a board (a veto the poll already un-does, above) — the
  // standings behind it always come from the refetch.
  useChannel(
    channels.spectate(tournament.id),
    (event, payload) => {
      if (event === "position") {
        if (!isValidSpectatePosition(payload)) return;
        const p = payload;
        const at = Date.now();
        setPatch((m) => ({
          ...m,
          [p.gameId]: {
            fen: p.fen,
            ply: plyOf(p.fen),
            clock: p.clock ? { ...p.clock, at } : null,
            at,
          },
        }));
        requestBoard();
      } else if (event === "result") {
        if (!isValidSpectateResult(payload)) return;
        const p = payload;
        // Drop it from the grid immediately; refetch authoritative standings.
        setFinished((s) => (s.has(p.gameId) ? s : new Set(s).add(p.gameId)));
        if (p.gameId === openId) setOpenResult(p.status);
        // Celebrate the result over the grid (who won / draw) — but only for a
        // game this projector is actually showing, so a made-up id can't put a
        // "X vant!" banner over a round still in play.
        const g = games.find((x) => x.id === p.gameId);
        const flash =
          p.status === "white_win" && g
            ? `${nameById(g.whitePlayerId)} ${no.host.spectateWon}`
            : p.status === "black_win" && g
              ? `${nameById(g.blackPlayerId)} ${no.host.spectateWon}`
              : p.status === "draw" && g
                ? no.host.spectateDraw
                : null;
        if (flash) setWinFlash(flash);
        onStale?.();
      }
    },
    (s) => {
      // Spectate broadcasts silently stopped → refetch the board so the live
      // grid recovers instead of freezing on stale positions. CLOSED included:
      // channelRegistry recreates the channel itself in the background (R11),
      // but the position/result this drop swallowed still needs this fetch.
      if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") onStale?.();
    },
  );

  // Auto-return from a finished spectated game after the winner animation.
  useEffect(() => {
    if (!openResult) return;
    const t = setTimeout(() => {
      setOpenId(null);
      setOpenResult(null);
    }, 4500);
    return () => clearTimeout(t);
  }, [openResult]);

  // Per-game win flash auto-dismiss.
  useEffect(() => {
    if (!winFlash) return;
    const t = setTimeout(() => setWinFlash(null), 3500);
    return () => clearTimeout(t);
  }, [winFlash]);

  // Is the CURRENT round fully resolved (every game done, none live)? When so,
  // there's nothing left to watch → prompt the host back to arranging to advance.
  const roundOver = useMemo(() => {
    const cur = games.filter((g) => {
      const r = rounds.find((rr) => rr.id === g.roundId);
      return r?.number === tournament.currentRound;
    });
    return cur.length > 0 && cur.every((g) => g.status !== "live");
  }, [games, rounds, tournament.currentRound]);

  // Stable board order: by bracket/pairing slot, then id. The incoming `games`
  // list is ordered by updated_at, so without this a move would bump its card to
  // a new position and the whole grid would jump around — hard to follow with
  // many boards live. Sorting by slot keeps each board in a fixed place.
  const live = games
    .filter((g) => g.status === "live" && g.blackPlayerId && !finished.has(g.id))
    .sort((a, b) => (a.slot ?? 0) - (b.slot ?? 0) || a.id.localeCompare(b.id));

  if (openId) {
    const g = games.find((x) => x.id === openId);
    if (g) {
      return (
        <SpectateGame
          gameId={g.id}
          fen={fenOf(g)}
          baselineFen={variantStartFen(tournament.config.variant)}
          white={nameById(g.whitePlayerId)}
          black={nameById(g.blackPlayerId)}
          senders={playerIds}
          clock={clockOf(g)}
          result={openResult}
          onClose={() => {
            setOpenId(null);
            setOpenResult(null);
          }}
        />
      );
    }
  }

  // The header card markup for one game (names + clocks).
  const Heads = (g: (typeof live)[number]) => (
    <div className="spread" style={{ marginBottom: 8, fontSize: 14, alignItems: "center" }}>
      <span className="row" style={{ gap: 6 }}>
        <b>{nameById(g.whitePlayerId)}</b>
        <SideClock clk={clockOf(g)} side="w" />
      </span>
      <span className="faint">vs</span>
      <span className="row" style={{ gap: 6 }}>
        <SideClock clk={clockOf(g)} side="b" />
        <b>{nameById(g.blackPlayerId)}</b>
      </span>
    </div>
  );

  // 1 game left → one big board that fills the projector.
  if (live.length === 1) {
    const g = live[0];
    return (
      <main className="wrap" style={{ padding: "12px 24px 48px", maxWidth: "min(96vw, 1100px)" }}>
        <button
          onClick={() => { setOpenId(g.id); setOpenResult(null); }}
          className="card reveal"
          style={{ padding: 16, cursor: "pointer", textAlign: "left", color: "inherit", width: "100%" }}
        >
          {Heads(g)}
          <div className="stack" style={{ alignItems: "center" }}>
            <div className="board-shell-lg" style={{ borderRadius: 8, overflow: "hidden" }}>
              <PlayBoard
                id={`big-${g.id}`}
                fen={fenOf(g)}
                orientation="white"
                allowDragging={false}
                showNotation
                squareStyles={NO_SQUARE_STYLES}
                stylesKey={NO_STYLES_KEY}
                onDrop={NOOP_DROP}
                onSquareClick={NOOP_CLICK}
              />
            </div>
          </div>
        </button>
        <FullscreenToggle />
      </main>
    );
  }

  return (
    <main className="wrap" style={{ padding: "12px 24px 64px", maxWidth: "min(96vw, 1800px)" }}>
      {live.length === 0 ? (
        roundOver && onExitLive ? (
          // Round done — nothing left to watch. A fullscreen card prompts the
          // host back to the arranging view to advance the round / bracket.
          <div className="result-overlay">
            <Confetti count={120} />
            <div className="result-card stack" style={{ alignItems: "center", gap: 14 }}>
              <div className="result-emoji">🏁</div>
              <h2 style={{ fontSize: "clamp(28px,5vw,46px)", textAlign: "center" }}>
                {no.host.roundOver}
              </h2>
              <button className="btn btn-primary btn-lg" onClick={onExitLive}>
                {no.host.backToArranging} →
              </button>
            </div>
          </div>
        ) : (
          <p className="muted text-center" style={{ padding: 40 }}>
            Ingen partier pågår akkurat nå.
          </p>
        )
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin(live.length)}px, 1fr))`,
            gap: 20,
            justifyContent: "center",
          }}
        >
          {live.map((g) => (
            <button
              key={g.id}
              onClick={() => { setOpenId(g.id); setOpenResult(null); }}
              className="card reveal"
              style={{ padding: 12, cursor: "pointer", textAlign: "left", color: "inherit" }}
            >
              {Heads(g)}
              <div style={{ borderRadius: 8, overflow: "hidden" }}>
                <PlayBoard
                  id={`mini-${g.id}`}
                  fen={fenOf(g)}
                  orientation="white"
                  allowDragging={false}
                  showNotation={false}
                  squareStyles={NO_SQUARE_STYLES}
                  stylesKey={NO_STYLES_KEY}
                  onDrop={NOOP_DROP}
                  onSquareClick={NOOP_CLICK}
                />
              </div>
            </button>
          ))}
        </div>
      )}

      {/* Brief "X vant!" celebration over the grid as each game finishes — does
          not block the other live boards (suppressed once the round is over, when
          the round-complete card takes over). */}
      {winFlash && !roundOver && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "grid",
            placeItems: "center",
            pointerEvents: "none",
            zIndex: 55,
          }}
        >
          <Confetti count={90} />
          <div className="result-card stack" style={{ alignItems: "center", gap: 8 }}>
            <div className="result-emoji">🎉</div>
            <h2 style={{ fontSize: "clamp(24px,4.5vw,40px)", textAlign: "center" }}>
              {winFlash}
            </h2>
          </div>
        </div>
      )}
      <FullscreenToggle />
    </main>
  );
}
