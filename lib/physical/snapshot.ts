// Offentlig, avledet visning av en publisert fysisk turnering (M5a). Aldri
// arrangørkode, aldri rålogg. Brukes av GET /api/physical/[id] og testes rent.

import { DEFAULT_PUBLIC_NAMES, type PublicNames } from "./cloudTypes";
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
  /** Hvilken navnepolicy som er brukt (for informasjon på siden). */
  names: PublicNames;
  standings: { rank: number; playerId: string; name: string; club: string | null; score: number }[];
}

/** «Ola Kristian Nordmann» -> «Ola N.»: fornavn + initial for etternavn. Ett ord beholdes. */
export function initialsName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length <= 1) return parts[0] ?? "";
  const last = parts[parts.length - 1];
  return `${parts[0]} ${last.charAt(0).toLocaleUpperCase("nb")}.`;
}

export interface SnapshotOptions {
  /** Id på den offentlige siden (skyens id; kan avvike fra den lokale turnerings-id). */
  id?: string;
  names?: PublicNames;
}

export function publicSnapshot(t: PhysicalTournament, updatedAt: string, opts: SnapshotOptions = {}): PublicSnapshot {
  const mode = opts.names ?? DEFAULT_PUBLIC_NAMES;
  const nm = (n: string) => (mode === "full" ? n : initialsName(n));
  const club = (c: string | undefined) => (mode === "full" ? c ?? null : null);
  return {
    id: opts.id ?? t.id,
    title: t.title,
    status: t.status,
    system: t.settings.system,
    totalRounds: totalRounds(t),
    groupLabel: mode === "full" ? t.settings.groupLabel ?? null : null,
    updatedAt,
    names: mode,
    players: t.players.map((p) => ({ id: p.id, name: nm(p.name), club: club(p.club), withdrawn: p.status === "withdrawn" })),
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
      name: nm(r.player.name),
      club: club(r.player.club),
      score: r.score,
    })),
  };
}
