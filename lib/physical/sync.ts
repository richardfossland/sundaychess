// Kryssfane-varsling på samme enhet: arrangørfanen lagrer, storskjermen
// (eget vindu) leser på nytt. BroadcastChannel + storage-hendelse som reserve.
// Virker uten nett – alt skjer i nettleseren.

const CHANNEL = "sundaychess-physical-sync";
const LS_PREFIX = "sundaychess:physical:";

/** Si fra at turneringen er lagret. Aldri kast. */
export function notifyChanged(id: string): void {
  try {
    if (typeof BroadcastChannel === "undefined") return;
    const c = new BroadcastChannel(CHANNEL);
    c.postMessage({ id });
    c.close();
  } catch {
    /* ingen kanal – storskjermen faller tilbake på polling */
  }
}

/** Lytt etter endringer for én turnering. Returnerer avmelding. */
export function onChanged(id: string, cb: () => void): () => void {
  let chan: BroadcastChannel | null = null;
  try {
    if (typeof BroadcastChannel !== "undefined") {
      chan = new BroadcastChannel(CHANNEL);
      chan.onmessage = (e: MessageEvent) => {
        if (e.data && (e.data as { id?: string }).id === id) cb();
      };
    }
  } catch {
    chan = null;
  }
  const onStorage = (e: StorageEvent) => {
    if (e.key === LS_PREFIX + id) cb();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    chan?.close();
    window.removeEventListener("storage", onStorage);
  };
}
