import vm from "node:vm";
import { describe, expect, it } from "vitest";

import { safeVersion, swSource } from "@/lib/sw/source";
import { GET } from "@/app/sw.js/route";

// Run the real worker source in a sandbox with a fake CacheStorage.
function boot(buildId: string, existing: string[]) {
  const deleted: string[] = [];
  const listeners: Record<string, (e: unknown) => void> = {};
  let skipped = 0;
  let claimed = 0;
  const self = {
    location: { origin: "https://x.test" },
    addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
    skipWaiting: () => void skipped++,
    clients: { claim: async () => void claimed++ },
  };
  const caches = {
    keys: async () => existing,
    delete: async (k: string) => (deleted.push(k), true),
    open: async () => ({ put: async () => {}, match: async () => undefined }),
  };
  const ctx = vm.createContext({ self, caches, fetch: async () => ({ ok: false, status: 404 }), URL, Response, Promise });
  vm.runInContext(swSource(buildId), ctx);
  const run = async (type: string, data?: unknown) => {
    let p: Promise<unknown> = Promise.resolve();
    listeners[type]({ waitUntil: (x: Promise<unknown>) => (p = x), data });
    await p;
  };
  return { run, deleted, skipped: () => skipped, claimed: () => claimed };
}

// Install against a fake network, with a working cache, then report what happened.
async function install(respond: (path: string) => Promise<{ ok: boolean; status: number; redirected?: boolean; html?: string }>) {
  const listeners: Record<string, (e: unknown) => void> = {};
  const stored: string[] = [];
  const self = {
    location: { origin: "https://x.test" },
    addEventListener: (t: string, fn: (e: unknown) => void) => (listeners[t] = fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  };
  const caches = {
    keys: async () => [],
    delete: async () => true,
    open: async () => ({ put: async (k: string) => void stored.push(k), match: async () => undefined }),
  };
  const fetch = async (path: string) => {
    const r = await respond(path);
    const res = { redirected: false, ...r, text: async () => r.html ?? "", clone: () => res };
    return res;
  };
  vm.runInContext(swSource("new1"), vm.createContext({ self, caches, fetch, URL, Response, Promise, Set, Error }));
  let p: Promise<unknown> = Promise.resolve();
  listeners.install({ waitUntil: (x: Promise<unknown>) => (p = x) });
  return { done: p, stored };
}

const HTML = '<script src="/_next/static/chunks/a.js"></script>';

describe("service worker install: an incomplete precache must not replace a working shell", () => {
  it("rejects when the network is down, so activate never evicts the old caches", async () => {
    const { done } = await install(async () => {
      throw new Error("offline");
    });
    await expect(done).rejects.toThrow("offline");
  });

  it("rejects on a 5xx document", async () => {
    const { done } = await install(async () => ({ ok: false, status: 503 }));
    await expect(done).rejects.toThrow("503");
  });

  it("rejects when a chunk the shell needs is missing", async () => {
    const { done } = await install(async (p) =>
      p.startsWith("/_next/") ? { ok: false, status: 500 } : { ok: true, status: 200, html: HTML },
    );
    await expect(done).rejects.toThrow("a.js");
  });

  it("still skips a route that does not exist or redirects", async () => {
    const { done, stored } = await install(async (p) =>
      p === "/offline" ? { ok: false, status: 404 } : { ok: true, status: 200, redirected: true },
    );
    await expect(done).resolves.toBeDefined();
    expect(stored).toEqual([]);
  });

  it("caches the shell and its chunks when everything answers", async () => {
    const { done, stored } = await install(async () => ({ ok: true, status: 200, html: HTML }));
    await done;
    expect(stored).toEqual(expect.arrayContaining(["/offline", "/arranger/fysisk", "/_next/static/chunks/a.js"]));
  });
});

describe("service worker versioning", () => {
  it("stamps the build id; different builds give different workers", () => {
    expect(swSource("abc1234")).toContain('const VERSION = "abc1234";');
    expect(swSource("abc1234")).not.toBe(swSource("def5678"));
    expect(swSource("abc1234")).not.toContain("__BUILD_VERSION__");
  });

  it("never lets odd characters into the string literal", () => {
    expect(safeVersion('a"b;\nc')).toBe("abc");
    expect(safeVersion(undefined)).toBe("dev");
    expect(safeVersion("")).toBe("dev");
  });

  it("serves it with no-cache headers", async () => {
    const res = GET();
    expect(res.headers.get("cache-control")).toMatch(/no-store/);
    expect(res.headers.get("content-type")).toContain("javascript");
    expect(res.headers.get("service-worker-allowed")).toBe("/");
  });

  it("evicts caches from older builds on activate, keeps the current ones and foreign caches", async () => {
    const sw = boot("new1", [
      "sundaychess-shell-old1",
      "sundaychess-static-old1",
      "sundaychess-assets-old1",
      "sundaychess-shell-new1",
      "sundaychess-static-new1",
      "sundaychess-assets-new1",
      "other-app-cache",
    ]);
    await sw.run("activate");
    expect(sw.deleted.sort()).toEqual([
      "sundaychess-assets-old1",
      "sundaychess-shell-old1",
      "sundaychess-static-old1",
    ]);
  });

  it("does not take over on install; only on an explicit SKIP_WAITING message", async () => {
    const sw = boot("new1", []);
    await sw.run("install");
    expect(sw.skipped()).toBe(0);
    await sw.run("message", { type: "OTHER" });
    expect(sw.skipped()).toBe(0);
    await sw.run("message", { type: "SKIP_WAITING" });
    expect(sw.skipped()).toBe(1);
  });
});
