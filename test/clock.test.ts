import { describe, expect, it } from "vitest";
import { computeClocks, fmtClock } from "@/lib/chess/clock";

const T0 = "2026-06-10T10:00:00.000Z";
const at = (sec: number) => new Date(Date.parse(T0) + sec * 1000).toISOString();

describe("computeClocks", () => {
  it("charges think time to the side to move", () => {
    const c = computeClocks({
      clockSec: 180,
      startedAt: T0,
      moves: [],
      turn: "w",
      now: at(30),
      running: true,
    });
    expect(c.whiteMs).toBe(150_000);
    expect(c.blackMs).toBe(180_000);
    expect(c.flagged).toBeNull();
  });

  it("attributes each gap to the mover (odd ply = white)", () => {
    const c = computeClocks({
      clockSec: 180,
      startedAt: T0,
      moves: [
        { ply: 1, createdAt: at(10) }, // white thought 10s
        { ply: 2, createdAt: at(40) }, // black thought 30s
        { ply: 3, createdAt: at(45) }, // white thought 5s
      ],
      turn: "b",
      now: at(65), // black thinking 20s now
      running: true,
    });
    expect(c.whiteMs).toBe(180_000 - 15_000);
    expect(c.blackMs).toBe(180_000 - 50_000);
    expect(c.flagged).toBeNull();
  });

  it("flags the side to move at zero", () => {
    const c = computeClocks({
      clockSec: 60,
      startedAt: T0,
      moves: [{ ply: 1, createdAt: at(5) }],
      turn: "b",
      now: at(70), // black has thought 65s > 60s
      running: true,
    });
    expect(c.blackMs).toBe(0);
    expect(c.flagged).toBe("b");
    expect(c.whiteMs).toBe(55_000);
  });

  it("stops accruing when the game is over", () => {
    const c = computeClocks({
      clockSec: 60,
      startedAt: T0,
      moves: [{ ply: 1, createdAt: at(5) }],
      turn: "b",
      now: at(1000),
      running: false,
    });
    expect(c.blackMs).toBe(60_000);
    expect(c.flagged).toBeNull();
  });

  it("tolerates out-of-order clock skew without negative time", () => {
    const c = computeClocks({
      clockSec: 60,
      startedAt: at(10), // started AFTER the first move stamp (extend +1min case)
      moves: [{ ply: 1, createdAt: at(5) }],
      turn: "b",
      now: at(8),
      running: true,
    });
    expect(c.whiteMs).toBeLessThanOrEqual(60_000);
    expect(c.blackMs).toBeLessThanOrEqual(60_000);
    expect(c.whiteMs).toBeGreaterThanOrEqual(0);
    expect(c.blackMs).toBeGreaterThanOrEqual(0);
  });
});

describe("fmtClock", () => {
  it("formats minutes and tenths", () => {
    expect(fmtClock(125_000)).toBe("2:05");
    expect(fmtClock(60_000)).toBe("1:00");
    expect(fmtClock(19_500)).toBe("19.5");
    expect(fmtClock(0)).toBe("0.0");
  });
});
