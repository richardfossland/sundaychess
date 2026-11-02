import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { BOARD_PALETTES, BOARD_THEMES, isBoardTheme } from "@/lib/client/boardOptions";

function channel(v: number): number {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

describe("brettfarger (D2)", () => {
  it("alle tre temaene har minst 1,6:1 luminanskontrast mellom lys og mørk rute", () => {
    for (const t of BOARD_THEMES) {
      expect(ratio(BOARD_PALETTES[t].light, BOARD_PALETTES[t].dark), t).toBeGreaterThanOrEqual(1.6);
    }
  });

  it("palettene i koden og i globals.css er like", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    for (const t of BOARD_THEMES) {
      const block = css.match(new RegExp(`\\[data-board-theme="${t}"\\]\\s*\\{([^}]*)\\}`))?.[1] ?? "";
      expect(block, t).toContain(`--board-light: ${BOARD_PALETTES[t].light}`);
      expect(block, t).toContain(`--board-dark: ${BOARD_PALETTES[t].dark}`);
      expect(block, t).toContain(`--board-last: ${BOARD_PALETTES[t].last}`);
      expect(block, t).toContain(`--board-selected: ${BOARD_PALETTES[t].selected}`);
    }
  });

  it("isBoardTheme avviser ukjente verdier", () => {
    expect(isBoardTheme("wood")).toBe(true);
    expect(isBoardTheme("neon")).toBe(false);
    expect(isBoardTheme(null)).toBe(false);
  });
});

describe("høykontrast-brettet (E3)", () => {
  const c = BOARD_PALETTES.contrast;
  it("svarte og hvite brikkefyll har minst 4,5:1 mot mørke ruter", () => {
    expect(ratio("#ffffff", c.dark)).toBeGreaterThanOrEqual(4.5);
    expect(ratio("#000000", c.dark)).toBeGreaterThanOrEqual(4.5);
  });
  it("svarte brikker har minst 4,5:1 mot lyse ruter, og rutene skiller seg tydelig", () => {
    expect(ratio("#000000", c.light)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(c.light, c.dark)).toBeGreaterThanOrEqual(4.5);
  });
  it("markørene er rammer (svart/hvit) definert i CSS", () => {
    const css = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
    const block = css.match(/\[data-board-theme="contrast"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(block).toContain("--board-last-ring");
    expect(block).toContain("--board-selected-ring");
    expect(block).toContain("--board-dot: #000000");
  });
});
