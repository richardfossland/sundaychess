import { describe, expect, it } from "vitest";
import { gamesCsv, standingsCsv } from "@/lib/export/csv";
import { downloadBlob, safeFileName, type DownloadEnv } from "@/lib/export/download";
import { lastFirst, toAscii, trf16Text } from "@/lib/export/trf16";
import { newTournament, playRound } from "../physical/helpers";
import { randomTournament } from "./gen";
import { goldenTournament } from "./fixture";

// Håndkontrollert mot FIDE C.04 Annex 2 (TRF16): kolonnene er verifisert under.
const TRF_GOLDEN = [
  "012 Skolemesterskap Aas",
  "022",
  "032 NOR",
  "042 2026/10/28",
  "052 2026/10/28",
  "062 5",
  "072 3",
  "092 Monrad",
  "102",
  "122",
  "001    1      Nordmann, Ola                     1800                             2.0    2     2 w 1     3 b 1",
  "001    2      Oestby, Aase                      1650                             0.0    5     1 b 0     5 w -",
  "001    3      Hansen-Berg, Kari                                                  0.5    4     4 w =     1 w 0",
  "001    4      Aesoey, Bjoern                    1200                             1.0    3     3 b =     0 - H",
  "001    5      Li                                                                 2.0    1     0 - U     2 b +",
].join("\r\n") + "\r\n";

describe("TRF16", () => {
  it("golden", () => {
    expect(trf16Text(goldenTournament())).toBe(TRF_GOLDEN);
  });

  it("spillerlinjer har eksakte kolonner (1-basert)", () => {
    const lines = trf16Text(goldenTournament()).split("\r\n").filter((l) => l.startsWith("001"));
    const col = (l: string, from: number, to: number) => l.slice(from - 1, to);
    const l = lines[0];
    expect(col(l, 1, 3)).toBe("001");
    expect(col(l, 5, 8)).toBe("   1");
    expect(col(l, 10, 10)).toBe(" "); // kjønn
    expect(col(l, 15, 47).trimEnd()).toBe("Nordmann, Ola");
    expect(col(l, 49, 52)).toBe("1800");
    expect(col(l, 81, 84)).toBe(" 2.0");
    expect(col(l, 86, 89)).toBe("   2");
    // runde 1: motstander 92-95, farge 97, resultat 99; runde 2 fra 102
    expect([col(l, 92, 95), col(l, 97, 97), col(l, 99, 99)]).toEqual(["   2", "w", "1"]);
    expect([col(l, 102, 105), col(l, 107, 107), col(l, 109, 109)]).toEqual(["   3", "b", "1"]);
    // frirunde: 0000/blank, «-», U/H
    const li = lines[4];
    expect([col(li, 92, 95), col(li, 97, 97), col(li, 99, 99)]).toEqual(["   0", "-", "U"]);
    expect(lines[3].slice(101, 109)).toBe("   0 - H");
    for (const x of lines) expect(x).toMatch(/^[\x20-\x7e]+$/);
  });

  it("tilfeldige turneringer gir ren ASCII og konsistente linjer", () => {
    for (let s = 1; s <= 30; s++) {
      const t = randomTournament(s);
      const out = trf16Text(t);
      expect(out).toMatch(/^[\x20-\x7e\r\n]+$/);
      const done = t.rounds.filter((r) => r.status === "completed").length;
      const pl = out.split("\r\n").filter((l) => l.startsWith("001"));
      expect(pl).toHaveLength(t.players.length);
      for (const l of pl) expect(l.length).toBe(89 + 10 * done);
    }
  });

  it("navn og tegnsett", () => {
    expect(lastFirst("Ola Nordmann")).toBe("Nordmann, Ola");
    expect(lastFirst("Ola Henrik Nordmann")).toBe("Nordmann, Ola Henrik");
    expect(lastFirst("Nordmann, Ola")).toBe("Nordmann, Ola");
    expect(lastFirst("Li")).toBe("Li");
    expect(toAscii("Æsøy Ålesund Zoë Müller ✓")).toBe("Aesoey Aalesund Zoe Mueller ?");
  });

  it("XXR og tom turnering", () => {
    const t = newTournament({}, 4);
    expect(trf16Text(t, { xxr: true })).toContain("XXR 5\r\n");
    expect(trf16Text(t).split("\r\n").filter((l) => l.startsWith("001"))).toHaveLength(4);
  });

  it("ufullførte runder eksporteres ikke", () => {
    const t = playRound(newTournament({}, 4));
    const l = trf16Text(t).split("\r\n").find((x) => x.startsWith("001"))!;
    expect(l.length).toBe(99);
  });
});

describe("CSV", () => {
  it("golden: stilling", () => {
    expect(standingsCsv(goldenTournament())).toBe(
      "﻿#;Nr;Navn;Klasse;Rating;Poeng;Buchholz\r\n1;5;Li;;;2;4\r\n2;1;Ola Nordmann;7A;1800;2;0,5\r\n3;4;Bjørn Æsøy;7B;1200;1;1,5\r\n4;3;Kari Hansen-Berg;7A;;0,5;3\r\n5;2;Åse Østby;7B;1650;0;2\r\n",
    );
  });
  it("golden: partier", () => {
    expect(gamesCsv(goldenTournament())).toBe(
      "﻿Runde;Brett;Hvit;Svart;Resultat\r\n1;1;Ola Nordmann;Åse Østby;1-0\r\n1;2;Kari Hansen-Berg;Bjørn Æsøy;½-½\r\n1;3;Li;;Frirunde (1)\r\n2;1;Kari Hansen-Berg;Ola Nordmann;0-1\r\n2;2;Åse Østby;Li;0-1 (walkover)\r\n2;3;Bjørn Æsøy;;Frirunde (0,5)\r\n",
    );
  });
  it("formelinjeksjon og skilletegn i navn", () => {
    const t = randomTournament(8); // inneholder «=Formel Test» når nok spillere
    const csv = standingsCsv(t) + gamesCsv(t);
    expect(csv).not.toMatch(/;=Formel/);
    const t2 = newTournament({}, 2, "x");
    t2.players[0].name = 'Hansen; "Ola"';
    expect(standingsCsv(t2)).toContain('"Hansen; ""Ola"""');
  });
});

describe("nedlasting", () => {
  const fake = (supportsDownload: boolean) => {
    const calls: string[] = [];
    const a: Record<string, unknown> = { style: {}, click: () => calls.push("click"), remove: () => calls.push("remove") };
    if (supportsDownload) a.download = "";
    const env: DownloadEnv = {
      document: { createElement: () => a as unknown as HTMLElement, body: { appendChild: () => calls.push("append") } } as unknown as DownloadEnv["document"],
      URL: { createObjectURL: () => "blob:x", revokeObjectURL: () => {} },
      open: (u, t) => calls.push(`open ${u} ${t}`),
    };
    return { env, calls, a };
  };
  it("anker med download-attributt", () => {
    const { env, calls, a } = fake(true);
    expect(downloadBlob("f.json", new Blob(["x"]), env)).toBe("download");
    expect(a.download).toBe("f.json");
    expect(calls).toEqual(["append", "click", "remove"]);
  });
  it("fallback: åpner i ny fane uten download-støtte (iOS Safari)", () => {
    const { env, calls } = fake(false);
    expect(downloadBlob("f.json", new Blob(["x"]), env)).toBe("newtab");
    expect(calls).toEqual(["open blob:x _blank"]);
  });
  it("trygt filnavn", () => {
    expect(safeFileName('A/B:C*"?', ".trf")).toBe("ABC.trf");
    expect(safeFileName("  ", ".csv")).toBe("turnering.csv");
  });
});
