// Les og valider en `.sundaychess.json`. Hendelsesloggen er sannhetskilden: den spilles av
// gjennom reduceren (som validerer HVER hendelse på nytt), og oppsummeringen i fila
// kryssjekkes mot resultatet. Norske, konkrete feilmeldinger.

import { FILE_FORMAT, hashEvents, snapshotOf, type TournamentFile } from "@/lib/export/json";
import { canonicalJson } from "@/lib/export/hash";
import { no } from "@/lib/locale/no";
import { PhysicalError } from "@/lib/physical/errors";
import { reduce } from "@/lib/physical/reducer";
import type { PhysicalEvent, PhysicalTournament } from "@/lib/physical/schema";
import { ImportError, migrateFile } from "./migrate";

export const MAX_FILE_CHARS = 25_000_000;

export interface RematchIssue {
  a: string;
  b: string;
  rounds: number[];
}

export interface ParsedFile {
  tournament: PhysicalTournament;
  file: TournamentFile;
  /** SHA-256 i fila stemmer med hendelsene slik de står i fila. */
  hashOk: boolean;
  /** Oppsummeringen («snapshot») stemmer med replay. */
  snapshotOk: boolean;
  /** Gjentatte parringer som ikke er merket som omkamp/manuelle. */
  rematches: RematchIssue[];
  /** Importen krever eksplisitt bekreftelse (endret fil). */
  needsConfirm: boolean;
}

export type ParseResult = ({ ok: true } & ParsedFile) | { ok: false; error: string };

/** Replay med indeks på feilende hendelse. */
export function replayChecked(events: PhysicalEvent[]): PhysicalTournament {
  let t: PhysicalTournament | null = null;
  for (let i = 0; i < events.length; i++) {
    const ev = events[i];
    try {
      t = reduce(t, ev);
    } catch (err) {
      const why = err instanceof PhysicalError ? err.message : no.physical.errors.badEvent;
      const type = typeof ev?.type === "string" ? ev.type : "?";
      throw new ImportError(no.physical.file.errors.eventFailed(i + 1, type, why));
    }
  }
  return t as PhysicalTournament;
}

export function findRematches(t: PhysicalTournament): RematchIssue[] {
  if (t.settings.system === "knockout" || t.settings.doubleRoundRobin) return [];
  const seen = new Map<string, { a: string; b: string; rounds: number[]; flagged: boolean }>();
  for (const r of t.rounds) {
    for (const p of r.pairings) {
      if (p.black === null) continue;
      const [a, b] = p.white < p.black ? [p.white, p.black] : [p.black, p.white];
      const k = `${a}|${b}`;
      const e = seen.get(k) ?? { a, b, rounds: [], flagged: false };
      if (e.rounds.length > 0 && (p.rematch || p.manual)) e.flagged = true;
      e.rounds.push(r.number);
      seen.set(k, e);
    }
  }
  const name = (id: string) => t.players.find((p) => p.id === id)?.name ?? id;
  return [...seen.values()]
    .filter((e) => e.rounds.length > 1 && !e.flagged)
    .map((e) => ({ a: name(e.a), b: name(e.b), rounds: e.rounds }));
}

function snapshotMatches(file: TournamentFile, t: PhysicalTournament): boolean {
  const snap = file.tournament.snapshot as unknown;
  if (snap === undefined || snap === null) return true; // valgfri; loggen er sannhetskilden
  if (typeof snap !== "object") return false;
  return canonicalJson(snap) === canonicalJson(snapshotOf(t));
}

export async function parseTournamentFile(text: string): Promise<ParseResult> {
  try {
    return { ok: true, ...(await parseOrThrow(text)) };
  } catch (e) {
    if (e instanceof ImportError) return { ok: false, error: e.message };
    return { ok: false, error: no.physical.file.errors.notJson };
  }
}

async function parseOrThrow(text: string): Promise<ParsedFile> {
  const e = no.physical.file.errors;
  if (typeof text !== "string" || !text.trim()) throw new ImportError(e.empty);
  if (text.length > MAX_FILE_CHARS) throw new ImportError(e.tooBig);
  let raw: unknown;
  try {
    raw = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    throw new ImportError(e.notJson);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || (raw as { format?: unknown }).format !== FILE_FORMAT) {
    throw new ImportError(e.notSundayChess);
  }
  const original = raw as Record<string, unknown>;

  // Hash sjekkes mot loggen SLIK DEN STÅR i fila, før en eventuell migrering endrer den.
  const origTournament = original.tournament as { events?: unknown } | undefined;
  if (!origTournament || !Array.isArray(origTournament.events) || origTournament.events.length === 0) throw new ImportError(e.noEvents);
  const hashOk = typeof original.sha256 === "string" && original.sha256 === (await hashEvents(origTournament.events as PhysicalEvent[]));

  const migrated = migrateFile(original) as unknown as TournamentFile;
  const events = migrated.tournament.events;
  const tournament = replayChecked(events);
  if (migrated.tournament.id !== undefined && migrated.tournament.id !== tournament.id) throw new ImportError(e.idMismatch);

  const snapshotOk = snapshotMatches(migrated, tournament);
  return {
    tournament,
    file: migrated,
    hashOk,
    snapshotOk,
    rematches: findRematches(tournament),
    needsConfirm: !hashOk || !snapshotOk,
  };
}
