import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// Two-isolate simulation: REAL attempts.ts + REAL authHost against a fake
// code_attempts table. "Switching isolate" = __resetAttemptsCache() (each
// isolate has its own in-memory cache; the DB is shared).
const { getTournament, db, rpcCalls } = vi.hoisted(() => ({
  getTournament: vi.fn(),
  db: { failures: 0 },
  rpcCalls: [] as string[],
}));
vi.mock("@/lib/server/store", () => ({ getPlayer: vi.fn(), getTournament }));
vi.mock("@/lib/supabase/auth-server", () => ({ createAuthClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (fn: string, a: { p_max: number }) => {
      rpcCalls.push(fn);
      if (fn === "register_code_failure") {
        db.failures += 1;
        return { data: db.failures >= a.p_max, error: null };
      }
      return { data: db.failures >= a.p_max, error: null };
    },
  }),
}));

import { authHost } from "@/lib/server/auth";
import { __resetAttemptsCache, BLOCK_CACHE_MS, CODE_MAX_FAILURES } from "@/lib/server/attempts";
import { withApi } from "@/lib/server/http";

const ID = "11111111-1111-4111-8111-111111111111";
const t = { id: ID, host_code: "ABCD-12" } as Tournament;
const req = () => new Request("http://x/api/round/start", { method: "POST" });
const status = (code: string) =>
  withApi(async () => {
    const r = await authHost(ID, code, req());
    return new Response("x", { status: r ? 200 : 401 });
  })().then((r) => r.status);

beforeEach(() => {
  db.failures = 0;
  __resetAttemptsCache();
  getTournament.mockResolvedValue(t);
});

describe("block oracle across isolates", () => {
  it("a block registered by ANOTHER isolate bites immediately: correct code is 429 right after (no negative cache)", async () => {
    // Isolate B sees a clean IP (nothing may be cached for "not blocked").
    expect(await status("ABCD-12")).toBe(200);
    // Isolate A (other cache) takes the IP to the limit in the shared DB; B's
    // cache is NOT reset, so only a missing negative cache lets this through.
    db.failures = CODE_MAX_FAILURES;
    expect(await status("ABCD-12")).toBe(429);
    expect(await status("ZZZZ-99")).toBe(429);
  });

  it("every check goes to the DB while clean: 'not blocked' is never cached", async () => {
    rpcCalls.length = 0;
    await status("ABCD-12");
    await status("ABCD-12");
    expect(rpcCalls.filter((f) => f === "code_blocked")).toHaveLength(2);
  });

  it("'blocked' IS cached: a second check in the window does not hit the DB again", async () => {
    db.failures = CODE_MAX_FAILURES;
    expect(await status("ABCD-12")).toBe(429);
    rpcCalls.length = 0;
    expect(await status("ABCD-12")).toBe(429);
    expect(rpcCalls).toHaveLength(0);
  });

  it("wrong guesses: 401 until the limit, then consistently 429 (cold or warm cache)", async () => {
    for (let i = 0; i < CODE_MAX_FAILURES - 1; i++) expect(await status("ZZZZ-99")).toBe(401);
    expect(await status("ZZZZ-99")).toBe(429);
    for (let i = 0; i < 3; i++) {
      __resetAttemptsCache(); // different isolate each time
      expect(await status("ZZZZ-99")).toBe(429);
      expect(await status("ABCD-12")).toBe(429);
    }
  });

  it("an unblocked IP with the right code is unaffected", async () => {
    expect(await status("ABCD-12")).toBe(200);
  });

  it("a block that lapses in the DB stops applying within BLOCK_CACHE_MS (no ~2x lockout)", async () => {
    vi.useFakeTimers();
    try {
      db.failures = CODE_MAX_FAILURES;
      expect(await status("ABCD-12")).toBe(429);
      // The DB window ends (fixed from window_start) a moment later.
      db.failures = 0;
      vi.advanceTimersByTime(BLOCK_CACHE_MS + 1);
      expect(await status("ABCD-12")).toBe(200);
    } finally {
      vi.useRealTimers();
    }
    expect(BLOCK_CACHE_MS).toBeLessThanOrEqual(30_000);
  });
});
