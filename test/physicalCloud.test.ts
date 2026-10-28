import { beforeEach, describe, expect, it } from "vitest";
import { CloudSync, BACKOFF_START_MS, DEBOUNCE_MS, sigOf, type HttpResult, type Timers, type Transport } from "@/lib/physical/cloud";
import { clearMeta, loadMeta, reportUrl, saveMeta } from "@/lib/physical/cloudMeta";
import { makeEvent } from "@/lib/physical/events";
import { createTournament, reduce } from "@/lib/physical/reducer";
import type { PhysicalEvent } from "@/lib/physical/schema";

const ID = "11111111-2222-4333-8444-555555555555";

function log(n: number): PhysicalEvent[] {
  let t = createTournament({ id: ID, title: "T", settings: { system: "monrad", rounds: 3, tiebreaks: [], byePoints: 1, allowLateEntry: false } });
  for (let i = 0; i < n; i++) t = reduce(t, makeEvent({ type: "addPlayer", playerId: `p${i}`, name: `P${i}` }));
  return t.events;
}

class FakeTimers implements Timers {
  q: { fn: () => void; ms: number; h: number }[] = [];
  n = 0;
  set(fn: () => void, ms: number) {
    const h = ++this.n;
    this.q.push({ fn, ms, h });
    return h;
  }
  clear(h: unknown) {
    this.q = this.q.filter((x) => x.h !== h);
  }
  /** Kjør neste planlagte timer; returnerer ms. */
  async fire() {
    const x = this.q.shift()!;
    x.fn();
    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));
    return x.ms;
  }
}

let calls: { method: string; path: string; body: unknown }[];
let replies: HttpResult[];
const transport: Transport = async (method, path, body) => {
  calls.push({ method, path, body });
  return replies.shift() ?? { status: 200, data: { version: 99 } };
};

beforeEach(() => {
  calls = [];
  replies = [];
  clearMeta(ID);
});

const mk = () => {
  const timers = new FakeTimers();
  return { timers, c: new CloudSync(ID, transport, timers) };
};

describe("CloudSync", () => {
  it("is unpublished and never calls the network before publish", () => {
    const { c, timers } = mk();
    c.notifyLocalChange(log(2));
    expect(c.getState().status).toBe("unpublished");
    expect(timers.q).toHaveLength(0);
    expect(calls).toHaveLength(0);
  });

  it("publish stores meta (code, token, version) and reports synced", async () => {
    const { c } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: "tok", version: 1 } });
    const events = log(2);
    expect(await c.publish(events)).toEqual({ ok: true });
    expect(loadMeta(ID)).toMatchObject({ hostCode: "ABCD-12", pairToken: "tok", syncedVersion: 1, syncedSig: sigOf(events) });
    expect(c.getState().status).toBe("synced");
  });

  it("debounces: several changes -> ONE push with the latest log and baseVersion", async () => {
    const { c, timers } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: null, version: 1 } });
    await c.publish(log(1));
    c.notifyLocalChange(log(2));
    c.notifyLocalChange(log(3));
    expect(c.getState().status).toBe("pending");
    expect(timers.q).toHaveLength(1);
    expect(timers.q[0].ms).toBe(DEBOUNCE_MS);
    replies.push({ status: 200, data: { version: 2 } });
    await timers.fire();
    const puts = calls.filter((x) => x.method === "PUT");
    expect(puts).toHaveLength(1);
    expect((puts[0].body as { baseVersion: number; events: unknown[] }).baseVersion).toBe(1);
    expect((puts[0].body as { events: unknown[] }).events).toHaveLength(log(3).length);
    expect(c.getState().status).toBe("synced");
    expect(loadMeta(ID)!.syncedVersion).toBe(2);
  });

  it("offline: retries with exponential backoff, then heals without losing anything", async () => {
    const { c, timers } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: null, version: 1 } });
    await c.publish(log(1));
    const events = log(2);
    c.notifyLocalChange(events);
    replies.push({ status: 0, data: {} }, { status: 503, data: { error: "server_error" } }, { status: 200, data: { version: 2 } });
    await timers.fire();
    expect(c.getState().status).toBe("offline");
    expect(await timers.fire()).toBe(BACKOFF_START_MS);
    expect(c.getState().status).toBe("offline");
    expect(await timers.fire()).toBe(BACKOFF_START_MS * 2);
    expect(c.getState().status).toBe("synced");
    // alle forsøk sendte samme base og samme logg (idempotent)
    const puts = calls.filter((x) => x.method === "PUT").map((x) => x.body as { baseVersion: number; events: unknown[] });
    expect(new Set(puts.map((p) => p.baseVersion))).toEqual(new Set([1]));
    expect(puts.every((p) => p.events.length === events.length)).toBe(true);
  });

  it("an edit made while a push is in flight is pushed afterwards", async () => {
    const { c, timers } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: null, version: 1 } });
    await c.publish(log(1));
    c.notifyLocalChange(log(2));
    let release!: (r: HttpResult) => void;
    const slow: Transport = (m, p, b) => {
      calls.push({ method: m, path: p, body: b });
      return new Promise((r) => (release = r));
    };
    const c2 = new CloudSync(ID, slow, timers);
    c2.notifyLocalChange(log(2));
    const p = c2.pushNow();
    c2.notifyLocalChange(log(3));
    release({ status: 200, data: { version: 2 } });
    await p;
    expect(c2.getState().status).toBe("pending");
    expect(timers.q.length).toBeGreaterThan(0);
  });

  it("409 version_conflict -> conflict, pushes stop; overwrite re-bases and pushes", async () => {
    const { c, timers } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: null, version: 1 } });
    await c.publish(log(1));
    c.notifyLocalChange(log(2));
    replies.push({ status: 409, data: { error: "version_conflict", version: 5 } });
    await timers.fire();
    expect(c.getState()).toMatchObject({ status: "conflict", serverVersion: 5 });
    const n = calls.length;
    c.notifyLocalChange(log(3));
    expect(timers.q).toHaveLength(0);
    expect(calls).toHaveLength(n);
    replies.push({ status: 200, data: { version: 6 } });
    await c.overwriteCloud();
    const last = calls[calls.length - 1];
    expect(last.method).toBe("PUT");
    expect((last.body as { baseVersion: number }).baseVersion).toBe(5);
    expect(c.getState().status).toBe("synced");
    expect(loadMeta(ID)!.syncedVersion).toBe(6);
  });

  it("load cloud version: fetchCloudLog + markSynced clears the conflict", async () => {
    const { c, timers } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: null, version: 1 } });
    await c.publish(log(1));
    c.notifyLocalChange(log(2));
    replies.push({ status: 409, data: { error: "version_conflict", version: 4 } });
    await timers.fire();
    const cloud = log(4);
    replies.push({ status: 200, data: { events: cloud, version: 4 } });
    const got = await c.fetchCloudLog();
    expect(got!.version).toBe(4);
    c.markSynced(got!.events, got!.version);
    expect(c.getState().status).toBe("synced");
    c.notifyLocalChange(cloud); // uendret -> ingen ny push
    expect(timers.q).toHaveLength(0);
  });

  it("permanent errors (401/422) stop retrying", async () => {
    const { c, timers } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: null, version: 1 } });
    await c.publish(log(1));
    c.notifyLocalChange(log(2));
    replies.push({ status: 422, data: { error: "invalid_log" } });
    await timers.fire();
    expect(c.getState()).toMatchObject({ status: "error", errorCode: "invalid_log" });
    expect(timers.q).toHaveLength(0);
  });

  it("board keys are fetched once, cached, and drive reportUrl (offline-safe)", async () => {
    const { c } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: null, version: 1 } });
    await c.publish(log(1));
    expect(reportUrl(ID, 1, 1, "https://x.test")).toBeNull();
    replies.push({ status: 200, data: { keys: { "1|1": "k1", "1|2": "k+2" } } });
    expect(await c.ensureBoardKeys(1, 2)).toBe(true);
    expect(await c.ensureBoardKeys(1, 2)).toBe(true); // cache
    expect(calls.filter((x) => x.path.includes("/keys"))).toHaveLength(1);
    expect(reportUrl(ID, 1, 2, "https://x.test")).toBe(`https://x.test/f/${ID}/r/1/2?k=k%2B2`);
  });

  it("unpublish clears meta and status", async () => {
    const { c } = mk();
    replies.push({ status: 201, data: { hostCode: "ABCD-12", pairToken: null, version: 1 } });
    await c.publish(log(1));
    replies.push({ status: 200, data: { ok: true } });
    expect(await c.unpublish()).toEqual({ ok: true });
    expect(loadMeta(ID)).toBeNull();
    expect(c.getState().status).toBe("unpublished");
  });

  it("saveMeta/loadMeta round-trip with defaults", () => {
    saveMeta(ID, { hostCode: "A", pairToken: null, syncedVersion: 1, syncedSig: null, keys: {} });
    expect(loadMeta(ID)!.hostCode).toBe("A");
  });
});
