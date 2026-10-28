import { describe, expect, it, vi } from "vitest";
import { sendReport, type ReportInput } from "@/lib/physical/reportClient";
import { relevantReports, agreedBoards, isAgreed, staleReports, approveReport, pairingFp } from "@/app/arranger/fysisk/cloud/ReportsPanel";
import { initialsName, publicSnapshot } from "@/lib/physical/snapshot";
import { makeEvent } from "@/lib/physical/events";
import { createTournament, reduce } from "@/lib/physical/reducer";
import { pairNextRound } from "@/lib/physical/selectors";
import type { ReportDto } from "@/lib/physical/cloudTypes";

const input: ReportInput = { id: "11111111-2222-4333-8444-555555555555", round: 1, board: 2, result: "1-0", reporter: "white", requestId: "req-12345678", deviceId: "dev-12345678", k: "KEY" };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const noSleep = async () => {};

describe("sendReport", () => {
  it("retries on network failure / 5xx / 429 / HTML edge pages with the SAME requestId, then succeeds", async () => {
    const f = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockResolvedValueOnce(json(503, { error: "server_error" }))
      .mockResolvedValueOnce(json(429, { error: "rate_limited" }))
      .mockResolvedValueOnce(new Response("<html>bad gateway</html>", { status: 502 }))
      .mockResolvedValueOnce(json(200, { report: {} }));
    const out = await sendReport(input, { fetchFn: f as unknown as typeof fetch, sleep: noSleep });
    expect(out).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(5);
    const ids = f.mock.calls.map((c) => JSON.parse((c[1] as RequestInit).body as string).requestId);
    expect(new Set(ids)).toEqual(new Set(["req-12345678"]));
    expect(f.mock.calls[0][0]).toBe(`/api/physical/${input.id}/report`);
  });

  it("stops at once on a permanent error", async () => {
    for (const code of ["bad_key", "already_has_result", "round_closed"]) {
      const f = vi.fn().mockResolvedValue(json(403, { error: code }));
      expect(await sendReport(input, { fetchFn: f as unknown as typeof fetch, sleep: noSleep })).toEqual({ ok: false, code });
      expect(f).toHaveBeenCalledTimes(1);
    }
  });

  it("gives up after maxAttempts and reports the last transient code", async () => {
    const f = vi.fn().mockRejectedValue(new TypeError("offline"));
    expect(await sendReport(input, { fetchFn: f as unknown as typeof fetch, sleep: noSleep, maxAttempts: 3 })).toEqual({ ok: false, code: "network" });
    expect(f).toHaveBeenCalledTimes(3);
  });
});

const T = "11111111-2222-4333-8444-555555555555";
function published() {
  let t = createTournament({ id: T, title: "T", settings: { system: "monrad", rounds: 3, tiebreaks: [], byePoints: 1, allowLateEntry: false } });
  for (const n of ["A", "B", "C", "D"]) t = reduce(t, makeEvent({ type: "addPlayer", playerId: `p${n}`, name: n }));
  t = pairNextRound(t);
  return t;
}
const FP: Record<number, string> = Object.fromEntries(published().rounds[0].pairings.map((g) => [g.board, pairingFp(g)]));
let n = 0;
const rep = (board: number, result: ReportDto["result"], reporter: ReportDto["reporter"], round = 1, device = `dev-${reporter}-${board}`, fp = FP[board]): ReportDto => ({
  id: `r-${++n}`, round, board, result, reporter, deviceId: device, pairingFp: fp, status: "pending", createdAt: "",
});

describe("reports panel logic", () => {
  it("shows nothing for a draft round; shows pending for a published round; hides boards with a result", () => {
    const t = published();
    expect(relevantReports(t, [rep(1, "1-0", "white")]).size).toBe(0);
    const p = reduce(t, makeEvent({ type: "publishRound", round: 1 }));
    expect([...relevantReports(p, [rep(1, "1-0", "white"), rep(2, "0-1", "black")]).keys()]).toEqual([1, 2]);
    expect(relevantReports(p, [rep(1, "1-0", "white", 2)]).size).toBe(0);
    const withRes = reduce(p, makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0", source: "player_report" }));
    expect([...relevantReports(withRes, [rep(1, "1-0", "white"), rep(2, "0-1", "black")]).keys()]).toEqual([2]);
    expect(withRes.rounds[0].pairings.find((x) => x.board === 1)!.resultSource).toBe("player_report");
  });

  it("agreement needs a white AND a black report from two DIFFERENT devices with the same result", () => {
    const p = reduce(published(), makeEvent({ type: "publishRound", round: 1 }));
    const m = relevantReports(p, [rep(1, "1-0", "white", 1, "A"), rep(1, "1-0", "black", 1, "B"), rep(2, "1-0", "white", 1, "A"), rep(2, "0-1", "black", 1, "B")]);
    expect(agreedBoards(m)).toEqual([1]);
    expect(agreedBoards(relevantReports(p, [rep(1, "1-0", "white")]))).toEqual([]);
  });

  it("one phone can never make a board 'agreed': same device, or both sides unknown, or the same side twice", () => {
    expect(isAgreed([rep(1, "1-0", "white", 1, "A"), rep(1, "1-0", "black", 1, "A")])).toBe(false); // same phone claims both
    expect(isAgreed([rep(1, "1-0", "unknown", 1, "A"), rep(1, "1-0", "unknown", 1, "B")])).toBe(false); // sides unknown
    expect(isAgreed([rep(1, "1-0", "white", 1, "A"), rep(1, "1-0", "white", 1, "B")])).toBe(false); // both claim white
    expect(isAgreed([rep(1, "1-0", "white", 1, "A")])).toBe(false);
    expect(isAgreed([rep(1, "1-0", "white", 1, "A"), rep(1, "1-0", "black", 1, "B")])).toBe(true);
    // any dissent from a third phone breaks it
    expect(isAgreed([rep(1, "1-0", "white", 1, "A"), rep(1, "1-0", "black", 1, "B"), rep(1, "0-1", "unknown", 1, "C")])).toBe(false);
  });

  it("reports for an old pairing (swap/manual change after publishing) are hidden and flagged stale", () => {
    const p = reduce(published(), makeEvent({ type: "publishRound", round: 1 }));
    const old = [rep(1, "1-0", "white", 1, "A"), rep(1, "1-0", "black", 1, "B")];
    expect(agreedBoards(relevantReports(p, old))).toEqual([1]);
    const swapped = reduce(p, makeEvent({ type: "swapPairing", round: 1, a: { board: 1, side: "white" }, b: { board: 2, side: "white" }, afterPublish: true }));
    expect(relevantReports(swapped, old).size).toBe(0);
    expect(staleReports(swapped, old).map((x) => x.id)).toEqual(old.map((x) => x.id));
    // a report given for the NEW pairing is shown
    const fresh = rep(1, "1-0", "white", 1, "A", pairingFp(swapped.rounds[0].pairings[0]));
    expect([...relevantReports(swapped, [fresh]).keys()]).toEqual([1]);
    expect(staleReports(swapped, [fresh])).toEqual([]);
  });

  it("approveReport: nothing is told to the server unless the local setResult succeeded", async () => {
    const p = reduce(published(), makeEvent({ type: "publishRound", round: 1 }));
    const a = rep(1, "1-0", "white", 1, "A");
    const b = rep(1, "0-1", "black", 1, "B");
    const decide = vi.fn(async () => true);
    const refresh = vi.fn();
    expect(await approveReport(p, () => false, [a, b], a, refresh, decide)).toBe(false);
    expect(decide).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    const applied: unknown[] = [];
    expect(await approveReport(p, (body) => (applied.push(body), true), [a, b], a, refresh, decide)).toBe(true);
    expect(applied).toEqual([{ type: "setResult", round: 1, board: 1, result: "1-0", source: "player_report" }]);
    expect(decide.mock.calls).toEqual([[a.id, "approve"], [b.id, "reject"]]);
  });
});

describe("publicSnapshot", () => {
  it("includes results in standings while the round is open, and never leaks events", () => {
    let t = reduce(published(), makeEvent({ type: "publishRound", round: 1 }));
    t = reduce(t, makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0" }));
    const s = publicSnapshot(t, "now");
    expect(s.rounds[0].pairings[0].result).toBe("1-0");
    expect(s.standings[0].score).toBe(1);
    expect(JSON.stringify(s)).not.toContain("events");
  });
});

describe("name policy", () => {
  it("initials: first name + last-name initial, one word kept, no club or group label; full mode opt-in", () => {
    let t = createTournament({ id: T, title: "T", settings: { system: "monrad", rounds: 3, tiebreaks: [], byePoints: 1, allowLateEntry: false, groupLabel: "Klasse" } });
    for (const [i, nm] of ["Ola Nordmann", "Åse Marie Østby", "Li", "  kari   hansen-berg "].entries()) t = reduce(t, makeEvent({ type: "addPlayer", playerId: `q${i}`, name: nm, club: "7A" }));
    t = reduce(pairNextRound(t), makeEvent({ type: "publishRound", round: 1 }));
    expect(initialsName("Ola Nordmann")).toBe("Ola N.");
    expect(initialsName("Åse Marie Østby")).toBe("Åse Ø.");
    expect(initialsName("Li")).toBe("Li");
    expect(initialsName("  kari   hansen-berg ")).toBe("kari H.");
    const def = publicSnapshot(t, "now"); // default = initials
    expect(def.names).toBe("initials");
    expect(def.players.map((p) => p.name)).toEqual(["Ola N.", "Åse Ø.", "Li", "kari H."]);
    expect(def.groupLabel).toBeNull();
    expect(def.players.every((p) => p.club === null) && def.standings.every((p) => p.club === null)).toBe(true);
    expect(JSON.stringify(def)).not.toMatch(/Nordmann|Østby|hansen|7A|Klasse/);
    const full = publicSnapshot(t, "now", { names: "full", id: "cloud-id" });
    expect(full.id).toBe("cloud-id");
    expect(full.players[0]).toMatchObject({ name: "Ola Nordmann", club: "7A" });
    expect(full.groupLabel).toBe("Klasse");
  });
});
