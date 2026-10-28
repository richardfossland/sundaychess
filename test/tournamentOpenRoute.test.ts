import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

const openTournamentByHostCode = vi.fn();

vi.mock("@/lib/server/store", () => ({
  openTournamentByHostCode: (...a: unknown[]) => openTournamentByHostCode(...a),
}));

// H5: this route now draws on BOTH its own `open:` bucket AND the shared host
// bucket (hostRateLimit) — mock both so each can be forced independently.
const { rateLimitMock, isCodeBlocked, registerCodeFailure } = vi.hoisted(() => ({
  rateLimitMock: vi.fn().mockReturnValue(true),
  isCodeBlocked: vi.fn().mockResolvedValue(false),
  registerCodeFailure: vi.fn().mockResolvedValue(false),
}));
vi.mock("@/lib/server/attempts", () => ({
  isCodeBlocked: (...a: unknown[]) => isCodeBlocked(...a),
  registerCodeFailure: (...a: unknown[]) => registerCodeFailure(...a),
}));
vi.mock("@/lib/server/http", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/server/http")>();
  return {
    ...actual,
    rateLimit: (...a: unknown[]) => rateLimitMock(...a),
  };
});

import { POST } from "@/app/api/tournament/open/route";
import { __resetRateLimiter } from "@/lib/server/http";

const T_ID = "22222222-2222-4222-8222-222222222222";

const tournament = (): Tournament =>
  ({
    id: T_ID,
    join_pin: "123456",
    host_code: "HOST-01",
    host_user_id: null,
    title: null,
    status: "lobby",
    config: { leagueRounds: 5, playoff: false, playoffSize: 0, roundTimerSec: null },
    current_round: 0,
    created_at: "",
  }) as Tournament;

const req = (body: unknown, cookie?: string) =>
  new Request("http://x/api/tournament/open", {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  rateLimitMock.mockReturnValue(true);
  isCodeBlocked.mockResolvedValue(false);
  registerCodeFailure.mockResolvedValue(false);
  openTournamentByHostCode.mockResolvedValue(tournament());
});

describe("POST /api/tournament/open", () => {
  it("reopens the board and normalises the typed code first", async () => {
    const res = await POST(req({ hostCode: "host 01" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: T_ID });
    expect(openTournamentByHostCode).toHaveBeenCalledWith("HOST-01");
  });

  it("a correct code is re-checked against the DB (fresh), so a stale negative cache cannot leak 200", async () => {
    // Cached read says clean; the fresh read (other isolate blocked the IP) says blocked.
    isCodeBlocked.mockImplementation(async (_s: string, _r: Request, o?: { fresh?: boolean }) => !!o?.fresh);
    const res = await POST(req({ hostCode: "host 01" }));
    expect(res.status).toBe(429);
    isCodeBlocked.mockResolvedValue(false);
  });

  it("400 missing_code on an empty body", async () => {
    const res = await POST(req({}));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("missing_code");
    expect(openTournamentByHostCode).not.toHaveBeenCalled();
  });

  // H2: normalizeResumeCode PASSES THROUGH anything that isn't 6 characters, so
  // without the shape check the lookup below ran on arbitrary client input — a
  // paste, a probe, a whole sentence — one DB round-trip per hit.
  it("400 invalid_code on anything that is not a real code shape, before the DB", async () => {
    for (const bad of [
      "nope",
      "hello there, this is not a code",
      "1234-56", // digits in the letter half
      "ABCDE-12",
      "ABC-12",
      "'; drop table tournaments; --",
    ]) {
      const res = await POST(req({ hostCode: bad }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("invalid_code");
    }
    expect(openTournamentByHostCode).not.toHaveBeenCalled();
  });

  it("404 not_found on a well-formed code nobody owns", async () => {
    openTournamentByHostCode.mockResolvedValue(null);
    const res = await POST(req({ hostCode: "ZZZZ-99" }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("returns a structured 503 (never throws) when the lookup fails", async () => {
    openTournamentByHostCode.mockRejectedValue(new Error("db down"));
    const res = await POST(req({ hostCode: "HOST-01" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("server_error");
  });

  // H5: the shape check must be decided BEFORE either rate limiter is touched,
  // so a garbage guess can never spend budget in the SHARED host bucket that
  // override/absent/extend/kick also draw from.
  it("checks the code SHAPE before touching either rate limiter", async () => {
    const res = await POST(req({ hostCode: "not a real code" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_code");
    expect(rateLimitMock).not.toHaveBeenCalled();
    expect(isCodeBlocked).not.toHaveBeenCalled();
  });

  // H5: own bucket (20/min) — independent of the shared host bucket.
  it("429s on its own `open:` bucket", async () => {
    rateLimitMock.mockReturnValueOnce(false);
    const res = await POST(req({ hostCode: "HOST-01" }));
    expect(res.status).toBe(429);
    expect((await res.json()).error).toBe("rate_limited");
    expect(isCodeBlocked).not.toHaveBeenCalled();
    expect(openTournamentByHostCode).not.toHaveBeenCalled();
  });

  // This route searches EVERY tournament — the best host-code brute-force
  // oracle in the app — so only WRONG guesses count, in the DB (migration 0015).
  it("429s before the lookup when the IP is blocked for scope `open`", async () => {
    isCodeBlocked.mockResolvedValue(true);
    const res = await POST(req({ hostCode: "HOST-01" }));
    expect(res.status).toBe(429);
    expect(openTournamentByHostCode).not.toHaveBeenCalled();
  });

  it("device layer: a blocked device is refused, its IP ceiling uses a much higher threshold", async () => {
    await POST(req({ hostCode: "HOST-01" }));
    const calls = isCodeBlocked.mock.calls;
    const dev = calls.find((c) => String(c[0]).startsWith("open:d:"))!;
    const ip = calls.find((c) => c[0] === "open")!;
    expect(dev[2].max).toBe(20);
    expect(ip[2].max).toBeGreaterThanOrEqual(200);
  });

  it("pupils' failures on the shared IP do not lock out the teacher's device", async () => {
    // Simulate the DB: the shared `open` IP row is below its high ceiling, and
    // only the PUPIL device's own scope is blocked.
    isCodeBlocked.mockImplementation(async (scope: string) => scope === `open:d:${"a".repeat(32)}`);
    const pupil = await POST(req({ hostCode: "HOST-01" }, `sc_dev=${"a".repeat(32)}`));
    expect(pupil.status).toBe(429);
    const teacher = await POST(req({ hostCode: "HOST-01" }, `sc_dev=${"b".repeat(32)}`));
    expect(teacher.status).toBe(200);
    expect((await teacher.json()).id).toBe(T_ID);
  });

  it("sets an httpOnly device cookie when missing (also on 404), reuses a valid one, ignores a malformed one", async () => {
    const r1 = await POST(req({ hostCode: "HOST-01" }));
    const c = r1.headers.get("set-cookie")!;
    expect(c).toMatch(/^sc_dev=[0-9a-f]{32}; /);
    expect(c).toContain("HttpOnly");
    openTournamentByHostCode.mockResolvedValue(null);
    expect((await POST(req({ hostCode: "ZZZZ-99" }))).headers.get("set-cookie")).toContain("sc_dev=");
    const r2 = await POST(req({ hostCode: "HOST-01" }, `sc_dev=${"c".repeat(32)}`));
    expect(r2.headers.get("set-cookie")).toBeNull();
    const r3 = await POST(req({ hostCode: "ZZZZ-99" }, "sc_dev=<script>"));
    expect(r3.headers.get("set-cookie")).toMatch(/^sc_dev=[0-9a-f]{32}/);
  });

  it("counts a wrong guess against BOTH the device and the IP scope", async () => {
    openTournamentByHostCode.mockResolvedValue(null);
    await POST(req({ hostCode: "ZZZZ-99" }, `sc_dev=${"d".repeat(32)}`));
    const scopes = registerCodeFailure.mock.calls.map((c) => c[0]);
    expect(scopes).toContain(`open:d:${"d".repeat(32)}`);
    expect(scopes).toContain("open");
  });

  it("the IP ceiling still blocks a guesser who rotates the cookie", async () => {
    isCodeBlocked.mockImplementation(async (scope: string) => scope === "open");
    const res = await POST(req({ hostCode: "HOST-01" }, `sc_dev=${"e".repeat(32)}`));
    expect(res.status).toBe(429);
  });

  it("counts a wrong code, and 429s on the failure that trips the block", async () => {
    openTournamentByHostCode.mockResolvedValue(null);
    expect((await POST(req({ hostCode: "ZZZZ-99" }))).status).toBe(404);
    expect(registerCodeFailure).toHaveBeenCalledWith("open", expect.any(Request), expect.anything());
    registerCodeFailure.mockResolvedValue(true);
    expect((await POST(req({ hostCode: "ZZZZ-99" }))).status).toBe(429);
  });

  it("never counts a correct code", async () => {
    await POST(req({ hostCode: "HOST-01" }));
    expect(registerCodeFailure).not.toHaveBeenCalled();
  });
});
