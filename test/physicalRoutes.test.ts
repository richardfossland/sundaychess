import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fakeSupabase";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => (fake.db as { client: unknown }).client }));

const { isCodeBlocked, registerCodeFailure } = vi.hoisted(() => ({
  isCodeBlocked: vi.fn(async () => false),
  registerCodeFailure: vi.fn(async () => false),
}));
vi.mock("@/lib/server/attempts", () => ({
  isCodeBlocked: (...a: unknown[]) => (isCodeBlocked as (...x: unknown[]) => Promise<boolean>)(...a),
  registerCodeFailure: (...a: unknown[]) => (registerCodeFailure as (...x: unknown[]) => Promise<boolean>)(...a),
}));

import { POST as publish } from "@/app/api/physical/publish/route";
import { GET as getPublic, DELETE as unpublish } from "@/app/api/physical/[id]/route";
import { GET as getLog, PUT as putLog } from "@/app/api/physical/[id]/log/route";
import { GET as getKeys } from "@/app/api/physical/[id]/keys/route";
import { POST as report } from "@/app/api/physical/[id]/report/route";
import { GET as listReports } from "@/app/api/physical/[id]/reports/route";
import { POST as decide } from "@/app/api/physical/[id]/reports/[reportId]/route";
import { __resetRateLimiter } from "@/lib/server/http";
import { signBoardKey, signPhysicalToken } from "@/lib/server/pair";
import { makeEvent } from "@/lib/physical/events";
import { createTournament, reduce } from "@/lib/physical/reducer";
import { pairNextRound } from "@/lib/physical/selectors";
import type { PhysicalEvent, PhysicalTournament } from "@/lib/physical/schema";

const ID = "11111111-2222-4333-8444-555555555555";
const ctx = (id = ID, extra: Record<string, string> = {}) => ({ params: Promise.resolve({ id, ...extra }) });

function base(): PhysicalTournament {
  let t = createTournament({ id: ID, title: "Skolemesterskap", settings: { system: "monrad", rounds: 3, tiebreaks: [], byePoints: 1, allowLateEntry: false } });
  for (const n of ["Anna", "Bjørn", "Cecilie", "David"]) t = reduce(t, makeEvent({ type: "addPlayer", playerId: `p-${n}`, name: n }));
  return t;
}
const paired = () => pairNextRound(base());
const published = () => reduce(paired(), makeEvent({ type: "publishRound", round: 1 }));

const post = (url: string, body: unknown, headers: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const put = (events: PhysicalEvent[], baseVersion: number, hostCode?: string, headers: Record<string, string> = {}) =>
  new Request(`http://x/api/physical/${ID}/log`, {
    method: "PUT",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ events, baseVersion, hostCode }),
  });
const get = (path: string, headers: Record<string, string> = {}) => new Request(`http://x${path}`, { headers });

let db: ReturnType<typeof makeFakeDb>;
async function seed(t = published()) {
  const res = await publish(post("http://x/api/physical/publish", { events: t.events }));
  expect(res.status).toBe(201);
  return (await res.json()) as { hostCode: string; pairToken: string; version: number };
}

beforeEach(() => {
  db = makeFakeDb();
  fake.db = db;
  __resetRateLimiter();
  isCodeBlocked.mockReset().mockResolvedValue(false);
  registerCodeFailure.mockReset().mockResolvedValue(false);
});

describe("POST /api/physical/publish", () => {
  it("creates the row, returns host code + pair token, stores a hash", async () => {
    const out = await seed();
    expect(out.hostCode).toMatch(/^[A-Z]{4}-[A-Z0-9]{2}$/);
    expect(out.pairToken).toBe(await signPhysicalToken(ID, out.hostCode));
    expect(db.tables.physical_tournaments).toHaveLength(1);
    expect(db.tables.physical_tournaments[0]).toMatchObject({ id: ID, log_version: 1, title: "Skolemesterskap" });
    expect(String(db.tables.physical_tournaments[0].log_hash)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("422 invalid_log: replay through the reducer rejects it", async () => {
    const t = paired();
    const bad = [...t.events];
    // a result on a round that was never published
    bad.push(makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0" }));
    expect((await publish(post("http://x/api/physical/publish", { events: bad }))).status).toBe(422);
    expect((await publish(post("http://x/api/physical/publish", { events: [{ type: "nope" }] }))).status).toBe(422);
    expect((await publish(post("http://x/api/physical/publish", { events: [] }))).status).toBe(422);
    expect((await publish(post("http://x/api/physical/publish", { nothing: 1 }))).status).toBe(400);
    expect(db.tables.physical_tournaments).toHaveLength(0);
  });

  it("an already published id is 409 without the host code, and an overwrite with it", async () => {
    const { hostCode } = await seed(paired());
    const res = await publish(post("http://x/api/physical/publish", { events: published().events }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_published");
    const ok = await publish(post("http://x/api/physical/publish", { events: published().events, hostCode }));
    expect(ok.status).toBe(200);
    expect((await ok.json()).version).toBe(2);
  });

  it("is rate limited per IP", async () => {
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await publish(post("http://x/api/physical/publish", { nothing: 1 }))).status;
    expect(last).toBe(429);
  });
});

describe("GET /api/physical/[id] (public)", () => {
  it("returns the derived snapshot and never the host code or raw log", async () => {
    const { hostCode } = await seed();
    const res = await getPublic(get(`/api/physical/${ID}`), ctx());
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain(hostCode);
    expect(text).not.toContain("host_code");
    expect(text).not.toContain("event_log");
    expect(text).not.toContain("events");
    const j = JSON.parse(text);
    expect(j.title).toBe("Skolemesterskap");
    expect(j.rounds[0].pairings).toHaveLength(2);
    expect(j.standings).toHaveLength(4);
  });

  it("hides draft rounds", async () => {
    await seed(paired());
    const j = await (await getPublic(get(`/api/physical/${ID}`), ctx())).json();
    expect(j.rounds).toHaveLength(0);
  });

  it("404 for unknown and malformed ids", async () => {
    expect((await getPublic(get("/api/physical/x"), ctx("x"))).status).toBe(404);
    expect((await getPublic(get(`/api/physical/${ID}`), ctx())).status).toBe(404);
  });
});

describe("host auth (PUT/GET log, keys, reports, DELETE)", () => {
  it("accepts code or pair token; rejects missing/wrong, counting only wrong codes under scope phys:<id>", async () => {
    const { hostCode, pairToken } = await seed();
    registerCodeFailure.mockClear(); // the publish itself spends one budget unit under scope "publish"
    const events = published().events;
    expect((await putLog(put(events, 1, hostCode), ctx())).status).toBe(200);
    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-pair-token": pairToken }), ctx())).status).toBe(200);
    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-host-code": hostCode.toLowerCase().replace("-", " ") }), ctx())).status).toBe(200);
    expect(registerCodeFailure).not.toHaveBeenCalled();

    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-host-code": "ZZZZ-99" }), ctx())).status).toBe(401);
    expect(registerCodeFailure).toHaveBeenCalledWith(`phys:${ID}`, expect.any(Request));
    expect((await getLog(get(`/api/physical/${ID}/log`), ctx())).status).toBe(401);
    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-pair-token": "forged" }), ctx())).status).toBe(401);
  });

  it("a token for another tournament, or a chess-style token, never authenticates", async () => {
    const { hostCode } = await seed();
    const other = await signPhysicalToken("99999999-8888-4777-8666-555555555555", hostCode);
    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-pair-token": other! }), ctx())).status).toBe(401);
  });

  it("429 when the IP is blocked (even for the right code); a valid token bypasses the block", async () => {
    const { hostCode, pairToken } = await seed();
    isCodeBlocked.mockResolvedValue(true);
    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-host-code": hostCode }), ctx())).status).toBe(429);
    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-pair-token": pairToken }), ctx())).status).toBe(200);
  });

  it("the correct code is re-checked with fresh:true (no stale negative-cache oracle)", async () => {
    const { hostCode } = await seed();
    isCodeBlocked.mockImplementation((async (_s: string, _r: Request, o?: { fresh?: boolean }) => !!o?.fresh) as never);
    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-host-code": hostCode }), ctx())).status).toBe(429);
  });

  it("a wrong code that trips the limit answers 429", async () => {
    await seed();
    registerCodeFailure.mockResolvedValue(true);
    expect((await getLog(get(`/api/physical/${ID}/log`, { "x-host-code": "ZZZZ-99" }), ctx())).status).toBe(429);
  });

  it("unknown or non-uuid id is 401 and not counted", async () => {
    expect((await getLog(get("/api/physical/zzz/log", { "x-host-code": "ZZZZ-99" }), ctx("zzz"))).status).toBe(401);
    expect(registerCodeFailure).not.toHaveBeenCalled();
  });
});

describe("PUT /api/physical/[id]/log", () => {
  it("advances log_version and stores the new log + hash", async () => {
    const { hostCode } = await seed(paired());
    const t = published();
    const res = await putLog(put(t.events, 1, hostCode), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).version).toBe(2);
    expect(db.tables.physical_tournaments[0].log_version).toBe(2);
    expect((db.tables.physical_tournaments[0].event_log as unknown[]).length).toBe(t.events.length);
  });

  it("409 version_conflict with the current version when the base is stale", async () => {
    const { hostCode } = await seed(paired());
    await putLog(put(published().events, 1, hostCode), ctx()); // -> v2 (other device)
    const mine = reduce(published(), makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0" }));
    const res = await putLog(put(mine.events, 1, hostCode), ctx());
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "version_conflict", version: 2 });
    expect(db.tables.physical_tournaments[0].log_version).toBe(2);
  });

  it("is idempotent: a retry of a push that already landed is 200 with the same version", async () => {
    const { hostCode } = await seed(paired());
    const events = published().events;
    expect((await (await putLog(put(events, 1, hostCode), ctx())).json()).version).toBe(2);
    const again = await putLog(put(events, 1, hostCode), ctx());
    expect(again.status).toBe(200);
    expect((await again.json()).version).toBe(2);
    expect(db.tables.physical_tournaments[0].log_version).toBe(2);
  });

  it("422 invalid_log for a replay failure, a foreign tournament id or an oversize log; nothing stored", async () => {
    const { hostCode } = await seed(paired());
    const bad = [...paired().events, makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0" })];
    expect((await putLog(put(bad, 1, hostCode), ctx())).status).toBe(422);
    const foreign = createTournament({ id: "99999999-8888-4777-8666-555555555555", title: "X", settings: base().settings }).events;
    expect((await putLog(put(foreign, 1, hostCode), ctx())).status).toBe(422);
    expect((await putLog(put([], 1, hostCode), ctx())).status).toBe(422);
    expect(db.tables.physical_tournaments[0].log_version).toBe(1);
  });

  it("400 on a bad baseVersion", async () => {
    const { hostCode } = await seed();
    expect((await putLog(put(published().events, 0, hostCode), ctx())).status).toBe(400);
  });
});

describe("POST /api/physical/[id]/report", () => {
  const key = (round = 1, board = 1) => signBoardKey(ID, round, board);
  const rep = async (over: Record<string, unknown> = {}, k?: string | null) =>
    report(
      post(`http://x/api/physical/${ID}/report`, {
        round: 1, board: 1, result: "1-0", reporter: "white", requestId: "req-aaaa-0001", deviceId: "dev-aaaa-0001",
        k: k === undefined ? await key() : k, ...over,
      }),
      ctx(),
    );

  it("accepts a report with a valid board key and stores it pending", async () => {
    await seed();
    const res = await rep();
    expect(res.status).toBe(200);
    expect(db.tables.physical_result_reports).toHaveLength(1);
    expect(db.tables.physical_result_reports[0]).toMatchObject({ round: 1, board: 1, result: "1-0", reporter: "white", status: "pending" });
  });

  it("403 bad_key for forged, missing, or another board's key; nothing stored", async () => {
    await seed();
    for (const k of ["forged", "", null, await key(1, 2), await key(2, 1)]) {
      const res = await rep({}, k as string | null);
      expect(res.status, String(k)).toBe(k === "" || k === null ? 403 : 403);
      expect((await res.json()).error).toBe("bad_key");
    }
    expect(db.tables.physical_result_reports).toHaveLength(0);
  });

  it("a key for tournament A never works for tournament B", async () => {
    await seed();
    const otherKey = await signBoardKey("99999999-8888-4777-8666-555555555555", 1, 1);
    expect((await rep({}, otherKey)).status).toBe(403);
  });

  it("is idempotent on requestId (flaky-network retry) - also after the arbiter filled the result", async () => {
    await seed();
    const a = await (await rep()).json();
    const b = await (await rep()).json();
    expect(b.report.id).toBe(a.report.id);
    expect(db.tables.physical_result_reports).toHaveLength(1);
    // arbiter approves + pushes the result; the player's retry still gets the same answer
    const { hostCode } = { hostCode: String(db.tables.physical_tournaments[0].host_code) };
    const withResult = reduce(published(), makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0", source: "player_report" }));
    await putLog(put(withResult.events, 1, hostCode), ctx());
    const c = await rep();
    expect(c.status).toBe(200);
    expect((await c.json()).report.id).toBe(a.report.id);
  });

  it("a requestId already used for another tournament is 409", async () => {
    await seed();
    db.tables.physical_result_reports.push({ id: "x", tournament_id: "99999999-8888-4777-8666-555555555555", request_id: "req-aaaa-0001", status: "pending", round: 1, board: 1, result: "1-0", reporter: "white", created_at: "" });
    expect((await rep()).status).toBe(409);
  });

  it("a newer pending report from the same DEVICE replaces the older; another device's stays", async () => {
    await seed();
    await rep({ requestId: "req-aaaa-0001", result: "1-0", reporter: "white", deviceId: "dev-aaaa-0001" });
    await rep({ requestId: "req-aaaa-0002", result: "0-1", reporter: "black", deviceId: "dev-bbbb-0002" });
    await rep({ requestId: "req-aaaa-0003", result: "½-½", reporter: "white", deviceId: "dev-aaaa-0001" });
    const rows = db.tables.physical_result_reports;
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => `${r.device_id}:${r.result}`).sort()).toEqual(["dev-aaaa-0001:½-½", "dev-bbbb-0002:0-1"]);
  });

  it("two players who both leave the side as 'unknown' no longer overwrite each other", async () => {
    await seed();
    await rep({ requestId: "req-aaaa-0001", result: "1-0", reporter: "unknown", deviceId: "dev-aaaa-0001" });
    await rep({ requestId: "req-aaaa-0002", result: "0-1", reporter: "unknown", deviceId: "dev-bbbb-0002" });
    const rows = db.tables.physical_result_reports;
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.status === "pending")).toBe(true);
  });

  it("keeps at most 8 pending reports per board (oldest dropped)", async () => {
    await seed();
    for (let i = 0; i < 12; i++) await rep({ requestId: `req-flood-${String(i).padStart(4, "0")}`, deviceId: `dev-flood-${String(i).padStart(4, "0")}` });
    const rows = db.tables.physical_result_reports;
    expect(rows).toHaveLength(8);
    expect(rows.some((r) => r.device_id === "dev-flood-0000")).toBe(false);
  });

  it("stores the pairing fingerprint from the PUBLIC snapshot and returns it with deviceId", async () => {
    await seed();
    const out = await (await rep()).json();
    const g = published().rounds[0].pairings[0];
    expect(db.tables.physical_result_reports[0].pairing_fp).toBe(`${g.white}|${g.black}`);
    expect(out.report).toMatchObject({ deviceId: "dev-aaaa-0001", pairingFp: `${g.white}|${g.black}` });
  });

  it("409 pairing_changed when the phone saw other players than the board has now", async () => {
    await seed();
    const g = published().rounds[0].pairings[0];
    expect((await rep({ fp: `${g.white}|${g.black}` })).status).toBe(200);
    const stale = await rep({ requestId: "req-aaaa-0002", deviceId: "dev-bbbb-0002", fp: "old-white|old-black" });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toBe("pairing_changed");
    expect(db.tables.physical_result_reports).toHaveLength(1);
    // a retry of the report that DID land is still answered with the same report
    expect((await rep({ fp: "old-white|old-black" })).status).toBe(200);
  });

  it("a swap pushed after a report supersedes it (it is never credited to the new players)", async () => {
    const { hostCode } = await seed();
    await rep();
    expect(db.tables.physical_result_reports[0].status).toBe("pending");
    const t = published();
    const swapped = reduce(t, makeEvent({ type: "swapPairing", round: 1, a: { board: 1, side: "white" }, b: { board: 2, side: "white" }, afterPublish: true }));
    expect((await putLog(put(swapped.events, 1, hostCode), ctx())).status).toBe(200);
    expect(db.tables.physical_result_reports[0].status).toBe("superseded");
    // and a new report now gets the NEW fingerprint
    const g = swapped.rounds[0].pairings[0];
    await rep({ requestId: "req-aaaa-0005", deviceId: "dev-bbbb-0002" });
    expect(db.tables.physical_result_reports[1].pairing_fp).toBe(`${g.white}|${g.black}`);
  });

  it("report POSTs never touch the tournament's updated_at (retention is extended by the host only)", async () => {
    await seed();
    const before = db.tables.physical_tournaments[0].updated_at;
    await rep();
    expect(db.tables.physical_tournaments[0].updated_at).toBe(before);
  });

  it("a report reads the stored snapshot: it works even when the stored log is unreplayable garbage", async () => {
    await seed();
    db.tables.physical_tournaments[0].event_log = [{ type: "garbage" }];
    expect((await rep()).status).toBe(200);
  });

  it("409 when the board already has a result, the round is completed or still a draft", async () => {
    const { hostCode } = await seed(paired());
    expect(((await rep()).status)).toBe(409); // draft
    const withResult = reduce(published(), makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0" }));
    await putLog(put(withResult.events, 1, hostCode), ctx());
    const r1 = await rep({ requestId: "req-aaaa-0009" });
    expect(r1.status).toBe(409);
    expect((await r1.json()).error).toBe("already_has_result");
    let done = reduce(withResult, makeEvent({ type: "setResult", round: 1, board: 2, result: "½-½" }));
    done = reduce(done, makeEvent({ type: "completeRound", round: 1 }));
    await putLog(put(done.events, 2, hostCode), ctx());
    const r2 = await rep({ requestId: "req-aaaa-0010", board: 2 }, await key(1, 2));
    expect((await r2.json()).error).toBe("round_closed");
    expect(db.tables.physical_result_reports).toHaveLength(0);
  });

  it("400 on malformed input, 404 on an unknown board/tournament", async () => {
    await seed();
    expect((await rep({ result: "2-0" })).status).toBe(400);
    expect((await rep({ reporter: "mom" })).status).toBe(400);
    expect((await rep({ requestId: "short" })).status).toBe(400);
    expect((await rep({ deviceId: "x" })).status).toBe(400);
    expect((await rep({ deviceId: undefined })).status).toBe(400);
    expect((await rep({ fp: 5 })).status).toBe(400);
    expect((await rep({ round: "1" })).status).toBe(400);
    expect((await rep({ board: 9 }, await key(1, 9))).status).toBe(404);
    const res = await report(post(`http://x/api/physical/zzz/report`, {}), ctx("zzz"));
    expect(res.status).toBe(404);
  });

  it("is rate limited per IP", async () => {
    await seed();
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await rep({ requestId: `req-rate-${String(i).padStart(4, "0")}` })).status;
    expect(last).toBe(429);
  });
});

describe("host reports: list + decide", () => {
  it("lists pending reports (host only) and records approve/reject without touching the log", async () => {
    const { hostCode, pairToken } = await seed();
    const k = await signBoardKey(ID, 1, 1);
    const r = await report(post(`http://x/api/physical/${ID}/report`, { round: 1, board: 1, result: "1-0", reporter: "white", requestId: "req-aaaa-0001", deviceId: "dev-aaaa-0001", k }), ctx());
    const id = (await r.json()).report.id as string;

    expect((await listReports(get(`/api/physical/${ID}/reports`), ctx())).status).toBe(401);
    const list = await (await listReports(get(`/api/physical/${ID}/reports`, { "x-pair-token": pairToken }), ctx())).json();
    expect(list.reports).toHaveLength(1);

    const before = JSON.stringify(db.tables.physical_tournaments[0].event_log);
    const rc = { params: Promise.resolve({ id: ID, reportId: id }) };
    const ok = await decide(post(`http://x/api/physical/${ID}/reports/${id}`, { action: "approve" }, { "x-host-code": hostCode }), rc);
    expect(ok.status).toBe(200);
    expect((await ok.json()).report.status).toBe("approved");
    expect(JSON.stringify(db.tables.physical_tournaments[0].event_log)).toBe(before); // server never writes results
    // idempotent, and the first decision wins
    const again = await decide(post(`http://x/api/physical/${ID}/reports/${id}`, { action: "reject" }, { "x-host-code": hostCode }), rc);
    expect((await again.json()).report.status).toBe("approved");
    expect((await (await listReports(get(`/api/physical/${ID}/reports`, { "x-pair-token": pairToken }), ctx())).json()).reports).toHaveLength(0);
    expect((await decide(post(`http://x/api/physical/${ID}/reports/${id}`, { action: "approve" }), rc)).status).toBe(401);
    expect((await decide(post(`http://x/api/physical/${ID}/reports/${id}`, { action: "x" }, { "x-host-code": hostCode }), rc)).status).toBe(400);
  });
});

describe("keys + unpublish", () => {
  it("keys: host only, matches signBoardKey, bounded", async () => {
    const { hostCode } = await seed();
    expect((await getKeys(get(`/api/physical/${ID}/keys?round=1&boards=2`), ctx())).status).toBe(401);
    const res = await getKeys(get(`/api/physical/${ID}/keys?round=2&boards=3`, { "x-host-code": hostCode }), ctx());
    const { keys } = await res.json();
    expect(Object.keys(keys)).toEqual(["2|1", "2|2", "2|3"]);
    expect(keys["2|2"]).toBe(await signBoardKey(ID, 2, 2));
    expect((await getKeys(get(`/api/physical/${ID}/keys?round=2&boards=9999`, { "x-host-code": hostCode }), ctx())).status).toBe(400);
  });

  it("DELETE removes the row (host only)", async () => {
    const { hostCode } = await seed();
    const del = (h: Record<string, string>) => unpublish(new Request(`http://x/api/physical/${ID}`, { method: "DELETE", headers: h }), ctx());
    expect((await del({})).status).toBe(401);
    expect((await del({ "x-host-code": hostCode })).status).toBe(200);
    expect(db.tables.physical_tournaments).toHaveLength(0);
  });
});
