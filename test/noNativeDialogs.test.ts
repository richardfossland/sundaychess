import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Native confirm/prompt/alert render as a tiny OS popup, easy to miss on a
// projector, and can be suppressed by the browser. Use lib/client/useConfirm
// (ConfirmDialog) or CopyLinkDialog instead.
function walk(dir: string, out: string[] = []): string[] {
  for (const f of readdirSync(dir)) {
    const p = path.join(dir, f);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(f)) out.push(p);
  }
  return out;
}

describe("no native browser dialogs", () => {
  it("app/ and lib/ never call window.confirm/prompt/alert", () => {
    const root = path.resolve(__dirname, "..");
    const bad: string[] = [];
    for (const file of [...walk(path.join(root, "app")), ...walk(path.join(root, "lib"))]) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((l, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(l)) return;
        if (/\bwindow\.(confirm|prompt|alert)\s*\(|(^|[^.\w])(confirm|prompt|alert)\s*\(\s*["'`]/.test(l)) {
          bad.push(`${path.relative(root, file)}:${i + 1}`);
        }
      });
    }
    expect(bad).toEqual([]);
  });
});
