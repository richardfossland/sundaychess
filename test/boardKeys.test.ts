import { describe, expect, it } from "vitest";
import { stepSquare } from "@/lib/client/BoardKeys";
import { loadConfirmMoves, saveConfirmMoves } from "@/lib/client/confirmMoves";

describe("stepSquare (piltaster følger brettets visuelle retning)", () => {
  it("hvit nederst: opp = høyere rad, høyre = høyere linje", () => {
    expect(stepSquare("e2", "ArrowUp", "white")).toBe("e3");
    expect(stepSquare("e2", "ArrowDown", "white")).toBe("e1");
    expect(stepSquare("e2", "ArrowRight", "white")).toBe("f2");
    expect(stepSquare("e2", "ArrowLeft", "white")).toBe("d2");
  });
  it("svart nederst: alt speilvendt", () => {
    expect(stepSquare("e7", "ArrowUp", "black")).toBe("e6");
    expect(stepSquare("e7", "ArrowDown", "black")).toBe("e8");
    expect(stepSquare("e7", "ArrowRight", "black")).toBe("d7");
    expect(stepSquare("e7", "ArrowLeft", "black")).toBe("f7");
  });
  it("stopper ved kanten", () => {
    expect(stepSquare("a1", "ArrowLeft", "white")).toBeNull();
    expect(stepSquare("h8", "ArrowUp", "white")).toBeNull();
    expect(stepSquare("a8", "ArrowLeft", "black")).toBe("b8");
    expect(stepSquare("h1", "ArrowLeft", "black")).toBeNull();
  });
});

describe("trekkbekreftelse (lagring)", () => {
  it("er av som standard, og tåler at localStorage kaster", () => {
    // node-miljø: ingen window → getItem kaster → standard (av)
    expect(loadConfirmMoves()).toBe(false);
    expect(() => saveConfirmMoves).not.toThrow();
  });
});
