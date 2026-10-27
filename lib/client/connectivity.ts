"use client";

// Tiny shared store for "is the network usable?": consecutive failed requests
// (network/timeout/5xx) plus the browser's own online flag. The OfflineBanner
// reads it; lib/client/api.ts feeds it. No React import — testable in Node.

export interface Connectivity {
  failures: number;
  lastOkAt: number | null;
  online: boolean;
}

let state: Connectivity = {
  failures: 0,
  lastOkAt: null,
  online: typeof navigator === "undefined" ? true : navigator.onLine !== false,
};
const listeners = new Set<() => void>();

function set(next: Connectivity): void {
  state = next;
  for (const l of listeners) l();
}

export function getConnectivity(): Connectivity {
  return state;
}

export function subscribeConnectivity(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function noteRequestOk(): void {
  if (state.failures === 0 && state.online) {
    state = { ...state, lastOkAt: Date.now() }; // silent: no re-render needed
    return;
  }
  set({ failures: 0, lastOkAt: Date.now(), online: true });
}

export function noteRequestFailed(): void {
  set({ ...state, failures: state.failures + 1 });
}

export function setOnline(online: boolean): void {
  if (state.online !== online) set({ ...state, online });
}

/** Show the banner when the browser says offline or two requests in a row failed. */
export function isDegraded(c: Connectivity): boolean {
  return !c.online || c.failures >= 2;
}

/** Test-only reset. */
export function __resetConnectivity(): void {
  state = { failures: 0, lastOkAt: null, online: true };
  listeners.clear();
}
