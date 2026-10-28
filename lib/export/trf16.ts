// TRF16 – FIDE Tournament Report File (Handbook C.04 Annex 2, godkjent Elista 2015).
// Kolonner (1-basert) i spillerlinjen «001»:
//   1-3 «001» · 5-8 startnr · 10 kjønn · 11-13 tittel · 15-47 navn «Etternavn, Fornavn»
//   49-52 rating · 54-56 forbund · 58-68 FIDE-nr · 70-79 fødselsdato · 81-84 poeng («11.5»)
//   86-89 plassering · deretter 10-tegns blokk per runde fra kolonne 90:
//   «  ssss c r» = 2 blanke, motstanders startnr (92-95), blank, farge w/b/- (97), blank, resultat (99).
// Hver linje avsluttes med CR (Remark 1) – vi bruker CRLF.
//
// Tegnsett: spesifikasjonen sier ingenting om koding, og bbpPairings/JaVaFo teller kolonner i BYTER.
// Æ/Ø/Å i UTF-8 ville forskjøvet alle kolonner. Vi transliterer derfor til ren ASCII
// (æ→ae, ø→oe, å→aa, é→e osv.) – verdien er aldri lagret annerledes enn i appen, kun i fila.
//
// Bare FULLFØRTE runder eksporteres (en halvferdig runde har ingen gyldige resultater).

import { no } from "@/lib/locale/no";
import type { PhysicalPairing, PhysicalTournament, ResultCode } from "@/lib/physical/schema";
import { totalRounds } from "@/lib/physical/reducer";
import { standings } from "@/lib/physical/selectors";

export interface Trf16Options {
  city?: string;
  /** FIDE-forbundskode, standard NOR. */
  federation?: string;
  chiefArbiter?: string;
  /** Betenkningstid, f.eks. «15 min + 5 sek». */
  timeControl?: string;
  /** Legg til «XXR <runder>» (bbpPairings-utvidelse; trengs for `--dutch -c`). */
  xxr?: boolean;
}

const TRANSLIT: Record<string, string> = {
  æ: "ae", Æ: "Ae", ø: "oe", Ø: "Oe", å: "aa", Å: "Aa", ä: "ae", Ä: "Ae", ö: "oe", Ö: "Oe", ü: "ue", Ü: "Ue",
  ß: "ss", đ: "d", Đ: "D", ł: "l", Ł: "L", þ: "th", Þ: "Th", ð: "d", Ð: "D",
};

/** Ren ASCII (utskrivbart 0x20–0x7E). */
export function toAscii(s: string): string {
  let out = "";
  for (const ch of s.normalize("NFC")) {
    if (TRANSLIT[ch]) out += TRANSLIT[ch];
    else {
      const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
      out += base;
    }
  }
  return out.replace(/[^\x20-\x7e]/g, "?");
}

/** «Ola Nordmann» → «Nordmann, Ola». Navn som allerede har komma beholdes. Best effort. */
export function lastFirst(name: string): string {
  const n = name.trim().replace(/\s+/g, " ");
  if (n.includes(",")) return n;
  const i = n.lastIndexOf(" ");
  return i < 0 ? n : `${n.slice(i + 1)}, ${n.slice(0, i)}`;
}

function put(buf: string[], col: number, text: string, width: number, align: "l" | "r" = "l") {
  const t = text.length > width ? text.slice(0, width) : text;
  const s = align === "l" ? t.padEnd(width, " ") : t.padStart(width, " ");
  for (let i = 0; i < width; i++) buf[col - 1 + i] = s[i];
}

const ymd = (iso: string) => iso.slice(0, 10).replace(/-/g, "/");

interface Cell {
  opp: number;
  colour: "w" | "b" | "-";
  code: string;
}
const ABSENT: Cell = { opp: 0, colour: "-", code: "Z" };

function cellFor(pl: string, p: PhysicalPairing | undefined, startNo: Map<string, number>): Cell {
  if (!p) return ABSENT;
  if (p.black === null) {
    const code = p.byeType === "half" ? "H" : p.byeType === "zero" ? "Z" : "U";
    return { opp: 0, colour: "-", code };
  }
  const white = p.white === pl;
  const opp = startNo.get(white ? p.black : p.white) ?? 0;
  const r = p.result as ResultCode;
  const colour = white ? "w" : "b";
  let code: string;
  switch (r) {
    case "1-0": code = white ? "1" : "0"; break;
    case "0-1": code = white ? "0" : "1"; break;
    case "½-½": code = "="; break;
    case "+-": code = white ? "+" : "-"; break;
    case "-+": code = white ? "-" : "+"; break;
    default: code = "-"; // «=» begge uteble: forfeit-tap for begge
  }
  return { opp, colour, code };
}

export function trf16Text(t: PhysicalTournament, opts: Trf16Options = {}): string {
  const done = t.rounds.filter((r) => r.status === "completed");
  const rows = new Map(standings(t).map((r) => [r.playerId, r]));
  const startNo = new Map(t.players.map((p) => [p.id, p.startNo]));
  const lastAt = t.events[t.events.length - 1]?.at ?? t.createdAt;
  const typ = no.physical.systems[t.settings.system].label;
  const header: [string, string][] = [
    ["012", toAscii(t.title)],
    ["022", toAscii(opts.city ?? "")],
    ["032", toAscii(opts.federation ?? "NOR")],
    ["042", ymd(t.createdAt)],
    ["052", ymd(lastAt)],
    ["062", String(t.players.length)],
    ["072", String(t.players.filter((p) => p.rating !== undefined).length)],
    ["092", toAscii(typ)],
    ["102", toAscii(opts.chiefArbiter ?? "")],
    ["122", toAscii(opts.timeControl ?? "")],
  ];
  const lines = header.map(([k, v]) => `${k} ${v}`.trimEnd());

  for (const p of [...t.players].sort((a, b) => a.startNo - b.startNo)) {
    const buf = new Array<string>(89 + 10 * done.length).fill(" ");
    put(buf, 1, "001", 3);
    put(buf, 5, String(p.startNo), 4, "r");
    put(buf, 15, toAscii(lastFirst(p.name)), 33);
    if (p.rating !== undefined) put(buf, 49, String(p.rating), 4, "r");
    const row = rows.get(p.id);
    put(buf, 81, (row?.score ?? 0).toFixed(1), 4, "r");
    put(buf, 86, String(row?.rank ?? 0), 4, "r");
    done.forEach((r, i) => {
      const c = cellFor(p.id, r.pairings.find((x) => x.white === p.id || x.black === p.id), startNo);
      const base = 90 + 10 * i;
      put(buf, base + 2, String(c.opp), 4, "r");
      put(buf, base + 7, c.colour, 1);
      put(buf, base + 9, c.code, 1);
    });
    lines.push(buf.join("").trimEnd());
  }
  if (opts.xxr) lines.push(`XXR ${totalRounds(t)}`);
  return lines.join("\r\n") + "\r\n";
}
