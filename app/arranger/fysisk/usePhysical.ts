"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PhysicalError } from "@/lib/physical/errors";
import { makeEvent } from "@/lib/physical/events";
import { reduce, undo as undoLast, canUndo } from "@/lib/physical/reducer";
import type { PhysicalEventBody, PhysicalTournament } from "@/lib/physical/schema";
import { loadTournament, openBestStore, saveTournament, type PhysicalStore } from "@/lib/physical/storage";
import { no } from "@/lib/locale/no";

let storePromise: Promise<PhysicalStore> | null = null;
/** Én delt store per fane. */
export function getStore(): Promise<PhysicalStore> {
  return (storePromise ??= openBestStore());
}

export function errorMessage(e: unknown): string {
  return e instanceof PhysicalError ? e.message : no.common.error;
}

/** Last en turnering fra lokal lagring og gi `apply`/`undo` som autosaver ved hver hendelse. */
export function usePhysicalTournament(id: string) {
  const [state, setState] = useState<PhysicalTournament | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "corrupt">("loading");
  const [error, setError] = useState<string | null>(null);
  const [storeKind, setStoreKind] = useState<PhysicalStore["kind"] | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const ref = useRef<PhysicalTournament | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const store = await getStore();
      if (!alive) return;
      setStoreKind(store.kind);
      try {
        const t = await loadTournament(store, id);
        if (!alive) return;
        ref.current = t;
        setState(t);
        setStatus(t ? "ready" : "missing");
      } catch {
        if (alive) setStatus("corrupt");
      }
    })();
    return () => {
      alive = false;
    };
  }, [id]);

  const commit = useCallback(async (next: PhysicalTournament) => {
    ref.current = next;
    setState(next);
    setError(null);
    const ok = await saveTournament(await getStore(), next);
    setSaveFailed(!ok);
  }, []);

  /** Kjør en overgang. Ugyldig hendelse gir feilmelding og endrer ingenting. */
  const run = useCallback(
    (fn: (t: PhysicalTournament) => PhysicalTournament) => {
      const cur = ref.current;
      if (!cur) return;
      try {
        void commit(fn(cur));
      } catch (e) {
        setError(errorMessage(e));
      }
    },
    [commit],
  );

  const apply = useCallback((body: PhysicalEventBody) => run((t) => reduce(t, makeEvent(body))), [run]);
  const undo = useCallback(() => run((t) => (canUndo(t) ? undoLast(t) : t)), [run]);

  return { state, status, error, setError, apply, run, undo, storeKind, saveFailed };
}
