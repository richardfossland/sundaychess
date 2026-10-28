import { describe, expect, it, vi } from "vitest";
import { sendReport, type ReportInput } from "@/lib/physical/reportClient";
import { relevantReports, agreedBoards } from "@/app/arranger/fysisk/cloud/ReportsPanel";
import { publicSnapshot } from "@/lib/physical/snapshot";
import { makeEvent } from "@/lib/physical/events";
import { createTournament, reduce } from "@/lib/physical/reducer";
import { pairNextRound } from "@/lib/physical/selectors";
import type { ReportDto } from "@/lib/physical/cloudTypes";

const input: ReportInput = { id: "11111111-2222-4333-8444-555555555555", round: 1, board: 2, result: "1-0", reporter: "white", requestId: "req-12345678", k: "KEY" };
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
const rep = (board: number, result: ReportDto["result"], reporter: ReportDto["reporter"], round = 1): ReportDto => ({
  id: `r-${board}-${reporter}`, round, board, result, reporter, status: "pending", createdAt: "",
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

  it("agreedBoards needs two different reporters with the same result", () => {
    const p = reduce(published(), makeEvent({ type: "publishRound", round: 1 }));
    const m = relevantReports(p, [rep(1, "1-0", "white"), rep(1, "1-0", "black"), rep(2, "1-0", "white"), rep(2, "0-1", "black")]);
    expect(agreedBoards(m)).toEqual([1]);
    expect(agreedBoards(relevantReports(p, [rep(1, "1-0", "white")]))).toEqual([]);
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
