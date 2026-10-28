// Offentlig, avledet visning av en publisert fysisk turnering (M5a). Aldri
// arrangørkode, aldri rålogg. Brukes av GET /api/physical/[id] og testes rent.

import { totalRounds } from "./reducer";
import type { PhysicalTournament, ResultCode, RoundStatus } from "./schema";
import { standings } from "./selectors";

export interface PublicPairing {
  board: number;
  white: string;
  black: string | null;
  byeType?: "full" | "half" | "zero";
  result: ResultCode | null;
}

export interface PublicSnapshot {
  id: string;
  title: string;
  status: "running" | "finished";
  system: string;
  totalRounds: number;
  groupLabel: string | null;
  updatedAt: string;
  /** spillerid -> navn/klubb (kun det som vises offentlig). */
  players: { id: string; name: string; club: string | null; withdrawn: boolean }[];
  /** Bare publiserte og fullførte runder – utkast skjules. */
  rounds: { number: number; status: Exclude<RoundStatus, "draft">; pairings: PublicPairing[] }[];
  standings: { rank: number; playerId: string; name: string; club: string | null; score: number }[];
}

export function publicSnapshot(t: PhysicalTournament, updatedAt: string): PublicSnapshot {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    system: t.settings.system,
    totalRounds: totalRounds(t),
    groupLabel: t.settings.groupLabel ?? null,
    updatedAt,
    players: t.players.map((p) => ({ id: p.id, name: p.name, club: p.club ?? null, withdrawn: p.status === "withdrawn" })),
    rounds: t.rounds
      .filter((r): r is typeof r & { status: Exclude<RoundStatus, "draft"> } => r.status !== "draft")
      .map((r) => ({
        number: r.number,
        status: r.status,
        pairings: r.pairings.map((p) => ({
          board: p.board,
          white: p.white,
          black: p.black,
          ...(p.black === null ? { byeType: p.byeType ?? "full" } : {}),
          result: p.result ?? null,
        })),
      })),
    standings: standings(t, { includeOpen: true }).map((r) => ({
      rank: r.rank,
      playerId: r.playerId,
      name: r.player.name,
      club: r.player.club ?? null,
      score: r.score,
    })),
  };
}
