// `.sundaychess.json`: hendelsesloggen er sannhetskilden; `snapshot` er avledet og bare til
// lesing for mennesker (og til kryssjekk ved import). `sha256` dekker kanonisk JSON av loggen.

import pkg from "@/package.json";
import type { PhysicalEvent, PhysicalTournament } from "@/lib/physical/schema";
import { SCHEMA_VERSION } from "@/lib/physical/schema";
import { standings } from "@/lib/physical/selectors";
import { canonicalJson, sha256Hex } from "./hash";

export const FILE_FORMAT = "sundaychess-tournament" as const;
export const FILE_EXT = ".sundaychess.json";

export interface TournamentFile {
  format: typeof FILE_FORMAT;
  schemaVersion: number;
  exportedAt: string;
  app: { name: "sundaychess"; version: string };
  tournament: {
    id: string;
    title: string;
    createdAt: string;
    /** Sannhetskilden. */
    events: PhysicalEvent[];
    /** Avledet (replay) – kun for lesbarhet og kryssjekk. */
    snapshot: Snapshot;
  };
  /** SHA-256 (hex) over canonicalJson(tournament.events). */
  sha256: string;
}

export interface Snapshot {
  status: PhysicalTournament["status"];
  settings: PhysicalTournament["settings"];
  players: PhysicalTournament["players"];
  rounds: PhysicalTournament["rounds"];
  byeRequests: PhysicalTournament["byeRequests"];
  standings: { rank: number; playerId: string; name: string; score: number }[];
}

export const hashEvents = (events: readonly PhysicalEvent[]) => sha256Hex(canonicalJson(events));

export function snapshotOf(t: PhysicalTournament): Snapshot {
  return {
    status: t.status,
    settings: t.settings,
    players: t.players,
    rounds: t.rounds,
    byeRequests: t.byeRequests,
    standings: standings(t).map((r) => ({ rank: r.rank, playerId: r.playerId, name: r.player.name, score: r.score })),
  };
}

export async function buildTournamentFile(t: PhysicalTournament, now = new Date().toISOString()): Promise<TournamentFile> {
  return {
    format: FILE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now,
    app: { name: "sundaychess", version: pkg.version },
    tournament: { id: t.id, title: t.title, createdAt: t.createdAt, events: t.events, snapshot: snapshotOf(t) },
    sha256: await hashEvents(t.events),
  };
}

export async function tournamentFileText(t: PhysicalTournament, now?: string): Promise<string> {
  return JSON.stringify(await buildTournamentFile(t, now), null, 2) + "\n";
}
