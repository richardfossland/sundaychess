"use client";

import { useEffect, useState } from "react";
import type { BoardState, PublicGame } from "@/lib/dto";
import { useBoardState } from "@/lib/client/useBoardState";
import { identity, type StoredPlayer } from "@/lib/client/identity";
import { initials } from "@/lib/client/Confetti";
import { PuzzleCard } from "@/lib/client/PuzzleCard";
import { PredictPanel } from "@/lib/client/PredictPanel";
import { variantStartFen } from "@/lib/chess/variants";
import { computeTeamStandings, teamColor } from "@/lib/tournament/teams";
import { no } from "@/lib/locale/no";
import { GameView } from "./GameView";

/** The player's own end-of-tournament card: placement, top 3, winning team. */
function FinalResults({ state, playerId }: { state: BoardState; playerId: string }) {
  const { standings, tournament, players } = state;
  const mine = standings.find((s) => s.playerId === playerId);
  const top = standings.slice(0, 3);
  const medals = ["🥇", "🥈", "🥉"];
  const teamRows = computeTeamStandings(tournament.config.teams ?? [], players);

  return (
    <div className="card stack" style={{ padding: 18, width: "100%", maxWidth: 420, gap: 10 }}>
      <p className="eyebrow" style={{ fontSize: 11 }}>🏁 {no.player.finalTitle}</p>
      {mine && (
        <p style={{ fontSize: 17 }}>
          {no.player.youPlaced} <b style={{ color: "var(--gold)", fontSize: 22 }}>{mine.rank}</b>{" "}
          {no.player.of} {standings.length} · {mine.score} {no.host.score.toLowerCase()}
        </p>
      )}
      <div className="stack" style={{ gap: 4 }}>
        {top.map((s, i) => (
          <div
            className="spread"
            key={s.playerId}
            style={{ fontSize: 14, fontWeight: s.playerId === playerId ? 700 : 400 }}
          >
            <span>
              {medals[i]} {s.displayName}
            </span>
            <span className="muted">{s.score}</span>
          </div>
        ))}
      </div>
      {teamRows.length > 0 && (
        <div className="spread" style={{ marginTop: 4 }}>
          <span className="muted" style={{ fontSize: 13 }}>{no.teams.winner}</span>
          <span className="team-chip">
            <span className="team-dot" style={{ background: teamColor(teamRows[0].team) }} />
            🏆 {teamRows[0].team} · <b>{teamRows[0].score}</b>
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
      timerSec && activeRound?.startedAt
        ? {
            startedAt: activeRound.startedAt,
            durationSec: timerSec,
            extendedMs: activeRound.extendedMs ?? 0,
          }
        : null;
    return (
      <GameView
        me={me}
        gameId={activeGameId}
        timer={timer}
        reactionsEnabled={state?.tournament.config.reactions === true}
        variantFen={variantStartFen(state?.tournament.config.variant)}
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

  const myTeam =
    state?.players.find((p) => p.id === me.playerId)?.team ?? null;

  return (
    <main className="center-screen">
      <div className="stack" style={{ alignItems: "center", gap: 16, width: "100%", maxWidth: 450 }}>
      <div className="card card-narrow stack text-center scale-in" style={{ alignItems: "center" }}>
        <div className="brandmark" style={{ justifyContent: "center" }}>
          <span className="knight">♞</span> Sunday<b>Chess</b>
        </div>
        <div className="avatar-lg float" style={{ width: 64, height: 64, fontSize: 22, marginTop: 4 }}>
          {initials(me.displayName)}
        </div>
        <h2 style={{ fontSize: 26 }}>{me.displayName}</h2>
        {myTeam && (
          <span className="team-chip" style={{ fontSize: 13 }}>
            <span className="team-dot" style={{ background: teamColor(myTeam) }} />
            {no.teams.yourTeam} {myTeam}
          </span>
        )}

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

      {/* the player's own final standings once it's all over */}
      {state && status === "finished" && (
        <FinalResults state={state} playerId={me.playerId} />
      )}

      {/* something to chew on while waiting */}
      {state && status !== "lobby" && status !== "finished" && (
        <PredictPanel me={me} state={state} />
      )}
      <PuzzleCard />
      </div>
    </main>
  );
}
