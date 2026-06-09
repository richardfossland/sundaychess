"use client";

import { useBoardState } from "@/lib/client/useBoardState";
import { no } from "@/lib/locale/no";
import { LobbyView } from "./LobbyView";
import { LeagueView } from "./LeagueView";
import { BracketView } from "./BracketView";
import { FinishedView } from "./FinishedView";

export function BoardClient({ tournamentId }: { tournamentId: string }) {
  const { state, error, refresh } = useBoardState(tournamentId);

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

  switch (state.tournament.status) {
    case "league":
      return <LeagueView state={state} onChanged={refresh} />;
    case "playoff":
      return <BracketView state={state} onChanged={refresh} />;
    case "finished":
      return <FinishedView state={state} />;
    case "lobby":
    default:
      return <LobbyView state={state} onChanged={refresh} />;
  }
}
