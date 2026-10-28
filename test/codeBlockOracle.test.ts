import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// Two-isolate simulation: REAL attempts.ts + REAL authHost against a fake
// code_attempts table. "Switching isolate" = __resetAttemptsCache() (each
// isolate has its own in-memory cache; the DB is shared).
const { getTournament, db } = vi.hoisted(() => ({
  getTournament: vi.fn(),
  db: { failures: 0 },
}));
vi.mock("@/lib/server/store", () => ({ getPlayer: vi.fn(), getTournament }));
vi.mock("@/lib/supabase/auth-server", () => ({ createAuthClient: vi.fn() }));
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    rpc: async (fn: string, a: { p_max: number }) => {
      if (fn === "register_code_failure") {
        db.failures += 1;
        return { data: db.failures >= a.p_max, error: null };
      }
      return { data: db.failures >= a.p_max, error: null };
    },
  }),
}));

import { authHost } from "@/lib/server/auth";
import { __resetAttemptsCache, CODE_MAX_FAILURES } from "@/lib/server/attempts";
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
  it("stale 'not blocked' on isolate B: correct code is still 429 after A blocked the IP", async () => {
    // Isolate B warms a negative cache entry while the IP is clean.
    expect(await status("ABCD-12")).toBe(200);
    // Isolate A (other cache) takes the IP to the limit in the shared DB.
    db.failures = CODE_MAX_FAILURES;
    // Back on B, whose cache still says "not blocked":
    expect(await status("ABCD-12")).toBe(429);
    expect(await status("ZZZZ-99")).toBe(429);
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
});
