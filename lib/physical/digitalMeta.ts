// «Fortsatt digitalt» (M5b): lokal markering på en fysisk turnering som er flyttet
// til spillmotoren. Ligger i localStorage ved siden av turneringen og eksporteres
// aldri i turneringsfila. Faller tilbake til minne.

export interface DigitalMeta {
  digitalId: string;
  joinPin: string;
}

const PREFIX = "sundaychess:physical-digital:";
const mem = new Map<string, string>();

export function loadDigitalMeta(id: string): DigitalMeta | null {
  let raw: string | null = null;
  try {
    raw = typeof localStorage === "undefined" ? null : localStorage.getItem(PREFIX + id);
  } catch {
    raw = null;
  }
  raw ??= mem.get(id) ?? null;
  if (!raw) return null;
  try {
    const m = JSON.parse(raw) as DigitalMeta;
    return m && typeof m.digitalId === "string" && typeof m.joinPin === "string" ? m : null;
  } catch {
    return null;
  }
}

export function saveDigitalMeta(id: string, meta: DigitalMeta): void {
  const raw = JSON.stringify(meta);
  mem.set(id, raw);
  try {
    localStorage.setItem(PREFIX + id, raw);
  } catch {
    /* minne holder */
  }
}

export function clearDigitalMeta(id: string): void {
  mem.delete(id);
  try {
    localStorage.removeItem(PREFIX + id);
  } catch {
    /* ignorer */
  }
}
