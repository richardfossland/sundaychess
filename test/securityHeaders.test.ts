import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

// M10: HSTS + CSP Report-Only på alle ruter; frame-ancestors forblir HÅNDHEVET.
describe("security headers (next.config.ts)", () => {
  it("alle ruter får HSTS uten includeSubDomains, enforced frame-ancestors og CSP Report-Only", async () => {
    const rules = await nextConfig.headers!();
    const all = rules.find((r) => r.source === "/:path*")!;
    const h = Object.fromEntries(all.headers.map((x) => [x.key, x.value]));
    expect(h["Strict-Transport-Security"]).toBe("max-age=31536000");
    expect(h["Strict-Transport-Security"]).not.toMatch(/includeSubDomains/i);
    expect(h["Content-Security-Policy"]).toBe("frame-ancestors 'self'"); // fortsatt håndhevet
    const ro = h["Content-Security-Policy-Report-Only"];
    expect(ro).toMatch(/default-src 'self'/);
    expect(ro).toMatch(/connect-src 'self' .*(wss:\/\/)/); // Realtime-websocket tillatt
    expect(ro).toMatch(/worker-src 'self' blob:/); // sjakkmotor-worker
    expect(ro).not.toMatch(/frame-ancestors/); // ignoreres i Report-Only
  });

  it("statiske filer får HSTS via public/_headers (de går forbi Worker-koden)", () => {
    const txt = readFileSync(join(__dirname, "..", "public", "_headers"), "utf8");
    const block = txt.split(/\n(?=\S)/).find((b) => b.startsWith("/*\n"))!;
    expect(block).toMatch(/Strict-Transport-Security: max-age=31536000\n?/);
    expect(block).not.toMatch(/includeSubDomains/i);
  });
});
