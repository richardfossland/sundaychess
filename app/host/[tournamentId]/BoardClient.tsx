"use client";

import { useBoardState } from "@/lib/client/useBoardState";
import { no } from "@/lib/locale/no";
import { LobbyView } from "./LobbyView";

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

  // Phase 1 implements the lobby. League/playoff/finished views arrive in later
  // phases; until then they fall back to the lobby roster.
  switch (state.tournament.status) {
    case "lobby":
    default:
      return <LobbyView state={state} onChanged={refresh} />;
  }
}
