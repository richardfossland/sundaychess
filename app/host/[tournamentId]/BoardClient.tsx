"use client";

import { useState } from "react";
import { useBoardState } from "@/lib/client/useBoardState";
import { no } from "@/lib/locale/no";
import { LobbyView } from "./LobbyView";
import { LeagueView } from "./LeagueView";
import { BracketView } from "./BracketView";
import { FinishedView } from "./FinishedView";
import { LiveGamesView } from "./LiveGamesView";

export function BoardClient({ tournamentId }: { tournamentId: string }) {
  const { state, error, refresh } = useBoardState(tournamentId);
  const [mode, setMode] = useState<"board" | "live">("board");

  if (error) {
    return (
      <main className="center-screen">
        <div className="banner banner-error">{no.common.error}</div>
      </main>
    );
  }
  if (!state) {
    return (
      <main className="center-screen">
        <span className="spin" />
      </main>
    );
  }

  const status = state.tournament.status;
  const liveable = status === "league" || status === "playoff";

  const view =
    liveable && mode === "live" ? (
      <LiveGamesView state={state} />
    ) : status === "league" ? (
      <LeagueView state={state} onChanged={refresh} />
    ) : status === "playoff" ? (
      <BracketView state={state} onChanged={refresh} />
    ) : status === "finished" ? (
      <FinishedView state={state} />
    ) : (
      <LobbyView state={state} onChanged={refresh} />
    );

  return (
    <>
      {liveable && (
        <div
          className="row"
          style={{ position: "fixed", top: 16, right: 20, zIndex: 40, gap: 4 }}
        >
          <button
            className={`btn ${mode === "board" ? "btn-primary" : "btn-ghost"}`}
            style={{ padding: "8px 14px" }}
            onClick={() => setMode("board")}
          >
            {no.host.boardToggle}
          </button>
          <button
            className={`btn ${mode === "live" ? "btn-primary" : "btn-ghost"}`}
            style={{ padding: "8px 14px" }}
            onClick={() => setMode("live")}
          >
            ● {no.host.liveToggle}
          </button>
        </div>
      )}
      {view}
    </>
  );
}
