// Serialisert autosave-kø. Lagring er asynkron (IndexedDB), så to raske hendelser kan ellers
// ende i feil rekkefølge eller bli tapt ved omlasting. Køen:
//  - skriver aldri to ganger samtidig (neste skrivning starter når forrige er ferdig),
//  - slår sammen ventende tilstander (bare den nyeste skrives),
//  - kan `flush()`es: ved visibilitychange/pagehide startes ventende skriving UMIDDELBART
//    (IndexedDB-transaksjoner på samme store kjøres i opprettelsesrekkefølge, så rekkefølgen holder).

import type { Journal } from "./journal";
import { saveTournament, toStored, type PhysicalStore } from "./storage";
import type { PhysicalTournament } from "./schema";

export type SaveState = "idle" | "saving" | "saved" | "failed";

export interface SaveQueue {
  /** Legg tilstand i køen. Starter straks hvis ingenting skrives. */
  enqueue(t: PhysicalTournament): void;
  /** Start ventende skriving nå (pagehide). Returnerer når alt er skrevet. */
  flush(): Promise<void>;
  /** Resolves når køen er tom. */
  idle(): Promise<void>;
  readonly state: SaveState;
}

export function createSaveQueue(
  getStore: () => Promise<PhysicalStore>,
  onState: (s: SaveState) => void = () => {},
  journal?: Journal,
  /** Kalles etter hver vellykket lokal lagring (sky-synk pusher da). */
  onSaved?: (t: PhysicalTournament) => void,
): SaveQueue {
  let pending: PhysicalTournament | null = null;
  let inflight: Promise<void> | null = null;
  let state: SaveState = "idle";
  let failed = false;
  const set = (s: SaveState) => {
    state = s;
    onState(s);
  };

  async function write(t: PhysicalTournament): Promise<void> {
    const ok = await saveTournament(await getStore(), t);
    if (!ok) failed = true;
    // Journalen kan ryddes når lageret har bekreftet og ingenting nyere venter.
    else {
      if (!pending && journal) journal.clear(t.id);
      try {
        onSaved?.(t);
      } catch {
        /* sky-synk skal aldri velte lokal lagring */
      }
    }
  }

  function pump(): Promise<void> {
    if (inflight) return inflight;
    inflight = (async () => {
      try {
        while (pending) {
          const next = pending;
          pending = null;
          await write(next);
        }
      } finally {
        inflight = null;
        set(failed ? "failed" : "saved");
        failed = false;
      }
    })();
    return inflight;
  }

  return {
    enqueue(t) {
      pending = t;
      journal?.write(toStored(t));
      set("saving");
      void pump();
    },
    async flush() {
      // Ventende tilstand mens en skriving pågår: start den med en gang (parallelt) i stedet for å vente.
      if (inflight && pending) {
        const next = pending;
        pending = null;
        await Promise.all([inflight, write(next).then(() => undefined)]);
        return;
      }
      await (inflight ?? Promise.resolve());
    },
    idle: () => inflight ?? Promise.resolve(),
    get state() {
      return state;
    },
  };
}
