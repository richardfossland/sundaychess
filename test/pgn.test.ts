import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { escapeTag, finalFen, gamePgn, pgnFileName, tournamentPgn } from "@/lib/export/pgn";

function stored(sans: string[]): string {
  const c = new Chess();
  for (const s of sans) c.move(s);
  return c.pgn();
}
const SCHOLAR = ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"];
const date = new Date(2026, 10, 2);

describe("gamePgn", () => {
  it("golden: Skolematt", () => {
    expect(
      gamePgn({ event: "Skoleturnering", round: 2, board: 3, white: "Ola", black: "Kari", status: "white_win", pgn: stored(SCHOLAR), date }),
    ).toBe(
      `[Event "Skoleturnering"]
[Site "chess.sundaysuite.app"]
[Date "2026.11.02"]
[Round "2"]
[White "Ola"]
[Black "Kari"]
[Result "1-0"]
[Board "3"]

1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0
`,
    );
  });

  it("golden: remis og oppgivelse", () => {
    const draw = gamePgn({ event: "T", round: 1, board: 1, white: "A", black: "B", status: "draw", pgn: stored(["e4", "e5"]), date });
    expect(draw).toContain('[Result "1/2-1/2"]');
    expect(draw.trimEnd().endsWith("1. e4 e5 1/2-1/2")).toBe(true);
    const res = gamePgn({ event: "T", white: "A", black: "B", status: "black_win", pgn: stored(["e4", "e5", "Nf3"]), date, termination: "Oppgivelse" });
    expect(res).toContain('[Round "-"]');
    expect(res).toContain('[Termination "Oppgivelse"]');
    expect(res.trimEnd().endsWith("1. e4 e5 2. Nf3 0-1")).toBe(true);
  });

  it("rundtur gir samme sluttstilling", () => {
    const pgn = stored(SCHOLAR);
    const out = gamePgn({ event: "T", white: "A", black: "B", status: "white_win", pgn, date });
    const c = new Chess();
    c.loadPgn(out);
    expect(c.fen()).toBe(finalFen(pgn));
    expect(c.isCheckmate()).toBe(true);
  });

  it("escaper anførselstegn og bakoverskråstrek", () => {
    expect(escapeTag('A "B" \\C')).toBe('A \\"B\\" \\\\C');
    const out = gamePgn({ event: 'Cup "X"', white: 'O"la', black: "K\\ari", status: "draw", pgn: "", date });
    expect(out).toContain('[Event "Cup \\"X\\""]');
    expect(out).toContain('[Black "K\\\\ari"]');
    // chess.js 1.x leser ikke \" i tagger (standarden krever det); bakoverskråstrek leses fint.
    new Chess().loadPgn(gamePgn({ event: "T", white: "O\\la", black: "K", status: "draw", pgn: "", date }));
  });
});

describe("tournamentPgn", () => {
  const g = (round: number, board: number, status: string, white = "W") => ({
    event: "T", round, board, white, black: "B", status: status as "draw", pgn: stored(["e4"]), date,
  });
  it("hopper over uavgjorte og sorterer på runde/bord", () => {
    const out = tournamentPgn([g(2, 1, "draw", "R2B1"), g(1, 2, "white_win", "R1B2"), g(1, 1, "live", "LIVE"), g(1, 1, "black_win", "R1B1")]);
    expect(out).not.toContain("LIVE");
    const order = [...out.matchAll(/\[White "([^"]+)"\]/g)].map((m) => m[1]);
    expect(order).toEqual(["R1B1", "R1B2", "R2B1"]);
    expect(out.split("\n\n\n").length).toBe(1);
    expect(out).toMatch(/1\. e4 0-1\n\n\[Event/);
  });
});

describe("pgnFileName", () => {
  it("slug med runde/bord", () => {
    expect(pgnFileName("Høst-cup 2026!", 2, 3)).toBe("host-cup-2026-runde-2-bord-3.pgn");
    expect(pgnFileName("Æble", null, null)).toBe("aeble.pgn");
  });
});
