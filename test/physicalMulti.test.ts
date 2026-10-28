import { beforeEach, describe, expect, it, vi } from "vitest";
import { CloudSync, type HttpResult, type Timers, type Transport } from "@/lib/physical/cloud";
import { clearMeta, loadMeta, publicUrl, reportUrl, saveMeta } from "@/lib/physical/cloudMeta";
import { MAX_EVENTS, MAX_PLAYERS, logLimitError } from "@/lib/physical/cloudTypes";
import { dismissReminder, isIos, markExported, requestPersistence, shouldRemindExport } from "@/lib/physical/exportReminder";
import { createSaveQueue } from "@/lib/physical/saveQueue";
import { getDeviceId } from "@/lib/physical/reportClient";
import { dispatch } from "@/lib/physical/reducer";
import { memoryStore } from "@/lib/physical/storage";
import { createWriterLock, type LockEnv } from "@/lib/physical/writerLock";
import { standingsCsv, gamesCsv } from "@/lib/export/csv";
import { makeEvent } from "@/lib/physical/events";
import { createTournament, reduce } from "@/lib/physical/reducer";
import type { PhysicalEvent } from "@/lib/physical/schema";
import { meta, newTournament, playRound } from "./physical/helpers";

const ID = "11111111-2222-4333-8444-555555555555";
function log(n: number): PhysicalEvent[] {
  let t = createTournament({ id: ID, title: "T", settings: { system: "monrad", rounds: 3, tiebreaks: [], byePoints: 1, allowLateEntry: false } });
  for (let i = 0; i < n; i++) t = reduce(t, makeEvent({ type: "addPlayer", playerId: `p${i}`, name: `P${i}` }));
  return t.events;
}
const timers: Timers = { set: () => 0, clear: () => {} };

describe("client caps + id collision on publish", () => {
  let calls: { path: string; body: Record<string, unknown> }[];
  let replies: HttpResult[];
  const transport: Transport = async (_m, path, body) => {
    calls.push({ path, body: body as Record<string, unknown> });
    return replies.shift() ?? { status: 200, data: { version: 1 } };
  };
  beforeEach(() => {
    calls = [];
    replies = [];
    clearMeta(ID);
  });

  it("logLimitError: friendly pre-check of events / players / bytes", () => {
    expect(logLimitError(log(3))).toBeNull();
    expect(logLimitError(new Array(MAX_EVENTS + 1).fill({}))).toBe("too_many_events");
    expect(logLimitError(Array.from({ length: MAX_PLAYERS + 1 }, () => ({ type: "addPlayer" })))).toBe("too_many_players");
    expect(logLimitError([{ type: "x", pad: "y".repeat(600_000) }])).toBe("payload_too_large");
  });

  it("publish refuses an oversize log locally, without calling the network", async () => {
    const c = new CloudSync(ID, transport, timers);
    const big = [...log(1), ...Array.from({ length: MAX_PLAYERS + 1 }, (_, i) => ({ type: "addPlayer", id: `x${i}`, at: "", playerId: `z${i}`, name: "N" }) as PhysicalEvent)];
    expect(await c.publish(big)).toEqual({ ok: false, code: "too_many_players" });
    expect(calls).toHaveLength(0);
    expect(c.getState().status).toBe("unpublished");
  });

  it("409 already_published -> retries with a NEW cloud id and stores the mapping", async () => {
    const c = new CloudSync(ID, transport, timers);
    replies.push({ status: 409, data: { error: "already_published" } });
    replies.push({ status: 201, data: { id: "will-be-overridden", hostCode: "ABCD-12", pairToken: "tok", version: 1 } });
    // the server answers with the id it created
    replies[1] = { status: 201, data: { id: "99999999-8888-4777-8666-555555555555", hostCode: "ABCD-12", pairToken: "tok", version: 1 } };
    expect(await c.publish(log(2), { publicNames: "initials" })).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].body.cloudId).toBe(ID);
    expect(calls[1].body.cloudId).not.toBe(ID);
    expect(calls[1].body.publicNames).toBe("initials");
    expect(loadMeta(ID)?.cloudId).toBe("99999999-8888-4777-8666-555555555555");
    // all later calls and links use the cloud id
    expect(publicUrl(ID, "https://x")).toBe("https://x/f/99999999-8888-4777-8666-555555555555");
    saveMeta(ID, { ...loadMeta(ID)!, keys: { "1|1": "KK" } });
    expect(reportUrl(ID, 1, 1, "https://x")).toBe("https://x/f/99999999-8888-4777-8666-555555555555/r/1/1?k=KK");
    replies.push({ status: 200, data: { keys: { "2|1": "K2" } } });
    await c.ensureBoardKeys(2, 1);
    expect(calls[2].path).toBe("/api/physical/99999999-8888-4777-8666-555555555555/keys?round=2&boards=1");
  });

  it("other publish errors are returned, and a size error from PUT stops sync with a clear code", async () => {
    const c = new CloudSync(ID, transport, timers);
    replies.push({ status: 429, data: { error: "rate_limited" } });
    expect(await c.publish(log(2))).toEqual({ ok: false, code: "rate_limited" });
    saveMeta(ID, { hostCode: "A", pairToken: null, syncedVersion: 1, syncedSig: "x", keys: {} });
    const c2 = new CloudSync(ID, transport, timers);
    c2.notifyLocalChange(new Array(MAX_EVENTS + 1).fill({ id: "q", type: "x" }));
    await c2.pushNow();
    expect(c2.getState()).toMatchObject({ status: "error", errorCode: "too_many_events" });
    expect(calls).toHaveLength(1); // only the rate-limited publish
    // 413 from the server is permanent too
    clearMeta(ID);
    saveMeta(ID, { hostCode: "A", pairToken: null, syncedVersion: 1, syncedSig: "x", keys: {} });
    const c3 = new CloudSync(ID, transport, timers);
    replies.push({ status: 413, data: { error: "payload_too_large" } });
    c3.notifyLocalChange(log(2));
    await c3.pushNow();
    expect(c3.getState()).toMatchObject({ status: "error", errorCode: "payload_too_large" });
  });
});

describe("report device id", () => {
  it("is random, stable and well-formed", () => {
    const a = getDeviceId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(getDeviceId()).toBe(a);
  });
});

describe("writer lock (single writer per tournament)", () => {
  /** Minimal Web Locks stand-in incl. ifAvailable and steal. */
  function fakeLocks() {
    const holders = new Map<string, { abort: (e: Error) => void }>();
    return {
      request(name: string, opts: { ifAvailable?: boolean; steal?: boolean }, cb: (l: unknown) => Promise<void> | void): Promise<unknown> {
        return new Promise((resolve, reject) => {
          const cur = holders.get(name);
          if (cur && opts.ifAvailable) return void Promise.resolve(cb(null)).then(resolve, reject);
          if (cur && opts.steal) cur.abort(Object.assign(new Error("stolen"), { name: "AbortError" }));
          const entry = { abort: reject };
          holders.set(name, entry);
          Promise.resolve(cb({})).then(
            (v) => {
              if (holders.get(name) === entry) holders.delete(name);
              resolve(v);
            },
            reject,
          );
        });
      },
    };
  }

  it("Web Locks: the second tab is refused, can take over, and the first is told", async () => {
    const locks = fakeLocks();
    const env: LockEnv = { locks, createChannel: null };
    const lostA = vi.fn();
    const lostB = vi.fn();
    const a = createWriterLock("t", lostA, env);
    const b = createWriterLock("t", lostB, env);
    expect(await a.acquire()).toBe(true);
    expect(a.held).toBe(true);
    expect(await b.acquire()).toBe(false);
    expect(b.held).toBe(false);
    await b.takeOver();
    expect(b.held).toBe(true);
    await new Promise((r) => setTimeout(r, 0));
    expect(lostA).toHaveBeenCalledTimes(1);
    expect(a.held).toBe(false);
    expect(lostB).not.toHaveBeenCalled();
  });

  it("Web Locks: disposing the holder frees the tournament for the next tab", async () => {
    const locks = fakeLocks();
    const env: LockEnv = { locks, createChannel: null };
    const a = createWriterLock("t2", () => {}, env);
    const b = createWriterLock("t2", () => {}, env);
    expect(await a.acquire()).toBe(true);
    a.dispose();
    await new Promise((r) => setTimeout(r, 0));
    expect(await b.acquire()).toBe(true);
    b.dispose();
  });

  it("BroadcastChannel fallback: heartbeat answers hello, takeover demotes the holder", async () => {
    const env: LockEnv = { locks: null, createChannel: (n) => new BroadcastChannel(n) as never, helloWaitMs: 60, beatMs: 20 };
    const lostA = vi.fn();
    const a = createWriterLock("fb", lostA, env);
    const b = createWriterLock("fb", () => {}, env);
    expect(await a.acquire()).toBe(true);
    expect(await b.acquire()).toBe(false);
    await b.takeOver();
    await new Promise((r) => setTimeout(r, 30));
    expect(b.held).toBe(true);
    expect(lostA).toHaveBeenCalledTimes(1);
    expect(a.held).toBe(false);
    a.dispose();
    b.dispose();
  });
});

describe("save queue refuses to overwrite a log somebody else changed", () => {
  it("a store changed by another tab blocks the write, clears the journal and reports a conflict", async () => {
    const store = memoryStore();
    const onConflict = vi.fn();
    const journal = { write: vi.fn(), read: vi.fn(), clear: vi.fn() };
    const q = createSaveQueue(async () => store, undefined, journal as never, undefined, onConflict);
    let t = newTournament({}, 4);
    q.enqueue(t);
    await q.idle();
    q.setBase(t);
    // "another tab" appends an event directly to the store
    const other = dispatch(t, { type: "addPlayer", playerId: "z", name: "Z" }, meta());
    await store.put({ schemaVersion: 1, id: t.id, title: t.title, createdAt: t.createdAt, updatedAt: "9", playerCount: 0, roundsPlayed: 0, events: other.events });
    t = dispatch(t, { type: "addPlayer", playerId: "y", name: "Y" }, meta());
    q.enqueue(t);
    await q.idle();
    expect(onConflict).toHaveBeenCalledTimes(1);
    expect(q.blocked).toBe(true);
    expect((await store.get(t.id))!.events).toHaveLength(other.events.length); // the other tab's work survived
    // further enqueues are ignored until the base is reset
    q.enqueue(t);
    await q.idle();
    expect((await store.get(t.id))!.events).toHaveLength(other.events.length);
    q.setBase(other);
    expect(q.blocked).toBe(false);
  });

  it("normal single-writer flow (incl. undo, which shortens the log) never conflicts", async () => {
    const store = memoryStore();
    const onConflict = vi.fn();
    const q = createSaveQueue(async () => store, undefined, undefined, undefined, onConflict);
    let t = newTournament({}, 4);
    q.enqueue(t);
    await q.idle();
    q.setBase(t);
    const shorter = { ...t, events: t.events.slice(0, -1) };
    q.enqueue(shorter as typeof t);
    await q.idle();
    t = dispatch(t, { type: "addPlayer", playerId: "n", name: "N" }, meta());
    q.enqueue(t);
    await q.idle();
    expect(onConflict).not.toHaveBeenCalled();
    expect((await store.get(t.id))!.events).toHaveLength(t.events.length);
  });
});

describe("export reminder + persistence", () => {
  const kv = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };
  it("nothing before a round is completed; reminder after; export or dismiss silences it until the next round", () => {
    const s = kv();
    let t = newTournament({}, 4);
    expect(shouldRemindExport(t, s)).toBe(false);
    t = playRound(t);
    expect(shouldRemindExport(t, s)).toBe(true);
    dismissReminder(t, s);
    expect(shouldRemindExport(t, s)).toBe(false);
    t = playRound(t);
    expect(shouldRemindExport(t, s)).toBe(true);
    markExported(t, s);
    expect(shouldRemindExport(t, s)).toBe(false);
    expect(shouldRemindExport(playRound(t), s)).toBe(true);
  });
  it("works without localStorage", () => {
    expect(() => shouldRemindExport(playRound(newTournament({}, 4)), null)).not.toThrow();
  });
  it("requestPersistence is best effort", async () => {
    expect(await requestPersistence(undefined)).toBe(false);
    expect(await requestPersistence({ persisted: async () => false, persist: async () => true })).toBe(true);
    expect(await requestPersistence({ persisted: async () => true, persist: async () => { throw new Error("no"); } })).toBe(true);
    expect(await requestPersistence({ persisted: async () => false, persist: async () => { throw new Error("no"); } })).toBe(false);
  });
  it("detects iOS incl. iPadOS posing as a Mac", () => {
    expect(isIos("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 5)).toBe(true);
    expect(isIos("Mozilla/5.0 (Macintosh; Intel Mac OS X)", 0)).toBe(false);
    expect(isIos("Mozilla/5.0 (Windows NT 10.0)", 0)).toBe(false);
  });
});

describe("CSV: every cell goes through the formula guard", () => {
  it("headers and the group label too", () => {
    let t = newTournament({ groupLabel: "=HYPERLINK(\"x\")" }, 4);
    t = dispatch(t, { type: "editPlayer", playerId: "p1", patch: { name: "+cmd", club: "@SUM(A1)" } }, meta());
    const csv = standingsCsv(t);
    const head = csv.replace("﻿", "").split("\r\n")[0].split(";");
    expect(head.some((h) => h.includes("'=HYPERLINK"))).toBe(true);
    for (const line of (csv + gamesCsv(t)).replace(/﻿/g, "").split("\r\n")) {
      for (const c of line.split(";")) expect(c, line).not.toMatch(/^[=+\-@]/);
    }
  });
});
