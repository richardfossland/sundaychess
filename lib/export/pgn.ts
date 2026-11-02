// PGN-eksport (rene funksjoner). Seven Tag Roster + Round/Board, trekk hentes fra lagret
// PGN (games.pgn, chess.js-format). Navn er de samme visningsnavnene som tavla allerede viser;
// ingen koder, PIN eller id-er skrives til fila.

import { Chess } from "chess.js";
import type { GameStatus } from "@/lib/types";

export const PGN_SITE = "chess.sundaysuite.app";
export const PGN_MIME = "application/x-chess-pgn";

export interface PgnGameInput {
  /** Turneringsnavn (Event). */
  event: string;
  /** Rundenummer (1-basert) eller null om ukjent (solo). */
  round?: number | null;
  /** Bordnummer (1-basert) eller null. */
  board?: number | null;
  white: string;
  black: string;
  status: GameStatus | "white_win" | "black_win" | "draw" | "live";
  /** Lagret PGN (med eller uten headere). */
  pgn: string;
  date?: Date;
  /** Lagres som Termination-tagg om oppgitt (f.eks. «oppgivelse»). */
  termination?: string;
}

export function resultToken(status: string): "1-0" | "0-1" | "1/2-1/2" | "*" {
  if (status === "white_win") return "1-0";
  if (status === "black_win") return "0-1";
  if (status === "draw") return "1/2-1/2";
  return "*";
}

/** Escape for tagg-verdi: `\` og `"` med bakoverskråstrek; linjeskift blir mellomrom. */
export function escapeTag(v: string): string {
  return v.replace(/[\r\n]+/g, " ").replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function tag(name: string, value: string): string {
  return `[${name} "${escapeTag(value)}"]`;
}

export function pgnDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`;
}

/** Trekkene (SAN) fra lagret PGN; tom liste om PGN-en ikke kan leses. */
export function sansFromStored(pgn: string): string[] {
  if (!pgn.trim()) return [];
  try {
    const c = new Chess();
    c.loadPgn(pgn);
    return c.history();
  } catch {
    return [];
  }
}

function movetext(sans: string[], result: string): string {
  const parts: string[] = [];
  sans.forEach((san, i) => {
    if (i % 2 === 0) parts.push(`${i / 2 + 1}.`);
    parts.push(san);
  });
  parts.push(result);
  // Linjebryt rundt 80 tegn (PGN-anbefaling).
  const lines: string[] = [];
  let line = "";
  for (const w of parts) {
    if (line && line.length + 1 + w.length > 80) {
      lines.push(line);
      line = w;
    } else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/** Én PGN (ender med linjeskift). */
export function gamePgn(g: PgnGameInput): string {
  const result = resultToken(g.status);
  const tags = [
    tag("Event", g.event || "SundayChess"),
    tag("Site", PGN_SITE),
    tag("Date", pgnDate(g.date ?? new Date())),
    tag("Round", g.round ? String(g.round) : "-"),
    tag("White", g.white || "?"),
    tag("Black", g.black || "?"),
    tag("Result", result),
  ];
  if (g.board) tags.push(tag("Board", String(g.board)));
  if (g.termination) tags.push(tag("Termination", g.termination));
  return `${tags.join("\n")}\n\n${movetext(sansFromStored(g.pgn), result)}\n`;
}

export interface TournamentPgnGame extends PgnGameInput {
  round: number;
  board: number;
}

const DECIDED = new Set(["white_win", "black_win", "draw"]);

/** Alle avgjorte partier, sortert på runde og bord, skilt med blank linje. */
export function tournamentPgn(games: TournamentPgnGame[]): string {
  return games
    .filter((g) => DECIDED.has(g.status))
    .sort((a, b) => a.round - b.round || a.board - b.board)
    .map((g) => gamePgn(g))
    .join("\n");
}

/** Slug for filnavn: små bokstaver, æøå → ae/o/a, bindestrek. */
export function pgnSlug(s: string): string {
  const base = s
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "o")
    .replace(/å/g, "a")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50);
  return base || "parti";
}

export function pgnFileName(title: string, round?: number | null, board?: number | null): string {
  let n = pgnSlug(title);
  if (round) n += `-runde-${round}`;
  if (board) n += `-bord-${board}`;
  return `${n}.pgn`;
}

/** Stillingen etter siste trekk (FEN), eller startstilling. */
export function finalFen(pgn: string): string {
  try {
    const c = new Chess();
    if (pgn.trim()) c.loadPgn(pgn);
    return c.fen();
  } catch {
    return new Chess().fen();
  }
}
