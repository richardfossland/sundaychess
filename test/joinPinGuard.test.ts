import { beforeEach, describe, expect, it, vi } from "vitest";

// Wrong-PIN counting is per DEVICE (cookie) with a high per-IP ceiling, so a class
// behind one school IP is never locked out by a few typos (same split as /open).
const store = vi.hoisted(() => ({ counts: new Map<string, number>() }));
vi.mock("@/lib/server/attempts", () => ({
  isCodeBlocked: async (scope: string, _r: Request, o: { max?: number } = {}) => (store.counts.get(scope) ?? 0) >= (o.max ?? 20),
  registerCodeFailure: async (scope: string, _r: Request, o: { max?: number } = {}) => {
    const n = (store.counts.get(scope) ?? 0) + 1;
    store.counts.set(scope, n);
    return n >= (o.max ?? 20);
  },
}));
vi.mock("@/lib/server/store", () => ({
  getTournamentByPin: async () => null,
  addPlayer: vi.fn(),
  listPlayers: vi.fn(),
  claimPlayer: vi.fn(),
}));
vi.mock("@/lib/server/broadcast", () => ({ broadcast: vi.fn(async () => {}) }));

import { POST as join } from "@/app/api/join/route";
import { POST as names } from "@/app/api/join/names/route";
import { __resetRateLimiter } from "@/lib/server/http";

const dev = (i: number) => `sc_dev=${i.toString(16).padStart(32, "0")}`;
const req = (url: string, cookie?: string) =>
  new Request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": "10.1.1.1", "cf-connecting-ip": "10.1.1.1", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify({ pin: "123456", displayName: "A" }),
  });

beforeEach(() => {
  store.counts.clear();
  __resetRateLimiter();
});

describe("PIN guess guard", () => {
  it("30 devices on one IP each mistyping once are NOT blocked (404, never 429)", async () => {
    for (let i = 1; i <= 30; i++) {
      expect((await names(req("http://x/api/join/names", dev(i)))).status).toBe(404);
      expect((await join(req("http://x/api/join", dev(i)))).status).toBe(404);
    }
  });

  it("one device guessing 20 times is blocked, other devices are not", async () => {
    for (let i = 0; i < 20; i++) await names(req("http://x/api/join/names", dev(1)));
    expect((await names(req("http://x/api/join/names", dev(1)))).status).toBe(429);
    expect((await names(req("http://x/api/join/names", dev(2)))).status).toBe(404);
  });

  it("sets an httpOnly device cookie scoped to /api/join when missing", async () => {
    const r = await names(req("http://x/api/join/names"));
    expect(r.headers.get("set-cookie")).toMatch(/^sc_dev=[0-9a-f]{32}; Path=\/api\/join; HttpOnly/);
  });

  it("the IP ceiling (200) still stops a guesser who rotates the cookie", async () => {
    store.counts.set("pin", 199);
    expect((await names(req("http://x/api/join/names", dev(7)))).status).toBe(429);
  });
});
