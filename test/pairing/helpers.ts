import type { GameResult, HistoryGame, PairingOutput, PairingPlayer } from "@/lib/tournament/pairing";

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mk(n: number): PairingPlayer[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    startNo: i + 1,
    score: 0,
    status: "active" as const,
  }));
}

const PTS: Record<GameResult, [number, number]> = {
  "1-0": [1, 0],
  "0-1": [0, 1],
  "1/2-1/2": [0.5, 0.5],
  "0-0": [0, 0],
  bye: [1, 0],
};

export function scoresFrom(ids: string[], history: HistoryGame[]): Map<string, number> {
  const s = new Map(ids.map((id) => [id, 0]));
  for (const g of history) {
    const [w, b] = PTS[g.result];
    const wp = g.black === null && g.byeType === "half" ? 0.5 : g.black === null && g.byeType === "zero" ? 0 : w;
    s.set(g.white, (s.get(g.white) ?? 0) + wp);
    if (g.black) s.set(g.black, (s.get(g.black) ?? 0) + b);
  }
  return s;
}

export function toHistory(round: number, out: PairingOutput, rng: () => number): HistoryGame[] {
  return out.pairings.map((p) => {
    if (p.black === null) {
      return { round, white: p.white, black: null, result: "bye" as const, byeType: p.byeType };
    }
    const r = rng();
    const result: GameResult = r < 0.4 ? "1-0" : r < 0.8 ? "0-1" : "1/2-1/2";
    return { round, white: p.white, black: p.black, result };
  });
}
