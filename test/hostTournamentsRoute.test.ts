import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the auth helper (requireHost/authFail) and the store. We keep authFail
// real-ish by re-implementing the AuthError→Response mapping the route relies on.
const { auth, store } = vi.hoisted(() => {
  class AuthError extends Error {
    status: number;
    constructor(status: number, code: string) {
      super(code);
      this.status = status;
    }
  }
  return {
    auth: {
      AuthError,
      requireHost: vi.fn(),
      authFail: (err: unknown) =>
        err instanceof AuthError
          ? Response.json({ error: err.message }, { status: err.status })
          : null,
    },
    store: {
      deleteTournamentOwned: vi.fn(),
      listTournamentsByOwner: vi.fn(),
    },
  };
});

vi.mock("@/lib/server/auth", () => ({
  requireHost: auth.requireHost,
  authFail: auth.authFail,
  AuthError: auth.AuthError,
}));
vi.mock("@/lib/server/store", () => store);

import { DELETE } from "@/app/api/host/tournaments/[id]/route";
import { GET } from "@/app/api/host/tournaments/route";

const params = (id: string) => ({ params: Promise.resolve({ id }) });
const req = () => new Request("http://x/api/host/tournaments/t1", { method: "DELETE" });

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/host/tournaments/[id]", () => {
  it("401 when not signed in", async () => {
    auth.requireHost.mockRejectedValue(new auth.AuthError(401, "not_signed_in"));
    const res = await DELETE(req(), params("t1"));
    expect(res.status).toBe(401);
    expect(store.deleteTournamentOwned).not.toHaveBeenCalled();
  });

  it("403 when signed in but not allow-listed", async () => {
    auth.requireHost.mockRejectedValue(new auth.AuthError(403, "not_authorized"));
    const res = await DELETE(req(), params("t1"));
    expect(res.status).toBe(403);
    expect(store.deleteTournamentOwned).not.toHaveBeenCalled();
  });

  it("404 when the host does not own the tournament (no row deleted)", async () => {
    auth.requireHost.mockResolvedValue({ id: "u1", email: "h@x.no" });
    store.deleteTournamentOwned.mockResolvedValue(false);
    const res = await DELETE(req(), params("t1"));
    expect(res.status).toBe(404);
    // Owner double-gate: the delete is scoped to the signed-in host's id.
    expect(store.deleteTournamentOwned).toHaveBeenCalledWith("t1", "u1");
  });

  it("200 when the owner deletes their own tournament", async () => {
    auth.requireHost.mockResolvedValue({ id: "u1", email: "h@x.no" });
    store.deleteTournamentOwned.mockResolvedValue(true);
    const res = await DELETE(req(), params("t1"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(store.deleteTournamentOwned).toHaveBeenCalledWith("t1", "u1");
  });

  it("503 (never throws) on an unexpected store failure", async () => {
    auth.requireHost.mockResolvedValue({ id: "u1", email: "h@x.no" });
    store.deleteTournamentOwned.mockRejectedValue(new Error("db down"));
    const res = await DELETE(req(), params("t1"));
    expect(res.status).toBe(503);
  });
});

describe("GET /api/host/tournaments", () => {
  it("401 when not signed in", async () => {
    auth.requireHost.mockRejectedValue(new auth.AuthError(401, "not_signed_in"));
    const res = await GET();
    expect(res.status).toBe(401);
    expect(store.listTournamentsByOwner).not.toHaveBeenCalled();
  });

  it("returns only the signed-in host's tournaments, mapped (no internals)", async () => {
    auth.requireHost.mockResolvedValue({ id: "u1", email: "h@x.no" });
    store.listTournamentsByOwner.mockResolvedValue([
      {
        id: "t1",
        title: "7A",
        status: "lobby",
        join_pin: "123456",
        host_code: "ABCD-7F",
        host_user_id: "u1",
        config: {},
        current_round: 0,
        created_at: "2026-01-01T00:00:00Z",
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(store.listTournamentsByOwner).toHaveBeenCalledWith("u1");
    const body = (await res.json()) as { tournaments: { id: string }[] };
    expect(body.tournaments).toEqual([
      {
        id: "t1",
        title: "7A",
        status: "lobby",
        joinPin: "123456",
        hostCode: "ABCD-7F",
        createdAt: "2026-01-01T00:00:00Z",
      },
    ]);
  });
});
