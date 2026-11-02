"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { PieceDataType } from "react-chessboard";
import { piecesFromFen, speakSquare } from "@/lib/chess/speak";
import { no } from "@/lib/locale/no";

/**
 * E3: tastaturbetjening og rutenavn for brettet.
 *
 * HVA react-chessboard v5 GIR: ingenting brukbart. Rutene er rene `div`-er
 * uten rolle eller navn, og brikkene er dnd-kit-«draggables» med `tabIndex=0`
 * og `role=button`, så Tab stopper på hver enkelt brikke (opptil 32 stopp) og
 * en skjermleser leser «knapp, kan dras» uten å si hvilken brikke eller rute.
 * dnd-kit sin KeyboardSensor flytter brikken i 25 px-steg uten å vite hva en
 * rute er. Biblioteket har ingen piltast- eller rutefokus-støtte.
 *
 * HVA DENNE KOMPONENTEN GJØR: legger et gjennomsiktig overlegg med 8×8
 * `gridcell` over brettet (`pointer-events: none`, så mus og touch går rett
 * til brettet nøyaktig som før). Rutenettet er det ENE tabulatorstoppet
 * («roving tabindex» via `aria-activedescendant`): piltaster flytter en synlig
 * fokusrute etter brettets visuelle retning, Enter/mellomrom «klikker» på
 * ruta (samme vei som klikk-for-å-flytte, via `onActivate`), Escape avbryter.
 * Biblioteket sitt eget DOM skjules for skjermlesere og tas ut av tab-rekkefølgen.
 */

const FILES = "abcdefgh";

export interface BoardKeysProps {
  /** Stabil id; rutenettet får `${id}-keys` så fokus kan flyttes dit. */
  id: string;
  fen: string;
  orientation: "white" | "black";
  /** Valgt rute og lovlige mål (fra visningens klikk-for-å-flytte-tilstand). */
  selected: string | null;
  legal: readonly string[];
  /** Som `onSquareClick` på brettet. */
  onActivate: (square: string, piece: PieceDataType | null) => void;
  /** Escape: avbryt valg / foreløpig trekk. */
  onCancel: () => void;
}

export function boardKeysId(boardId: string): string {
  return `${boardId}-keys`;
}

/** Flytt fokus til brettets tastaturrutenett (om det finnes). */
export function focusBoardKeys(boardId: string): void {
  document.getElementById(boardKeysId(boardId))?.focus({ preventScroll: true });
}

/** Neste rute for en piltast, etter brettets visuelle retning. null = utenfor brettet. */
export function stepSquare(
  square: string,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  orientation: "white" | "black",
): string | null {
  const f = FILES.indexOf(square[0]);
  const r = Number(square[1]);
  const flip = orientation === "black" ? -1 : 1;
  let nf = f;
  let nr = r;
  if (key === "ArrowUp") nr += flip;
  else if (key === "ArrowDown") nr -= flip;
  else if (key === "ArrowRight") nf += flip;
  else nf -= flip;
  if (nf < 0 || nf > 7 || nr < 1 || nr > 8) return null;
  return FILES[nf] + String(nr);
}

/** Rutene i visuell rekkefølge: øverste rad først, venstre mot høyre. */
function visualRows(orientation: "white" | "black"): string[][] {
  const ranks = orientation === "white" ? [8, 7, 6, 5, 4, 3, 2, 1] : [1, 2, 3, 4, 5, 6, 7, 8];
  const files = orientation === "white" ? FILES.split("") : FILES.split("").reverse();
  return ranks.map((r) => files.map((f) => f + String(r)));
}

export function BoardKeys({
  id,
  fen,
  orientation,
  selected,
  legal,
  onActivate,
  onCancel,
}: BoardKeysProps) {
  const gridId = boardKeysId(id);
  const grid = useRef<HTMLDivElement | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const pieces = useMemo(() => piecesFromFen(fen), [fen]);
  const rows = useMemo(() => visualRows(orientation), [orientation]);
  const legalSet = useMemo(() => new Set(legal), [legal]);

  // Biblioteket sitt DOM: ut av tab-rekkefølgen og skjult for skjermlesere. Det
  // blir (re)rendret av biblioteket når som helst, så vi følger med.
  useEffect(() => {
    const host = grid.current?.parentElement;
    if (!host) return;
    const fix = () => {
      for (const child of Array.from(host.children)) {
        if (child === grid.current) continue;
        if (child.getAttribute("aria-hidden") !== "true") child.setAttribute("aria-hidden", "true");
      }
      for (const el of Array.from(host.querySelectorAll<HTMLElement>('[tabindex="0"]'))) {
        if (!grid.current?.contains(el)) el.setAttribute("tabindex", "-1");
      }
    };
    fix();
    const mo = new MutationObserver(fix);
    mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["tabindex"] });
    return () => mo.disconnect();
  }, []);

  const startSquare = orientation === "white" ? "e2" : "e7";
  const active = cursor ?? startSquare;

  /** Samme vei for Enter/mellomrom og for skjermleser-aktivering (click). */
  function activate(sq: string) {
    const p = pieces[sq];
    onActivate(sq, p ? { pieceType: (p.color === "w" ? "w" : "b") + p.piece.toUpperCase() } : null);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const k = e.key;
    if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      e.preventDefault();
      const next = stepSquare(active, k, orientation);
      if (next) setCursor(next);
    } else if (k === "Enter" || k === " ") {
      e.preventDefault();
      // Hold Enter inne på «Bekreft»: fokus flyttes hit midt i auto-repeten, og
      // de gjentatte tastetrykkene skal ikke velge en brikke. Bare et nytt,
      // bevisst tastetrykk (ikke repeat) aktiverer ruta.
      if (e.repeat) return;
      activate(active);
    } else if (k === "Escape") {
      e.preventDefault();
      onCancel();
    }
  }

  return (
    <div
      ref={grid}
      id={gridId}
      className="board-keys"
      role="grid"
      tabIndex={0}
      aria-label={no.a11y.boardKeys}
      aria-activedescendant={`${gridId}-${active}`}
      onKeyDown={onKeyDown}
      onFocus={() => setCursor((c) => c ?? startSquare)}
    >
      {rows.map((row) => (
        <div key={row[0]} role="row" className="board-keys-row">
          {row.map((sq) => {
            const extra = [
              sq === selected ? no.a11y.cellSelected : null,
              legalSet.has(sq) ? no.a11y.cellLegal : null,
            ].filter(Boolean);
            return (
              <div
                key={sq}
                id={`${gridId}-${sq}`}
                role="gridcell"
                className="board-keys-cell"
                data-cursor={sq === active ? "true" : undefined}
                aria-selected={sq === selected}
                aria-label={[speakSquare(sq, pieces), ...extra].join(", ")}
                // VoiceOver/TalkBack/ChromeVox «dobbelttrykk» sender et syntetisk
                // click til elementet. `pointer-events: none` stopper bare ekte
                // mus/touch (som går til brettet under), ikke dispatchede
                // click-events, så dette når handleren uten å fange pekeren.
                onClick={() => {
                  setCursor(sq);
                  activate(sq);
                }}
              />
            );
          })}
        </div>
      ))}
    </div>
  );
}
