import { describe, expect, it } from "vitest";
import {
  commitDraft,
  draftHint,
  draftState,
  liveValue,
  parseDraft,
  sanitizeDraft,
} from "@/lib/client/numberDraft";

const words = { max: (n: number) => `Maks ${n}`, min: (n: number) => `Minst ${n}` };

describe("sanitizeDraft", () => {
  it("keeps digits only", () => {
    expect(sanitizeDraft("12abc", false)).toBe("12");
    expect(sanitizeDraft(" 4 5 ", false)).toBe("45");
    expect(sanitizeDraft("abc", false)).toBe("");
    expect(sanitizeDraft("3.7", false)).toBe("37");
  });
  it("drops leading zeros but keeps a lone zero", () => {
    expect(sanitizeDraft("02", false)).toBe("2");
    expect(sanitizeDraft("007", false)).toBe("7");
    expect(sanitizeDraft("0", false)).toBe("0");
    expect(sanitizeDraft("000", false)).toBe("0");
  });
  it("allows a leading minus only when negatives are allowed", () => {
    expect(sanitizeDraft("-5", true)).toBe("-5");
    expect(sanitizeDraft("-", true)).toBe("-");
    expect(sanitizeDraft("-05", true)).toBe("-5");
    expect(sanitizeDraft("1-2", true)).toBe("12");
    expect(sanitizeDraft("-5", false)).toBe("5");
    expect(sanitizeDraft("-", false)).toBe("");
  });
});

describe("clear then type (the courts bug)", () => {
  // Field shows "2" (min 1, max 12). User clears it and types 3.
  it("reports nothing while empty, then exactly 3", () => {
    expect(liveValue(sanitizeDraft("", false), 1, 12)).toBeNull();
    expect(liveValue(sanitizeDraft("3", false), 1, 12)).toBe(3);
  });
  it("typing 1 then 2 passes through 1 and lands on 12, never jumps", () => {
    expect(liveValue("1", 1, 12)).toBe(1);
    expect(liveValue("12", 1, 12)).toBe(12);
  });
  it("a below-min intermediate (min 2) is not reported, and fixes itself", () => {
    expect(liveValue("1", 2, 24)).toBeNull();
    expect(liveValue("16", 2, 24)).toBe(16);
  });
  it("win-points: clearing then typing 2 gives 2, not 02", () => {
    const d = sanitizeDraft("02", false);
    expect(d).toBe("2");
    expect(liveValue(d, 0, 100)).toBe(2);
  });
});

describe("draftState / hints", () => {
  it("classifies against the bounds", () => {
    expect(draftState("", 1, 12)).toBe("empty");
    expect(draftState("-", -5, 5)).toBe("empty");
    expect(draftState("0", 1, 12)).toBe("low");
    expect(draftState("13", 1, 12)).toBe("high");
    expect(draftState("12", 1, 12)).toBe("ok");
    expect(draftState("99999999999999999999", 1, 12)).toBe("high");
  });
  it("hints name the bound that was broken", () => {
    expect(draftHint("13", 1, 12, words)).toBe("Maks 12");
    expect(draftHint("1", 2, 24, words)).toBe("Minst 2");
    expect(draftHint("5", 2, 24, words)).toBeNull();
    expect(draftHint("", 2, 24, words)).toBeNull();
  });
});

describe("commitDraft (blur / Enter)", () => {
  it("clamps an out-of-range draft to the nearest bound", () => {
    expect(commitDraft("99", 1, 12)).toBe(12);
    expect(commitDraft("0", 1, 12)).toBe(1);
    expect(commitDraft("-9", -5, 5)).toBe(-5);
    expect(commitDraft("99999999999999999999", 1, 12)).toBe(12);
  });
  it("an empty draft falls back to the minimum", () => {
    expect(commitDraft("", 2, 24)).toBe(2);
    expect(commitDraft("-", 0, 100)).toBe(0);
  });
  it("keeps an in-range draft", () => {
    expect(commitDraft("8", 2, 24)).toBe(8);
  });
});

describe("paste", () => {
  it("«12abc» pastes as 12", () => {
    const d = sanitizeDraft("12abc", false);
    expect(parseDraft(d)).toBe(12);
    expect(liveValue(d, 1, 240)).toBe(12);
  });
  it("a pasted over-max number is held as a draft and clamped on commit", () => {
    const d = sanitizeDraft("500", false);
    expect(liveValue(d, 0, 100)).toBeNull();
    expect(commitDraft(d, 0, 100)).toBe(100);
  });
});

describe("negative numbers", () => {
  it("parse and range-check when allowed", () => {
    expect(parseDraft("-5")).toBe(-5);
    expect(liveValue("-5", -240, 240)).toBe(-5);
    expect(liveValue("-300", -240, 240)).toBeNull();
    expect(commitDraft("-300", -240, 240)).toBe(-240);
  });
  it("a lone minus is unfinished, not a value", () => {
    expect(parseDraft("-")).toBeNull();
  });
  it("a minus is stripped when not allowed", () => {
    expect(parseDraft(sanitizeDraft("-5", false))).toBe(5);
  });
});
