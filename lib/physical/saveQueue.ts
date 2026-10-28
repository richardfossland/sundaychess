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
  /**
   * Hva lageret holder ifølge oss (hendelses-id-er). Settes etter lasting; oppdateres etter hver
   * vellykket skriving. `null` = ukjent (første skriving sjekkes ikke). Brukes av vernet under.
   */
  setBase(t: PhysicalTournament | null): void;
  /** Etter en konflikt skriver køen ingenting mer før `setBase` kalles igjen. */
  readonly blocked: boolean;
}

const idsOf = (t: PhysicalTournament) => t.events.map((e) => e.id);
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);

export function createSaveQueue(
  getStore: () => Promise<PhysicalStore>,
  onState: (s: SaveState) => void = () => {},
  journal?: Journal,
  /** Kalles etter hver vellykket lokal lagring (sky-synk pusher da). */
  onSaved?: (t: PhysicalTournament) => void,
  /** Lageret er endret av noen andre enn oss siden vi lastet/skrev sist (annen fane): vi nekter å skrive. */
  onConflict?: () => void,
): SaveQueue {
  // De siste kjente lagerinnholdene (flush() kan avslutte parallelle skrivinger i annen rekkefølge).
  let bases: string[][] = [];
  let blocked = false;
  let pending: PhysicalTournament | null = null;
  let inflight: Promise<void> | null = null;
  let state: SaveState = "idle";
  let failed = false;
  const set = (s: SaveState) => {
    state = s;
    onState(s);
  };

  async function write(t: PhysicalTournament): Promise<void> {
    if (blocked) return;
    const store = await getStore();
    // Defensivt vern: lageret må fortsatt være det vi selv skrev/lastet. Ellers har en annen fane
    // lagret i mellomtiden, og vi ville overskrevet arbeidet stille.
    if (bases.length > 0) {
      let stored: Awaited<ReturnType<typeof store.get>> = null;
      try {
        stored = await store.get(t.id);
      } catch {
        stored = null;
      }
      if (stored && !bases.some((b) => sameIds(stored.events.map((e) => e.id), b))) {
        blocked = true;
        pending = null;
        journal?.clear(t.id);
        try {
          onConflict?.();
        } catch {
          /* ignorer */
        }
        return;
      }
    }
    const ok = await saveTournament(store, t);
    if (ok) bases = [...bases, idsOf(t)].slice(-3);
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
    setBase(t) {
      bases = t ? [idsOf(t)] : [];
      blocked = false;
    },
    get blocked() {
      return blocked;
    },
    enqueue(t) {
      if (blocked) return;
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
