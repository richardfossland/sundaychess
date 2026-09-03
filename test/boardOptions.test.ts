import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { BOARD_BASE_OPTIONS } from "@/lib/client/boardOptions";

// L4: react-chessboard v5 ships defaults tuned for a mouse on a single static
// board, not a classroom of phones polling a live game. See
// lib/client/boardOptions.ts for the full reasoning behind each field.
describe("BOARD_BASE_OPTIONS", () => {
  it("disables all three arrow-drawing churn flags", () => {
    // allowDrawingArrows alone isn't enough: clearArrowsOnClick and
    // clearArrowsOnPositionChange each fire independently and call
    // setInternalArrows([]) with a fresh array on every square mousedown /
    // every position update, forcing a re-render even with no arrows drawn.
    expect(BOARD_BASE_OPTIONS.allowDrawingArrows).toBe(false);
    expect(BOARD_BASE_OPTIONS.clearArrowsOnClick).toBe(false);
    expect(BOARD_BASE_OPTIONS.clearArrowsOnPositionChange).toBe(false);
  });

  it("raises the drag activation distance well past the 1px library default", () => {
    // 1px lets a finger's natural wobble on a tap start a drag, making
    // tap-to-move flaky on phones.
    expect(BOARD_BASE_OPTIONS.dragActivationDistance).toBeGreaterThanOrEqual(8);
  });
});

// Cheap "no call site forgotten" guard: every source file that renders a
// react-chessboard <Chessboard /> must also import BOARD_BASE_OPTIONS, so a
// new board (or a rewritten one) can't silently skip the shared defaults
// above. This walks the real source tree with `fs` rather than importing
// each module, since several call sites load react-chessboard via
// `next/dynamic` (`ssr: false`), which vitest's node environment can't render.
const SCAN_ROOTS = ["app", "lib"];
const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".git",
  "test",
  "e2e",
]);

function collectSourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIR_NAMES.has(entry.name)) continue;
      collectSourceFiles(join(dir, entry.name), out);
    } else if (/\.tsx?$/.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

describe("every board that renders <Chessboard /> imports BOARD_BASE_OPTIONS", () => {
  const files = SCAN_ROOTS.flatMap((root) => collectSourceFiles(root));
  const boardFiles = files.filter((file) =>
    /<Chessboard\b/.test(readFileSync(file, "utf8")),
  );

  // Sanity check the scan itself isn't silently finding nothing (e.g. a path
  // typo), which would make every test below vacuously pass.
  it("found at least one call site", () => {
    expect(boardFiles.length).toBeGreaterThan(0);
  });

  it.each(boardFiles)("%s", (file) => {
    const src = readFileSync(file, "utf8");
    expect(src).toMatch(/\bBOARD_BASE_OPTIONS\b/);
  });
});
