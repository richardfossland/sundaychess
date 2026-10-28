import { expect, test } from "@playwright/test";

import { no } from "@/lib/locale/no";

// Fysisk modus M1: hele flyten i nettleseren, uten server – og med nettet av
// etter at siden er lastet (lokal-først).

test("veiviser → parring → resultater → stilling, uten nett", async ({ page, context }) => {
  await page.goto("/arranger/fysisk/ny");
  await page.getByLabel(no.physical.nameLabel).fill("E2E-turnering");
  await page.getByRole("button", { name: no.common.next }).click(); // system
  await page.getByRole("button", { name: no.common.next }).click(); // runder
  await page.getByRole("button", { name: no.common.next }).click(); // tiebreaks
  await page.getByRole("button", { name: no.common.next }).click(); // spillere
  await page.getByLabel(no.physical.pasteLabel).fill("Anna; 1500; A\nBjørn; 1400; A\nCecilie; 1300; B\nDavid; 1200; B");
  await page.getByRole("button", { name: no.physical.pasteImport }).click();
  await page.getByRole("button", { name: no.common.next }).click(); // bekreft
  await page.getByRole("button", { name: no.physical.confirmCreate }).click();

  await expect(page.getByRole("heading", { name: "E2E-turnering" })).toBeVisible();
  await context.setOffline(true);

  await page.getByRole("button", { name: no.physical.pairRound(1) }).click();
  await page.getByRole("button", { name: no.physical.publishRound }).click();
  const selects = page.locator("select");
  await expect(selects).toHaveCount(2);
  await selects.nth(0).selectOption("1-0");
  await selects.nth(1).selectOption("½-½");
  await page.getByRole("button", { name: no.physical.completeRound }).click();
  await expect(page.getByText(no.physical.standingsAfter(1))).toBeVisible();

  // Overlever omlasting: alt ligger lagret lokalt i nettleseren.
  const url = page.url();
  await context.setOffline(false);
  await page.goto(url);
  await expect(page.getByText(no.physical.standingsAfter(1))).toBeVisible();
});
