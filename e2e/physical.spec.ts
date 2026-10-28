import { expect, test } from "@playwright/test";

import { no } from "@/lib/locale/no";

// Fysisk modus M1: hele flyten i nettleseren, uten server. Service workeren
// forhåndscacher /arranger/fysisk; resten av testen kjøres helt uten nett.
test.use({ serviceWorkers: "allow" });

test("veiviser → (nettet av) omlasting, parring, resultat, stilling", async ({ page, context }) => {
  await page.goto("/arranger/fysisk");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => !!(await caches.match("/arranger/fysisk")))).toBe(true);

  await page.getByRole("link", { name: no.physical.newTournament }).click();
  await page.getByLabel(no.physical.nameLabel).fill("E2E-turnering");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page.getByLabel(no.physical.pasteLabel).fill("Anna; 1500; A\nBjørn; 1400; A\nCecilie; 1300; B\nDavid; 1200; B");
  await page.getByRole("button", { name: no.physical.pasteImport }).click();
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: no.physical.confirmCreate }).click();
  await expect(page.getByRole("heading", { name: "E2E-turnering" })).toBeVisible();
  const url = page.url();

  await context.setOffline(true);
  await page.goto("/arranger/fysisk");
  await expect(page.getByText("E2E-turnering")).toBeVisible();
  await page.goto(url); // hard navigasjon: SW serverer skallet, klienten velger visning
  await expect(page.getByRole("heading", { name: "E2E-turnering" })).toBeVisible();

  await page.getByRole("button", { name: no.physical.pairRound(1) }).click();
  await page.getByRole("button", { name: no.physical.publishRound }).click();
  const selects = page.locator("select");
  await expect(selects).toHaveCount(2);
  await selects.nth(0).selectOption("1-0");
  await selects.nth(1).selectOption("½-½");
  await page.getByRole("button", { name: no.physical.completeRound }).click();
  await expect(page.getByText(no.physical.standingsAfter(1))).toBeVisible();

  await page.waitForTimeout(500); // autosave til IndexedDB er asynkron
  await page.reload();
  await expect(page.getByText(no.physical.standingsAfter(1))).toBeVisible();
  await context.setOffline(false);
});
