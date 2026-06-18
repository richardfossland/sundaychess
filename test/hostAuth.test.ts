import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// isAdminEmail reads process.env.CHESS_ADMIN_EMAILS; requireHost calls
// createAuthClient().auth.getUser(). Mock the AUTH client; keep the store mocked
// so nothing touches a real DB. normalizeResumeCode etc. stay real.
const { authClient } = vi.hoisted(() => ({
  authClient: { auth: { getUser: vi.fn() } },
}));
vi.mock("@/lib/supabase/auth-server", () => ({
  createAuthClient: vi.fn(async () => authClient),
}));
vi.mock("@/lib/server/store", () => ({
  getPlayer: vi.fn(),
  getTournament: vi.fn(),
}));

import { isAdminEmail, requireHost, getHost, AuthError } from "@/lib/server/auth";

const ENV = process.env.CHESS_ADMIN_EMAILS;
afterEach(() => {
  process.env.CHESS_ADMIN_EMAILS = ENV;
});
beforeEach(() => vi.clearAllMocks());

describe("isAdminEmail", () => {
  it("fails closed when the allow-list is empty", () => {
    process.env.CHESS_ADMIN_EMAILS = "";
    expect(isAdminEmail("anyone@x.com")).toBe(false);
  });

  it("matches case-insensitively and ignores surrounding whitespace", () => {
    process.env.CHESS_ADMIN_EMAILS = " Host@Church.NO , other@x.com ";
    expect(isAdminEmail("host@church.no")).toBe(true);
    expect(isAdminEmail("HOST@CHURCH.NO")).toBe(true);
    expect(isAdminEmail("other@x.com")).toBe(true);
  });

  it("rejects emails not on the list, and null/undefined", () => {
    process.env.CHESS_ADMIN_EMAILS = "host@church.no";
    expect(isAdminEmail("stranger@x.com")).toBe(false);
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
  });
});

describe("requireHost", () => {
  it("throws 401 when there is no session", async () => {
    process.env.CHESS_ADMIN_EMAILS = "host@church.no";
    authClient.auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(requireHost()).rejects.toMatchObject({ status: 401 });
  });

  it("throws 403 when the signed-in email is not allow-listed", async () => {
    process.env.CHESS_ADMIN_EMAILS = "host@church.no";
    authClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "stranger@x.com" } },
    });
    await expect(requireHost()).rejects.toMatchObject({ status: 403 });
  });

  it("returns {id,email} for an allow-listed host", async () => {
    process.env.CHESS_ADMIN_EMAILS = "host@church.no";
    authClient.auth.getUser.mockResolvedValue({
      data: { user: { id: "u1", email: "Host@Church.NO" } },
    });
    await expect(requireHost()).resolves.toEqual({ id: "u1", email: "Host@Church.NO" });
  });

  it("getHost swallows AuthError → null (for anonymous create)", async () => {
    process.env.CHESS_ADMIN_EMAILS = "host@church.no";
    authClient.auth.getUser.mockResolvedValue({ data: { user: null } });
    expect(await getHost()).toBeNull();
  });

  it("AuthError carries the status", () => {
    expect(new AuthError(403, "x").status).toBe(403);
  });
});
