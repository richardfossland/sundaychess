import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INITIAL_RATING, MAX_SKILL } from "@/lib/chess/skill";

// vitest runs in the node environment (no jsdom), so provide a minimal
// localStorage. identity reads it lazily inside each call, so setting it per
// test is enough.
class MemStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null {
    return this.m.has(k) ? this.m.get(k)! : null;
  }
  setItem(k: string, v: string): void {
    this.m.set(k, String(v));
  }
  removeItem(k: string): void {
    this.m.delete(k);
  }
  clear(): void {
    this.m.clear();
  }
}

beforeEach(() => {
  (globalThis as unknown as { localStorage: MemStorage }).localStorage = new MemStorage();
});
afterEach(() => {
  delete (globalThis as unknown as { localStorage?: MemStorage }).localStorage;
});

import { identity } from "@/lib/client/identity";

describe("identity", () => {
  it("round-trips a stored player and clears it", () => {
    const p = { tournamentId: "t1", playerId: "p1", resumeCode: "ABCD-EF", displayName: "Ada" };
    identity.savePlayer(p);
    expect(identity.player()).toEqual(p);
    identity.clearPlayer();
    expect(identity.player()).toBeNull();
  });

  it("stores host codes per tournament", () => {
    identity.saveHostCode("t1", "WXYZ-12");
    expect(identity.hostCode("t1")).toBe("WXYZ-12");
    expect(identity.hostCode("t2")).toBeNull();
  });

  it("falls back to the initial rating when none is stored", () => {
    expect(identity.soloRating()).toEqual(INITIAL_RATING);
  });

  it("sanitises a corrupt stored rating (clamped, non-negative games)", () => {
    localStorage.setItem("sjakk:solo-rating", JSON.stringify({ rating: 999999, games: -5 }));
    const r = identity.soloRating();
    expect(r.rating).toBe(MAX_SKILL); // clamped down from 999999
    expect(r.games).toBe(0); // negative floored to 0
  });

  it("returns the initial rating when the stored JSON is garbage", () => {
    localStorage.setItem("sjakk:solo-rating", "{not json");
    expect(identity.soloRating()).toEqual(INITIAL_RATING);
  });
});
