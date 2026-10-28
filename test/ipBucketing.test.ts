import { describe, expect, it, vi } from "vitest";
import { clientIp, ipKey, ipKeyOf } from "@/lib/server/http";

describe("ipKeyOf", () => {
  it("leaves IPv4 alone", () => {
    expect(ipKeyOf("203.0.113.9")).toBe("203.0.113.9");
  });
  it("buckets IPv6 by /64, however it is spelled", () => {
    const a = ipKeyOf("2001:db8:1:2:aaaa:bbbb:cccc:dddd");
    expect(a).toBe("2001:db8:1:2::/64");
    expect(ipKeyOf("2001:DB8:1:2::1")).toBe(a);
    expect(ipKeyOf("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(a);
    expect(ipKeyOf("2001:db8:1:3::1")).not.toBe(a);
  });
  it("unwraps IPv4-mapped IPv6 to the IPv4 address", () => {
    expect(ipKeyOf("::ffff:1.2.3.4")).toBe("1.2.3.4");
  });
  it("maps anything that is not a valid IP to the single shared 'invalid' key", () => {
    for (const bad of ["garbage:::::1", "1.2.3.256", "1.2.3", "a".repeat(5000), "1:2:3:4:5:6:7:8:9", "::1::2", "<script>", "", "1.2.3.4 evil"]) {
      expect(ipKeyOf(bad)).toBe("invalid");
    }
  });
  it("keeps the 'local' sentinel", () => {
    expect(ipKeyOf("local")).toBe("local");
  });
});

describe("clientIp / ipKey header trust", () => {
  const mk = (h: Record<string, string>) => new Request("http://x", { headers: h });
  it("prefers cf-connecting-ip and ignores a spoofed x-forwarded-for", () => {
    const r = mk({ "cf-connecting-ip": "203.0.113.7", "x-forwarded-for": "6.6.6.6, 7.7.7.7" });
    expect(clientIp(r)).toBe("203.0.113.7");
    expect(ipKey(r)).toBe("203.0.113.7");
  });
  it("buckets a cf-connecting-ip IPv6 by /64", () => {
    expect(ipKey(mk({ "cf-connecting-ip": "2001:DB8:1:2::9" }))).toBe("2001:db8:1:2::/64");
  });
  it("outside production falls back to the first x-forwarded-for hop", () => {
    expect(ipKey(mk({ "x-forwarded-for": "2001:db8::5, 10.0.0.1" }))).toBe("2001:db8:0:0::/64");
    expect(ipKey(mk({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" }))).toBe("198.51.100.4");
  });
  it("in production x-forwarded-for is never trusted", () => {
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(clientIp(mk({ "x-forwarded-for": "198.51.100.4" }))).toBe("local");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("multi-kB garbage in either header collapses to 'invalid', never raw text", () => {
    const junk = "x".repeat(8000);
    expect(ipKey(mk({ "cf-connecting-ip": junk }))).toBe("invalid");
    expect(ipKey(mk({ "x-forwarded-for": junk }))).toBe("invalid");
    expect(ipKey(mk({ "x-forwarded-for": "1.2.3.4," + junk }))).toBe("invalid");
    expect(ipKey(mk({ "cf-connecting-ip": "1.2.3.4, 5.6.7.8" }))).toBe("invalid");
  });
  it("no header → 'local'", () => {
    expect(ipKey(mk({}))).toBe("local");
  });
});
