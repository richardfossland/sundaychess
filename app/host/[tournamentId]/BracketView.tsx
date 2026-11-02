"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { JoinChip } from "@/lib/client/JoinChip";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { useCountdown } from "@/lib/client/useCountdown";
import { ConfirmDialog } from "@/lib/client/ConfirmDialog";
import { FullscreenToggle } from "@/lib/client/FullscreenToggle";
import { sortBySlot } from "@/lib/tournament/bracket";
import { roundTimerEndMs } from "@/lib/tournament/roundTimer";
import { BracketBoard } from "@/lib/client/BracketBoard";
import { OverrideModal } from "./OverrideModal";
import { CodesModal } from "./CodesModal";
import { Icon } from "@/lib/client/Icon";
import { effectiveHostCode, usePresentasjon } from "@/lib/client/storskjerm/usePresentasjon";

export function BracketView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players, games, rounds } = state;
  // Tavlevisning (projektor/cast): ingen arrangørkontroller, ingen modaler.
  const presentasjon = usePresentasjon();
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overrideGame, setOverrideGame] = useState<PublicGame | null>(null);
  const [showCodes, setShowCodes] = useState(false);
  const [confirmForce, setConfirmForce] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHostCode(effectiveHostCode(identity.hostCode(tournament.id), presentasjon));
  }, [tournament.id, presentasjon]);

  const player = useMemo(() => {
    const byId = new Map(players.map((p) => [p.id, p]));
    return (id: string | null) => (id ? byId.get(id) : null);
  }, [players]);

  const columns = useMemo(() => {
    const pr = rounds
      .filter((r) => r.phase === "playoff")
      .sort((a, b) => a.number - b.number);
    return pr.map((r) => ({
      round: r,
      // slot order = bracket structure (fetch order shifts as games resolve)
      games: sortBySlot(games.filter((g) => g.roundId === r.id)),
    }));
  }, [rounds, games]);

  const currentCol = columns.find(
    (c) => c.round.number === tournament.currentRound,
  );
  const liveCount = currentCol?.games.filter((g) => g.status === "live").length ?? 0;
  const allResolved =
    (currentCol?.games.length ?? 0) > 0 && liveCount === 0;
  // A slot is "undecided" when none of its games has a decisive result (a draw,
  // with no rematch winner yet). When the round is resolved but a slot is still
  // undecided, the teacher must pick: play a rematch, or send the higher seed on.
  const DECISIVE = new Set(["white_win", "black_win", "bye"]);
  const hasUndecidedDraw =
    allResolved &&
    [...new Set((currentCol?.games ?? []).map((g) => g.slot ?? 0))].some(
      (s) =>
        !(currentCol?.games ?? [])
          .filter((g) => (g.slot ?? 0) === s)
          .some((g) => DECISIVE.has(g.status)),
    );
  // The final is the round with a single matchup. Count distinct bracket slots,
  // not games, so a drawn final that spawned a tiebreak rematch still counts.
  const isFinal =
    currentCol != null &&
    currentCol.games.length > 0 &&
    new Set(currentCol.games.map((g) => g.slot ?? 0)).size === 1;

  const timerSec = tournament.config.roundTimerSec;
  const timerEndMs = roundTimerEndMs(currentCol?.round, timerSec);
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

  async function force() {
    if (!hostCode) return setError(no.host.missingHostCode);
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

  async function advance(tiebreak?: "rematch" | "ranking") {
    if (!hostCode) return setError(no.host.missingHostCode);
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const res = await api.advanceRound(tournament.id, hostCode ?? "", tiebreak);
      // A "rematch" choice on a drawn slot spawns a live rematch — tell the
      // teacher it's now being played (the round stays live until it finishes).
      if (res.status === "tiebreak") setNotice(no.host.rematchStarted);
      onChanged();
    } catch {
      setError(no.common.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={`wrap host-main${presentasjon ? " tv-bracket" : ""}`}>
      <header className={presentasjon ? "spread host-head-tv" : "host-sub"}>
        {presentasjon && (
          <>
            <span className="brandmark">
              <span className="knight">♞</span> Sunday<b>Chess</b>
            </span>
            <span className="badge badge-live">{no.host.bracket}</span>
          </>
        )}
        {timerSec && currentCol?.round.startedAt && liveCount > 0 && (
          <div className="row gap-3">
            <RoundTimer
              startedAt={currentCol.round.startedAt}
              durationSec={timerSec}
              extendedMs={currentCol.round.extendedMs ?? 0}
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
          <button className="btn btn-ghost" onClick={() => setShowCodes(true)}>
            {no.host.showCodes}
          </button>
        )}
        {presentasjon && tournament.title && <span className="muted">{tournament.title}</span>}
      </header>

      <BracketBoard
        games={games}
        rounds={rounds}
        players={players}
        onPick={presentasjon ? undefined : (g) => setOverrideGame(g)}
        fit={presentasjon}
      />

      {!presentasjon && timeUp && liveCount > 0 && (
        <div className="banner timeup-banner bracket-note">
          <span><Icon name="alarm" size={16} /> {no.host.timeUpSuggestion}</span>
          <button className="btn btn-danger" disabled={busy} onClick={() => setConfirmForce(true)}>
            {busy ? <span className="spin" /> : no.host.endRound}
          </button>
        </div>
      )}

      {!presentasjon && (
        <>
        <div className="row bracket-actions">
          {hasUndecidedDraw ? (
            <>
              <button className="btn grow" disabled={busy} onClick={() => advance("rematch")}>
                {busy ? <span className="spin" /> : <><Icon name="versus" size={16} /> {no.host.playRematch}</>}
              </button>
              <button
                className="btn btn-primary grow"
                disabled={busy}
                onClick={() => advance("ranking")}
              >
                {busy ? <span className="spin" /> : <><Icon name="cup" size={16} /> {no.host.advanceBySeed}</>}
              </button>
            </>
          ) : (
            <button
              className="btn btn-primary grow"
              disabled={busy || !allResolved}
              onClick={() => advance()}
            >
              {busy ? <span className="spin" /> : isFinal ? no.host.crownChampion : no.host.nextRound}
            </button>
          )}
        </div>
        {hasUndecidedDraw ? (
          <p className="muted round-note bracket-note">
            {no.host.drawChoiceHint}
          </p>
        ) : (
          !allResolved && (
            <p className="muted round-note">
              {no.host.awaitAllGames}
            </p>
          )
        )}
        {notice && <div className="banner banner-wait bracket-note mt-3">{notice}</div>}
        {error && <div className="banner banner-error bracket-note mt-3">{error}</div>}
        </>
      )}

      {!presentasjon && showCodes && (
        <CodesModal
          tournamentId={tournament.id}
          hostCode={hostCode ?? ""}
          onClose={() => setShowCodes(false)}
        />
      )}

      {!presentasjon && overrideGame && (
        <OverrideModal
          gameId={overrideGame.id}
          hostCode={hostCode ?? ""}
          white={{ id: overrideGame.whitePlayerId, name: player(overrideGame.whitePlayerId)?.displayName ?? "?" }}
          black={
            overrideGame.blackPlayerId
              ? { id: overrideGame.blackPlayerId, name: player(overrideGame.blackPlayerId)?.displayName ?? "?" }
              : null
          }
          onClose={() => setOverrideGame(null)}
          allowAbort={false}
          onDone={() => {
            setOverrideGame(null);
            onChanged();
          }}
        />
      )}

      {!presentasjon && confirmForce && (
        <ConfirmDialog
          message={no.host.forceResolveConfirm}
          danger
          onConfirm={() => {
            setConfirmForce(false);
            force();
          }}
          onCancel={() => setConfirmForce(false)}
        />
      )}

      <FullscreenToggle />
    </main>
  );
}
