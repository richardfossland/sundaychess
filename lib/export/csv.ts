// CSV for norsk Excel: UTF-8 med BOM, `;` som skilletegn, CRLF, desimalkomma.
// Celler som begynner med = + - @ (tekst fra brukere) får en ' foran mot formelinjeksjon.

import { no } from "@/lib/locale/no";
import type { PhysicalTournament } from "@/lib/physical/schema";
import { standings } from "@/lib/physical/selectors";

export const CSV_BOM = "﻿";
export const CSV_SEP = ";";

function cell(v: string | number | null | undefined, opts: { text?: boolean } = {}): string {
  if (v === null || v === undefined) return "";
  let s = typeof v === "number" ? String(v).replace(".", ",") : v;
  if (opts.text && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[";\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const row = (cells: string[]) => cells.join(CSV_SEP);

/** Tabell: Plass;Startnr;Navn;Klubb/klasse;Rating;Poeng;<tiebreaks i turneringens rekkefølge>. */
export function standingsCsv(t: PhysicalTournament): string {
  const p = no.physical;
  const tbs = t.settings.tiebreaks;
  const head = [p.rank, p.startNo, p.name, t.settings.groupLabel ?? "Klubb", p.rating, p.points, ...tbs.map((k) => no.tiebreaks[k].label)];
  const lines = [row(head.map((h) => cell(h)))];
  for (const r of standings(t)) {
    lines.push(
      row([
        cell(r.rank),
        cell(r.player.startNo),
        cell(r.player.name, { text: true }),
        cell(r.player.club, { text: true }),
        cell(r.player.rating),
        cell(r.score),
        ...tbs.map((k) => cell(r.values[k])),
      ]),
    );
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}

/** Partier: Runde;Brett;Hvit;Svart;Resultat. Frirunde: svart tom, resultat «Frirunde (poeng)». */
export function gamesCsv(t: PhysicalTournament): string {
  const p = no.physical;
  const name = (id: string | null) => (id ? t.players.find((x) => x.id === id)?.name ?? "" : "");
  const lines = [row([p.file.csvRound, p.board, p.white, p.black, p.result].map((h) => cell(h)))];
  for (const r of t.rounds) {
    if (r.status === "draft") continue;
    for (const g of [...r.pairings].sort((a, b) => a.board - b.board)) {
      const res =
        g.black === null
          ? `${p.bye} (${g.byeType === "half" ? "0,5" : g.byeType === "zero" ? "0" : "1"})`
          : g.result
            ? p.file.csvResults[g.result]
            : "";
      lines.push(row([cell(r.number), cell(g.board), cell(name(g.white), { text: true }), cell(name(g.black), { text: true }), cell(res)]));
    }
  }
  return CSV_BOM + lines.join("\r\n") + "\r\n";
}
