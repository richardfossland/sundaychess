import { afterEach, describe, expect, it, vi } from "vitest";
import { api, ApiError, READ_TIMEOUT_MS, WRITE_TIMEOUT_MS } from "@/lib/client/api";
import { __resetConnectivity, getConnectivity, isDegraded } from "@/lib/client/connectivity";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  __resetConnectivity();
});

/** A response whose headers arrive but whose body never does until aborted. */
function stalledBody(signal: AbortSignal | undefined) {
  return {
    ok: true,
    status: 200,
    json: () =>
      new Promise((_r, rej) =>
        signal?.addEventListener("abort", () => rej(new DOMException("aborted", "AbortError"))),
      ),
  };
}

describe("client fetch timeouts", () => {
  it("has the 8 s read / 15 s write bounds", () => {
    expect(READ_TIMEOUT_MS).toBe(8000);
    expect(WRITE_TIMEOUT_MS).toBe(15000);
  });

  it("GET gives up after 8 s even when only the body stalls", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => Promise.resolve(stalledBody(init.signal ?? undefined)));
    const p = api.board("t1");
    const expectation = expect(p).rejects.toMatchObject({ code: "timeout", status: 0 });
    await vi.advanceTimersByTimeAsync(7999);
    await vi.advanceTimersByTimeAsync(2);
    await expectation;
  });

  it("POST is still alive at 8 s and times out at 15 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => Promise.resolve(stalledBody(init.signal ?? undefined)));
    let settled = false;
    const p = api.resign("g", "p", "c").catch((e) => {
      settled = true;
      return e;
    });
    await vi.advanceTimersByTimeAsync(9000);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(6100);
    const err = await p;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "timeout" });
  });

  it("repeated failures flip the connectivity store to degraded; success recovers", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    await api.board("t").catch(() => {});
    expect(isDegraded(getConnectivity())).toBe(false);
    await api.board("t").catch(() => {});
    expect(isDegraded(getConnectivity())).toBe(true);
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}) }),
    );
    await api.board("t");
    expect(isDegraded(getConnectivity())).toBe(false);
  });

  it("a 503 counts as a failure but a 4xx does not", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({ error: "server_error" }) }),
    );
    await api.board("t").catch(() => {});
    await api.board("t").catch(() => {});
    expect(getConnectivity().failures).toBe(2);
    vi.stubGlobal("fetch", () =>
      Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({ error: "not_found" }) }),
    );
    await api.board("t").catch(() => {});
    expect(getConnectivity().failures).toBe(0);
  });
});

describe("which responses count as connectivity failures", () => {
  const respond = (status: number, body: unknown) =>
    vi.stubGlobal("fetch", () => Promise.resolve({ ok: false, status, json: () => Promise.resolve(body) }));

  it("a deliberate application 503 (predictions_unavailable) never degrades connectivity", async () => {
    respond(503, { error: "predictions_unavailable" });
    for (let i = 0; i < 4; i++) await api.board("t").catch(() => {});
    expect(getConnectivity().failures).toBe(0);
    expect(isDegraded(getConnectivity())).toBe(false);
  });

  it("502/503/504 with the transient server_error code, or with no envelope (edge page), do", async () => {
    for (const [status, body] of [[502, { error: "server_error" }], [503, { error: "server_error" }], [504, {}], [502, { error: "" }]] as const) {
      __resetConnectivity();
      respond(status, body);
      await api.board("t").catch(() => {});
      expect(getConnectivity().failures).toBe(1);
    }
  });

  it("timeouts and network errors still do", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    await api.board("t").catch(() => {});
    expect(getConnectivity().failures).toBe(1);
  });

  it("an app 5xx counts as the server answering: it resets earlier failures", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new TypeError("offline")));
    await api.board("t").catch(() => {});
    respond(503, { error: "predictions_unavailable" });
    await api.board("t").catch(() => {});
    expect(getConnectivity().failures).toBe(0);
  });
});

describe("move keeps the short deadline", () => {
  it("a hung move POST aborts at 8 s, not 15 s", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", (_u: string, init: RequestInit) => Promise.resolve(stalledBody(init.signal ?? undefined)));
    const p = api.move({ gameId: "g", from: "e2", to: "e4", playerId: "p", resumeCode: "c" });
    const expectation = expect(p).rejects.toMatchObject({ code: "timeout" });
    await vi.advanceTimersByTimeAsync(8100);
    await expectation;
  });
});
