import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Tournament } from "@/lib/types";

// Seam test: authHost(+req) × attempts × pair token. Store and attempts are
// mocked; the pair token and normalisation stay real.
const { getTournament, isCodeBlocked, registerCodeFailure } = vi.hoisted(() => ({
  getTournament: vi.fn(),
  isCodeBlocked: vi.fn(),
  registerCodeFailure: vi.fn(),
}));
vi.mock("@/lib/server/store", () => ({ getPlayer: vi.fn(), getTournament }));
vi.mock("@/lib/supabase/auth-server", () => ({ createAuthClient: vi.fn() }));
vi.mock("@/lib/server/attempts", () => ({ isCodeBlocked, registerCodeFailure }));

import { authHost } from "@/lib/server/auth";
import { signPairToken } from "@/lib/server/pair";
import { RateLimitedError, withApi } from "@/lib/server/http";

const ID = "11111111-1111-4111-8111-111111111111";
const t = { id: ID, host_code: "ABCD-12" } as Tournament;
const req = (token?: string) =>
  new Request("http://x/api/round/start", {
    method: "POST",
    headers: token ? { "x-pair-token": token } : {},
  });

beforeEach(() => {
  vi.clearAllMocks();
  getTournament.mockResolvedValue(t);
  isCodeBlocked.mockResolvedValue(false);
  registerCodeFailure.mockResolvedValue(false);
});

describe("authHost with the wrong-code guard", () => {
  it("correct code: ok, nothing counted", async () => {
    expect(await authHost(ID, "abcd 12", req())).toBe(t);
    expect(registerCodeFailure).not.toHaveBeenCalled();
  });

  it("wrong code: null and counted against the tournament scope", async () => {
    expect(await authHost(ID, "ZZZZ-99", req())).toBeNull();
    expect(registerCodeFailure).toHaveBeenCalledWith(ID, expect.any(Request));
  });

  it("the failure that trips the block throws RateLimitedError (→ 429)", async () => {
    registerCodeFailure.mockResolvedValue(true);
    await expect(authHost(ID, "ZZZZ-99", req())).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("a blocked IP is refused even with the CORRECT code", async () => {
    isCodeBlocked.mockResolvedValue(true);
    await expect(authHost(ID, "ABCD-12", req())).rejects.toBeInstanceOf(RateLimitedError);
    const res = await withApi(async () => {
      await authHost(ID, "ABCD-12", req());
      return new Response("x");
    })();
    expect(res.status).toBe(429);
  });

  it("a valid pair token passes a blocked IP and never consults the block table", async () => {
    isCodeBlocked.mockResolvedValue(true);
    const tok = await signPairToken(ID, "ABCD-12");
    expect(await authHost(ID, "wrong", req(tok!))).toBe(t);
    expect(isCodeBlocked).not.toHaveBeenCalled();
    expect(registerCodeFailure).not.toHaveBeenCalled();
  });

  it("a token for an old host code (or a forged one) does not bypass the block", async () => {
    isCodeBlocked.mockResolvedValue(true);
    const old = await signPairToken(ID, "OLD0-00");
    await expect(authHost(ID, "ABCD-12", req(old!))).rejects.toBeInstanceOf(RateLimitedError);
    await expect(authHost(ID, "ABCD-12", req("forged"))).rejects.toBeInstanceOf(RateLimitedError);
  });

  it("unknown tournament: null, not counted; non-uuid never reaches the store", async () => {
    getTournament.mockResolvedValue(null);
    expect(await authHost(ID, "ABCD-12", req())).toBeNull();
    expect(registerCodeFailure).not.toHaveBeenCalled();
    getTournament.mockClear();
    expect(await authHost("nope", "ABCD-12", req())).toBeNull();
    expect(getTournament).not.toHaveBeenCalled();
  });

  it("without a req the guard is off (legacy callers)", async () => {
    expect(await authHost(ID, "ZZZZ-99")).toBeNull();
    expect(isCodeBlocked).not.toHaveBeenCalled();
    expect(registerCodeFailure).not.toHaveBeenCalled();
  });
});
