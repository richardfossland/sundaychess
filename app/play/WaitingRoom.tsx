"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { useBoardState } from "@/lib/client/useBoardState";
import { usePresence } from "@/lib/client/usePresence";
import { channels } from "@/lib/realtime";
import { api } from "@/lib/client/api";
import { identity, type StoredPlayer } from "@/lib/client/identity";
import { report } from "@/lib/client/telemetry";
import { initials } from "@/lib/client/Confetti";
import { PuzzleCard } from "@/lib/client/PuzzleCard";
import { PredictPanel } from "@/lib/client/PredictPanel";
import { BracketBoard } from "@/lib/client/BracketBoard";
import { variantStartFen } from "@/lib/chess/variants";
import { computeTeamStandings, teamColor } from "@/lib/tournament/teams";
import { offerSoloWhileWaiting, waitingProgress } from "@/lib/tournament/progress";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { resumeTroubleFromStatus } from "@/lib/client/resumeCopy";
import { no } from "@/lib/locale/no";
import { GameView } from "./GameView";
import "./play.css";
import { Icon, MedalIcon } from "@/lib/client/Icon";

function Brand() {
  return (
    <div className="brandmark pl-brand">
      <span className="knight">♞</span> Sunday<b>Chess</b>
    </div>
  );
}

/** The player's own end-of-tournament card. The placement is the headline
 *  ("Du ble nr. 7 av 8 · 2 poeng"); top 3 and the winning team sit under it. */
function FinalResults({ state, playerId }: { state: BoardState; playerId: string }) {
  const { standings, tournament, players } = state;
  const mine = standings.find((s) => s.playerId === playerId);
  const top = standings.slice(0, 3);
  const teamRows = computeTeamStandings(tournament.config.teams ?? [], players);

  return (
    <div className="pl-final">
      <p className="pl-done" role="status">
        <Icon name="flag" size={16} /> {no.player.tournamentFinished}
      </p>
      {mine && (
        <div className="pl-hero" data-testid="final-placement">
          <p className="pl-hero-lead">
            {no.player.youPlaced} <b className="pl-hero-rank">{mine.rank}</b>
          </p>
          <p className="pl-hero-sub">{no.player.pointsOf(standings.length, mine.score)}</p>
        </div>
      )}
      <div className="pl-podium" aria-label={no.player.finalTitle}>
        {top.map((s, i) => (
          <div
            className={`pl-podium-row${s.playerId === playerId ? " is-me" : ""}`}
            key={s.playerId}
          >
            <span className="pl-podium-name">
              <MedalIcon rank={i + 1} /> {s.displayName}
            </span>
            <span className="muted">{s.score}</span>
          </div>
        ))}
      </div>
      {teamRows.length > 0 && (
        <div className="pl-team-row">
          <span className="muted fs-xs">{no.teams.winner}</span>
          <span className="team-chip">
            <span className="team-dot" style={{ background: teamColor(teamRows[0].team) }} />
            <Icon name="cup" size={16} /> {teamRows[0].team} · <b>{teamRows[0].score}</b>
          </span>
        </div>
      )}
    </div>
  );
}

/** Find the player's most relevant game in the current board state. */
function myGame(state: BoardState, playerId: string): PublicGame | null {
  const mine = state.games.filter(
    (g) => g.whitePlayerId === playerId || g.blackPlayerId === playerId,
  );
  if (mine.length === 0) return null;
  return mine.find((g) => g.status === "live") ?? mine[mine.length - 1];
}

/** Is the player OUT of the tournament (vs merely waiting for the next round)?
 *  - status "left": marked absent / walkover, or removed from the lobby.
 *  - playoff: eliminated = not present in any game of the CURRENT playoff round
 *    (once the round has advanced past them). */
function isOut(state: BoardState, playerId: string): boolean {
  const meP = state.players.find((p) => p.id === playerId);
  if (meP?.status === "left") return true;
  if (state.tournament.status !== "playoff") return false;
  const cur = state.rounds.find(
    (r) => r.phase === "playoff" && r.number === state.tournament.currentRound,
  );
  if (!cur) return false;
  const inRound = state.games.some(
    (g) =>
      g.roundId === cur.id &&
      (g.whitePlayerId === playerId || g.blackPlayerId === playerId),
  );
  return !inRound;
}

export function WaitingRoom({
  me,
  onLeave,
}: {
  me: StoredPlayer;
  /** `reason` (T5) only labels the telemetry event the parent records before it
   * wipes the session — the leave behaviour is identical either way. */
  onLeave: (reason?: "logout" | "tournament_gone" | "switch_player") => void;
}) {
  const [showCode, setShowCode] = useState(false);
  const [rejoining, setRejoining] = useState(false);
  const [rejoinError, setRejoinError] = useState(false);
  // Latch the active game so the result screen survives board refetches until
  // the student dismisses it.
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const { state, error, errorStatus, errorCode, refresh } = useBoardState(
    me.tournamentId,
  );
  // Advertise that this student is connected (keyed by playerId) so the host can
  // see who's online in the lobby and drop ghosts. Stays active across the
  // waiting view and the in-game child below (this component remains mounted).
  usePresence(channels.presence(me.tournamentId), me.playerId);

  const game = state ? myGame(state, me.playerId) : null;
  const status = state?.tournament.status ?? "lobby";

  useEffect(() => {
    if (game?.status === "live" && activeGameId !== game.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveGameId(game.id);
    }
  }, [game, activeGameId]);

  // If the latched game vanished from a loaded state (host reset the tournament),
  // drop back to the waiting view instead of rendering a board that can't load.
  useEffect(() => {
    if (state && activeGameId && !state.games.some((g) => g.id === activeGameId)) {
      report("game_vanished", { gameId: activeGameId, status: state.tournament.status });
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveGameId(null);
    }
  }, [state, activeGameId]);

  // --- L5: the props handed to <GameView> below ---
  //
  // GameView is `memo`'d, and this component is its ALWAYS-MOUNTED parent: it
  // re-renders on every board poll and every presence event in the class. Both
  // of those are now no-ops when nothing changed (useBoardState / usePresence),
  // but a re-render for any OTHER reason must still not reach the board — so
  // every prop below has to be a primitive or a stable reference.
  //
  // Derived up here, before the early returns, so the hooks run unconditionally
  // (they used to live inside the `if (activeGameId)` branch, where a hook
  // cannot go). `me` is set once in app/play/page.tsx and `variantStartFen`
  // returns a module constant, so those two are already stable.
  const activeGame = activeGameId
    ? state?.games.find((g) => g.id === activeGameId)
    : undefined;
  const activeRound = activeGame
    ? state?.rounds.find((r) => r.id === activeGame.roundId)
    : undefined;
  // Round timer (league rounds only) — fed to the player's board. Rebuilt only
  // when one of the three primitives it derives from actually changes; it used
  // to be a fresh object literal on every render of this component.
  const timerSec = state?.tournament.config.roundTimerSec ?? null;
  const roundStartedAt = activeRound?.startedAt ?? null;
  const roundExtendedMs = activeRound?.extendedMs ?? 0;
  const timer = useMemo(
    () =>
      timerSec && roundStartedAt
        ? {
            startedAt: roundStartedAt,
            durationSec: timerSec,
            extendedMs: roundExtendedMs,
          }
        : null,
    [timerSec, roundStartedAt, roundExtendedMs],
  );
  // `refresh` is itself a useCallback over [tournamentId, withClocks], and
  // setActiveGameId is a stable setter, so this closure is stable too.
  const onGameFinished = useCallback(() => {
    setActiveGameId(null);
    refresh();
  }, [refresh]);

  // The tournament itself is gone: OUR API said so (404 + our own `not_found`
  // envelope) and we never got a board. The code check is load-bearing, by this
  // PR's own rule — an HTML 404 from the edge also arrives as status 404, but
  // carries the caller tag "board_failed", and it must NOT put a student in
  // front of a "Logg ut" button that wipes their resume code.
  // Every OTHER error is deliberately left alone here — `error`/`errorStatus`/
  // `errorCode` stay in scope for the reconnecting badge (R7); a blip keeps the
  // last board.
  const tournamentGone =
    error && errorStatus === 404 && errorCode === "not_found" && !state;

  // A transient fetch error while we still have SOME state: never wipe the
  // waiting view (or a latched game below) — just flag the hiccup with a
  // fixed-position badge, exactly like the host board (BoardClient).
  const showReconnectBadge = error && !!state;
  // No state at all, and it's not the "tournament is gone" verdict above: a
  // full connection loss before the first board ever loaded. Give the student
  // something to act on instead of an infinite spinner.
  const showReconnectCard = error && !state && !tournamentGone;

  if (tournamentGone) {
    return (
      <main className="center-screen">
        <div className="card card-narrow stack pl-card scale-in">
          <Brand />
          <div className="pl-icon"><Icon name="flag" size={40} /></div>
          <h2 className="pl-title">{no.player.tournamentGone}</h2>
          <p className="muted">{no.player.tournamentGoneBody}</p>
          <button
            className="btn btn-primary btn-lg pl-cta"
            onClick={() => {
              // onLeave FIRST: it records the telemetry event, and that reads
              // the stored identity for the (opaque) ids — clearing first would
              // make every kick anonymous. onLeave clears the session itself;
              // the call below is the pre-existing belt-and-braces.
              onLeave("tournament_gone");
              identity.clearPlayer(me.tournamentId);
            }}
          >
            {no.player.logOut}
          </button>
        </div>
      </main>
    );
  }

  if (showReconnectCard) {
    // Same "blip vs. dead end" copy as attemptResume's resumeTrouble() in
    // page.tsx (moved to lib/client/resumeCopy.ts) — this hook only kept the
    // status/code pair, not the raw exception, hence the FromStatus variant.
    const message = resumeTroubleFromStatus(errorStatus, errorCode);
    return (
      <main className="center-screen">
        <div className="card card-narrow stack pl-card">
          <h2>{no.common.error}</h2>
          <p className="muted">{message}</p>
          <button className="btn btn-primary btn-lg" onClick={() => refresh()}>
            {no.common.retry}
          </button>
          <button
            className="text-link"
            onClick={() => {
              onLeave(); // first — see the tournament-gone button above
              identity.clearPlayer(me.tournamentId);
            }}
          >
            {no.player.logOut}
          </button>
        </div>
      </main>
    );
  }

  // R4: the host's ghost-sweep removed us from the LOBBY (a locked phone stops
  // the presence heartbeat). The old behaviour was to keep saying "venter på at
  // arrangøren starter …" to a student who was no longer in the tournament at
  // all. Say what happened, and offer the one button that undoes it.
  const meRow = state?.players.find((p) => p.id === me.playerId) ?? null;
  if (status === "lobby" && meRow?.status === "left") {
    const rejoin = async () => {
      setRejoining(true);
      setRejoinError(false);
      try {
        await api.rejoin(me.tournamentId, me.playerId, me.resumeCode);
        await refresh();
      } catch {
        setRejoinError(true);
      } finally {
        setRejoining(false);
      }
    };
    return (
      <main className="center-screen">
        <div className="card card-narrow stack pl-card scale-in">
          <Brand />
          <div className="pl-icon"><Icon name="wave" size={40} strokeWidth={1.5} /></div>
          <h2 className="pl-title">{no.player.removedLobbyTitle}</h2>
          <p className="muted">{no.player.removedLobbyBody}</p>
          <button
            className="btn btn-primary btn-lg pl-cta"
            disabled={rejoining}
            onClick={rejoin}
          >
            {rejoining ? <span className="spin" /> : no.player.rejoinLobby}
          </button>
          {rejoinError && (
            <div className="banner banner-error">{no.player.rejoinFailed}</div>
          )}
        </div>
      </main>
    );
  }

  if (activeGameId) {
    return (
      <GameView
        me={me}
        gameId={activeGameId}
        timer={timer}
        reactionsEnabled={state?.tournament.config.reactions === true}
        variantFen={variantStartFen(state?.tournament.config.variant)}
        onFinished={onGameFinished}
      />
    );
  }

  const eliminated = state ? isOut(state, me.playerId) : false;
  // The spinner means "hang on, more is coming" — drop it once the player is out
  // or the tournament is over, where nothing more is coming for them.
  const showWaitingSpinner = !eliminated && status !== "finished";

  // Round n/N + games-left line (+ compact timer) for the between-rounds and
  // bye screens. Null for lobby/finished/no-round-yet/an eliminated playoff
  // player — see lib/tournament/progress.ts — so it's safe to render
  // unconditionally below.
  const progress = state ? waitingProgress(state, { playerId: me.playerId }) : null;

  // Nothing left to do right now (eliminated / bye / finished their league
  // game early) — offer /solo instead of a bare spinner. Opens in a NEW tab
  // (see the link below) so the tournament screen is never lost; /solo isn't
  // a tournament page, so lib/client/useActiveTab.ts's single-tab lock is
  // never involved.
  const showSoloWhileWaiting = state
    ? offerSoloWhileWaiting(state, me.playerId)
    : false;

  // ONE status message. Between rounds with every game done, the round number
  // IS the message ("Venter på runde 2") — no second line about the opponent.
  let headline: string = no.player.waitingStart;
  let sub: string | null = null;
  if (status !== "lobby") {
    if (status === "finished") headline = no.player.tournamentFinished;
    else if (eliminated) headline = no.player.outOfTournament;
    else if (game?.status === "bye") {
      headline = no.player.waitingBye;
      sub = progress?.label ?? null;
    } else if (progress && progress.live === 0) {
      headline = no.player.waitingRound(progress.round + 1);
      sub = no.player.waitingRoundHint;
    } else {
      headline = no.player.waitingNext;
      sub = progress?.label ?? null;
    }
  }

  const myTeam = meRow?.team ?? null;
  const leave = (reason?: "logout" | "switch_player") => {
    onLeave(reason); // first — see the tournament-gone button above
    identity.clearPlayer(me.tournamentId);
  };

  const meLinks = (
    <div className="pl-me">
      {showCode && (
        <div className="pl-code">
          <div className="big-code" data-testid="my-code">{me.resumeCode}</div>
        </div>
      )}
      <div className="pl-me-links">
        {!showCode && (
          <button className="text-link" onClick={() => setShowCode(true)}>
            <Icon name="key" size={16} /> {no.player.showMyCode}
          </button>
        )}
        {/* Shared devices: the iPad that Ada used in round 1 is Bo's in round 2.
            The ordinary leave path, scoped to THIS tournament, so a session for
            another tournament on the same device survives. */}
        <button className="text-link" data-testid="switch-player" onClick={() => leave("switch_player")}>
          {no.player.switchPlayer}
        </button>
        <button className="text-link" onClick={() => leave()}>
          {no.player.logOut}
        </button>
      </div>
      <p className="pl-me-hint">{no.player.resumeHint}</p>
    </div>
  );

  const hasAside = status !== "lobby" && status !== "finished";

  return (
    <main className="center-screen" data-testid="waiting-room">
      {showReconnectBadge && (
        <div className="banner banner-wait pl-reconnect" role="status" aria-live="polite">
          {no.player.reconnecting}
        </div>
      )}
      <div className="pl-wrap">
        <div className="card card-narrow stack pl-card scale-in">
          <Brand />
          {state && status === "finished" ? (
            <>
              <FinalResults state={state} playerId={me.playerId} />
              <p className="muted fs-xs">
                {me.displayName}
                {myTeam ? ` · ${no.teams.yourTeam} ${myTeam}` : ""}
              </p>
            </>
          ) : (
            <>
              <div className="avatar-lg pl-avatar float">{initials(me.displayName)}</div>
              <h2 className="pl-name">{me.displayName}</h2>
              {myTeam && (
                <span className="team-chip">
                  <span className="team-dot" style={{ background: teamColor(myTeam) }} />
                  {no.teams.yourTeam} {myTeam}
                </span>
              )}
              <div className="pl-status" role="status">
                <p className={`pl-status-main${headline.length > 48 ? " is-long" : ""}`}>
                  {showWaitingSpinner && <span className="spin" aria-hidden="true" />}
                  <span>{headline}</span>
                </p>
                {sub && (
                  <div className="pl-status-sub">
                    <span>{sub}</span>
                    {progress?.timer && (
                      <RoundTimer
                        startedAt={progress.timer.startedAt}
                        durationSec={progress.timer.durationSec}
                        extendedMs={progress.timer.extendedMs}
                        compact
                      />
                    )}
                  </div>
                )}
              </div>
            </>
          )}
          {meLinks}
        </div>

        {/* the cup ladder — how it's going / how it went (knockout only) */}
        {state && state.rounds.some((r) => r.phase === "playoff") && (
          <div className="card stack pl-fill">
            <p className="eyebrow">{no.player.cupProgress}</p>
            <BracketBoard games={state.games} rounds={state.rounds} players={state.players} />
          </div>
        )}

        {/* Secondary, muted: things to do while waiting. */}
        {/* something to chew on while waiting */}
        {state && hasAside && <PredictPanel me={me} state={state} />}

        {/* eliminated / bye / finished early — nothing left to do right now,
            so offer a solo game against the computer instead of a bare wait.
            target="_blank": opening it in THIS tab would lose the tournament
            screen (and, mid-game, the presence heartbeat). */}
        {showSoloWhileWaiting && (
          <div className="card stack pl-aside">
            <p className="eyebrow">{no.player.soloWhileWaitingTitle}</p>
            <p className="pl-aside-body">{no.player.soloWhileWaitingBody}</p>
            <a href="/solo" target="_blank" rel="noopener" className="btn btn-ghost btn-block">
              {no.player.soloWhileWaitingCta}
            </a>
          </div>
        )}

        {status !== "finished" && <PuzzleCard />}
      </div>
    </main>
  );
}
