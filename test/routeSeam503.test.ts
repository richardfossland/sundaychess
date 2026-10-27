import { beforeEach, describe, expect, it, vi } from "vitest";

// Seam test: a Supabase/DB outage under real route handlers must surface as
// JSON 503 `server_error` (the client keeps its session on 5xx) — never a 500.
const { store } = vi.hoisted(() => ({
  store: {
    createTournament: vi.fn(),
    getTournament: vi.fn().mockRejectedValue(new Error("fetch failed")),
    getTournamentByPin: vi.fn(),
    getPlayerByResume: vi.fn(),
  },
}));
vi.mock("@/lib/server/store", async (orig) => ({
  ...(await orig<typeof import("@/lib/server/store")>()),
  ...store,
}));
vi.mock("@/lib/server/casual", () => ({
  createCasualGame: vi.fn().mockRejectedValue(new Error("db down")),
}));
vi.mock("@/lib/server/auth", () => ({ getHost: vi.fn().mockResolvedValue(null) }));

import { POST as createTournament } from "@/app/api/tournament/route";
import { POST as casual } from "@/app/api/casual/route";
import { POST as resume } from "@/app/api/resume/route";
import { __resetRateLimiter } from "@/lib/server/http";

const post = (url: string, body: unknown) =>
  new Request(`http://x${url}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => {
  __resetRateLimiter();
  vi.spyOn(console, "error").mockImplementation(() => {});
  store.createTournament.mockRejectedValue(new Error("fetch failed"));
  store.getTournamentByPin.mockRejectedValue(new Error("fetch failed"));
  store.getPlayerByResume.mockRejectedValue(new Error("fetch failed"));
});

describe("DB outage → 503 server_error", () => {
  it("POST /api/tournament", async () => {
    const res = await createTournament(post("/api/tournament", { title: "T" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
  it("POST /api/casual", async () => {
    const res = await casual(post("/api/casual", { name: "Ada" }));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "server_error" });
  });
  it("POST /api/resume", async () => {
    const res = await resume(post("/api/resume", { resumeCode: "AAAA-AA", tournamentId: "11111111-1111-4111-8111-111111111111" }));
    expect(res.status).toBe(503);
  });
});
