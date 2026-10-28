// Lokal lagring av fysiske turneringer: IndexedDB → localStorage → minne.
// Mønster fra sundayturnering/lib/client/outbox.ts. Hver berøring er pakket i
// try/catch: lagring kan feile (privat modus, full disk, blokkert), og
// turneringen skal da fortsette å virke i minnet.
//
// Det som lagres er hendelsesloggen + litt metadata (StoredTournament). Ved
// lasting spilles loggen av på nytt (replay) – avledet state lagres aldri.

import { fail } from "./errors";
import { replay } from "./reducer";
import { notifyChanged } from "./sync";
import { SCHEMA_VERSION, type PhysicalTournament, type StoredTournament } from "./schema";

export type StorageKind = "indexedDB" | "localStorage" | "memory";

export interface PhysicalStore {
  readonly kind: StorageKind;
  list(): Promise<StoredTournament[]>;
  get(id: string): Promise<StoredTournament | null>;
  put(rec: StoredTournament): Promise<void>;
  remove(id: string): Promise<void>;
}

export function toStored(t: PhysicalTournament, updatedAt = new Date().toISOString()): StoredTournament {
  return {
    schemaVersion: SCHEMA_VERSION,
    id: t.id,
    title: t.title,
    createdAt: t.createdAt,
    updatedAt,
    playerCount: t.players.length,
    roundsPlayed: t.rounds.filter((r) => r.status === "completed").length,
    events: t.events,
  };
}

/** Gjenoppbygg state fra lagret post. Kaster PhysicalError ved ukjent versjon eller skadet logg. */
export function fromStored(rec: StoredTournament): PhysicalTournament {
  if (!rec || rec.schemaVersion !== SCHEMA_VERSION) fail("unsupportedVersion");
  return replay(rec.events);
}

function isRecord(x: unknown): x is StoredTournament {
  const r = x as StoredTournament | null;
  return !!r && typeof r === "object" && typeof r.id === "string" && Array.isArray(r.events);
}

// ---- minne ----
export function memoryStore(): PhysicalStore {
  const m = new Map<string, StoredTournament>();
  return {
    kind: "memory",
    list: async () => [...m.values()].map((r) => structuredClone(r)),
    get: async (id) => (m.has(id) ? structuredClone(m.get(id)!) : null),
    put: async (rec) => void m.set(rec.id, structuredClone(rec)),
    remove: async (id) => void m.delete(id),
  };
}

// ---- localStorage ----
const LS_PREFIX = "sundaychess:physical:";

export function localStorageStore(storage: Pick<Storage, "getItem" | "setItem" | "removeItem" | "length" | "key">): PhysicalStore {
  const keys = (): string[] => {
    const out: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const k = storage.key(i);
      if (k && k.startsWith(LS_PREFIX)) out.push(k);
    }
    return out;
  };
  const read = (k: string): StoredTournament | null => {
    try {
      const v = JSON.parse(storage.getItem(k) ?? "null");
      return isRecord(v) ? v : null;
    } catch {
      return null;
    }
  };
  return {
    kind: "localStorage",
    list: async () => keys().map(read).filter((x): x is StoredTournament => !!x),
    get: async (id) => read(LS_PREFIX + id),
    put: async (rec) => storage.setItem(LS_PREFIX + rec.id, JSON.stringify(rec)),
    remove: async (id) => storage.removeItem(LS_PREFIX + id),
  };
}

// ---- IndexedDB ----
const IDB_NAME = "sundaychess-physical";
const IDB_STORE = "tournaments";

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

export function indexedDbStore(factory: IDBFactory): PhysicalStore {
  let opened: Promise<IDBDatabase> | null = null;
  const open = () =>
    (opened ??= new Promise<IDBDatabase>((res, rej) => {
      const r = factory.open(IDB_NAME, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE, { keyPath: "id" });
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
      r.onblocked = () => rej(new Error("idb blocked"));
    }));
  const store = async (mode: IDBTransactionMode) => (await open()).transaction(IDB_STORE, mode).objectStore(IDB_STORE);
  return {
    kind: "indexedDB",
    list: async () => ((await req((await store("readonly")).getAll())) as unknown[]).filter(isRecord),
    get: async (id) => {
      const v = await req((await store("readonly")).get(id));
      return isRecord(v) ? v : null;
    },
    put: async (rec) => void (await req((await store("readwrite")).put(rec))),
    remove: async (id) => void (await req((await store("readwrite")).delete(id))),
  };
}

export interface StorageEnv {
  indexedDB?: IDBFactory;
  localStorage?: Storage;
}

function browserEnv(): StorageEnv {
  const env: StorageEnv = {};
  try {
    if (typeof indexedDB !== "undefined") env.indexedDB = indexedDB;
  } catch {
    /* blokkert */
  }
  try {
    if (typeof localStorage !== "undefined") env.localStorage = localStorage;
  } catch {
    /* blokkert (SecurityError) */
  }
  return env;
}

/** Beste lager nettleseren tilbyr. IndexedDB kan finnes men feile ved åpning → prøv, så fall tilbake. */
export async function openBestStore(env: StorageEnv = browserEnv()): Promise<PhysicalStore> {
  try {
    if (env.indexedDB) {
      const s = indexedDbStore(env.indexedDB);
      await s.list();
      return s;
    }
  } catch {
    /* fall through */
  }
  try {
    if (env.localStorage) {
      const probe = LS_PREFIX + "__probe";
      env.localStorage.setItem(probe, "1");
      env.localStorage.removeItem(probe);
      return localStorageStore(env.localStorage);
    }
  } catch {
    /* fall through */
  }
  return memoryStore();
}

// ---- høynivå ----

/** Lagre med autosave-semantikk: aldri kast. Returnerer true hvis lagringen lyktes. */
export async function saveTournament(store: PhysicalStore, t: PhysicalTournament): Promise<boolean> {
  try {
    await store.put(toStored(t));
    notifyChanged(t.id);
    return true;
  } catch {
    return false;
  }
}

export async function listTournaments(store: PhysicalStore): Promise<StoredTournament[]> {
  try {
    return (await store.list()).sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  } catch {
    return [];
  }
}

/** Last og spill av på nytt. Returnerer null hvis den ikke finnes; kaster PhysicalError hvis skadet. */
export async function loadTournament(store: PhysicalStore, id: string): Promise<PhysicalTournament | null> {
  let rec: StoredTournament | null = null;
  try {
    rec = await store.get(id);
  } catch {
    return null;
  }
  return rec ? fromStored(rec) : null;
}

export async function deleteTournament(store: PhysicalStore, id: string): Promise<boolean> {
  try {
    await store.remove(id);
    return true;
  } catch {
    return false;
  }
}
