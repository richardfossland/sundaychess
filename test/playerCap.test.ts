import { beforeEach, describe, expect, it, vi } from "vitest";

// M5: addPlayer nekter den 501. raden i en digital turnering (som fysisk modus).
const { state } = vi.hoisted(() => ({
  state: { existing: 0, inserts: 0 },
}));

vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: () => ({
    from: () => {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "order", "limit", "insert"]) {
        b[m] = (...a: unknown[]) => {
          if (m === "insert") state.inserts++;
          void a;
          return b;
        };
      }
      b.single = async () => ({ data: { id: "new", display_name: "x" }, error: null });
      b.then = (resolve: (v: unknown) => unknown) =>
        resolve({
          data: Array.from({ length: state.existing }, (_, i) => ({ id: `p${i}`, resume_code: `C${i}` })),
          error: null,
        });
      return b;
    },
    rpc: async () => ({ data: null, error: new Error("no rpc") }),
  }),
}));

import { MAX_TOURNAMENT_PLAYERS, addPlayer } from "@/lib/server/store";

beforeEach(() => {
  state.existing = 0;
  state.inserts = 0;
});

describe("addPlayer-tak (M5)", () => {
  it("taket er 500, som fysisk modus", () => {
    expect(MAX_TOURNAMENT_PLAYERS).toBe(500);
  });

  it("ved 500 eksisterende: kaster tournament_full og skriver ingenting", async () => {
    state.existing = 500;
    await expect(addPlayer("t", "Ada")).rejects.toThrow("tournament_full");
    expect(state.inserts).toBe(0);
  });

  it("ved 499: den siste plassen kan tas", async () => {
    state.existing = 499;
    await expect(addPlayer("t", "Ada")).resolves.toMatchObject({ id: "new" });
    expect(state.inserts).toBe(1);
  });
});
