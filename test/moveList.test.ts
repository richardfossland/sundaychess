import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { sansFromPgn } from "@/lib/client/MoveList";

describe("sansFromPgn", () => {
  it("returns the SAN half-move sequence from a PGN", () => {
    const c = new Chess();
    for (const san of ["e4", "e5", "Nf3", "Nc6"]) c.move(san);
    expect(sansFromPgn(c.pgn())).toEqual(["e4", "e5", "Nf3", "Nc6"]);
  });

  it("returns [] for an empty or whitespace PGN", () => {
    expect(sansFromPgn("")).toEqual([]);
    expect(sansFromPgn("   ")).toEqual([]);
  });

  it("returns [] for an unparseable PGN", () => {
    expect(sansFromPgn("this is not a pgn 99. Zz99")).toEqual([]);
  });

  it("preserves check/mate/capture glyphs in SAN", () => {
    const c = new Chess();
    for (const san of ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]) c.move(san);
    const sans = sansFromPgn(c.pgn());
    expect(sans[sans.length - 1]).toBe("Qxf7#");
  });
});
