import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
import { themeToggleHiddenOn } from "@/lib/client/ThemeToggle";

const css = readFileSync("app/globals.css", "utf8");
const rule = (sel: string) => {
  const m = css.match(new RegExp(`(?:^|\\n)${sel.replace(".", "\\.")} \\{([^}]*)\\}`));
  return m ? m[1] : "";
};
const z = (sel: string) => Number(rule(sel).match(/z-index:\s*(\d+)/)?.[1]);

describe("ThemeToggle placement", () => {
  it("sits below modal and promo overlays", () => {
    expect(z(".theme-toggle")).toBeLessThan(z(".modal-overlay"));
    expect(z(".theme-toggle")).toBeLessThan(z(".promo-overlay"));
  });

  it("is hidden on game, host-board and projector screens, kept on home/dashboard/login", () => {
    for (const p of ["/play", "/play/x", "/solo", "/versus", "/arranger", "/host/11111111-1111-4111-8111-111111111111", "/host/abc/projector"]) {
      expect(themeToggleHiddenOn(p), p).toBe(true);
    }
    for (const p of ["/", "/host", "/host/login", "/host/login/x", "/auth/login", null]) {
      expect(themeToggleHiddenOn(p), String(p)).toBe(false);
    }
  });

  it("moves to the page flow also on landscape phones (~932 px wide)", () => {
    const m = css.match(/@media \(max-width: (\d+)px\)(?:, \(max-height: \d+px\))? \{\s*\/\* A floating button[\s\S]*?\.theme-toggle \{\s*position: static/);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(932);
  });
});
