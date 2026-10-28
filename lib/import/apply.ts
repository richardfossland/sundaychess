// Konfliktløsning og lagring ved import.

import { no } from "@/lib/locale/no";
import { newId } from "@/lib/physical/events";
import { replay } from "@/lib/physical/reducer";
import type { PhysicalEvent, PhysicalTournament } from "@/lib/physical/schema";
import { saveTournament, type PhysicalStore } from "@/lib/physical/storage";

export type ConflictKind = "none" | "same" | "localNewer" | "fileNewer" | "diverged";
export interface Conflict {
  kind: ConflictKind;
  /** Antall lokale hendelser utover fellesprefikset. */
  localExtra: number;
}

/** Sammenlign hendelsesloggene på hendelses-id (rekkefølge og innhold av id). */
export function classifyConflict(localEvents: readonly PhysicalEvent[] | null, fileEvents: readonly PhysicalEvent[]): Conflict {
  if (!localEvents) return { kind: "none", localExtra: 0 };
  let common = 0;
  while (common < localEvents.length && common < fileEvents.length && localEvents[common].id === fileEvents[common].id) common++;
  const localExtra = localEvents.length - common;
  const fileExtra = fileEvents.length - common;
  if (localExtra === 0 && fileExtra === 0) return { kind: "same", localExtra };
  if (fileExtra === 0) return { kind: "localNewer", localExtra };
  if (localExtra === 0) return { kind: "fileNewer", localExtra };
  return { kind: "diverged", localExtra };
}

/** Ny kopi: ny turnerings-id og tittel med «(kopi)». Hendelses-id-ene beholdes. */
export function asNewCopy(t: PhysicalTournament, id: string = newId()): PhysicalTournament {
  const suffix = no.physical.file.copySuffix;
  const [first, ...rest] = t.events;
  if (first.type !== "createTournament") return t;
  const title = `${first.title.slice(0, 80 - suffix.length)}${suffix}`;
  return replay([{ ...first, tournamentId: id, title }, ...rest]);
}

export type Resolution = "replace" | "copy";

/** Lagrer og returnerer id-en turneringen ble lagret under. Kaster Error hvis lagringen feiler. */
export async function saveImported(store: PhysicalStore, t: PhysicalTournament, resolution: Resolution): Promise<string> {
  const toSave = resolution === "copy" ? asNewCopy(t) : t;
  if (!(await saveTournament(store, toSave))) throw new Error(no.physical.file.saveFailed);
  return toSave.id;
}
