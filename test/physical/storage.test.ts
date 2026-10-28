import { describe, expect, it } from "vitest";
import {
  deleteTournament,
  listTournaments,
  loadTournament,
  localStorageStore,
  memoryStore,
  openBestStore,
  saveTournament,
  fromStored,
  toStored,
  type PhysicalStore,
} from "@/lib/physical/storage";
import { parseRoster } from "@/lib/physical/roster";
import { newTournament, playRound } from "./helpers";

function fakeLocalStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
  } as Storage;
}

async function roundTrip(store: PhysicalStore) {
  let t = newTournament({}, 6);
  t = playRound(t);
  expect(await saveTournament(store, t)).toBe(true);
  const list = await listTournaments(store);
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ id: "t1", title: "Test", playerCount: 6, roundsPlayed: 1 });
  expect(await loadTournament(store, "t1")).toEqual(t);
  expect(await deleteTournament(store, "t1")).toBe(true);
  expect(await loadTournament(store, "t1")).toBeNull();
}

describe("lagring", () => {
  it("minnelager: lagre, liste, laste (replay), slette", () => roundTrip(memoryStore()));
  it("localStorage-lager", () => roundTrip(localStorageStore(fakeLocalStorage())));

  it("uten indexedDB faller openBestStore tilbake til localStorage, så til minne", async () => {
    expect(typeof indexedDB).toBe("undefined");
    expect((await openBestStore({ localStorage: fakeLocalStorage() })).kind).toBe("localStorage");
    expect((await openBestStore({})).kind).toBe("memory");
  });
  it("indexedDB som feiler ved åpning faller tilbake", async () => {
    const broken = {
      open() {
        const r: Record<string, unknown> = {};
        setTimeout(() => (r.onerror as () => void)?.(), 0);
        return r;
      },
    } as unknown as IDBFactory;
    expect((await openBestStore({ indexedDB: broken, localStorage: fakeLocalStorage() })).kind).toBe("localStorage");
  });
  it("localStorage som kaster (privat modus / full) faller til minne", async () => {
    const throwing = {
      length: 0,
      key: () => null,
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceeded");
      },
      removeItem: () => {
        throw new Error("x");
      },
    } as unknown as Storage;
    expect((await openBestStore({ localStorage: throwing })).kind).toBe("memory");
  });
  it("lagringsfeil kaster aldri ut av autosave", async () => {
    const failing: PhysicalStore = {
      kind: "memory",
      list: async () => Promise.reject(new Error("x")),
      get: async () => Promise.reject(new Error("x")),
      put: async () => Promise.reject(new Error("x")),
      remove: async () => Promise.reject(new Error("x")),
    };
    const t = newTournament({}, 2);
    expect(await saveTournament(failing, t)).toBe(false);
    expect(await listTournaments(failing)).toEqual([]);
    expect(await loadTournament(failing, "t1")).toBeNull();
    expect(await deleteTournament(failing, "t1")).toBe(false);
  });
  it("skadet logg og ukjent versjon gir norsk feil ved lasting", () => {
    const rec = toStored(newTournament({}, 2));
    expect(() => fromStored({ ...rec, schemaVersion: 2 as never })).toThrow(/format/i);
    expect(() => fromStored({ ...rec, events: [] })).toThrow(/skadet/);
  });
  it("korrupt JSON i localStorage hoppes over", async () => {
    const ls = fakeLocalStorage();
    ls.setItem("sundaychess:physical:bad", "{ikke json");
    const s = localStorageStore(ls);
    expect(await s.list()).toEqual([]);
  });
});

describe("parseRoster", () => {
  it("semikolon: navn; rating; klubb – med overskrift og tomme linjer", () => {
    const r = parseRoster("Navn; Rating; Klasse\nKari Nordmann; 1450; 7A\n\nOla Hansen; ; 7B\nPer\n");
    expect(r.errors).toEqual([]);
    expect(r.entries).toEqual([
      { name: "Kari Nordmann", rating: 1450, club: "7A" },
      { name: "Ola Hansen", club: "7B" },
      { name: "Per" },
    ]);
  });
  it("CSV med komma og anførselstegn", () => {
    const r = parseRoster('"Hansen, Ola",1200,Sjakklubben\nKari,,');
    expect(r.entries).toEqual([{ name: "Hansen, Ola", rating: 1200, club: "Sjakklubben" }, { name: "Kari" }]);
  });
  it("rapporterer ugyldig rating med linjenummer", () => {
    const r = parseRoster("A; 1000\nB; abc\nC; 9999");
    expect(r.entries).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([2, 3]);
  });
  it("tab-skilt", () => {
    expect(parseRoster("A\t1500\tK").entries).toEqual([{ name: "A", rating: 1500, club: "K" }]);
  });
});
