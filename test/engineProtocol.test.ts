import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import { handleEngineRequest } from "@/lib/chess/engineProtocol";
import { evaluateFen } from "@/lib/chess/bot";
import { adviceMap, moveAdvice } from "@/lib/chess/coach";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const HANGING_Q = "4k3/8/8/3q4/4P3/8/8/4K3 w - - 0 1";

describe("handleEngineRequest", () => {
  it("echoes the id it was given — the client matches replies by it", async () => {
    for (const id of [1, 7, 9999]) {
      const r = await handleEngineRequest({ id, mode: "eval", fen: START });
      expect(r.id).toBe(id);
    }
  });

  it("eval mode returns exactly what evaluateFen returns", async () => {
    const r = await handleEngineRequest({ id: 1, mode: "eval", fen: HANGING_Q });
    expect(r).toEqual({ id: 1, evaluation: evaluateFen(HANGING_Q) });
  });

  it("eval mode honours an explicit depth", async () => {
    const r = await handleEngineRequest({ id: 2, mode: "eval", fen: HANGING_Q, depth: 1 });
    expect(r).toEqual({ id: 2, evaluation: evaluateFen(HANGING_Q, 1) });
  });

  it("advice mode returns the whole map, agreeing with moveAdvice", async () => {
    const r = (await handleEngineRequest({ id: 3, mode: "advice", fen: HANGING_Q })) as {
      id: number;
      advice: Record<string, unknown>;
    };
    expect(r.id).toBe(3);
    expect(r.advice).toEqual(adviceMap(HANGING_Q));
    expect(r.advice.e4d5).toEqual(moveAdvice(HANGING_Q, { from: "e4", to: "d5" }));
  });

  it("skill and level modes return a legal move", async () => {
    const reqs = [
      { id: 4, mode: "skill", fen: START, skill: 1200 },
      { id: 5, mode: "level", fen: START, level: "hard" },
      { id: 6, mode: "level", fen: START, level: "impossible" },
    ] as const;
    for (const req of reqs) {
      const r = (await handleEngineRequest(req)) as {
        id: number;
        move: { from: string; to: string; promotion?: string } | null;
      };
      expect(r.id).toBe(req.id);
      expect(r.move).not.toBeNull();
      const chess = new Chess(START);
      expect(() =>
        chess.move({ from: r.move!.from, to: r.move!.to, promotion: "q" }),
      ).not.toThrow();
    }
  });

  it("answers a nonsense position instead of throwing, shaped like the request", async () => {
    await expect(
      handleEngineRequest({ id: 7, mode: "advice", fen: "not a fen" }),
    ).resolves.toEqual({ id: 7, advice: {} });
    await expect(
      handleEngineRequest({ id: 8, mode: "eval", fen: "not a fen" }),
    ).resolves.toEqual({ id: 8, evaluation: { cp: 0, mate: null } });
    await expect(
      handleEngineRequest({ id: 9, mode: "level", fen: "not a fen", level: "easy" }),
    ).resolves.toEqual({ id: 9, move: null });
  });
});
