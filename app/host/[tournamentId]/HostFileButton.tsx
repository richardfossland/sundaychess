"use client";

import { useState } from "react";
import type { BoardState } from "@/lib/dto";
import { downloadText, safeFileName } from "@/lib/export/download";
import { FILE_EXT, tournamentFileText } from "@/lib/export/json";
import { no } from "@/lib/locale/no";
import { buildPhysicalFromDigital } from "@/lib/physical/fromDigital";

/** «Last ned turneringsfil»: den digitale turneringen som fysisk hendelseslogg
 * (.sundaychess.json) som kan åpnes i fysisk modus og fortsettes over brettet. */
export function HostFileButton({ state }: { state: BoardState }) {
  const L = no.continueDigital;
  const [msg, setMsg] = useState<string | null>(null);

  async function download() {
    setMsg(null);
    const built = buildPhysicalFromDigital({
      tournament: { id: state.tournament.id, title: state.tournament.title, status: state.tournament.status, config: state.tournament.config },
      players: state.players.map((p) => ({
        id: p.id,
        displayName: p.displayName,
        status: p.status,
        rating: p.rating,
        club: p.club,
        startNo: p.startNo,
      })),
      rounds: state.rounds,
      games: state.games.map((g) => ({
        roundId: g.roundId,
        whitePlayerId: g.whitePlayerId,
        blackPlayerId: g.blackPlayerId,
        status: g.status,
        slot: g.slot,
        resultSource: g.resultSource,
      })),
    });
    if (!built.ok) return setMsg(L.downloadErrors[built.reason] ?? L.downloadErrors.failed);
    try {
      downloadText(safeFileName(built.tournament.title, FILE_EXT), await tournamentFileText(built.tournament), "application/json");
    } catch {
      setMsg(L.downloadErrors.failed);
    }
  }

  return (
    <span style={{ position: "relative" }}>
      <button type="button" className="btn btn-ghost" style={{ padding: "8px 14px" }} title={L.downloadTitle} data-testid="host-download-file" onClick={() => void download()}>
        {L.download}
      </button>
      {msg && (
        <span role="alert" className="banner banner-error" data-testid="host-download-error" style={{ position: "absolute", right: 0, top: "100%", width: 260, fontSize: "var(--fs-xs)" }}>
          {msg}
        </span>
      )}
    </span>
  );
}
