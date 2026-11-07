import { describe, expect, it } from "vitest";
import { afterEach, vi } from "vitest";
import {
  generateHostCode,
  generatePin,
  generateResumeCode,
  generateUnique,
  isHostCodeShape,
  isResumeCodeShape,
  isUuid,
  isValidPin,
  maskCode,
  normalizeResumeCode,
  type Rng,
} from "@/lib/codes";

// Deterministic RNG: cycles through a fixed sequence.
function seq(values: number[]): Rng {
  let i = 0;
  return () => values[i++ % values.length];
}

describe("generatePin", () => {
  it("is always 6 digits", () => {
    for (let i = 0; i < 200; i++) {
      const pin = generatePin();
      expect(pin).toMatch(/^\d{6}$/);
    }
  });
});

describe("generateResumeCode", () => {
  it("matches the AAAA-XX shape", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateResumeCode()).toMatch(/^[A-Z]{4}-[A-Z0-9]{2}$/);
    }
  });

  it("never contains ambiguous characters I O 0 1", () => {
    for (let i = 0; i < 500; i++) {
      const code = generateResumeCode();
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it("is deterministic under a fixed RNG", () => {
    const a = generateResumeCode(seq([0]));
    const b = generateResumeCode(seq([0]));
    expect(a).toBe(b);
    expect(a).toBe("AAAA-AA");
  });
});

describe("normalizeResumeCode", () => {
  it("uppercases and inserts the dash", () => {
    expect(normalizeResumeCode("kole7f")).toBe("KOLE-7F");
    expect(normalizeResumeCode("kole-7f")).toBe("KOLE-7F");
    expect(normalizeResumeCode(" KOLE 7F ")).toBe("KOLE-7F");
  });
});

describe("isValidPin", () => {
  it("accepts 6 digits only", () => {
    expect(isValidPin("402815")).toBe(true);
    expect(isValidPin("12345")).toBe(false);
    expect(isValidPin("abcdef")).toBe(false);
    expect(isValidPin(" 402815 ")).toBe(true);
  });
});

describe("isUuid", () => {
  it("accepts a well-formed v4 UUID, case-insensitively", () => {
    expect(isUuid("11111111-1111-4111-8111-111111111111")).toBe(true);
    expect(isUuid("11111111-1111-4111-8111-111111111111".toUpperCase())).toBe(true);
  });

  // Regression: GET /api/tournament/probe (bot scans, stale links) made the
  // store throw Postgres 22P02 for a non-UUID id — a client error the route
  // must catch itself, not let escape as a false 503 (R1b).
  it("rejects a bot-probe / non-UUID string", () => {
    expect(isUuid("probe")).toBe(false);
    expect(isUuid("")).toBe(false);
    expect(isUuid("12345")).toBe(false);
  });

  it("rejects a near-miss shape (wrong segment length, missing dashes)", () => {
    expect(isUuid("11111111-1111-4111-8111-11111111111")).toBe(false); // 11 not 12
    expect(isUuid("111111111111411181111111111111111")).toBe(false); // no dashes
  });

  it("rejects non-string input", () => {
    expect(isUuid(undefined)).toBe(false);
    expect(isUuid(null)).toBe(false);
    expect(isUuid(12345)).toBe(false);
  });
});

describe("maskCode", () => {
  it("replaces every character but the dash with a bullet", () => {
    expect(maskCode("KOLE-7F")).toBe("••••-••");
  });

  it("preserves length and dash position for any code shape", () => {
    expect(maskCode("AB-C")).toBe("••-•");
    expect(maskCode("ABCDEF")).toBe("••••••");
  });

  it("never leaks a letter or digit from the original code", () => {
    for (let i = 0; i < 200; i++) {
      const code = generateResumeCode();
      const masked = maskCode(code);
      expect(masked).not.toMatch(/[A-Z0-9]/);
      expect(masked.length).toBe(code.length);
      expect(masked.indexOf("-")).toBe(code.indexOf("-"));
    }
  });
});

describe("generateUnique", () => {
  it("retries until it finds a free code", () => {
    // First two draws collide with taken set, third is free.
    const taken = new Set(["AAAA-AA", "BBBB-BB"]);
    const rng = seq([0, 0, 0, 0, 0, 0, /* AAAA-AA */ ...new Array(6).fill(0)]);
    // Simpler: provide a gen that returns from a list.
    const codes = ["AAAA-AA", "BBBB-BB", "CCCC-CC"];
    let n = 0;
    const gen = () => codes[n++];
    expect(generateUnique(gen, taken, rng)).toBe("CCCC-CC");
  });
});

// H2: ny vertskode = 10 tegn, kryptografisk tilfeldig; elevkoden forblir kort og streng.
describe("generateHostCode (10 tegn)", () => {
  it("er XXXXX-XXXXX uten tvetydige tegn", () => {
    for (let i = 0; i < 300; i++) {
      const c = generateHostCode();
      expect(c).toMatch(/^[A-Z0-9]{5}-[A-Z0-9]{5}$/);
      expect(c).not.toMatch(/[IO01]/);
      expect(isHostCodeShape(c)).toBe(true);
      expect(normalizeResumeCode(c.toLowerCase().replace("-", " "))).toBe(c);
    }
  });

  it("er deterministisk med injisert Rng (testsømmen er beholdt)", () => {
    expect(generateHostCode(seq([0]))).toBe("AAAAA-AAAAA");
  });

  it("elevens gjenopptakskode er fortsatt kort", () => {
    expect(generateResumeCode()).toMatch(/^[A-Z]{4}-[A-Z0-9]{2}$/);
  });
});

describe("standard-RNG er crypto.getRandomValues, uten modulo-skjevhet", () => {
  afterEach(() => vi.restoreAllMocks());

  it("bruker crypto for PIN, elevkode og vertskode", () => {
    const spy = vi.spyOn(crypto, "getRandomValues");
    generatePin();
    generateResumeCode();
    generateHostCode();
    expect(spy).toHaveBeenCalled();
    // 6 + 6 + 10 tegn, hver minst ett kall
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(22);
  });

  it("forkaster verdier i den skjeve halen (rejection sampling)", () => {
    // 2^32 % 10 = 6 -> verdier >= 4294967290 må forkastes. Første trekk er i halen.
    const draws = [0xffff_ffff, 4_294_967_290, 7];
    let i = 0;
    vi.spyOn(crypto, "getRandomValues").mockImplementation(((buf: Uint32Array) => {
      buf[0] = draws[Math.min(i++, draws.length - 1)];
      return buf;
    }) as never);
    expect(generatePin()[0]).toBe("7"); // 0xffffffff og 4294967290 forkastet
  });

  it("alle sifre/tegn forekommer omtrent jevnt", () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 6000; i++) for (const ch of generatePin()) counts.set(ch, (counts.get(ch) ?? 0) + 1);
    expect(counts.size).toBe(10);
    for (const n of counts.values()) expect(n).toBeGreaterThan(3200); // forventet 3600
  });
});

describe("kodeformer: begge vertskode-former, elevkode uendret", () => {
  it("normaliserer 6 -> 4+2 og 10 -> 5+5, alt annet urørt", () => {
    expect(normalizeResumeCode("kole7f")).toBe("KOLE-7F");
    expect(normalizeResumeCode("k7mqx4rt9b")).toBe("K7MQX-4RT9B");
    expect(normalizeResumeCode(" k7mqx-4rt9b ")).toBe("K7MQX-4RT9B");
    expect(normalizeResumeCode("kole7f2")).toBe("KOLE7F2");
  });

  it("isHostCodeShape godtar gammel og ny; isResumeCodeShape (elev) er IKKE løsnet", () => {
    expect(isHostCodeShape("KOLE-7F")).toBe(true);
    expect(isHostCodeShape("K7MQX-4RT9B")).toBe(true);
    expect(isHostCodeShape("K7MQX4RT9B")).toBe(false); // ikke normalisert
    expect(isHostCodeShape("ABCDE-12")).toBe(false);
    expect(isResumeCodeShape("KOLE-7F")).toBe(true);
    expect(isResumeCodeShape("K7MQX-4RT9B")).toBe(false);
    expect(isResumeCodeShape("1234-56")).toBe(false);
  });
});
