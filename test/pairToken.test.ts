import { afterEach, describe, expect, it, vi } from "vitest";
import { __resetPairWarning, ctEqual, signPairToken, verifyPairToken } from "@/lib/server/pair";

const T = "11111111-1111-4111-8111-111111111111";
const ENV = { s: process.env.PAIR_SECRET, n: process.env.NODE_ENV };
afterEach(() => {
  if (ENV.s === undefined) delete process.env.PAIR_SECRET;
  else process.env.PAIR_SECRET = ENV.s;
  vi.stubEnv("NODE_ENV", ENV.n ?? "test");
  vi.restoreAllMocks();
  __resetPairWarning();
});

describe("pair token", () => {
  it("verifies for the same tournament + host code only", async () => {
    process.env.PAIR_SECRET = "s1";
    const tok = await signPairToken(T, "ABCD-12");
    expect(tok).toBeTruthy();
    expect(await verifyPairToken(T, "ABCD-12", tok)).toBe(true);
    expect(await verifyPairToken(T, "ABCD-13", tok)).toBe(false); // code changed
    expect(await verifyPairToken("22222222-2222-4222-8222-222222222222", "ABCD-12", tok)).toBe(false);
  });

  it("a different secret does not verify", async () => {
    process.env.PAIR_SECRET = "s1";
    const tok = await signPairToken(T, "ABCD-12");
    process.env.PAIR_SECRET = "s2";
    expect(await verifyPairToken(T, "ABCD-12", tok)).toBe(false);
  });

  it("rejects junk tokens", async () => {
    process.env.PAIR_SECRET = "s1";
    for (const bad of [undefined, null, "", 5, "x".repeat(300), "nope"])
      expect(await verifyPairToken(T, "ABCD-12", bad)).toBe(false);
  });

  it("missing secret in production disables tokens, logs once, never throws", async () => {
    delete process.env.PAIR_SECRET;
    vi.stubEnv("NODE_ENV", "production");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await signPairToken(T, "ABCD-12")).toBeNull();
    expect(await signPairToken(T, "ABCD-12")).toBeNull();
    expect(await verifyPairToken(T, "ABCD-12", "anything")).toBe(false);
    expect(err).toHaveBeenCalledTimes(1);
  });

  it("ctEqual is length- and content-sensitive", () => {
    expect(ctEqual("abc", "abc")).toBe(true);
    expect(ctEqual("abc", "abd")).toBe(false);
    expect(ctEqual("abc", "abcd")).toBe(false);
  });
});
