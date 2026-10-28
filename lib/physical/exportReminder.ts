// Lokal-først betyr at nettleseren er eneste kopi. To lavterskel-sikringer:
//  * be om vedvarende lagring (`navigator.storage.persist()`) når en turnering opprettes;
//  * minn om å eksportere turneringsfila etter fullførte runder (avvisbart).
// Alt er best effort og i try/catch: manglende API eller blokkert localStorage skal aldri stoppe noe.

import type { PhysicalTournament } from "./schema";

/** Minn om eksport når så mange fullførte runder har gått siden sist. */
export const EXPORT_REMINDER_ROUNDS = 1;
const KEY = "sundaychess:physical-export:";
const DISMISS = "sundaychess:physical-export-dismiss:";

type Kv = Pick<Storage, "getItem" | "setItem">;
const kv = (): Kv | null => {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
};
const readNum = (store: Kv | null, key: string): number => {
  try {
    const n = Number(store?.getItem(key));
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
};
const writeNum = (store: Kv | null, key: string, n: number) => {
  try {
    store?.setItem(key, String(n));
  } catch {
    /* ignorer */
  }
};

export const completedRounds = (t: Pick<PhysicalTournament, "rounds">) => t.rounds.filter((r) => r.status === "completed").length;

/** Kalles etter en vellykket eksport av turneringsfila (.sundaychess.json). */
export function markExported(t: PhysicalTournament, store: Kv | null = kv()): void {
  writeNum(store, KEY + t.id, completedRounds(t));
}

export function dismissReminder(t: PhysicalTournament, store: Kv | null = kv()): void {
  writeNum(store, DISMISS + t.id, completedRounds(t));
}

/** Skal påminnelsen vises nå? (Ren, testbar.) */
export function shouldRemindExport(t: PhysicalTournament, store: Kv | null = kv()): boolean {
  const done = completedRounds(t);
  if (done < 1) return false;
  if (readNum(store, DISMISS + t.id) >= done) return false;
  return done - readNum(store, KEY + t.id) >= EXPORT_REMINDER_ROUNDS;
}

export const isIos = (ua = typeof navigator === "undefined" ? "" : navigator.userAgent, touchPoints = typeof navigator === "undefined" ? 0 : navigator.maxTouchPoints): boolean =>
  /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1);

/** Be om vedvarende lagring. Returnerer om lageret nå er vedvarende (false også når API-et mangler). */
export async function requestPersistence(storage: Pick<StorageManager, "persist" | "persisted"> | undefined = typeof navigator === "undefined" ? undefined : navigator.storage): Promise<boolean> {
  try {
    if (!storage) return false;
    if (typeof storage.persisted === "function" && (await storage.persisted())) return true;
    return typeof storage.persist === "function" ? await storage.persist() : false;
  } catch {
    return false;
  }
}
