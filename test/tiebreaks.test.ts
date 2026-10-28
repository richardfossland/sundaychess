import { describe, expect, it } from "vitest";
import {
  computeStandings,
  resolveTiebreaks,
  TIEBREAK_KEYS,
  type TiebreakGame,
  type TiebreakKey,
} from "@/lib/tournament/tiebreaks";

const P = (...ids: string[]) => ids.map((id) => ({ id }));
const g = (round: number, white: string, black: string | null, result: TiebreakGame["result"], extra: Partial<TiebreakGame> = {}): TiebreakGame => ({
  round, white, black, result, ...extra,
});
const row = (rows: ReturnType<typeof computeStandings>, id: string) => rows.find((r) => r.playerId === id)!;

describe("golden: 4 spillere, 3 runder, ingen bye", () => {
  // R1 A-B 1-0, C-D 1/2; R2 A-C 1/2, B-D 1-0; R3 A-D 1-0, B-C 0-1
  const h = [
    g(1, "A", "B", "1-0"), g(1, "C", "D", "1/2-1/2"),
    g(2, "A", "C", "1/2-1/2"), g(2, "B", "D", "1-0"),
    g(3, "A", "D", "1-0"), g(3, "B", "C", "0-1"),
  ];
  // Poeng: A 2.5, B 1, C 2, D 0.5
  const rows = computeStandings(P("A", "B", "C", "D"), h, TIEBREAK_KEYS as TiebreakKey[]);
  it("poeng og Buchholz", () => {
    expect(row(rows, "A").score).toBe(2.5);
    expect(row(rows, "A").values.buchholz).toBe(3.5); // B1 + C2 + D0.5
    expect(row(rows, "A").values.buchholz_cut1).toBe(3); // 3.5 - 0.5
    expect(row(rows, "A").values.buchholz_median).toBe(1); // bare C=2 igjen? [0.5,1,2] -> 1
    expect(row(rows, "B").values.buchholz).toBe(5); // 2.5+0.5+2
  });
  it("Sonneborn-Berger, seire, progressiv", () => {
    // A: 1*1 + 0.5*2 + 1*0.5 = 2.5
    expect(row(rows, "A").values.sonneborn_berger).toBe(2.5);
    expect(row(rows, "A").values.wins).toBe(2);
    expect(row(rows, "A").values.progressive).toBe(1 + 1.5 + 2.5);
    expect(row(rows, "C").values.progressive).toBe(0.5 + 1 + 2);
  });
  it("rekkefølge", () => {
    expect(rows.map((r) => r.playerId)).toEqual(["A", "C", "B", "D"]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
  });
});

describe("bye, forfeit og uttrekk (virtuell motstander)", () => {
  // 3 runder. A bye R1 (full), A-B R2 1-0, A-C R3 1/2. B-C R1 1/2, C-B... 
  const h = [
    g(1, "A", null, "bye"),
    g(1, "B", "C", "1/2-1/2"),
    g(2, "A", "B", "1-0"),
    g(3, "A", "C", "1/2-1/2"),
    g(2, "C", "D", "1-0"),
    g(3, "B", "D", "1-0"),
  ];
  const rows = computeStandings(P("A", "B", "C", "D"), h, ["buchholz"]);
  it("full bye gir 1 poeng og virtuell motstand min(egen sum, ½×runder)", () => {
    // A = 1+1+0.5 = 2.5; cap = 1.5 → VO = 1.5. Opp: B(0.5+0+1=1.5), C(0.5+1+0.5=2).
    expect(row(rows, "A").score).toBe(2.5);
    expect(row(rows, "A").values.buchholz).toBe(1.5 + 1.5 + 2);
  });
  it("uttrekk/fravær: runder uten parti gir virtuell motstander og 0 poeng", () => {
    // D: R1 intet parti (VO), R2 tap mot C (2), R3 tap mot B (1.5). D=0, VO=min(0,1.5)=0
    expect(row(rows, "D").score).toBe(0);
    expect(row(rows, "D").values.buchholz).toBe(0 + 2 + 1.5);
  });
  it("halv bye gir ½ og telles ikke som seier", () => {
    const r = computeStandings(P("A", "B"), [g(1, "A", null, "bye", { byeType: "half" }), g(2, "A", "B", "1-0")], ["wins"]);
    expect(row(r, "A").score).toBe(1.5);
    expect(row(r, "A").values.wins).toBe(1);
  });
  it("forfeit: teller som parti i Buchholz, ikke som seier, ikke i innbyrdes/ARO", () => {
    const hist = [g(1, "A", "B", "1-0", { forfeit: true }), g(2, "A", "C", "1-0"), g(2, "B", "D", "1-0")];
    const r = computeStandings(
      [{ id: "A", rating: 1000 }, { id: "B", rating: 1200 }, { id: "C", rating: 1400 }, { id: "D", rating: 1600 }],
      hist, TIEBREAK_KEYS as TiebreakKey[],
    );
    expect(row(r, "A").values.wins).toBe(1); // kun over brettet
    expect(row(r, "A").values.buchholz).toBe(1 + 0); // B=1, C=0
    expect(row(r, "A").values.avg_opponent_rating).toBe(1400); // forfeit utelatt
  });
  it("ARO null når en spiller mangler rating", () => {
    const r = computeStandings([{ id: "A", rating: 1000 }, { id: "B" }], [g(1, "A", "B", "1-0")], ["avg_opponent_rating"]);
    expect(row(r, "A").values.avg_opponent_rating).toBeNull();
  });
  it("ARO avrundes halv opp", () => {
    const r = computeStandings(
      [{ id: "A", rating: 1000 }, { id: "B", rating: 1001 }, { id: "C", rating: 1000 }],
      [g(1, "A", "B", "1-0"), g(2, "A", "C", "1-0")], ["avg_opponent_rating"]);
    expect(row(r, "A").values.avg_opponent_rating).toBe(1001); // (1001+1000)/2 = 1000.5 → 1001
  });
});

describe("innbyrdes oppgjør (rekursiv minitabell)", () => {
  it("to like: den som vant innbyrdes, først", () => {
    const h = [g(1, "A", "B", "0-1"), g(1, "C", "D", "1-0"), g(2, "A", "C", "1-0"), g(2, "B", "D", "0-1")];
    // A: 1, B: 1, C: 1, D: 1 — alle 1 poeng
    const r = computeStandings(P("A", "B", "C", "D"), h, ["direct_encounter"]);
    expect(r.length).toBe(4);
  });
  it("tre i sirkel er likt → delt rang", () => {
    const h = [g(1, "A", "B", "1-0"), g(2, "B", "C", "1-0"), g(3, "C", "A", "1-0")];
    const r = computeStandings(P("A", "B", "C"), h, ["direct_encounter"]);
    expect(r.map((x) => x.rank)).toEqual([1, 1, 1]);
  });
  it("delvis splitt kjører prosedyren på nytt for gruppen som fortsatt er lik", () => {
    // A,B,C,D alle 1.5 av 3 mot hverandre i ring + ..., konstruer: A slår B,C,D (3);
    // gruppe {B,C,D} like på poeng via sirkel B>C>D>B (1 hver +0 mot A =1).
    const h = [
      g(1, "A", "B", "1-0"), g(1, "C", "D", "1-0"),
      g(2, "A", "C", "1-0"), g(2, "D", "B", "1-0"),
      g(3, "A", "D", "1-0"), g(3, "B", "C", "1-0"),
    ];
    const r = computeStandings(P("A", "B", "C", "D"), h, ["direct_encounter"]);
    expect(r[0].playerId).toBe("A");
    expect(r.slice(1).map((x) => x.rank)).toEqual([2, 2, 2]);
  });
  it("ikke alle har møtt hverandre → hopp til neste kriterium", () => {
    const h = [g(1, "A", "B", "1-0"), g(1, "C", "D", "0-1"), g(2, "B", "C", "1-0"), g(2, "A", "D", "0-1")];
    // A 1, B 1, C 0, D 2 ... A og B like (1); A har møtt B → minitabell A>B.
    const r = computeStandings(P("A", "B", "C", "D"), h, ["direct_encounter", "wins"]);
    expect(r[0].playerId).toBe("D");
    expect(r.map((x) => x.playerId).slice(1, 3)).toEqual(["A", "B"]);
  });
  it("to møter mellom samme par gir snittpoeng", () => {
    const h = [g(1, "A", "B", "1-0"), g(2, "B", "A", "1-0")];
    const r = computeStandings(P("A", "B"), h, ["direct_encounter"]);
    expect(r.map((x) => x.rank)).toEqual([1, 1]);
  });
});

describe("config", () => {
  it("resolveTiebreaks", () => {
    expect(resolveTiebreaks(undefined)).toEqual(["buchholz"]);
    expect(resolveTiebreaks(["wins", "x", "wins", "progressive"])).toEqual(["wins", "progressive"]);
    expect(resolveTiebreaks([])).toEqual(["buchholz"]);
  });
});

describe("egenskaper", () => {
  // Liten deterministisk PRNG (mulberry32) i stedet for ekstern avhengighet.
  const rng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  it("totalt, deterministisk, uavhengig av inndata-rekkefølge, rang monoton", () => {
    for (let seed = 1; seed <= 150; seed++) {
      const rand = rng(seed);
      const n = 2 + Math.floor(rand() * 7);
      const rounds = 1 + Math.floor(rand() * 5);
      const order = [...TIEBREAK_KEYS].filter(() => rand() < 0.6);
      if (!order.length) order.push("buchholz");
      const ids = Array.from({ length: n }, (_, i) => `p${i}`);
      const h: TiebreakGame[] = [];
      for (let r = 1; r <= rounds; r++) {
        const sh = [...ids].sort(() => rand() - 0.5);
        for (let i = 0; i + 1 < sh.length; i += 2) {
          const res = (["1-0", "0-1", "1/2-1/2"] as const)[Math.floor(rand() * 3)];
          h.push(g(r, sh[i], sh[i + 1], res, rand() < 0.1 ? { forfeit: true } : {}));
        }
        if (sh.length % 2) h.push(g(r, sh[sh.length - 1], null, "bye"));
      }
      const a = computeStandings(ids.map((id) => ({ id })), h, order);
      const b = computeStandings([...ids].reverse().map((id) => ({ id })), [...h].reverse(), order);
      expect(a).toEqual(b);
      expect(a.map((r) => r.playerId).sort()).toEqual([...ids].sort());
      for (let i = 1; i < a.length; i++) {
        expect(a[i].rank).toBeGreaterThanOrEqual(a[i - 1].rank);
        expect(a[i].score).toBeLessThanOrEqual(a[i - 1].score);
        if (a[i].rank === a[i - 1].rank) expect(a[i].score).toBe(a[i - 1].score);
        else expect(a[i].rank).toBe(i + 1);
      }
    }
  });
});
