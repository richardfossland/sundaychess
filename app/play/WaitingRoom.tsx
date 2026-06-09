"use client";

import { useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { useBoardState } from "@/lib/client/useBoardState";
import { identity, type StoredPlayer } from "@/lib/client/identity";
import { no } from "@/lib/locale/no";

/** Find the player's most relevant game in the current board state. */
function myGame(state: BoardState, playerId: string): PublicGame | null {
  const mine = state.games.filter(
    (g) => g.whitePlayerId === playerId || g.blackPlayerId === playerId,
  );
  if (mine.length === 0) return null;
  // Prefer a live game, else the most recent (last in updated order).
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
  const { state } = useBoardState(me.tournamentId);

  const game = state ? myGame(state, me.playerId) : null;
  const status = state?.tournament.status ?? "lobby";

  // In Phase 2 a live game routes into the playable board. For now show the
  // appropriate waiting state.
  let banner: string = no.player.waitingStart;
  if (status !== "lobby") {
    if (game?.status === "bye") banner = no.player.waitingBye;
    else if (game?.status === "live") banner = "Partiet ditt er klart.";
    else banner = no.player.waitingNext;
  }

  return (
    <main className="center-screen">
      <div className="card card-narrow stack text-center">
        <p className="eyebrow">SundaySjakk</p>
        <h2 style={{ fontSize: 28 }}>{me.displayName}</h2>

        <div className="banner banner-wait" style={{ marginTop: 4 }}>
          <span className="spin" style={{ display: "inline-block", verticalAlign: "middle", marginRight: 10 }} />
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
