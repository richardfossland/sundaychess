import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { no } from "@/lib/locale/no";

// Fysisk modus: hele flyten i nettleseren, uten server. Service workeren
// forhåndscacher /arranger/fysisk; resten av testene kjøres helt uten nett.
test.use({ serviceWorkers: "allow" });

const p = no.physical;

/** Last skallet, vent på SW + cache, lag turnering via veiviseren og gå offline. */
async function setup(page: Page, context: BrowserContext, title: string, players: string[], opts: { late?: boolean } = {}) {
  await page.goto("/arranger/fysisk");
  await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  await expect.poll(() => page.evaluate(async () => !!(await caches.match("/arranger/fysisk")))).toBe(true);

  await page.getByRole("link", { name: p.newTournament }).click();
  await page.getByLabel(p.nameLabel).fill(title);
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page.getByLabel(p.pasteLabel).fill(players.map((n, i) => `${n}; ${1500 - i * 50}; K`).join("\n"));
  await page.getByRole("button", { name: p.pasteImport }).click();
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: p.confirmCreate }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  void opts;
  await context.setOffline(true);
}

const row = (page: Page, board: number) => page.locator(`[data-board="${board}"]`);
const progress = (page: Page) => page.getByTestId("progress");

test("offline: hel runde med tastatur, angre, umiddelbar omlasting og lagring", async ({ page, context }) => {
  await setup(page, context, "Tastatur-turnering", ["Anna", "Bjørn", "Cecilie", "David", "Emil", "Frida"]);

  await page.getByRole("button", { name: p.pairRound(1) }).click();
  // Utkast: ingen resultatknapper, parringene kan publiseres.
  await expect(page.getByText(p.draftLockNote)).toBeVisible();
  await expect(page.locator(".pr-res")).toHaveCount(0);
  await page.getByRole("button", { name: p.publishRound }).click();
  await expect(progress(page)).toHaveText(p.progress(0, 3));

  // Tastatur: velg brett 1 og før 1-0; fokus flytter til neste brett uten resultat.
  await row(page, 1).focus();
  await page.keyboard.press("1");
  await expect(progress(page)).toHaveText(p.progress(1, 3));
  await expect(row(page, 2)).toBeFocused();
  await page.keyboard.press("h");
  await expect(progress(page)).toHaveText(p.progress(2, 3));
  await expect(row(page, 3)).toBeFocused();
  await expect(row(page, 3)).toHaveAttribute("data-missing", "true");
  await page.keyboard.press("0");
  await expect(progress(page)).toHaveText(p.progress(3, 3));

  // Angre via toasten, så før på nytt.
  await expect(page.locator(".pr-toast").getByRole("button", { name: p.toastUndo })).toBeVisible();
  await page.locator(".pr-toast").getByRole("button", { name: p.toastUndo }).click();
  await expect(progress(page)).toHaveText(p.progress(2, 3));
  await row(page, 3).focus();
  await page.keyboard.press("=");
  await expect(progress(page)).toHaveText(p.progress(3, 3));
  await expect(page.getByRole("button", { name: p.setResultLabel(3, p.results["½-½"]) })).toHaveAttribute("aria-pressed", "true");

  // Omlasting UMIDDELBART etter siste resultat: alt er lagret.
  await page.reload();
  await expect(progress(page)).toHaveText(p.progress(3, 3));
  await expect(page.getByRole("button", { name: p.setResultLabel(1, p.results["1-0"]) })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("save-state")).toHaveText(p.saveSaved);

  // Publisert runde er låst for parringsendring uten bekreftelse.
  await page.getByRole("button", { name: p.editPairing }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: no.common.cancel }).click();

  await page.getByRole("button", { name: p.completeRound }).click();
  await page.getByRole("tab", { name: p.tabs.standings }).click();
  await expect(page.getByText(p.standingsAfter(1))).toBeVisible();
  await page.getByRole("tab", { name: p.tabs.crosstable }).click();
  await expect(page.getByRole("heading", { name: "Tastatur-turnering" })).toBeVisible();
  await expect(page.locator("th", { hasText: "R1" })).toBeVisible();
  await page.getByRole("tab", { name: p.tabs.round }).click();
  await expect(page.getByRole("button", { name: p.pairRound(2) })).toBeVisible();
  await context.setOffline(false);
});

test("offline: «Fullfør runde» krever alle resultater; walkover via mer-menyen", async ({ page, context }) => {
  await setup(page, context, "Walkover-turnering", ["Anna", "Bjørn", "Cecilie", "David"]);
  await page.getByRole("button", { name: p.pairRound(1) }).click();
  await page.getByRole("button", { name: p.publishRound }).click();
  await expect(page.getByRole("button", { name: p.completeBlocked(2) })).toBeDisabled();

  await page.getByRole("button", { name: p.moreMenuFor(1) }).click();
  await page.getByRole("button", { name: p.walkoverWhite }).click();
  await expect(progress(page)).toHaveText(p.progress(1, 2));
  await page.getByRole("button", { name: p.setResultLabel(2, p.results["0-1"]) }).click();
  await expect(page.getByRole("button", { name: p.completeRound })).toBeEnabled();
  await context.setOffline(false);
});

test("offline: trekk spiller gir automatisk walkover og kan angres; sen påmelding med ½ poeng", async ({ page, context }) => {
  await setup(page, context, "Trekk-turnering", ["Anna", "Bjørn", "Cecilie", "David"]);
  await page.getByRole("button", { name: p.pairRound(1) }).click();
  await page.getByRole("button", { name: p.publishRound }).click();

  const withdrawAnna = async () => {
    await page.getByRole("tab", { name: p.tabs.players }).click();
    await page.locator(".pp-item", { hasText: "Anna" }).getByRole("button", { name: p.withdraw }).click();
    await expect(page.getByRole("dialog")).toContainText("brett 1");
    await page.getByRole("button", { name: p.withdrawConfirm }).click();
    await expect(page.locator(".pp-item", { hasText: "Anna" })).toContainText(p.statusWithdrawn);
  };
  await withdrawAnna();
  await page.getByRole("tab", { name: p.tabs.round }).click();
  await expect(progress(page)).toHaveText(p.progress(1, 2));
  await expect(row(page, 1)).toContainText(p.results["-+"]);

  // Angre: ett trykk tilbake både trekket og walkoveren.
  await page.locator(".pr-toast").getByRole("button", { name: p.toastUndo }).click();
  await expect(progress(page)).toHaveText(p.progress(0, 2));
  await withdrawAnna();
  await page.reload();
  await expect(page.getByRole("heading", { name: "Trekk-turnering" })).toBeVisible();
  await expect(progress(page)).toHaveText(p.progress(1, 2));
  await page.getByRole("button", { name: p.setResultLabel(2, p.results["1-0"]) }).click();
  await page.getByRole("button", { name: p.completeRound }).click();
  await page.getByRole("tab", { name: p.tabs.players }).click();
  await page.getByLabel(p.playerName).fill("Sen Spiller");
  await page.getByLabel(p.lateMissedHalf(1)).check();
  await page.getByRole("button", { name: p.addLate }).click();
  await expect(page.locator(".pp-item", { hasText: "Sen Spiller" })).toContainText(p.lateBadge(2, true));
  await page.getByRole("tab", { name: p.tabs.standings }).click();
  await expect(page.locator("tr", { hasText: "Sen Spiller" }).locator("td.num").nth(1)).toHaveText("0.5");
  await context.setOffline(false);
});
