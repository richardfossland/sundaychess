import { beforeEach, describe, expect, it, vi } from "vitest";

// Chainable query-builder stub: every method records its call and returns the
// same builder; the builder is itself awaitable (thenable) and resolves to the
// configured { data, error }. This matches PostgREST's "await the chain" usage
// in store.ts without a real DB.
const { makeDb, state } = vi.hoisted(() => {
  const state: { table: string; ops: [string, ...unknown[]][]; result: unknown } = {
    table: "",
    ops: [],
    result: { data: [], error: null },
  };
  function makeDb() {
    const builder: Record<string, unknown> = {};
    const method =
      (name: string) =>
      (...args: unknown[]) => {
        if (name === "from") {
          state.table = args[0] as string;
          state.ops = [];
        } else {
          state.ops.push([name, ...args]);
        }
        return builder;
      };
    for (const m of ["from", "select", "delete", "eq", "order", "limit"]) {
      builder[m] = method(m);
    }
    // Awaiting the chain resolves to the configured result.
    builder.then = (resolve: (v: unknown) => unknown) => resolve(state.result);
    return builder;
  }
  return { makeDb, state };
});

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => makeDb(),
}));

import { listTournamentsByOwner, deleteTournamentOwned } from "@/lib/server/store";

beforeEach(() => {
  state.table = "";
  state.ops = [];
  state.result = { data: [], error: null };
});

describe("listTournamentsByOwner", () => {
  it("queries tournaments filtered by host_user_id, newest first", async () => {
    state.result = { data: [{ id: "t1", host_user_id: "u1" }], error: null };
    const rows = await listTournamentsByOwner("u1");
    expect(state.table).toBe("tournaments");
    expect(state.ops).toContainEqual(["eq", "host_user_id", "u1"]);
    expect(state.ops).toContainEqual(["order", "created_at", { ascending: false }]);
    expect(rows).toEqual([{ id: "t1", host_user_id: "u1" }]);
  });

  it("throws on a DB error (transient → route 503, never a silent empty list)", async () => {
    state.result = { data: null, error: new Error("boom") };
    await expect(listTournamentsByOwner("u1")).rejects.toThrow("boom");
  });
});

describe("deleteTournamentOwned", () => {
  it("double-gates the delete on id AND host_user_id", async () => {
    state.result = { data: [{ id: "t1" }], error: null };
    const ok = await deleteTournamentOwned("t1", "u1");
    expect(state.table).toBe("tournaments");
    expect(state.ops).toContainEqual(["delete"]);
    expect(state.ops).toContainEqual(["eq", "id", "t1"]);
    expect(state.ops).toContainEqual(["eq", "host_user_id", "u1"]);
    expect(ok).toBe(true);
  });

  it("returns false when no row matched (not the owner / already gone)", async () => {
    state.result = { data: [], error: null };
    expect(await deleteTournamentOwned("t1", "u1")).toBe(false);
  });
});
