import { describe, expect, it } from "vitest";
import { ipKey, ipKeyOf } from "@/lib/server/http";

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
  it("passes unparseable input through unchanged", () => {
    expect(ipKeyOf("garbage:::::1")).toBe("garbage:::::1");
  });
  it("ipKey reads the first x-forwarded-for hop", () => {
    const r = new Request("http://x", { headers: { "x-forwarded-for": "2001:db8::5, 10.0.0.1" } });
    expect(ipKey(r)).toBe("2001:db8:0:0::/64");
  });
});
