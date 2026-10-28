import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeFakeDb } from "./helpers/fakeSupabase";

const fake = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/lib/supabase/service", () => ({ createServiceClient: () => (fake.db as { client: unknown }).client }));

const { isCodeBlocked, registerCodeFailure } = vi.hoisted(() => ({
  isCodeBlocked: vi.fn(async () => false),
  registerCodeFailure: vi.fn(async (...args: unknown[]) => (args.length < 0)),
}));
vi.mock("@/lib/server/attempts", () => ({
  isCodeBlocked: (...a: unknown[]) => (isCodeBlocked as (...x: unknown[]) => Promise<boolean>)(...a),
  registerCodeFailure: (...a: unknown[]) => registerCodeFailure(...a),
}));

import { POST as publish } from "@/app/api/physical/publish/route";
import { GET as getPublic } from "@/app/api/physical/[id]/route";
import { PUT as putLog } from "@/app/api/physical/[id]/log/route";
import { POST as report } from "@/app/api/physical/[id]/report/route";
import { __resetRateLimiter } from "@/lib/server/http";
import { signBoardKey } from "@/lib/server/pair";
import { MAX_EVENTS, MAX_LOG_BYTES, MAX_PLAYERS } from "@/lib/physical/cloudTypes";
import { makeEvent } from "@/lib/physical/events";
import { createTournament, reduce } from "@/lib/physical/reducer";
import { pairNextRound } from "@/lib/physical/selectors";
import type { PhysicalTournament } from "@/lib/physical/schema";
import * as reducerMod from "@/lib/physical/reducer";

const ID = "11111111-2222-4333-8444-555555555555";
const CLOUD = "22222222-2222-4333-8444-555555555555";
const ctx = (id = ID) => ({ params: Promise.resolve({ id }) });
const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://x/api/physical/publish", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

function base(): PhysicalTournament {
  let t = createTournament({ id: ID, title: "Skole", settings: { system: "monrad", rounds: 3, tiebreaks: [], byePoints: 1, allowLateEntry: false } });
  for (const [i, n] of ["Anna Hansen", "Bjørn Ola Berg", "Cecilie", "David Dahl"].entries()) {
    t = reduce(t, makeEvent({ type: "addPlayer", playerId: `p-${i}`, name: n, club: "7A" }));
  }
  return t;
}
const published = () => reduce(pairNextRound(base()), makeEvent({ type: "publishRound", round: 1 }));

let db: ReturnType<typeof makeFakeDb>;
beforeEach(() => {
  db = makeFakeDb();
  fake.db = db;
  __resetRateLimiter();
  isCodeBlocked.mockReset().mockResolvedValue(false);
  registerCodeFailure.mockReset().mockResolvedValue(false);
});

describe("publish: DoS limits are enforced BEFORE any replay", () => {
  it("413 on a declared or streamed oversize body, without parsing it", async () => {
    const big = "x".repeat(MAX_LOG_BYTES + 20_000);
    const res = await publish(post({ events: [], pad: big }));
    expect(res.status).toBe(413);
    expect((await res.json()).error).toBe("payload_too_large");
    // lying / missing Content-Length: caught while streaming
    const streamed = new Request("http://x/api/physical/publish", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"pad":"' + big + '"}'));
          c.close();
        },
      }),
      // @ts-expect-error duplex is required for stream bodies in undici
      duplex: "half",
    });
    expect((await publish(streamed)).status).toBe(413);
    expect(db.tables.physical_tournaments).toHaveLength(0);
  });

  it("422 too_many_events / too_many_players without replaying", async () => {
    const spy = vi.spyOn(reducerMod, "replay");
    const t = base();
    const many = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({ type: "editPlayer", id: `e${i}` }));
    const r1 = await publish(post({ events: [t.events[0], ...many] }));
    expect(r1.status).toBe(422);
    expect((await r1.json()).error).toBe("too_many_events");
    const players = Array.from({ length: MAX_PLAYERS + 1 }, (_, i) => ({ type: "addPlayer", id: `a${i}`, playerId: `q${i}` }));
    const r2 = await publish(post({ events: [t.events[0], ...players] }));
    expect(r2.status).toBe(422);
    expect((await r2.json()).error).toBe("too_many_players");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("the same caps guard PUT /log (after auth, before replay)", async () => {
    const out = await (await publish(post({ events: published().events }))).json();
    const spy = vi.spyOn(reducerMod, "replay");
    const t = base();
    const many = Array.from({ length: MAX_EVENTS + 1 }, (_, i) => ({ type: "editPlayer", id: `e${i}` }));
    const put = (body: unknown) =>
      putLog(new Request(`http://x/api/physical/${ID}/log`, { method: "PUT", headers: { "content-type": "application/json", "x-pair-token": out.pairToken }, body: JSON.stringify(body) }), ctx());
    const res = await put({ events: [t.events[0], ...many], baseVersion: 1 });
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("too_many_events");
    expect((await put({ events: [], baseVersion: 1, pad: "x".repeat(MAX_LOG_BYTES + 20_000) })).status).toBe(413);
    // unauthenticated callers never reach the replay at all
    const anon = await putLog(new Request(`http://x/api/physical/${ID}/log`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ events: published().events, baseVersion: 1 }) }), ctx());
    expect(anon.status).toBe(401);
    expect(spy).not.toHaveBeenCalled();
    // control: an authorised, in-limits push DOES replay (so the spy really observes the route)
    expect((await put({ events: published().events, baseVersion: 1 })).status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });

  it("a DB-backed daily budget per IP: every publish is counted under scope 'publish'; the 11th is 429", async () => {
    await publish(post({ events: published().events }));
    expect(registerCodeFailure).toHaveBeenCalledWith("publish", expect.any(Request), { max: 11, windowS: 86_400 });
    registerCodeFailure.mockResolvedValue(true);
    const res = await publish(post({ events: published().events, cloudId: CLOUD }));
    expect(res.status).toBe(429);
    expect(db.tables.physical_tournaments).toHaveLength(1);
    // invalid logs also spend budget (they cost CPU), malformed bodies do not reach it
    registerCodeFailure.mockClear().mockResolvedValue(false);
    await publish(post({ events: [{ type: "nope" }] }));
    expect(registerCodeFailure).toHaveBeenCalledTimes(1);
    await publish(post({ nothing: 1 }));
    expect(registerCodeFailure).toHaveBeenCalledTimes(1);
  });
});

describe("public reads never replay", () => {
  it("GET /api/physical/[id] serves the stored snapshot even if the stored log is garbage", async () => {
    await publish(post({ events: published().events }));
    db.tables.physical_tournaments[0].event_log = [{ type: "garbage" }];
    const spy = vi.spyOn(reducerMod, "replay");
    const res = await getPublic(new Request(`http://x/api/physical/${ID}`), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).rounds).toHaveLength(1);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("PUT refreshes the stored snapshot (results show up publicly)", async () => {
    const out = await (await publish(post({ events: published().events }))).json();
    const withRes = reduce(published(), makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0" }));
    await putLog(new Request(`http://x/api/physical/${ID}/log`, { method: "PUT", headers: { "content-type": "application/json", "x-pair-token": out.pairToken }, body: JSON.stringify({ events: withRes.events, baseVersion: 1 }) }), ctx());
    const j = await (await getPublic(new Request(`http://x/api/physical/${ID}`), ctx())).json();
    expect(j.rounds[0].pairings[0].result).toBe("1-0");
    expect(j.version).toBe(2);
  });
});

describe("name policy of the public snapshot", () => {
  const names = async (body: Record<string, unknown>) => {
    await publish(post({ events: published().events, ...body }));
    return (await (await getPublic(new Request(`http://x/api/physical/${ID}`), ctx())).json()) as {
      names: string;
      groupLabel: string | null;
      players: { name: string; club: string | null }[];
      standings: { name: string; club: string | null }[];
    };
  };

  it("defaults to initials: «Anna H.», no club/class anywhere", async () => {
    const j = await names({});
    expect(j.names).toBe("initials");
    expect(j.players.map((p) => p.name)).toEqual(["Anna H.", "Bjørn B.", "Cecilie", "David D."]);
    expect(j.players.every((p) => p.club === null)).toBe(true);
    expect(j.standings.every((p) => p.club === null && !p.name.includes("Hansen"))).toBe(true);
    expect(JSON.stringify(j)).not.toMatch(/Hansen|Berg|Dahl|7A/);
  });

  it("the arbiter can opt in to full names (and club) at publish time", async () => {
    const j = await names({ publicNames: "full" });
    expect(j.names).toBe("full");
    expect(j.players.map((p) => p.name)).toContain("Anna Hansen");
    expect(j.players[0].club).toBe("7A");
  });

  it("rejects an unknown mode", async () => {
    expect((await publish(post({ events: published().events, publicNames: "everything" }))).status).toBe(400);
  });

  it("a later PUT keeps the mode chosen at publish", async () => {
    const out = await (await publish(post({ events: published().events, publicNames: "full" }))).json();
    const more = reduce(published(), makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0" }));
    await putLog(new Request(`http://x/api/physical/${ID}/log`, { method: "PUT", headers: { "content-type": "application/json", "x-pair-token": out.pairToken }, body: JSON.stringify({ events: more.events, baseVersion: 1 }) }), ctx());
    expect(db.tables.physical_tournaments[0].public_names).toBe("full");
    expect(((db.tables.physical_tournaments[0].public_snapshot as { players: { name: string }[] }).players[0]).name).toBe("Anna Hansen");
  });
});

describe("id squatting: publish under another cloud id", () => {
  it("an id owned by someone else is 409 without auth; a fresh cloudId publishes the same tournament", async () => {
    // someone else holds ID
    db.tables.physical_tournaments.push({ id: ID, host_code: "ZZZZ-99", title: "x", log_version: 1, log_hash: "h", public_names: "initials", local_id: null, event_log: [], public_snapshot: {}, updated_at: "", created_at: "" });
    const res = await publish(post({ events: published().events }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("already_published");
    const ok = await publish(post({ events: published().events, cloudId: CLOUD }));
    expect(ok.status).toBe(201);
    const out = await ok.json();
    expect(out.id).toBe(CLOUD);
    const row = db.tables.physical_tournaments.find((r) => r.id === CLOUD)!;
    expect(row.local_id).toBe(ID);
    // the public snapshot is addressed by the cloud id, and PUT/report work against it
    const pub = await (await getPublic(new Request(`http://x/api/physical/${CLOUD}`), ctx(CLOUD))).json();
    expect(pub.id).toBe(CLOUD);
    const withRes = reduce(published(), makeEvent({ type: "setResult", round: 1, board: 1, result: "1-0" }));
    const put = await putLog(new Request(`http://x/api/physical/${CLOUD}/log`, { method: "PUT", headers: { "content-type": "application/json", "x-pair-token": out.pairToken }, body: JSON.stringify({ events: withRes.events, baseVersion: 1 }) }), ctx(CLOUD));
    expect(put.status).toBe(200);
    const k = await signBoardKey(CLOUD, 1, 2);
    const rep = await report(
      new Request(`http://x/api/physical/${CLOUD}/report`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ round: 1, board: 2, result: "1-0", reporter: "white", requestId: "req-cloud-0001", deviceId: "dev-cloud-0001", k }) }),
      ctx(CLOUD),
    );
    expect(rep.status).toBe(200);
  });
});
