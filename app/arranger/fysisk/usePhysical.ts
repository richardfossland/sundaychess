"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PhysicalError } from "@/lib/physical/errors";
import { makeEvent } from "@/lib/physical/events";
import { reduce, undo as undoLast, canUndo } from "@/lib/physical/reducer";
import type { PhysicalEventBody, PhysicalTournament } from "@/lib/physical/schema";
import { describeEvent } from "@/lib/physical/roundView";
import { createSaveQueue, type SaveQueue, type SaveState } from "@/lib/physical/saveQueue";
import { localJournal, loadWithJournal } from "@/lib/physical/journal";
import { createWriterLock, type WriterLock } from "@/lib/physical/writerLock";
import { openBestStore, type PhysicalStore } from "@/lib/physical/storage";
import { no } from "@/lib/locale/no";
import { cloudSaved } from "./cloud/cloudRegistry";

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
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [toast, setToast] = useState<{ id: number; text: string; undoable: boolean } | null>(null);
  const ref = useRef<PhysicalTournament | null>(null);
  const queue = useRef<SaveQueue | null>(null);
  const toastSeq = useRef(0);
  // Én skriver per turnering (se writerLock.ts): en andre fane er skrivebeskyttet til brukeren tar over.
  const [readOnly, setReadOnly] = useState(false);
  const readOnlyRef = useRef(false);
  const lock = useRef<WriterLock | null>(null);
  const lockReady = useRef<Promise<void>>(Promise.resolve());
  const markReadOnly = useCallback((on: boolean, message?: string) => {
    readOnlyRef.current = on;
    setReadOnly(on);
    if (message) setError(message);
  }, []);
  queue.current ??= createSaveQueue(getStore, setSaveState, localJournal(), cloudSaved, () =>
    markReadOnly(true, no.physicalCloud.saveConflict),
  );

  useEffect(() => {
    const l = createWriterLock(`physical-${id}`, () => markReadOnly(true, no.physicalCloud.lockLost));
    lock.current = l;
    lockReady.current = l.acquire().then((got) => markReadOnly(!got));
    return () => {
      l.dispose();
      lock.current = null;
    };
  }, [id, markReadOnly]);

  useEffect(() => {
    let alive = true;
    (async () => {
      const store = await getStore();
      if (!alive) return;
      setStoreKind(store.kind);
      try {
        const { tournament: t, recovered } = await loadWithJournal(store, localJournal(), id);
        await lockReady.current;
        if (!alive) return;
        // Vernet mot skriving fra to faner sammenligner med det lageret holdt da vi lastet.
        queue.current!.setBase(recovered ? null : t);
        if (t && recovered && !readOnlyRef.current) queue.current!.enqueue(t);
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

  // Flush ventende lagring når fanen skjules eller lukkes.
  useEffect(() => {
    const q = queue.current!;
    const onHide = () => void q.flush();
    const onVis = () => document.visibilityState === "hidden" && onHide();
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
      void q.flush();
    };
  }, []);

  const showToast = useCallback((text: string | null, undoable = true) => {
    setToast(text ? { id: ++toastSeq.current, text, undoable } : null);
  }, []);

  const commit = useCallback((next: PhysicalTournament) => {
    ref.current = next;
    setState(next);
    setError(null);
    queue.current!.enqueue(next);
  }, []);

  /** Kjør en overgang. Ugyldig hendelse gir feilmelding og endrer ingenting. */
  const run = useCallback(
    (fn: (t: PhysicalTournament) => PhysicalTournament): boolean => {
      const cur = ref.current;
      if (!cur) return false;
      if (readOnlyRef.current) {
        setError(no.physicalCloud.lockedTitle);
        return false;
      }
      try {
        const next = fn(cur);
        commit(next);
        if (next.events.length > cur.events.length) {
          const text = describeEvent(next, next.events[next.events.length - 1]);
          showToast(text);
        }
        return true;
      } catch (e) {
        setError(errorMessage(e));
        return false;
      }
    },
    [commit, showToast],
  );

  /** Returnerer true når hendelsen ble ført (false = avvist eller skrivebeskyttet). */
  const apply = useCallback((body: PhysicalEventBody): boolean => run((t) => reduce(t, makeEvent(body))), [run]);

  /** «Ta over»: stjel låsen, last turneringen på nytt fra lageret (den andre fanen kan ha endret den). */
  const takeOver = useCallback(async () => {
    await lock.current?.takeOver();
    const store = await getStore();
    const { tournament: t } = await loadWithJournal(store, localJournal(), id);
    if (t) {
      ref.current = t;
      setState(t);
    }
    queue.current!.setBase(t);
    markReadOnly(false);
    setError(null);
  }, [id, markReadOnly]);
  const undo = useCallback(() => {
    const cur = ref.current;
    if (!cur || !canUndo(cur)) return;
    if (readOnlyRef.current) return setError(no.physicalCloud.lockedTitle);
    try {
      commit(undoLast(cur));
      showToast(no.physical.toast.undone, false);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, [commit, showToast]);

  return { state, status, error, setError, apply, run, undo, readOnly, takeOver, storeKind, saveState, saveFailed: saveState === "failed", toast, dismissToast: () => showToast(null) };
}
