// PGN-eksport (rene funksjoner). Seven Tag Roster + Round/Board, trekk hentes fra lagret
// PGN (games.pgn, chess.js-format). Navn er de samme visningsnavnene som tavla allerede viser;
// ingen koder, PIN eller id-er skrives til fila.

import { Chess } from "chess.js";
import type { GameStatus, ResultSource } from "@/lib/types";
import { no } from "@/lib/locale/no";

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
  /** Hvordan partiet ble avgjort (`games.result_source`); styrer Termination-taggen. */
  resultSource?: ResultSource | null;
  /** Overstyrer Termination-taggen. Utelatt: utledes av `resultSource` og stillingen. */
  termination?: string;
}

export function resultToken(status: string): "1-0" | "0-1" | "1/2-1/2" | "*" {
  if (status === "white_win") return "1-0";
  if (status === "black_win") return "0-1";
  if (status === "draw") return "1/2-1/2";
  return "*";
}

/** Tagg-verdi: PGN-spesifikasjonen escaper `"` og `\` med `\`, men chess.js 1.x
 * leser ikke `\"` (taggen ender på det første `"`), så en eksportert fil kan ikke
 * lastes tilbake. Derfor erstattes `"` med typografisk `”` og `\` med `/`, og
 * det er ingenting igjen å escape. Linjeskift blir mellomrom. */
export function escapeTag(v: string): string {
  return v.replace(/[\r\n]+/g, " ").replace(/"/g, "”").replace(/\\/g, "/");
}

function tag(name: string, value: string): string {
  return `[${name} "${escapeTag(value)}"]`;
}

/**
 * Rundenummer i eksporten. Sluttspillrunder har egne nummer fra 1 og ville
 * kollidert med ligarundene (`Round "1"` to ganger), så sluttspillrunde n
 * eksporteres som `ligaRunder + n`.
 */
export function exportRound(
  rounds: readonly { id: string; number: number; phase: string }[],
  roundId: string,
): number | null {
  const r = rounds.find((x) => x.id === roundId);
  if (!r) return null;
  if (r.phase !== "playoff") return r.number;
  const league = rounds.reduce((m, x) => (x.phase === "playoff" ? m : Math.max(m, x.number)), 0);
  return league + r.number;
}

/** Norsk Termination-tagg ut fra `result_source` og (for «play») stillingen. */
export function terminationFor(g: {
  status: string;
  resultSource?: ResultSource | null;
  pgn: string;
}): string | undefined {
  const t = no.pgn.termination;
  switch (g.resultSource) {
    case "teacher_override":
      return t.teacherOverride;
    case "walkover":
      return t.walkover;
    case "opponent_absent":
      return t.opponentAbsent;
    case "timeout_draw":
      return t.timeoutDraw;
    case "physical":
      return t.physical;
    case "bye":
      return undefined;
    default:
      break;
  }
  const win = g.status === "white_win" || g.status === "black_win";
  if (!win && g.status !== "draw") return undefined;
  let c: Chess | null = null;
  try {
    c = new Chess();
    if (g.pgn.trim()) c.loadPgn(g.pgn);
  } catch {
    c = null;
  }
  if (win) {
    // Ikke matt på brettet, men avgjort = en spiller ga opp.
    return c?.isCheckmate() ? t.checkmate : t.resignation;
  }
  if (c?.isStalemate()) return t.stalemate;
  if (c?.isInsufficientMaterial()) return t.insufficient;
  if (c?.isThreefoldRepetition()) return t.repetition;
  if (c?.isDrawByFiftyMoves()) return t.fiftyMoves;
  return t.agreement;
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
  const termination = g.termination ?? terminationFor(g);
  if (termination) tags.push(tag("Termination", termination));
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
