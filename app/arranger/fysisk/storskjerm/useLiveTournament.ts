"use client";

import { useEffect, useState } from "react";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { loadTournament, type PhysicalStore } from "@/lib/physical/storage";
import { onChanged } from "@/lib/physical/sync";
import { getStore } from "../usePhysical";

const POLL_MS = 2500;

/**
 * Leser turneringen fra samme lokale lager som arrangørfanen og oppdaterer ved
 * varsel (BroadcastChannel/storage) – med polling som sikkerhetsnett. Alt på
 * samme enhet; ingen server.
 */
export function useLiveTournament(id: string) {
  const [state, setState] = useState<PhysicalTournament | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "missing" | "corrupt">("loading");
  const [kind, setKind] = useState<PhysicalStore["kind"] | null>(null);

  useEffect(() => {
    let alive = true;
    let lastKey = "";
    let busy = false;
    const load = async () => {
      if (busy) return;
      busy = true;
      try {
        const store = await getStore();
        if (!alive) return;
        setKind(store.kind);
        const t = await loadTournament(store, id);
        if (!alive) return;
        if (!t) {
          setStatus("missing");
          return;
        }
        const key = `${t.events.length}:${t.events[t.events.length - 1]?.id ?? ""}`;
        if (key !== lastKey) {
          lastKey = key;
          setState(t);
        }
        setStatus("ready");
      } catch {
        if (alive) setStatus("corrupt");
      } finally {
        busy = false;
      }
    };
    void load();
    const off = onChanged(id, () => void load());
    const timer = window.setInterval(() => void load(), POLL_MS);
    const vis = () => document.visibilityState === "visible" && void load();
    document.addEventListener("visibilitychange", vis);
    return () => {
      alive = false;
      off();
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", vis);
    };
  }, [id]);

  return { state, status, kind };
}
