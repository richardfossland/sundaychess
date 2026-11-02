// Skjermleser: gjør et sjakktrekk om til norsk klartekst («Hvit springer til
// f3»). Ren logikk uten I/O, så den testes uten nettleser.
//
// Tre innganger:
//   speakMove(move)               — et chess.js-trekk (Move-objektet)
//   speakIntent(fen, intent)      — trekket from→to slik det ville blitt spilt
//                                   i `fen` (for «foreløpig trekk»)
//   speakTransition(prev, next)   — trekket som tok `prev` til `next`, eller
//                                   null hvis det ikke er nøyaktig ett trekk
//                                   (sistnevnte brukes av live-regionen, som
//                                   derfor leser likt uansett hvem som flyttet
//                                   og om stillingen kom fra serveren eller
//                                   fra et optimistisk trekk).

import { Chess } from "chess.js";

/** Minimalt utsnitt av chess.js sitt Move-objekt. */
export interface SpokenMove {
  color: "w" | "b";
  piece: string;
  from: string;
  to: string;
  san: string;
  flags: string;
  captured?: string;
  promotion?: string;
}

const PIECE: Record<string, string> = {
  p: "bonde",
  n: "springer",
  b: "løper",
  r: "tårn",
  q: "dronning",
  k: "konge",
};

const COLOR: Record<"w" | "b", string> = { w: "Hvit", b: "Svart" };

export function colorName(c: "w" | "b"): string {
  return COLOR[c];
}

export function pieceName(p: string): string {
  return PIECE[p.toLowerCase()] ?? "brikke";
}

/** «hvit bonde» — brukes som rutenavn i brettet («e4, hvit bonde»). */
export function pieceWithColor(color: "w" | "b", piece: string): string {
  return `${COLOR[color].toLowerCase()} ${pieceName(piece)}`;
}

/** Trekket som norsk tekst, inkludert «Sjakk» / «Sjakkmatt». */
export function speakMove(m: SpokenMove): string {
  const who = COLOR[m.color];
  let text: string;
  if (m.flags.includes("k")) text = `${who} rokade kort`;
  else if (m.flags.includes("q")) text = `${who} rokade lang`;
  else {
    const verb = m.captured ? "slår på" : "til";
    text = `${who} ${pieceName(m.piece)} ${verb} ${m.to}`;
    if (m.flags.includes("e")) text += " en passant";
    if (m.promotion) text += `, forvandles til ${pieceName(m.promotion)}`;
  }
  if (m.san.endsWith("#")) text += ". Sjakkmatt";
  else if (m.san.endsWith("+")) text += ". Sjakk";
  return text;
}

export interface SpeakIntent {
  from: string;
  to: string;
  promotion?: string;
}

/** Teksten for from→to i `fen`, eller null hvis trekket er ulovlig / FEN er ugyldig. */
export function speakIntent(fen: string, intent: SpeakIntent): string | null {
  try {
    const c = new Chess(fen);
    const m = c.move({
      from: intent.from,
      to: intent.to,
      promotion: intent.promotion ?? "q",
    });
    return speakMove(m);
  } catch {
    return null;
  }
}

/** De tre første FEN-feltene (brikker, tur, rokade) — nok til å kjenne igjen en
 * stilling uten å bry seg om en-passant-ruta eller trekktellerne. */
function core(fen: string): string {
  return fen.split(" ").slice(0, 3).join(" ");
}

/** Brikker + tur, ingen tellere. */
function plyOfFen(fen: string): number {
  const parts = fen.split(" ");
  const full = Number(parts[5]);
  if (!Number.isFinite(full)) return NaN;
  return (full - 1) * 2 + (parts[1] === "b" ? 1 : 0);
}

/** Trekket som tok `prev` til `next`. null = ikke nøyaktig ett trekk (samme
 * stilling, tilbakerulling, første innlasting, eller flere trekk). */
export function transitionMove(prev: string, next: string): SpokenMove | null {
  if (!prev || !next || core(prev) === core(next)) return null;
  const dp = plyOfFen(next) - plyOfFen(prev);
  if (dp !== 1) return null;
  try {
    const c = new Chess(prev);
    const want = core(next);
    for (const m of c.moves({ verbose: true })) {
      if (core(m.after) === want) return m;
    }
  } catch {
    /* ugyldig FEN: ingen opplesning */
  }
  return null;
}

/** Som `transitionMove`, men som norsk tekst. */
export function speakTransition(prev: string, next: string): string | null {
  const m = transitionMove(prev, next);
  return m ? speakMove(m) : null;
}

/** Fra en FEN: rute → [farge, brikke]. Brukes til rutenavn og til å vite hva som står hvor. */
export function piecesFromFen(fen: string): Record<string, { color: "w" | "b"; piece: string }> {
  const out: Record<string, { color: "w" | "b"; piece: string }> = {};
  const rows = fen.split(" ")[0]?.split("/") ?? [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (ch >= "1" && ch <= "8") {
        f += Number(ch);
        continue;
      }
      const lower = ch.toLowerCase();
      if (f < 8 && r < 8 && PIECE[lower]) {
        out["abcdefgh"[f] + String(8 - r)] = {
          color: ch === lower ? "b" : "w",
          piece: lower,
        };
      }
      f += 1;
    }
  });
  return out;
}

/** «e4, hvit bonde» / «e4, tom». */
export function speakSquare(
  square: string,
  pieces: Record<string, { color: "w" | "b"; piece: string }>,
): string {
  const p = pieces[square];
  return p ? `${square}, ${pieceWithColor(p.color, p.piece)}` : `${square}, tom`;
}
