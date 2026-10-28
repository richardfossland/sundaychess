"use client";

import { useEffect, useState } from "react";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { getCloud } from "./cloudRegistry";

/**
 * Hent og cache bordnøklene (k) for en runde før bordkort skrives ut, så QR-koden
 * kommer med. Etter ett vellykket oppslag virker utskrift uten nett (nøklene
 * ligger i localStorage). Utrullet publisert turnering uten nett: QR utelates.
 * Returnerer en teller som øker når nøklene er hentet (tvinger ny tegning).
 */
export function useBoardKeys(t: PhysicalTournament | null, round: number | null): number {
  const [n, setN] = useState(0);
  const id = t?.id ?? null;
  const boards = t && round ? t.rounds.find((r) => r.number === round)?.pairings.reduce((m, p) => Math.max(m, p.board), 0) ?? 0 : 0;
  useEffect(() => {
    if (!id || !round || boards < 1) return;
    let alive = true;
    const c = getCloud(id);
    if (!c.meta()) return;
    void c.ensureBoardKeys(round, boards).then((ok) => alive && ok && setN((x) => x + 1));
    return () => {
      alive = false;
    };
  }, [id, round, boards]);
  return n;
}
