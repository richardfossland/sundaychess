import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Player, Tournament } from "@/lib/types";
import { ApiError, shouldClearSession } from "@/lib/client/api";

// M1: /api/resume og /api/casual/join teller FEIL gjetting per enhet + IP
// (som /api/join/claim). Riktige koder teller aldri (en klasse bak ett NAT
// som gjenopptar etter wifi-blipp), 429 sletter aldri en elevøkt, og
// device-cookien har en Path som faktisk sendes tilbake til ruten.
const { store, attempts, joinCasualGame } = vi.hoisted(() => ({
  store: { getPlayerByResume: vi.fn(), getTournament: vi.fn(), getTournamentByPin: vi.fn() },
  attempts: { isCodeBlocked: vi.fn(), registerCodeFailure: vi.fn() },
  joinCasualGame: vi.fn(),
}));
vi.mock("@/lib/server/store", () => store);
vi.mock("@/lib/server/attempts", () => attempts);
vi.mock("@/lib/server/lifecycle", () => ({ maybeAutoFinishStale: async (t: Tournament) => t }));
vi.mock("@/lib/server/casual", () => ({ joinCasualGame: (...a: unknown[]) => joinCasualGame(...a) }));

import { POST as resume } from "@/app/api/resume/route";
import { POST as casualJoin } from "@/app/api/casual/join/route";
import { __resetRateLimiter } from "@/lib/server/http";

const TID = "11111111-1111-4111-8111-111111111111";
const tournament = { id: TID, status: "league", join_pin: "123456" } as Tournament;
const player = { id: "p1", display_name: "Ada", status: "active", resume_code: "KOLE-7F" } as Player;
const DEV = "a".repeat(32);

const post = (url: string, body: unknown, cookie?: string) =>
  new Request(`http://x${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(body),
  });
const scopes = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.map((c) => c[0]);

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiter();
  attempts.isCodeBlocked.mockResolvedValue(false);
  attempts.registerCodeFailure.mockResolvedValue(false);
  store.getTournament.mockResolvedValue(tournament);
  store.getTournamentByPin.mockResolvedValue(tournament);
  store.getPlayerByResume.mockResolvedValue(player);
  joinCasualGame.mockResolvedValue({ ok: true, gameId: "g" });
});

describe("POST /api/resume", () => {
  it("en hel klasse med RIKTIGE koder fra ett NAT: ingen feil telles, alle får 200", async () => {
    for (let i = 0; i < 40; i++) {
      const res = await resume(post("/api/resume", { resumeCode: "KOLE-7F", tournamentId: TID }));
      expect(res.status).toBe(200);
    }
    expect(attempts.registerCodeFailure).not.toHaveBeenCalled();
  });

  it("feil kode telles mot enhet og IP, og setter cookie med riktig Path", async () => {
    store.getPlayerByResume.mockResolvedValue(null);
    const res = await resume(post("/api/resume", { resumeCode: "ZZZZ-99", tournamentId: TID }));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("invalid_code");
    const sc = res.headers.get("set-cookie") ?? "";
    expect(sc).toMatch(/^sc_dev=[0-9a-f]{32}; Path=\/api\/resume;/);
    const s = scopes(attempts.registerCodeFailure);
    expect(s).toContain("resume");
    expect(s.some((x) => /^resume:d:[0-9a-f]{32}$/.test(x))).toBe(true);
  });

  it("cookien fra forrige svar gjenbrukes (ingen ny Set-Cookie, samme enhet telles)", async () => {
    store.getPlayerByResume.mockResolvedValue(null);
    const res = await resume(post("/api/resume", { resumeCode: "ZZZZ-99", tournamentId: TID }, `sc_dev=${DEV}`));
    expect(res.headers.get("set-cookie")).toBeNull();
    expect(scopes(attempts.registerCodeFailure)).toContain(`resume:d:${DEV}`);
  });

  it("ukjent PIN telles; ukjent tournamentId (slettet turnering) telles IKKE", async () => {
    store.getTournamentByPin.mockResolvedValue(null);
    expect((await resume(post("/api/resume", { resumeCode: "KOLE-7F", pin: "999999" }))).status).toBe(404);
    expect(attempts.registerCodeFailure).toHaveBeenCalled();
    attempts.registerCodeFailure.mockClear();
    store.getTournament.mockResolvedValue(null);
    expect((await resume(post("/api/resume", { resumeCode: "KOLE-7F", tournamentId: TID }))).status).toBe(404);
    expect(attempts.registerCodeFailure).not.toHaveBeenCalled();
  });

  it("blokkert enhet/IP: 429 rate_limited FØR noen oppslag, og klienten sletter ikke økten", async () => {
    attempts.isCodeBlocked.mockResolvedValue(true);
    const res = await resume(post("/api/resume", { resumeCode: "KOLE-7F", tournamentId: TID }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.error).toBe("rate_limited");
    expect(store.getPlayerByResume).not.toHaveBeenCalled();
    // Fellen: klientens resume-catch tømmer lagret økt på noen feil. 429 må ikke gjøre det.
    expect(shouldClearSession(new ApiError(res.status, body.error, body))).toBe(false);
  });

  it("feilgjetting som tipper over grensen svarer 429", async () => {
    store.getPlayerByResume.mockResolvedValue(null);
    attempts.registerCodeFailure.mockResolvedValue(true);
    expect((await resume(post("/api/resume", { resumeCode: "ZZZZ-99", tournamentId: TID }))).status).toBe(429);
  });
});

describe("POST /api/casual/join", () => {
  it("feil PIN telles (scope pin) og cookien får Path til selve ruten", async () => {
    joinCasualGame.mockResolvedValue({ ok: false, reason: "not_found" });
    const res = await casualJoin(post("/api/casual/join", { pin: "999999", name: "Ola" }));
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/Path=\/api\/casual\/join;/);
    expect(scopes(attempts.registerCodeFailure)).toContain("pin");
  });

  it("riktig PIN (full / ikke casual / ok) telles aldri", async () => {
    for (const r of [{ ok: false, reason: "full" }, { ok: false, reason: "not_casual" }, { ok: true, gameId: "g" }]) {
      joinCasualGame.mockResolvedValue(r);
      await casualJoin(post("/api/casual/join", { pin: "123456", name: "Ola" }));
    }
    expect(attempts.registerCodeFailure).not.toHaveBeenCalled();
  });

  it("blokkert: 429 uten å røre spillet", async () => {
    attempts.isCodeBlocked.mockResolvedValue(true);
    const res = await casualJoin(post("/api/casual/join", { pin: "123456", name: "Ola" }));
    expect(res.status).toBe(429);
    expect(joinCasualGame).not.toHaveBeenCalled();
  });
});
