import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import {
  piecesFromFen,
  speakIntent,
  speakMove,
  speakSquare,
  speakTransition,
} from "@/lib/chess/speak";

/** Spill sekvensen og gi teksten for siste trekk. */
function last(seq: string[], fen?: string): string {
  const c = fen ? new Chess(fen) : new Chess();
  let m = null;
  for (const s of seq) m = c.move(s);
  return speakMove(m!);
}

describe("speakMove", () => {
  it("vanlige trekk", () => {
    expect(last(["Nf3"])).toBe("Hvit springer til f3");
    expect(last(["e4"])).toBe("Hvit bonde til e4");
    expect(last(["e4", "e5", "Bc4"])).toBe("Hvit løper til c4");
    expect(last(["e4", "Nc6"])).toBe("Svart springer til c6");
  });

  it("slag", () => {
    expect(last(["e4", "d5", "exd5"])).toBe("Hvit bonde slår på d5");
    expect(last(["e4", "d5", "e5", "d4", "e6", "fxe6"])).toBe("Svart bonde slår på e6");
  });

  it("rokade begge veier", () => {
    const kort = last(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "O-O"]);
    expect(kort).toBe("Hvit rokade kort");
    const lang = last(["d4", "d5", "Nc3", "Nc6", "Bf4", "Bf5", "Qd2", "Qd7", "O-O-O"]);
    expect(lang).toBe("Hvit rokade lang");
    const svartKort = last(["e4", "e5", "Nf3", "Nf6", "Bc4", "Be7", "d3", "O-O"]);
    expect(svartKort).toBe("Svart rokade kort");
  });

  it("en passant", () => {
    expect(last(["e4", "a6", "e5", "d5", "exd6"])).toBe("Hvit bonde slår på d6 en passant");
  });

  it("forvandling, med og uten slag og sjakk", () => {
    const fen = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(last(["a8=Q"], fen)).toBe("Hvit bonde til a8, forvandles til dronning");
    expect(last(["a8=N"], fen)).toBe("Hvit bonde til a8, forvandles til springer");
    const slag = "1n6/P6k/8/8/8/8/8/K7 w - - 0 1";
    expect(last(["axb8=R"], slag)).toBe("Hvit bonde slår på b8, forvandles til tårn");
    // forvandling med sjakk
    const sjakk = "7k/P7/8/8/8/8/8/K7 w - - 0 1";
    expect(last(["a8=Q+"], sjakk)).toBe("Hvit bonde til a8, forvandles til dronning. Sjakk");
  });

  it("sjakk og sjakkmatt", () => {
    expect(last(["e4", "e5", "Qh5", "Nc6", "Bc4", "a6", "Qxf7#"])).toBe(
      "Hvit dronning slår på f7. Sjakkmatt",
    );
    expect(last(["e4", "f6", "Qh5+"])).toBe("Hvit dronning til h5. Sjakk");
  });
});

describe("speakIntent", () => {
  it("leser et trekk før det er spilt", () => {
    expect(speakIntent(new Chess().fen(), { from: "g1", to: "f3" })).toBe("Hvit springer til f3");
  });
  it("gir null for ulovlig trekk", () => {
    expect(speakIntent(new Chess().fen(), { from: "e2", to: "e5" })).toBeNull();
    expect(speakIntent("ugyldig", { from: "e2", to: "e4" })).toBeNull();
  });
  it("bruker valgt forvandlingsbrikke", () => {
    expect(
      speakIntent("8/P6k/8/8/8/8/8/K7 w - - 0 1", { from: "a7", to: "a8", promotion: "b" }),
    ).toBe("Hvit bonde til a8, forvandles til løper");
  });
});

describe("speakTransition", () => {
  it("gjenkjenner ett trekk mellom to stillinger", () => {
    const c = new Chess();
    const a = c.fen();
    c.move("e4");
    const b = c.fen();
    expect(speakTransition(a, b)).toBe("Hvit bonde til e4");
  });
  it("er stille for samme stilling, første innlasting og tilbakerulling", () => {
    const c = new Chess();
    const a = c.fen();
    c.move("e4");
    const b = c.fen();
    expect(speakTransition(b, b)).toBeNull();
    expect(speakTransition("", b)).toBeNull();
    expect(speakTransition(b, a)).toBeNull();
  });
  it("er stille når flere trekk har skjedd", () => {
    const c = new Chess();
    const a = c.fen();
    c.move("e4");
    c.move("e5");
    expect(speakTransition(a, c.fen())).toBeNull();
  });
  it("tåler at en-passant-felt og tellere avviker", () => {
    const a = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const b = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    expect(speakTransition(a, b)).toBe("Hvit bonde til e4");
  });
});

describe("rutenavn", () => {
  it("beskriver brikke og tom rute", () => {
    const p = piecesFromFen(new Chess().fen());
    expect(speakSquare("e2", p)).toBe("e2, hvit bonde");
    expect(speakSquare("e4", p)).toBe("e4, tom");
    expect(speakSquare("d8", p)).toBe("d8, svart dronning");
    expect(speakSquare("g1", p)).toBe("g1, hvit springer");
  });
});
