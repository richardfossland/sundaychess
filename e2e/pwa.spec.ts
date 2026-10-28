import { expect, test } from "@playwright/test";

import { no } from "@/lib/locale/no";

// PWA: manifest is valid, the service worker installs, and an offline
// navigation to an uncached page lands on the Norwegian offline page.
test.use({ serviceWorkers: "allow" });

test("manifest is served with icons and standalone display", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.ok()).toBe(true);
  const m = await res.json();
  expect(m.name).toBe(no.appName);
  expect(m.display).toBe("standalone");
  expect(m.start_url).toBe("/");
  expect(m.icons.some((i: { sizes: string; purpose: string }) => i.sizes === "512x512" && i.purpose === "maskable")).toBe(true);
  for (const i of m.icons) expect((await request.get(i.src)).ok()).toBe(true);
});

test("sw.js is never cached long-term", async ({ request }) => {
  const res = await request.get("/sw.js");
  expect(res.ok()).toBe(true);
  expect(res.headers()["content-type"]).toContain("javascript");
  expect(res.headers()["cache-control"]).toMatch(/no-cache|no-store/);
});

test("offline: uncached page falls back to the Norwegian offline page", async ({ page, context }) => {
  await page.goto("/");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  // Install precaches /offline before activation completes.
  await expect
    .poll(() => page.evaluate(async () => !!(await caches.match("/offline"))))
    .toBe(true);

  await context.setOffline(true);
  await page.goto("/play");
  await expect(page.getByRole("heading", { name: no.pwa.offlineTitle })).toBeVisible();
  await context.setOffline(false);
});
