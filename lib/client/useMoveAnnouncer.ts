"use client";

import { useCallback, useState } from "react";
import { speakMove, transitionMove } from "@/lib/chess/speak";

/**
 * E3: teksten til skjermleserens live-region (se `GameLayout`).
 *
 * Opplesningen utledes av STILLINGEN, ikke av hvor trekket kom fra: hver gang
 * `fen` går ett trekk fram, leses det trekket opp — enten det er mitt eget
 * optimistiske trekk, motstanderens trekk fra en kringkasting, eller samme
 * trekk igjen når serveren bekrefter det. Bekreftelsen har samme stilling og
 * gir derfor ingen ny opplesning, og det gjør heller ikke en ny rendring,
 * tilbakerulling (turnering: avvist trekk), nytt parti eller første innlasting.
 *
 * Utledet tilstand under rendring (React sitt anbefalte mønster for «tilstand
 * som følger av en prop»), ikke en effekt: teksten er på plass i samme rendring
 * som stillingen, uten ekstra runde.
 *
 * `end` er partislutt-teksten (null mens partiet pågår). Den leses opp i samme
 * melding som sluttrekket («Hvit dronning slår på f7. Sjakkmatt. Du vant»), så
 * ingen av dem overstyrer den andre i regionen.
 */
export function useMoveAnnouncer(opts: {
  fen: string;
  /** Teksten foran et trekk («Du: …»); null = ingen prefiks. */
  label?: (color: "w" | "b") => string | null;
  end: string | null;
}): { text: string; say: (text: string) => void } {
  const { fen, label, end } = opts;
  const [s, setS] = useState({ fen, end, text: "" });

  if (s.fen !== fen || s.end !== end) {
    const parts: string[] = [];
    const m = s.fen && fen ? transitionMove(s.fen, fen) : null;
    if (m) {
      const who = label?.(m.color) ?? null;
      const t = speakMove(m);
      parts.push(who ? `${who}: ${t}` : t);
    }
    if (end && end !== s.end) parts.push(end);
    setS({ fen, end, text: parts.length > 0 ? parts.join(". ") : s.text });
  }

  const say = useCallback((text: string) => setS((p) => ({ ...p, text })), []);
  return { text: s.text, say };
}
