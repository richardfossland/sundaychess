import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { escapeTag, exportRound, finalFen, gamePgn, pgnFileName, terminationFor, tournamentPgn } from "@/lib/export/pgn";

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
[Termination "Sjakkmatt"]

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

  it("erstatter anførselstegn og bakoverskråstrek (chess.js leser ikke \\\")", () => {
    expect(escapeTag('A "B" \\C')).toBe("A ”B” /C");
    const out = gamePgn({ event: 'Cup "X"', white: 'O"la', black: "K\\ari", status: "draw", pgn: "", date });
    expect(out).toContain('[Event "Cup ”X”"]');
    expect(out).toContain('[Black "K/ari"]');
    new Chess().loadPgn(out);
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

describe("Termination", () => {
  const mate = stored(SCHOLAR);
  const some = stored(["e4", "e5", "Nf3"]);
  it("sjakkmatt og oppgivelse skilles (resultatet er riktig, ikke *)", () => {
    expect(terminationFor({ status: "white_win", pgn: mate, resultSource: "play" })).toBe("Sjakkmatt");
    expect(terminationFor({ status: "black_win", pgn: some, resultSource: "play" })).toBe("Oppgivelse");
    const out = gamePgn({ event: "T", white: "A", black: "B", status: "black_win", pgn: some, resultSource: "play", date });
    expect(out).toContain('[Result "0-1"]');
    expect(out).toContain('[Termination "Oppgivelse"]');
    expect(out.trimEnd().endsWith("0-1")).toBe(true);
  });
  it("result_source styrer taggen", () => {
    const t = (resultSource: Parameters<typeof terminationFor>[0]["resultSource"], status = "white_win") =>
      terminationFor({ status, pgn: some, resultSource });
    expect(t("teacher_override")).toBe("Avgjort av lærer");
    expect(t("walkover")).toBe("Walkover");
    expect(t("opponent_absent")).toBe("Motstanderen møtte ikke");
    expect(t("timeout_draw", "draw")).toBe("Rundetiden gikk ut (remis)");
    expect(t("physical")).toBe("Spilt over brettet");
    expect(t("bye")).toBeUndefined();
  });
  it("remis: patt, avtalt, og ingen tagg for uavgjort", () => {
    // Patt: FEN-oppsett der svart er i patt etter siste trekk.
    const patt = '[SetUp "1"]\n[FEN "7k/8/5K2/8/8/8/8/6Q1 w - - 0 1"]\n\n1. Qg6 *';
    expect(terminationFor({ status: "draw", pgn: patt })).toBe("Patt");
    expect(terminationFor({ status: "draw", pgn: some })).toBe("Remis avtalt");
    expect(terminationFor({ status: "live", pgn: some })).toBeUndefined();
  });
});

describe("sluttspillrunder", () => {
  const rounds = [
    { id: "l1", number: 1, phase: "league" },
    { id: "l2", number: 2, phase: "league" },
    { id: "p1", number: 1, phase: "playoff" },
    { id: "p2", number: 2, phase: "playoff" },
  ];
  it("sluttspillrunde n eksporteres som ligaRunder + n", () => {
    expect(exportRound(rounds, "l1")).toBe(1);
    expect(exportRound(rounds, "l2")).toBe(2);
    expect(exportRound(rounds, "p1")).toBe(3);
    expect(exportRound(rounds, "p2")).toBe(4);
    expect(exportRound(rounds, "ukjent")).toBeNull();
  });
  it("tournamentPgn gir unike Round-tagger og sorterer ligarunder før sluttspill", () => {
    const g = (roundId: string, board: number) => ({
      event: "T", white: "A", black: "B", status: "draw" as const, pgn: stored(["e4", "e5"]), date,
      round: exportRound(rounds, roundId)!, board,
    });
    const out = tournamentPgn([g("p1", 1), g("l2", 1), g("l1", 1)]);
    const order = [...out.matchAll(/\[Round "(\d+)"\]/g)].map((m) => m[1]);
    expect(order).toEqual(["1", "2", "3"]);
  });
});

describe("anførselstegn og skråstrek i navn", () => {
  it("escapeTag gir ingen \\ eller \" inne i verdien", () => {
    expect(escapeTag('O"la')).toBe("O”la");
    expect(escapeTag("A\\B")).toBe("A/B");
  });
  it("rundtur: chess.js leser tilbake en fil med O\"la og tittel med \"", () => {
    const out = gamePgn({ event: 'Skole "cup" a\\b', white: 'O"la', black: "Kari", status: "white_win", pgn: stored(SCHOLAR), date });
    const c = new Chess();
    c.loadPgn(out);
    expect(c.getHeaders().White).toBe("O”la");
    expect(c.getHeaders().Event).toBe("Skole ”cup” a/b");
    expect(c.isCheckmate()).toBe(true);
  });
});
