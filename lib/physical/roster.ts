// Parser for innlimt spillerliste: «Navn; rating; klubb/klasse», én per linje.
// Støtter ; , og tab som skilletegn, anførselstegn («"Hansen, Ola"») og valgfri overskriftslinje.

import { no } from "@/lib/locale/no";

export interface RosterEntry {
  name: string;
  rating?: number;
  club?: string;
}
export interface RosterParse {
  entries: RosterEntry[];
  errors: { line: number; message: string }[];
}

function splitLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((x) => x.trim());
}

function detectSep(text: string): string {
  const first = text.split(/\r?\n/).find((l) => l.trim()) ?? "";
  for (const s of [";", "\t"]) if (first.includes(s)) return s;
  return ",";
}

const HEADER = /^(navn|name|spiller)$/i;

export function parseRoster(text: string): RosterParse {
  const entries: RosterEntry[] = [];
  const errors: RosterParse["errors"] = [];
  const sep = detectSep(text);
  const lines = text.split(/\r?\n/);
  let seenData = false;
  lines.forEach((raw, i) => {
    if (!raw.trim()) return;
    const cols = splitLine(raw, sep);
    if (!seenData && HEADER.test(cols[0])) {
      seenData = true;
      return;
    }
    seenData = true;
    const name = cols[0].replace(/\s+/g, " ");
    if (!name) return void errors.push({ line: i + 1, message: no.physical.errors.nameRequired });
    if (name.length > 80) return void errors.push({ line: i + 1, message: no.physical.errors.nameRequired });
    let rating: number | undefined;
    if (cols[1]) {
      const r = Number(cols[1].replace(/\s/g, ""));
      if (!Number.isInteger(r) || r < 0 || r > 3500) {
        return void errors.push({ line: i + 1, message: no.physical.errors.badRating });
      }
      rating = r;
    }
    const club = cols.slice(2).join(" ").trim().slice(0, 60);
    entries.push({ name, ...(rating !== undefined ? { rating } : {}), ...(club ? { club } : {}) });
  });
  return { entries, errors };
}
