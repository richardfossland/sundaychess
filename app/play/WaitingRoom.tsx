"use client";

import { useEffect, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { useBoardState } from "@/lib/client/useBoardState";
import { identity, type StoredPlayer } from "@/lib/client/identity";
import { initials } from "@/lib/client/Confetti";
import { no } from "@/lib/locale/no";
import { GameView } from "./GameView";

/** Find the player's most relevant game in the current board state. */
function myGame(state: BoardState, playerId: string): PublicGame | null {
  const mine = state.games.filter(
    (g) => g.whitePlayerId === playerId || g.blackPlayerId === playerId,
  );
  if (mine.length === 0) return null;
  return mine.find((g) => g.status === "live") ?? mine[mine.length - 1];
}

export function WaitingRoom({
  me,
  onLeave,
}: {
  me: StoredPlayer;
  onLeave: () => void;
}) {
  const [showCode, setShowCode] = useState(false);
  // Latch the active game so the result screen survives board refetches until
  // the student dismisses it.
  const [activeGameId, setActiveGameId] = useState<string | null>(null);
  const { state, refresh } = useBoardState(me.tournamentId);

  const game = state ? myGame(state, me.playerId) : null;
  const status = state?.tournament.status ?? "lobby";

  useEffect(() => {
    if (game?.status === "live" && activeGameId !== game.id) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setActiveGameId(game.id);
    }
  }, [game, activeGameId]);

  if (activeGameId) {
    // Round timer (league rounds only) — fed to the player's board.
    const activeGame = state?.games.find((g) => g.id === activeGameId);
    const activeRound = activeGame
      ? state?.rounds.find((r) => r.id === activeGame.roundId)
      : null;
    const timerSec = state?.tournament.config.roundTimerSec ?? null;
    const timer =
      timerSec && activeRound?.phase === "league" && activeRound.startedAt
        ? { startedAt: activeRound.startedAt, durationSec: timerSec }
        : null;
    return (
      <GameView
        me={me}
        gameId={activeGameId}
        timer={timer}
        onFinished={() => {
          setActiveGameId(null);
          refresh();
        }}
      />
    );
  }

  let banner: string = no.player.waitingStart;
  if (status !== "lobby") {
    if (game?.status === "bye") banner = no.player.waitingBye;
    else if (status === "finished") banner = "Turneringen er ferdig 🏆";
    else banner = no.player.waitingNext;
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center scale-in" style={{ alignItems: "center" }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>
        <div className="avatar-lg float" style={{ width: 64, height: 64, fontSize: 22, marginTop: 4 }}>
          {initials(me.displayName)}
        </div>
        <h2 style={{ fontSize: 26 }}>{me.displayName}</h2>

        <div className="banner banner-wait" style={{ marginTop: 2, width: "100%" }}>
          <span
            className="spin"
            style={{ display: "inline-block", verticalAlign: "middle", marginRight: 10 }}
          />
          {banner}
        </div>

        {showCode ? (
          <div className="big-code">{me.resumeCode}</div>
        ) : (
          <button className="btn btn-ghost" onClick={() => setShowCode(true)}>
            Vis koden min
          </button>
        )}
        <p className="muted" style={{ fontSize: 12 }}>
          {no.player.resumeHint}
        </p>

        <button
          className="btn btn-ghost"
          style={{ marginTop: 8 }}
          onClick={() => {
            identity.clearPlayer();
            onLeave();
          }}
        >
          Logg ut
        </button>
      </div>
    </main>
  );
}
