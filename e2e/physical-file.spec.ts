import { readFileSync, writeFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import { no } from "@/lib/locale/no";

// Fysisk modus M4: eksporter turneringsfil, slett lokalt, importer, fortsett – uten nett.
test.use({ serviceWorkers: "allow", acceptDownloads: true });

test("eksport → slett → import → neste runde, offline", async ({ page, context }, info) => {
  await page.goto("/arranger/fysisk");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => !!(await caches.match("/arranger/fysisk")))).toBe(true);

  await page.getByRole("link", { name: no.physical.newTournament }).click();
  await page.getByLabel(no.physical.nameLabel).fill("Filtest");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page.getByLabel(no.physical.pasteLabel).fill("Anna; 1500; A\nBjørn; 1400; A\nCecilie; 1300; B\nDavid; 1200; B");
  await page.getByRole("button", { name: no.physical.pasteImport }).click();
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: no.physical.confirmCreate }).click();
  await expect(page.getByRole("heading", { name: "Filtest" })).toBeVisible();

  await context.setOffline(true);

  await page.getByRole("button", { name: no.physical.pairRound(1) }).click();
  await page.getByRole("button", { name: no.physical.publishRound }).click();
  await page.getByRole("button", { name: no.physical.setResultLabel(1, no.physical.results["1-0"]) }).click();
  await page.getByRole("button", { name: no.physical.setResultLabel(2, no.physical.results["½-½"]) }).click();
  await page.getByRole("button", { name: no.physical.completeRound }).click();
  await page.getByRole("tab", { name: no.physical.tabs.standings }).click();
  await expect(page.getByText(no.physical.standingsAfter(1))).toBeVisible();

  // Eksporter
  const menu = page.getByText(no.physical.file.menu, { exact: true });
  await menu.click();
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: no.physical.file.downloadJson }).click(),
  ]);
  expect(dl.suggestedFilename()).toBe("Filtest.sundaychess.json");
  const path = info.outputPath("Filtest.sundaychess.json");
  await dl.saveAs(path);
  const file = JSON.parse(readFileSync(path, "utf8"));
  expect(file.format).toBe("sundaychess-tournament");
  expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);

  // TRF16 og CSV lastes også ned
  await menu.click();
  const [trf] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: no.physical.file.exportTrf }).click()]);
  expect(trf.suggestedFilename()).toBe("Filtest.trf");
  await menu.click();
  const [csv] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: no.physical.file.exportCsv }).click()]);
  expect(csv.suggestedFilename()).toBe("Filtest.csv");

  // Slett lokalt
  await page.getByRole("link", { name: no.physical.backToList }).first().click();
  page.once("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: no.physical.remove }).click();
  await expect(page.getByText(no.physical.emptyList)).toBeVisible();

  // Endret fil krever bekreftelse
  const bad = JSON.parse(JSON.stringify(file));
  bad.tournament.events.find((e: { type: string }) => e.type === "setResult").result = "0-1";
  const badPath = info.outputPath("endret.sundaychess.json");
  writeFileSync(badPath, JSON.stringify(bad));
  await page.getByTestId("import-file-input").setInputFiles(badPath);
  await expect(page.getByText(no.physical.file.tamperedWarn)).toBeVisible();
  await expect(page.getByRole("button", { name: no.physical.file.importButton })).toBeDisabled();
  await page.getByRole("button", { name: no.physical.file.cancel }).click();

  // Importer originalen
  await page.getByTestId("import-file-input").setInputFiles(path);
  await page.getByRole("button", { name: no.physical.file.importButton }).click();
  await expect(page.getByRole("heading", { name: "Filtest" })).toBeVisible();
  await page.getByRole("tab", { name: no.physical.tabs.standings }).click();
  await expect(page.getByText(no.physical.standingsAfter(1))).toBeVisible();
  await page.getByRole("tab", { name: no.physical.tabs.round }).click();

  // Fortsett: runde 2
  await page.getByRole("button", { name: no.physical.pairRound(2) }).click();
  await expect(page.getByText(`${no.physical.roundN(2)} / `)).toBeVisible();

  // Samme fil på nytt → konflikt (lokal er nyere)
  await page.getByRole("link", { name: no.physical.backToList }).first().click();
  await page.getByTestId("import-file-input").setInputFiles(path);
  await expect(page.getByText(no.physical.file.conflictTitle)).toBeVisible();
  await expect(page.getByText(/nyere/)).toBeVisible();
  await page.getByRole("button", { name: no.physical.file.keepBoth }).click();
  await expect(page.getByRole("heading", { name: `Filtest${no.physical.file.copySuffix}` })).toBeVisible();
  await context.setOffline(false);
});
