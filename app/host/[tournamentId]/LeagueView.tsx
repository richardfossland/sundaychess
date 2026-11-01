"use client";

import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { resultSourceLabel, type BoardState, type PublicGame } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { useCountdown } from "@/lib/client/useCountdown";
import { JoinChip } from "@/lib/client/JoinChip";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { computeTeamStandings, teamColor } from "@/lib/tournament/teams";
import { StandingsTable } from "./StandingsTable";
import { OverrideModal } from "./OverrideModal";
import { CodesModal } from "./CodesModal";
import { NotesModal } from "./NotesModal";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { Icon } from "@/lib/client/Icon";
import { effectiveHostCode, usePresentasjon } from "@/lib/client/storskjerm/usePresentasjon";

/** Tavlevisning: høyeste antall rader som vises før «+N til». */
const TV_STANDINGS_MAX = 12;
const TV_GAMES_MAX = 8;

function resultLabel(g: PublicGame, name: (id: string | null) => string): ReactNode {
  switch (g.status) {
    case "live":
      return no.host.inProgress;
    case "white_win":
      return <>{name(g.whitePlayerId)} <Icon name="check" size={14} /></>;
    case "black_win":
      return <>{name(g.blackPlayerId)} <Icon name="check" size={14} /></>;
    case "draw":
      return no.host.draw;
    case "bye":
      return no.host.bye;
    case "aborted":
      // A status, not an instruction — `no.host.abort` is the OverrideModal
      // button's imperative label ("Annuller partiet"); this is its past tense.
      return no.host.aborted;
    default:
      return "";
  }
}

/** I tavlevisning er partiraden ren visning (div); ellers åpner den override. */
function GameRow({
  onClick,
  ...rest
}: {
  onClick?: () => void;
} & Omit<React.HTMLAttributes<HTMLElement>, "onClick">) {
  return onClick ? (
    <button type="button" onClick={onClick} {...(rest as object)} />
  ) : (
    <div {...rest} />
  );
}

export function LeagueView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players, games, standings, rounds, tipping } = state;
  // Tavlevisning (projektor/cast): ingen arrangørkontroller, ingen modaler.
  const presentasjon = usePresentasjon();
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [overrideGame, setOverrideGame] = useState<PublicGame | null>(null);
  const [showCodes, setShowCodes] = useState(false);
  // Force-resolve is irreversible (sets every live game in the round to a
  // draw), so it's confirmed via the themed dialog rather than window.confirm
  // (an OS popup a teacher can miss on a projector).
  const [confirmForce, setConfirmForce] = useState(false);
  // Reinstating an absent/left player only takes effect from the NEXT round's
  // pairing (the current round is already set) — confirmed the same way, so a
  // stray tap on a projector can't silently change the roster.
  const [reinstateTarget, setReinstateTarget] = useState<{ id: string; name: string } | null>(
    null,
  );
  // Finish-early ("Avslutt etter denne runden") lowers config.leagueRounds to
  // the current round — irreversible in the sense that the skipped rounds
  // never happen, so it's confirmed the same way as force-resolve above.
  const [confirmFinishEarly, setConfirmFinishEarly] = useState(false);
  const [showNotes, setShowNotes] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHostCode(effectiveHostCode(identity.hostCode(tournament.id), presentasjon));
  }, [tournament.id, presentasjon]);

  const nameById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.displayName]));
    return (id: string | null) => (id ? (m.get(id) ?? "?") : no.host.bye);
  }, [players]);

  const teamRows = useMemo(
    () => computeTeamStandings(tournament.config.teams ?? [], players),
    [tournament.config.teams, players],
  );
  // Marked absent/left (a walkover with scope 'tournament', or a lobby ghost-
  // kick that outlived the lobby) — collapsed out of the way, with the one
  // button that undoes it from the next round.
  const leftPlayers = useMemo(
    () => players.filter((p) => p.status === "left"),
    [players],
  );
  const teamById = useMemo(() => {
    const m = new Map(players.map((p) => [p.id, p.team]));
    return (id: string) => m.get(id) ?? null;
  }, [players]);

  const currentRound = useMemo(
    () =>
      rounds.find(
        (r) => r.number === tournament.currentRound && r.phase === "league",
      ),
    [rounds, tournament.currentRound],
  );
  const roundGames = useMemo(
    () => games.filter((g) => g.roundId === currentRound?.id),
    [games, currentRound],
  );

  const liveCount = roundGames.filter((g) => g.status === "live").length;
  const allResolved = roundGames.length > 0 && liveCount === 0;
  const isLastRound = tournament.currentRound >= tournament.config.leagueRounds;

  const timerSec = tournament.config.roundTimerSec;
  const timerEndMs =
    timerSec && currentRound?.startedAt
      ? new Date(currentRound.startedAt).getTime() +
        timerSec * 1000 +
        (currentRound.extendedMs ?? 0)
      : null;
  const { expired: timeUp } = useCountdown(timerEndMs);

  async function addMinute() {
    if (!hostCode) return setError(no.host.missingHostCode);
    setBusy(true);
    setError(null);
    try {
      await api.extendRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (!hostCode) return setError(no.host.missingHostCode);
    setBusy(true);
    setError(null);
    try {
      await api.advanceRound(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  function requestForce() {
    if (!hostCode) return setError(no.host.missingHostCode);
    setConfirmForce(true);
  }

  async function force() {
    setConfirmForce(false);
    setBusy(true);
    setError(null);
    try {
      await api.forceResolve(tournament.id, hostCode ?? "");
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  function requestFinishEarly() {
    if (!hostCode) return setError(no.host.missingHostCode);
    setConfirmFinishEarly(true);
  }

  async function finishEarly() {
    setConfirmFinishEarly(false);
    setBusy(true);
    setError(null);
    try {
      // Lowers leagueRounds to the round in progress/just finished — the
      // existing "Fullfør" advance path then finishes the league (or starts
      // the playoff, if configured) as soon as this round is done.
      await api.updateTournamentConfig(tournament.id, hostCode ?? "", {
        leagueRounds: tournament.currentRound,
      });
      onChanged();
    } catch {
      setError(no.host.finishEarlyError);
    } finally {
      setBusy(false);
    }
  }

  async function reinstate(playerId: string) {
    if (!hostCode) return setError(no.host.missingHostCode);
    setBusy(true);
    setError(null);
    try {
      await api.reinstate(tournament.id, hostCode, playerId);
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  // Tavlevisning: maks antall rader som får plass i én skjermhøyde — resten
  // blir «+N til». Skriften skaleres etter radantallet (se storskjerm.css).
  const shownGames = presentasjon ? roundGames.slice(0, TV_GAMES_MAX) : roundGames;
  const tvTipping = Math.min(tipping?.length ?? 0, 3);
  const tvStandingRows =
    Math.min(standings.length, TV_STANDINGS_MAX) +
    (standings.length > TV_STANDINGS_MAX ? 1 : 0) +
    (teamRows.length > 0 ? teamRows.length + 1 : 0) +
    (tvTipping > 0 ? tvTipping + 1 : 0);
  const tvGameRows = shownGames.length + (roundGames.length > shownGames.length ? 1 : 0);

  return (
    <main className={`wrap host-main${presentasjon ? " tv-screen" : ""}`}>
      <header className={presentasjon ? "spread host-head-tv" : "host-sub"}>
        {presentasjon && (
          <>
            <span className="brandmark">
              <span className="knight">♞</span> Sunday<b>Chess</b>
            </span>
            {tournament.title && <span className="muted">{tournament.title}</span>}
            <span className="badge badge-live">
              {no.host.round} {tournament.currentRound} / {tournament.config.leagueRounds}
            </span>
          </>
        )}
        {timerSec && currentRound && (
          <div className="row gap-3">
            <RoundTimer
              startedAt={currentRound.startedAt}
              durationSec={timerSec}
              extendedMs={currentRound.extendedMs ?? 0}
            />
            {!presentasjon && (
              <button className="btn btn-ghost" disabled={busy} onClick={addMinute}>
                {busy ? <span className="spin" /> : no.host.addMinute}
              </button>
            )}
          </div>
        )}
        <span className="grow" />
        <JoinChip pin={tournament.joinPin} />
        {!presentasjon && (
          <>
            <button type="button" className="btn btn-ghost" onClick={() => setShowNotes(true)}>
              <Icon name="edit" size={16} /> {no.host.editNotes}
            </button>
            <button className="btn btn-ghost" onClick={() => setShowCodes(true)}>
              {no.host.showCodes}
            </button>
          </>
        )}
      </header>

      <div className="board-grid split-league tv-grid">
        {/* Standings */}
        <section
          className="card tv-card"
          style={presentasjon ? ({ ["--rows"]: tvStandingRows } as CSSProperties) : undefined}
        >
          <h2 className="card-title">{no.host.standings}</h2>
          <StandingsTable
            standings={standings}
            teamById={teamById}
            limit={presentasjon ? TV_STANDINGS_MAX : undefined}
          />

          {/* lagstilling — sum of each team's player scores */}
          {teamRows.length > 0 && (
            <div className="stack gap-2 mt-5">
              <p className="eyebrow">{no.teams.standings}</p>
              <div className="stack gap-2">
                {teamRows.map((r, i) => (
                  <div className="spread side-row" key={r.team}>
                    <span className="row gap-2">
                      <span className="muted">{i + 1}.</span>
                      <span className="team-chip">
                        <span className="team-dot" style={{ background: teamColor(r.team) }} />
                        {r.team}
                      </span>
                      <span className="faint fs-xs">
                        {r.players} {no.teams.members}
                      </span>
                    </span>
                    <b className="gold-num">{r.score}</b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* tipping leaderboard — appears once anyone has earned a point */}
          {(tipping?.length ?? 0) > 0 && (
            <div className="stack gap-2 mt-5">
              <p className="eyebrow"><Icon name="target" size={14} /> {no.predict.leaderboard}</p>
              <div className="stack gap-1">
                {(tipping ?? []).slice(0, presentasjon ? 3 : 5).map((t, i) => (
                  <div className="spread side-row" key={t.playerId}>
                    <span>
                      <span className="muted">{i + 1}.</span>{" "}
                      {nameById(t.playerId)}
                    </span>
                    <b className="gold-num">
                      {t.points} {no.predict.points}
                    </b>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Absent/left players — collapsed out of the way; "Ta inn igjen"
              is the only way back in, and only takes effect next round. */}
          {!presentasjon && leftPlayers.length > 0 && (
            <details className="stack mt-5">
              <summary className="eyebrow summary-pointer">
                {no.host.outOfTournamentSection(leftPlayers.length)}
              </summary>
              <div className="stack gap-2 mt-2">
                {leftPlayers.map((p) => (
                  <div className="spread side-row" key={p.id}>
                    <span className="muted">{p.displayName}</span>
                    <button
                      className="btn btn-ghost"
                      disabled={busy}
                      onClick={() => setReinstateTarget({ id: p.id, name: p.displayName })}
                    >
                      {no.host.reinstate}
                    </button>
                  </div>
                ))}
              </div>
            </details>
          )}
        </section>

        {/* Games grid */}
        <section
          className="card tv-card tv-games"
          style={presentasjon ? ({ ["--rows"]: tvGameRows } as CSSProperties) : undefined}
        >
          <div className="spread mb-3">
            <h2 className="card-title">{no.host.games}</h2>
            <span className="badge">
              {roundGames.length - liveCount} / {roundGames.length}
            </span>
          </div>

          <div className="stack gap-3">
            {shownGames.map((g) => (
              <GameRow
                key={g.id}
                className={`spread game-row${
                  presentasjon || g.status === "bye" || g.blackPlayerId === null ? " is-static" : ""
                }`}
                onClick={
                  presentasjon
                    ? undefined
                    : () => g.blackPlayerId !== null && g.status !== "bye" && setOverrideGame(g)
                }
              >
                <span className="game-row-names">
                  <b>{nameById(g.whitePlayerId)}</b>
                  {g.blackPlayerId ? (
                    <>
                      {" "}
                      <span className="muted">{no.player.vs}</span>{" "}
                      <b>{nameById(g.blackPlayerId)}</b>
                    </>
                  ) : null}
                </span>
                <span
                  className={`badge ${g.status === "live" ? "badge-live" : "badge-done"}`}
                >
                  {resultLabel(g, nameById)}
                  {/* Fair-play readout — only ever set for a decided game whose
                      result wasn't ordinary play (walkover/override/timeout/absent). */}
                  {g.resultSource && resultSourceLabel(g.resultSource) && (
                    <span
                      className="result-marker"
                      title={no.host.resultSourceTitle[g.resultSource] ?? ""}
                    >
                      {resultSourceLabel(g.resultSource)}
                    </span>
                  )}
                </span>
              </GameRow>
            ))}
          </div>

          {presentasjon && roundGames.length > shownGames.length && (
            <p className="tiebreak-note">
              +{roundGames.length - shownGames.length} {no.host.moreRows}
            </p>
          )}

          {!presentasjon && timeUp && liveCount > 0 && (
            <div className="banner timeup-banner">
              <span><Icon name="alarm" size={16} /> {no.host.timeUpSuggestion}</span>
              <button className="btn btn-danger" disabled={busy} onClick={requestForce}>
                {busy ? <span className="spin" /> : no.host.endRound}
              </button>
            </div>
          )}

          {!presentasjon && (
            <>
              <div className="round-actions">
                <button
                  className="btn btn-primary"
                  disabled={busy || !allResolved}
                  onClick={advance}
                >
                  {busy ? <span className="spin" /> : isLastRound ? "Fullfør" : no.host.nextRound}
                </button>
                {/* Finish early: only makes sense while there's still a round left
                    to skip — once this IS the last configured round, "Fullfør"
                    above already does the same thing. */}
                {!isLastRound && (
                  <button className="btn btn-ghost" disabled={busy} onClick={requestFinishEarly}>
                    {no.host.finishEarly}
                  </button>
                )}
                {liveCount > 0 && (
                  <button className="btn btn-ghost" disabled={busy} onClick={requestForce}>
                    {busy ? <span className="spin" /> : no.host.forceResolve}
                  </button>
                )}
              </div>
              <div className="round-help">
                {!allResolved && <p>{no.host.nextRoundHelp}</p>}
                {liveCount > 0 && <p>{no.host.forceResolveHelp}</p>}
              </div>
            </>
          )}
          {!presentasjon && error && <div className="banner banner-error mt-3">{error}</div>}
        </section>
      </div>

      {!presentasjon && overrideGame && (
        <OverrideModal
          gameId={overrideGame.id}
          hostCode={hostCode ?? ""}
          white={{ id: overrideGame.whitePlayerId, name: nameById(overrideGame.whitePlayerId) }}
          black={
            overrideGame.blackPlayerId
              ? { id: overrideGame.blackPlayerId, name: nameById(overrideGame.blackPlayerId) }
              : null
          }
          onClose={() => setOverrideGame(null)}
          onDone={() => {
            setOverrideGame(null);
            onChanged();
          }}
        />
      )}

      {!presentasjon && showCodes && (
        <CodesModal
          tournamentId={tournament.id}
          hostCode={hostCode ?? ""}
          onClose={() => setShowCodes(false)}
        />
      )}

      {!presentasjon && showNotes && (
        <NotesModal
          tournamentId={tournament.id}
          hostCode={hostCode ?? ""}
          onClose={() => setShowNotes(false)}
          onSaved={onChanged}
        />
      )}

      <FullscreenToggle />

      {!presentasjon && confirmForce && (
        <ConfirmDialog
          message={no.host.forceResolveConfirm}
          confirmLabel={no.host.forceResolve}
          danger
          onConfirm={force}
          onCancel={() => setConfirmForce(false)}
        />
      )}

      {!presentasjon && confirmFinishEarly && (
        <ConfirmDialog
          message={no.host.finishEarlyConfirm(tournament.currentRound)}
          confirmLabel={no.host.finishEarly}
          onConfirm={finishEarly}
          onCancel={() => setConfirmFinishEarly(false)}
        />
      )}

      {!presentasjon && reinstateTarget && (
        <ConfirmDialog
          message={no.host.reinstateConfirm(reinstateTarget.name)}
          confirmLabel={no.host.reinstate}
          onConfirm={() => {
            const id = reinstateTarget.id;
            setReinstateTarget(null);
            reinstate(id);
          }}
          onCancel={() => setReinstateTarget(null)}
        />
      )}
    </main>
  );
}
