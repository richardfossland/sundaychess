import { afterEach, describe, expect, it, vi } from "vitest";
import { fail, must, ok, TRANSIENT_ERROR, withApi } from "@/lib/server/http";

afterEach(() => vi.restoreAllMocks());

describe("withApi", () => {
  it("passes a normal response through untouched (incl. 4xx)", async () => {
    const res = await withApi<[Request]>(() => ok({ a: 1 }))(new Request("http://x/api/a"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ a: 1 });
    const bad = await withApi<[Request]>(() => fail(400, "bad_request"))(new Request("http://x/api/a"));
    expect(bad.status).toBe(400);
  });

  it("maps a thrown error to JSON 503 server_error (never an HTML 500)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withApi<[Request]>(async () => {
      throw new Error("fetch failed");
    })(new Request("http://x/api/boom"));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toEqual({ error: TRANSIENT_ERROR });
    expect(TRANSIENT_ERROR).toBe("server_error");
  });

  it("maps a synchronous throw and a Supabase-style error object too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const sync = await withApi<[Request]>((): Response => {
      throw { message: "boom", code: "08006" };
    })(new Request("http://x/api/s"));
    expect(sync.status).toBe(503);
  });

  it("forwards handler arguments (route context)", async () => {
    const h = withApi(async (_r: Request, ctx: { params: Promise<{ id: string }> }) =>
      ok({ id: (await ctx.params).id }),
    );
    const res = await h(new Request("http://x"), { params: Promise.resolve({ id: "z" }) });
    expect(await res.json()).toEqual({ id: "z" });
  });
});

describe("must", () => {
  it("returns data, throws on a Supabase error", () => {
    expect(must({ data: [1], error: null })).toEqual([1]);
    expect(() => must({ data: null, error: { message: "down" } })).toThrow();
  });
});
