import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "@/lib/physical/reducer";
import { loadWithJournal, localJournal } from "@/lib/physical/journal";
import { createSaveQueue } from "@/lib/physical/saveQueue";
import { memoryStore, type PhysicalStore } from "@/lib/physical/storage";
import type { StoredTournament } from "@/lib/physical/schema";
import { meta, newTournament } from "./helpers";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("saveQueue: omlasting rett etter siste resultat (journal-race)", () => {
  it("flush() med ny tilstand B mens A skrives: journalen beholder B til B er bekreftet", async () => {
    const m = new Map<string, string>();
    const journal = localJournal({
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => void m.set(k, v),
      removeItem: (k) => void m.delete(k),
    });
    const mem = memoryStore();
    // Hver put() holdes åpen til testen slipper den, så vi styrer rekkefølgen.
    const gates: Array<() => void> = [];
    let active = 0;
    let maxActive = 0;
    const store: PhysicalStore = {
      ...mem,
      put: async (rec: StoredTournament) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise<void>((r) => gates.push(r));
        await mem.put(rec);
        active--;
      },
    };
    const q = createSaveQueue(async () => store, undefined, journal);

    const a = newTournament({}, 3);
    const b = dispatch(a, { type: "addPlayer", playerId: "zz-ny", name: "Siste resultat" }, meta());

    q.enqueue(a); // A i gang
    await tick();
    expect(gates.length).toBe(1);
    q.enqueue(b); // B venter
    const flushed = q.flush(); // pagehide
    await tick();

    gates.shift()!(); // A ferdig
    await tick();
    await tick();
    // B er ikke bekreftet ennå -> journalen MÅ fortsatt ha B
    expect(journal.read(a.id)?.events).toHaveLength(b.events.length);

    while (gates.length === 0) await tick();
    gates.shift()!(); // B ferdig
    await flushed;
    expect(maxActive).toBe(1);
    expect((await mem.get(a.id))!.events).toHaveLength(b.events.length);
    expect(journal.read(a.id)).toBeNull(); // nå kan den ryddes
  });

  describe("omlasting mens A skrives og B bare er i journalen: B skal vinne", () => {
    afterEach(() => vi.useRealTimers());

    /** Kø der getStore og put holdes igjen, så omlastingen skjer etter A og før B er lagret. */
    function rig() {
      const m = new Map<string, string>();
      const journal = localJournal({
        getItem: (k) => m.get(k) ?? null,
        setItem: (k, v) => void m.set(k, v),
        removeItem: (k) => void m.delete(k),
      });
      const mem = memoryStore();
      let releaseStore = () => {};
      const storeReady = new Promise<void>((r) => (releaseStore = r));
      let puts = 0;
      const store: PhysicalStore = {
        ...mem,
        put: async (rec: StoredTournament) => {
          // Bare A når lageret: B ble aldri skrevet før siden lastet om.
          if (puts++ === 0) await mem.put(rec);
          else await new Promise(() => {});
        },
      };
      const q = createSaveQueue(async () => (await storeReady, store), undefined, journal);
      const a = newTournament({}, 3);
      const b = dispatch(a, { type: "addPlayer", playerId: "zz-ny", name: "Siste resultat" }, meta());
      return { q, a, b, mem, journal, releaseStore };
    }

    it("A får ikke senere tidsstempel enn B selv om A skrives etter at B ble lagt i køen", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { q, a, b, mem, journal, releaseStore } = rig();
      vi.setSystemTime(1_000);
      q.enqueue(a);
      vi.setSystemTime(2_000);
      q.enqueue(b);
      vi.setSystemTime(3_000); // A når lageret først nå
      releaseStore();
      await tick();
      await tick();

      expect((await mem.get(a.id))!.events).toHaveLength(a.events.length);
      const { tournament, recovered } = await loadWithJournal(mem, journal, a.id);
      expect(tournament!.events).toHaveLength(b.events.length);
      expect(recovered).toBe(true);
    });

    it("to tilstander i samme millisekund: den siste vinner", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      const { q, a, b, mem, journal, releaseStore } = rig();
      vi.setSystemTime(1_000);
      q.enqueue(a);
      q.enqueue(b);
      releaseStore();
      await tick();
      await tick();

      const { tournament } = await loadWithJournal(mem, journal, a.id);
      expect(tournament!.events).toHaveLength(b.events.length);
    });
  });
});
