import { expect, test, type Page } from "@playwright/test";

import { no } from "@/lib/locale/no";

// M5b: fysisk turnering -> «Fortsett digitalt» -> to elever velger navn -> runde 2 i
// spillmotoren (arrangør setter resultat) -> turneringsfil -> import i fysisk modus.
// Kjører mot lokal Supabase med migr. 0017.
const C = no.continueDigital;
test.use({ acceptDownloads: true });

async function claim(page: Page, pin: string, name: string) {
  await page.goto("/play");
  await page.locator("#pin").fill(pin);
  await page.getByRole("button", { name: new RegExp(no.player.join) }).click();
  await expect(page.getByTestId("claim-list")).toBeVisible();
  await page.getByTestId("claim-list").getByRole("button", { name: new RegExp(name) }).click();
  await page.getByRole("button", { name: no.player.resumeAck }).click();
}

test("fysisk → digital → runde 2 → fil → fysisk igjen", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await page.goto("/arranger/fysisk");
  await page.getByRole("link", { name: no.physical.newTournament }).click();
  await page.getByLabel(no.physical.nameLabel).fill("Fortsett");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page.getByLabel(no.physical.pasteLabel).fill("Anna; 1500; A\nBjørn; 1400; A\nCecilie; 1300; B\nDavid; 1200; B");
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: no.physical.confirmCreate }).click();
  await expect(page.getByRole("heading", { name: "Fortsett" })).toBeVisible();

  // Runde 1 over brettet (uten spillmotoren)
  await page.getByRole("button", { name: no.physical.pairRound(1) }).click();
  await page.getByRole("button", { name: no.physical.publishRound }).click();
  await page.getByRole("button", { name: no.physical.setResultLabel(1, no.physical.results["1-0"]) }).click();
  await page.getByRole("button", { name: no.physical.setResultLabel(2, no.physical.results["½-½"]) }).click();
  await page.getByRole("button", { name: no.physical.completeRound }).click();

  // Fortsett digitalt
  await page.getByTestId("continue-digital").click();
  await page.getByTestId("continue-confirm").click();
  await page.waitForURL(/\/host\/[0-9a-f-]{36}/);
  const tid = page.url().split("/host/")[1].split(/[?#]/)[0];
  const pin = (await page.locator(".pin-hero").innerText()).trim();
  expect(pin).toMatch(/^\d{6}$/);
  await expect(page.getByTestId("unclaimed-hint")).toBeVisible();

  // To elever velger navn; samme navn kan ikke velges to ganger
  const s1 = await (await browser.newContext()).newPage();
  const s2 = await (await browser.newContext()).newPage();
  await claim(s1, pin, "Anna");
  await claim(s2, pin, "Bjørn");
  const s3 = await (await browser.newContext()).newPage();
  await s3.goto("/play");
  await s3.locator("#pin").fill(pin);
  await s3.getByRole("button", { name: new RegExp(no.player.join) }).click();
  await expect(s3.getByTestId("claim-list")).toBeVisible();
  await expect(s3.getByTestId("claim-list").getByRole("button", { name: /Anna/ })).toHaveCount(0);
  await expect(page.getByTestId("claimed")).toHaveCount(2, { timeout: 20_000 });

  // Arrangør starter runde 2 – motoren parrer videre fra den fysiske runden
  await page.getByRole("button", { name: /Start liga/ }).click();
  const hostCode = await page.evaluate((id) => localStorage.getItem(`sjakk:host:${id}`), tid);
  await expect
    .poll(async () => {
      const b = await (await page.request.get(`/api/tournament/${tid}`)).json();
      return b.games.filter((g: { status: string }) => g.status === "live").length;
    }, { timeout: 30_000 })
    .toBe(2);

  // Resultater i spillmotoren (arrangøroverstyring), så avslutt etter runde 2
  const board = await (await page.request.get(`/api/tournament/${tid}`)).json();
  for (const g of board.games.filter((x: { status: string }) => x.status === "live")) {
    const r = await page.request.post("/api/game/override", { data: { gameId: g.id, hostCode, result: "white_win" } });
    expect(r.ok()).toBe(true);
  }
  expect((await page.request.post(`/api/tournament/${tid}/config`, { data: { hostCode, leagueRounds: 2 } })).ok()).toBe(true);
  await expect
    .poll(async () => (await page.request.post("/api/round/advance", { data: { tournamentId: tid, hostCode } })).status(), { timeout: 20_000 })
    .toBe(200);

  // Tilbake til fil
  await page.goto(`/host/${tid}`);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.getByTestId("host-download-file").click()]);
  expect(dl.suggestedFilename()).toMatch(/\.sundaychess\.json$/);
  const path = info.outputPath("tilbake.sundaychess.json");
  await dl.saveAs(path);

  // Importer i fysisk modus (original finnes: behold begge)
  await page.goto("/arranger/fysisk");
  await page.getByTestId("import-file-input").setInputFiles(path);
  await page.getByRole("button", { name: no.physical.file.keepBoth }).click();
  await expect(page.getByRole("heading", { name: "Fortsett" })).toBeVisible();
  await page.getByRole("tab", { name: no.physical.tabs.standings }).click();
  await expect(page.getByText(no.physical.standingsAfter(2))).toBeVisible();
  await expect(page.getByText("Anna").first()).toBeVisible();
});

test("fysisk original markeres som fortsatt digitalt og er skrivebeskyttet", async ({ page }) => {
  await page.goto("/arranger/fysisk");
  await page.getByRole("link", { name: no.physical.newTournament }).click();
  await page.getByLabel(no.physical.nameLabel).fill("Lås");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page.getByLabel(no.physical.pasteLabel).fill("Anna\nBjørn\nCecilie\nDavid");
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: no.physical.confirmCreate }).click();
  await page.getByTestId("continue-digital").click();
  await page.getByTestId("continue-confirm").click();
  await page.waitForURL(/\/host\//);
  await page.goBack();
  await expect(page.getByTestId("continued-digital-banner")).toBeVisible();
});
