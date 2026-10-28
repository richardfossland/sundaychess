// Rene datahjelpere for utskrifter og storskjerm. Ingen DOM, ingen lagring.
// All visning leses fra selectors (standings, crosstable) – ingen nye hendelser.

import { reportUrl } from "@/lib/physical/cloudMeta";
import type { PhysicalPairing, PhysicalPlayer, PhysicalRound, PhysicalTournament } from "@/lib/physical/schema";
import { crosstable, standings, type StandingWithPlayer } from "@/lib/physical/selectors";

export const PRINT_KINDS = [
  "parringsliste",
  "bordkort",
  "resultatlapper",
  "tabell",
  "krysstabell",
  "sluttresultat",
  "diplomer",
] as const;
export type PrintKind = (typeof PRINT_KINDS)[number];

export function isPrintKind(x: string): x is PrintKind {
  return (PRINT_KINDS as readonly string[]).includes(x);
}

/** Del en liste i sider på `size` elementer. Alltid minst én side hvis lista ikke er tom. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size));
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/** Brettrekkefølge: stigende brettnummer, frirunder sist. */
export function boardOrder(pairings: readonly PhysicalPairing[]): PhysicalPairing[] {
  return [...pairings].sort((a, b) => {
    const ab = a.black === null ? 1 : 0;
    const bb = b.black === null ? 1 : 0;
    return ab - bb || a.board - b.board;
  });
}

/** Runden utskriften gjelder: ønsket, ellers åpen/siste. Null hvis ingen runder. */
export function pickRound(t: PhysicalTournament, wanted?: number | null): PhysicalRound | null {
  if (wanted != null) {
    const r = t.rounds.find((x) => x.number === wanted);
    if (r) return r;
  }
  return t.rounds[t.rounds.length - 1] ?? null;
}

export interface FindRow {
  playerId: string;
  name: string;
  startNo: number;
  /** null = ikke parret denne runden (trukket / ikke med). */
  board: number | null;
  colour: "W" | "B" | "bye" | null;
  opponent: string | null;
}

const collator = new Intl.Collator("nb", { sensitivity: "base", numeric: true });

/** «Finn bordet ditt»: alle spillere alfabetisk (norsk sortering) med brett og farge. */
export function findBoardList(t: PhysicalTournament, round: PhysicalRound | null): FindRow[] {
  const nameOf = new Map(t.players.map((p) => [p.id, p.name]));
  const where = new Map<string, FindRow>();
  for (const g of round?.pairings ?? []) {
    where.set(g.white, {
      playerId: g.white,
      name: nameOf.get(g.white) ?? "?",
      startNo: 0,
      board: g.board,
      colour: g.black === null ? "bye" : "W",
      opponent: g.black ? (nameOf.get(g.black) ?? "?") : null,
    });
    if (g.black) {
      where.set(g.black, {
        playerId: g.black,
        name: nameOf.get(g.black) ?? "?",
        startNo: 0,
        board: g.board,
        colour: "B",
        opponent: nameOf.get(g.white) ?? "?",
      });
    }
  }
  const rows: FindRow[] = [];
  for (const p of t.players) {
    const w = where.get(p.id);
    if (!w && p.status === "withdrawn") continue;
    rows.push({ ...(w ?? { playerId: p.id, name: p.name, board: null, colour: null, opponent: null }), startNo: p.startNo });
  }
  return rows.sort((a, b) => collator.compare(a.name, b.name) || a.startNo - b.startNo);
}

export interface CardData {
  round: number;
  board: number;
  white: string;
  black: string;
  whiteGroup?: string;
  blackGroup?: string;
}

/** Brett med to spillere (uten frirunder), i brettrekkefølge. */
export function cardsFor(t: PhysicalTournament, round: PhysicalRound | null): CardData[] {
  if (!round) return [];
  const byId = new Map(t.players.map((p) => [p.id, p]));
  const out: CardData[] = [];
  for (const g of boardOrder(round.pairings)) {
    if (g.black === null) continue;
    const w = byId.get(g.white);
    const b = byId.get(g.black);
    out.push({
      round: round.number,
      board: g.board,
      white: w?.name ?? "?",
      black: b?.name ?? "?",
      ...(w?.club ? { whiteGroup: w.club } : {}),
      ...(b?.club ? { blackGroup: b.club } : {}),
    });
  }
  return out;
}

/** Frirunder i runden (navn). */
export function byesFor(t: PhysicalTournament, round: PhysicalRound | null): string[] {
  if (!round) return [];
  const byId = new Map(t.players.map((p) => [p.id, p.name]));
  return round.pairings.filter((g) => g.black === null).map((g) => byId.get(g.white) ?? "?");
}

/** 0,5 → «½», 1,5 → «1½», 0 → «0». */
export function fmtPoints(n: number): string {
  const whole = Math.floor(n + 1e-9);
  const half = Math.abs(n - whole - 0.5) < 1e-9;
  if (half) return whole === 0 ? "½" : `${whole}½`;
  return String(Math.round(n));
}

export interface CrossRow {
  playerId: string;
  rank: number;
  name: string;
  /** Én celle per kolonne (samme rekkefølge som `order`); null = diagonalen. */
  cells: (string | null)[];
  score: number;
}
export interface CrossMatrix {
  order: PhysicalPlayer[];
  rows: CrossRow[];
}

/** Krysstabell sortert etter sluttplassering. Celle: poeng sett fra radens spiller; «–» = ikke spilt. */
export function crossMatrix(t: PhysicalTournament): CrossMatrix {
  const st = standings(t);
  const ct = new Map(crosstable(t).map((r) => [r.playerId, r]));
  const order = st.map((r) => r.player);
  const rows: CrossRow[] = st.map((r) => {
    const row = ct.get(r.playerId)!;
    return {
      playerId: r.playerId,
      rank: r.rank,
      name: r.player.name,
      score: row.score,
      cells: order.map((o) => {
        if (o.id === r.playerId) return null;
        const cs = row.cells[o.id];
        if (!cs?.length) return "–";
        return cs.map((c) => fmtPoints(c.points)).join(" ");
      }),
    };
  });
  return { order, rows };
}

export type CertificateKind = "place" | "participant";
export interface Certificate {
  kind: CertificateKind;
  playerId: string;
  name: string;
  /** Plassering (delt plass gir samme tall). Bare for kind = place. */
  rank?: number;
  /** Flere på samme plassering. */
  shared?: boolean;
  score: number;
}

/**
 * Diplomer: alle med plassering 1–3 (delt plass gir flere diplomer på samme
 * plassering – neste plass hoppes over slik tabellen gjør). Valgfritt
 * deltakerdiplom til alle øvrige.
 */
export function certificatesFor(t: PhysicalTournament, opts: { participants?: boolean } = {}): Certificate[] {
  // Ingen diplomer før minst én runde er fullført (ellers deler alle 1. plass med 0 poeng).
  if (!t.rounds.some((r) => r.status === "completed")) return [];
  const st: StandingWithPlayer[] = standings(t);
  const sizeOf = new Map<number, number>();
  for (const r of st) sizeOf.set(r.rank, (sizeOf.get(r.rank) ?? 0) + 1);
  const out: Certificate[] = [];
  for (const r of st) {
    if (r.rank <= 3) {
      out.push({
        kind: "place",
        playerId: r.playerId,
        name: r.player.name,
        rank: r.rank,
        shared: (sizeOf.get(r.rank) ?? 1) > 1,
        score: r.score,
      });
    } else if (opts.participants) {
      out.push({ kind: "participant", playerId: r.playerId, name: r.player.name, score: r.score });
    }
  }
  return out;
}

/** Norsk datotekst, f.eks. «28. oktober 2026». */
export function dateText(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("nb-NO", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * URL i QR på bordkortet (M5a): resultatrapport-siden for dette brettet, når
 * turneringen er publisert og bordnøklene er hentet (de caches lokalt, så
 * utskrift virker uten nett etter ett oppslag). Ellers null – QR tegnes ikke.
 */
export function boardQrUrl(tournament: PhysicalTournament, round: number, board: number): string | null {
  return reportUrl(tournament.id, round, board);
}
