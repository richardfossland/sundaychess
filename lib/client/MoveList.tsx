"use client";

import { useEffect, useRef } from "react";
import { Chess } from "chess.js";

/** SAN half-move list from a PGN (["e4","e5","Nf3", …]). [] on empty/bad PGN. */
export function sansFromPgn(pgn: string): string[] {
  if (!pgn || !pgn.trim()) return [];
  try {
    const c = new Chess();
    c.loadPgn(pgn);
    return c.history();
  } catch {
    return [];
  }
}

/** Compact SAN notation panel. `sans` is the half-move sequence; the most recent
 * move is highlighted, and the list scrolls to keep it in view. Read-only — shown
 * to players and spectators for a "follow the game" feel. */
export function MoveList({ sans, title }: { sans: string[]; title?: string }) {
  const endRef = useRef<HTMLLIElement | null>(null);
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [sans.length]);

  const rows: { no: number; white?: string; black?: string }[] = [];
  for (let i = 0; i < sans.length; i += 2) {
    rows.push({ no: i / 2 + 1, white: sans[i], black: sans[i + 1] });
  }
  const lastPly = sans.length; // 1-based ply of the most recent move

  return (
    <div className="movelist" role="log" aria-label={title ?? "Trekkliste"}>
      {sans.length === 0 ? (
        <span className="movelist-empty muted">–</span>
      ) : (
        <ol className="movelist-rows">
          {rows.map((r, ri) => {
            const last = ri === rows.length - 1;
            return (
              <li
                key={r.no}
                className="movelist-row"
                ref={last ? endRef : undefined}
              >
                <span className="movelist-no">{r.no}.</span>
                <span
                  className={`movelist-san ${ri * 2 + 1 === lastPly ? "movelist-current" : ""}`}
                >
                  {r.white}
                </span>
                <span
                  className={`movelist-san ${r.black && ri * 2 + 2 === lastPly ? "movelist-current" : ""}`}
                >
                  {r.black ?? ""}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}
