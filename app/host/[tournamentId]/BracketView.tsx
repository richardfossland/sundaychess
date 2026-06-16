"use client";

import { useEffect, useMemo, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { api } from "@/lib/client/api";
import { identity } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";
import { JoinChip } from "@/lib/client/JoinChip";
import { RoundTimer } from "@/lib/client/RoundTimer";
import { sortBySlot } from "@/lib/tournament/bracket";
import { OverrideModal } from "./OverrideModal";
import { CodesModal } from "./CodesModal";

function winnerId(g: PublicGame): string | null {
  if (g.status === "white_win") return g.whitePlayerId;
  if (g.status === "black_win") return g.blackPlayerId;
  return null;
}

export function BracketView({
  state,
  onChanged,
}: {
  state: BoardState;
  onChanged: () => void;
}) {
  const { tournament, players, games, rounds } = state;
  const [hostCode, setHostCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overrideGame, setOverrideGame] = useState<PublicGame | null>(null);
  const [showCodes, setShowCodes] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHostCode(identity.hostCode(tournament.id));
  }, [tournament.id]);

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

  const slot = (g: PublicGame, side: "white" | "black") => {
    const id = side === "white" ? g.whitePlayerId : g.blackPlayerId;
    const p = player(id);
    const won = winnerId(g) === id && id !== null;
    return (
      <div className={`bracket-slot ${won ? "win" : ""} ${p ? "" : "tbd"}`}>
        <span>
          {p?.seed != null && <span className="seed">{p.seed}</span>} {p?.displayName ?? "—"}
        </span>
        {won && <span>✓</span>}
      </div>
    );
  };

  return (
    <main className="wrap" style={{ padding: "28px 24px 64px" }}>
      <header className="spread" style={{ marginBottom: 24 }}>
        <span className="brandmark">
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </span>
        <span className="badge badge-live">{no.host.bracket}</span>
        {timerSec && currentCol?.round.startedAt && liveCount > 0 && (
          <div className="row" style={{ gap: 10 }}>
            <RoundTimer
              startedAt={currentCol.round.startedAt}
              durationSec={timerSec}
              extendedMs={currentCol.round.extendedMs ?? 0}
            />
            <button
              className="btn btn-ghost"
              style={{ padding: "8px 12px" }}
              disabled={busy}
              onClick={addMinute}
            >
              {busy ? <span className="spin" /> : no.host.addMinute}
            </button>
          </div>
        )}
        <span className="grow" />
        <JoinChip pin={tournament.joinPin} />
        <button className="btn btn-ghost" onClick={() => setShowCodes(true)}>
          {no.host.showCodes}
        </button>
        {tournament.title && <span className="muted">{tournament.title}</span>}
      </header>

      <div className="bracket">
        {columns.map((col) => {
          // Games sharing a slot in a column = an original draw + its tiebreak
          // rematch. Count by slot so the header and badges read correctly.
          const slotCounts = new Map<number, number>();
          for (const g of col.games) {
            const s = g.slot ?? 0;
            slotCounts.set(s, (slotCounts.get(s) ?? 0) + 1);
          }
          return (
            <div className="bracket-col" key={col.round.id}>
              <h3>
                {slotCounts.size === 1
                  ? "Finale"
                  : `${no.host.round} ${col.round.number}`}
              </h3>
              {col.games.map((g) => {
                const isTiebreak = (slotCounts.get(g.slot ?? 0) ?? 0) > 1;
                return (
                  <div
                    className="bracket-match"
                    key={g.id}
                    onClick={() => g.status !== "bye" && setOverrideGame(g)}
                  >
                    {isTiebreak && (
                      <span className="badge" style={{ fontSize: 10 }}>
                        ⚔︎ {no.host.replay}
                      </span>
                    )}
                    {slot(g, "white")}
                    {slot(g, "black")}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 24, maxWidth: 480 }}>
        {hasUndecidedDraw ? (
          <>
            <button className="btn grow" disabled={busy} onClick={() => advance("rematch")}>
              {busy ? <span className="spin" /> : `⚔︎ ${no.host.playRematch}`}
            </button>
            <button
              className="btn btn-primary grow"
              disabled={busy}
              onClick={() => advance("ranking")}
            >
              {busy ? <span className="spin" /> : `🏆 ${no.host.advanceBySeed}`}
            </button>
          </>
        ) : (
          <button
            className="btn btn-primary grow"
            disabled={busy || !allResolved}
            onClick={() => advance()}
          >
            {busy ? <span className="spin" /> : isFinal ? "Kår mester" : no.host.nextRound}
          </button>
        )}
      </div>
      {hasUndecidedDraw ? (
        <p className="muted" style={{ fontSize: 13, marginTop: 8, maxWidth: 480 }}>
          {no.host.drawChoiceHint}
        </p>
      ) : (
        !allResolved && (
          <p className="muted" style={{ fontSize: 13, marginTop: 8 }}>
            Alle partier i runden må være ferdige.
          </p>
        )
      )}
      {notice && <div className="banner banner-wait" style={{ marginTop: 10, maxWidth: 480 }}>{notice}</div>}
      {error && <div className="banner banner-error" style={{ marginTop: 10, maxWidth: 480 }}>{error}</div>}

      {showCodes && (
        <CodesModal
          tournamentId={tournament.id}
          hostCode={hostCode ?? ""}
          onClose={() => setShowCodes(false)}
        />
      )}

      {overrideGame && (
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
    </main>
  );
}
