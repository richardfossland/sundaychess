import { useSyncExternalStore } from "react";

/**
 * E3: valgfri trekkbekreftelse. Av som standard. Lagres per enhet i
 * localStorage på samme måte som brettfargene (`boardOptions.ts`): all
 * lagringstilgang i try/catch, og et minnefall­back når lagring er blokkert,
 * slik at valget varer ut sidevisningen.
 */
export const CONFIRM_MOVES_KEY = "chess:confirmMoves";
const EVENT = "chess:confirmMoves-change";

let memory: boolean | null = null;

export function loadConfirmMoves(): boolean {
  try {
    const v = window.localStorage.getItem(CONFIRM_MOVES_KEY);
    if (v === "1") return true;
    if (v === "0") return false;
  } catch {
    /* blokkert lagring: bruk minnet */
  }
  return memory ?? false;
}

export function saveConfirmMoves(on: boolean): void {
  memory = on;
  try {
    window.localStorage.setItem(CONFIRM_MOVES_KEY, on ? "1" : "0");
  } catch {
    /* private mode / blocked storage: valget varer til siden lastes på nytt */
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", cb);
  return () => {
    window.removeEventListener(EVENT, cb);
    window.removeEventListener("storage", cb);
  };
}

/** Er trekkbekreftelse på? (Server: av.) Delt mellom alle komponenter via hendelsen over. */
export function useConfirmMoves(): [boolean, (on: boolean) => void] {
  const on = useSyncExternalStore(subscribe, loadConfirmMoves, () => false);
  return [on, saveConfirmMoves];
}
