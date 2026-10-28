// Lokal sky-tilstand per publisert turnering (M5a): arrangørkode, pair-token,
// siste synkroniserte versjon og bordnøkler (k) til QR. Ligger i localStorage
// ved siden av, men adskilt fra, selve turneringen – og eksporteres ALDRI i
// turneringsfila. localStorage er synkron, så boardQrUrl() kan være synkron.
// Faller tilbake til minne når lagring er blokkert.

export interface CloudMeta {
  hostCode: string;
  /** null når serveren mangler PAIR_SECRET (da brukes koden). */
  pairToken: string | null;
  /** log_version vi sist pushet/hentet. */
  syncedVersion: number;
  /** Signatur (lengde + siste hendelses-id) av loggen ved siste vellykkede synk. */
  syncedSig: string | null;
  /** `${runde}|${brett}` -> k. */
  keys: Record<string, string>;
}

const PREFIX = "sundaychess:physical-cloud:";
const mem = new Map<string, string>();

function ls(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function loadMeta(id: string): CloudMeta | null {
  let raw: string | null = null;
  try {
    raw = ls()?.getItem(PREFIX + id) ?? null;
  } catch {
    raw = null;
  }
  raw ??= mem.get(id) ?? null;
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as CloudMeta;
    return m && typeof m.hostCode === "string" && Number.isInteger(m.syncedVersion) ? { keys: {}, ...m } : null;
  } catch {
    return null;
  }
}

export function saveMeta(id: string, meta: CloudMeta): void {
  const raw = JSON.stringify(meta);
  mem.set(id, raw);
  try {
    ls()?.setItem(PREFIX + id, raw);
  } catch {
    /* minne holder */
  }
}

export function clearMeta(id: string): void {
  mem.delete(id);
  try {
    ls()?.removeItem(PREFIX + id);
  } catch {
    /* ignorer */
  }
}

/** Offentlig lenke (turneringsside). */
export function publicUrl(id: string, origin = typeof location === "undefined" ? "" : location.origin): string {
  return `${origin}/f/${id}`;
}

/** URL i QR på bordkortet, eller null når turneringen ikke er publisert / nøkkelen ikke er hentet. */
export function reportUrl(id: string, round: number, board: number, origin?: string): string | null {
  const k = loadMeta(id)?.keys[`${round}|${board}`];
  if (!k) return null;
  return `${publicUrl(id, origin)}/r/${round}/${board}?k=${encodeURIComponent(k)}`;
}
