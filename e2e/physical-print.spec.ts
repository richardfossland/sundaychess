import { expect, test, type Page } from "@playwright/test";

import { no } from "@/lib/locale/no";

// Fysisk modus M3: utskrifter og storskjerm. Alt lokalt – ingen serverdata.

async function createTournament(page: Page, title: string) {
  await page.goto("/arranger/fysisk/ny");
  await page.getByLabel(no.physical.nameLabel).fill(title);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page
    .getByLabel(no.physical.pasteLabel)
    .fill("Anna; 1500; A\nBjørn; 1400; A\nCecilie; 1300; B\nDavid; 1200; B");
  await page.getByRole("button", { name: no.physical.pasteImport }).click();
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: no.physical.confirmCreate }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

async function playRound(page: Page, n: number) {
  await page.getByRole("tab", { name: no.physical.tabs.round }).click();
  await page.getByRole("button", { name: no.physical.pairRound(n) }).click();
  await page.getByRole("button", { name: no.physical.publishRound }).click();
  await expect(page.locator(".pr-board")).toHaveCount(2);
  await page.getByRole("button", { name: no.physical.setResultLabel(1, no.physical.results["1-0"]) }).click();
  await page.getByRole("button", { name: no.physical.setResultLabel(2, no.physical.results["½-½"]) }).click();
  await page.getByRole("button", { name: no.physical.completeRound }).click();
  await page.getByRole("tab", { name: no.physical.tabs.standings }).click();
  await expect(page.getByText(no.physical.standingsAfter(n))).toBeVisible();
}

test("utskrifter: 3 runder gir parringsliste, kort, lapper, tabell, krysstabell og diplomer", async ({ page }) => {
  await createTournament(page, "Utskriftscup");
  for (const n of [1, 2, 3]) await playRound(page, n);
  await page.waitForTimeout(400); // autosave
  const L = no.physicalPrint;

  // via menyen
  await page.getByRole("button", { name: L.menuAria }).click();
  await page.getByRole("menuitem", { name: L.kinds.parringsliste }).click();
  await expect(page.getByRole("heading", { name: L.pairingsTitle(3) })).toBeVisible();
  await expect(page.getByRole("heading", { name: L.findYourBoard })).toBeVisible();
  await expect(page.locator(".pp-wall tbody tr")).toHaveCount(2);
  await expect(page.locator(".pp-find-row")).toHaveCount(4);

  const id = page.url().split("/")[5];
  const go = async (kind: string, q = "") => page.goto(`/arranger/fysisk/${id}/skriv/${kind}${q}`);

  await go("parringsliste", "?runde=1");
  await expect(page.getByRole("heading", { name: L.pairingsTitle(1) })).toBeVisible();

  await go("bordkort", "?runde=2");
  await expect(page.locator(".pp-card")).toHaveCount(2);
  await expect(page.locator(".pp-qr")).toHaveCount(0); // ingen QR før M5

  await go("resultatlapper");
  await expect(page.locator(".pp-slip")).toHaveCount(2);

  await go("tabell");
  await expect(page.getByRole("heading", { name: L.standingsTitle(3) })).toBeVisible();
  await expect(page.locator(".pp-table tbody tr")).toHaveCount(4);

  await go("krysstabell");
  await expect(page.locator(".pp-cross tbody tr")).toHaveCount(4);

  await go("sluttresultat");
  await expect(page.getByRole("heading", { name: L.finalTitle })).toBeVisible();

  await go("diplomer");
  const top = await page.locator(".pp-cert").count();
  expect(top).toBeGreaterThanOrEqual(3);
  await page.getByLabel(L.participants).check();
  await expect(page.locator(".pp-cert")).toHaveCount(4);

  // papiret er hvitt uansett tema
  const bg = await page.locator(".pp-page").first().evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg).toBe("rgb(255, 255, 255)");
});

test("storskjerm oppdateres når resultat føres i arrangørfanen", async ({ page, context }) => {
  await createTournament(page, "Skjermcup");
  const id = page.url().split("/")[5];
  await page.getByRole("button", { name: no.physical.pairRound(1) }).click();
  await page.getByRole("button", { name: no.physical.publishRound }).click();
  await page.waitForTimeout(400);

  const big = await context.newPage();
  await big.goto(`/arranger/fysisk/${id}/storskjerm`);
  await expect(big.getByTestId("storskjerm")).toBeVisible();
  await expect(big.getByTestId("ss-row")).toHaveCount(2);
  await expect(big.getByTestId("ss-result").first()).toHaveText("");
  // fyller viewporten uten scrolling
  const fit = await big.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1);
  expect(fit).toBe(true);

  await page.getByRole("button", { name: no.physical.setResultLabel(1, no.physical.results["1-0"]) }).click();
  await expect(big.getByTestId("ss-result").first()).toHaveText("1–0");

  // nedtelling settes på skjermen
  await big.mouse.move(100, 100);
  await big.getByLabel(no.physicalPrint.timerMinutes).fill("5");
  await big.getByRole("button", { name: no.physicalPrint.timerSet }).click();
  await expect(big.getByTestId("ss-clock")).toContainText(/0[45]:\d\d/);
});
