// Synkron journal: IndexedDB-skriving er asynkron og kan gå tapt hvis fanen lukkes/lastes om midt i
// skrivingen. Derfor speiles hver endring SYNKRONT til localStorage før den asynkrone skrivingen
// starter, og journalen ryddes når hovedlageret har bekreftet. Ved lasting vinner den nyeste av
// journal og lager (etter `updatedAt`). Alt er pakket i try/catch: mangler localStorage, hoppes det over.

import { fromStored } from "./storage";
import type { PhysicalTournament, StoredTournament } from "./schema";
import type { PhysicalStore } from "./storage";

const PREFIX = "sundaychess:physical-journal:";

export interface Journal {
  write(rec: StoredTournament): void;
  read(id: string): StoredTournament | null;
  clear(id: string): void;
}

type Kv = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function localJournal(storage?: Kv): Journal {
  const kv = (): Kv | null => {
    try {
      return storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
    } catch {
      return null;
    }
  };
  return {
    write(rec) {
      try {
        kv()?.setItem(PREFIX + rec.id, JSON.stringify(rec));
      } catch {
        /* full/blokkert: vi har fortsatt IndexedDB */
      }
    },
    read(id) {
      try {
        const v = JSON.parse(kv()?.getItem(PREFIX + id) ?? "null") as StoredTournament | null;
        return v && typeof v.id === "string" && Array.isArray(v.events) ? v : null;
      } catch {
        return null;
      }
    },
    clear(id) {
      try {
        kv()?.removeItem(PREFIX + id);
      } catch {
        /* ignorer */
      }
    },
  };
}

/** Den nyeste av lager og journal. */
export function newerOf(rec: StoredTournament | null, j: StoredTournament | null): StoredTournament | null {
  if (!j) return rec;
  if (!rec) return j;
  return j.updatedAt > rec.updatedAt ? j : rec;
}

/** Last en turnering fra lager + journal. Returnerer også om journalen vant (da bør lageret oppdateres). */
export async function loadWithJournal(
  store: PhysicalStore,
  journal: Journal,
  id: string,
): Promise<{ tournament: PhysicalTournament | null; recovered: boolean }> {
  let rec: StoredTournament | null = null;
  try {
    rec = await store.get(id);
  } catch {
    rec = null;
  }
  const j = journal.read(id);
  const pick = newerOf(rec, j);
  if (!pick) return { tournament: null, recovered: false };
  try {
    return { tournament: fromStored(pick), recovered: pick === j && j !== null };
  } catch (e) {
    // Skadet journal: prøv lageret alene.
    if (pick === j && rec) return { tournament: fromStored(rec), recovered: false };
    throw e;
  }
}
