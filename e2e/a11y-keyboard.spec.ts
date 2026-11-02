import { expect, test, type Page } from "@playwright/test";

import { no } from "@/lib/locale/no";

// E3: tastatur, skjermleser, trekkbekreftelse og høy kontrast. DB-fri: spiller
// «Skolematt» på lokal versus (to spillere, ett brett), bare med tastatur.
// Brettet har ett tabulatorstopp (rutenettet med aria-activedescendant); her
// lander fokus dit én gang, og alt etter det er taster.

const GRID = "#versus-board-keys";
const FILES = "abcdefgh";

async function startVersus(page: Page) {
  await page.goto("/versus");
  await page.getByRole("button", { name: new RegExp(no.versus.sameScreen) }).click();
  await expect(page.locator(GRID)).toBeVisible();
}

/** Ruta fokusmarkøren står på nå (fra aria-activedescendant). */
async function cursor(page: Page): Promise<string> {
  const id = await page.locator(GRID).getAttribute("aria-activedescendant");
  return id!.slice(-2);
}

/** Flytt markøren til `to` med piltaster. Brettet vender mot den som skal trekke. */
async function goto(page: Page, to: string, black: boolean) {
  const cur = await cursor(page);
  const df = FILES.indexOf(to[0]) - FILES.indexOf(cur[0]);
  const dr = Number(to[1]) - Number(cur[1]);
  const right = black ? "ArrowLeft" : "ArrowRight";
  const left = black ? "ArrowRight" : "ArrowLeft";
  const up = black ? "ArrowDown" : "ArrowUp";
  const down = black ? "ArrowUp" : "ArrowDown";
  for (let i = 0; i < Math.abs(df); i++) await page.keyboard.press(df > 0 ? right : left);
  for (let i = 0; i < Math.abs(dr); i++) await page.keyboard.press(dr > 0 ? up : down);
  expect(await cursor(page)).toBe(to);
}

/** Velg brikken på `from`, så målruta `to`, bare med taster. */
async function keyMove(page: Page, from: string, to: string, black: boolean) {
  await goto(page, from, black);
  await page.keyboard.press("Enter");
  await goto(page, to, black);
  await page.keyboard.press("Enter");
}

const SCHOOL_MATE: [string, string][] = [
  ["e2", "e4"],
  ["e7", "e5"],
  ["f1", "c4"],
  ["b8", "c6"],
  ["d1", "h5"],
  ["g8", "f6"],
  ["h5", "f7"],
];

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "tastaturflyt; kjøres kun én gang");
});

test.describe("tastatur og skjermleser", () => {
  test("Skolematt med bare tastatur, og live-regionen sier «Sjakkmatt»", async ({ page }) => {
    await startVersus(page);
    const live = page.getByTestId("move-announcer");

    // Brettet er ett fokusbart punkt, og rutene har navn.
    await page.locator(GRID).focus();
    await expect(page.locator(GRID)).toBeFocused();
    await expect(page.locator(`${GRID}-e2`)).toHaveAttribute("aria-label", "e2, hvit bonde");
    await expect(page.locator(`${GRID}-e4`)).toHaveAttribute("aria-label", "e4, tom");

    for (let i = 0; i < SCHOOL_MATE.length; i++) {
      const [from, to] = SCHOOL_MATE[i];
      await keyMove(page, from, to, i % 2 === 1);
      if (i === 0) await expect(live).toHaveText("Hvit bonde til e4");
      if (i === 3) await expect(live).toHaveText("Svart springer til c6");
    }

    await expect(live).toContainText("Sjakkmatt");
    await expect(live).toContainText(no.a11y.whiteWins);
    // Fokus ble på brettet hele veien.
    await expect(page.locator(GRID)).toBeFocused();
  });

  test("Escape avbryter valg; piltaster stopper ved kanten", async ({ page }) => {
    await startVersus(page);
    await page.locator(GRID).focus();
    await goto(page, "g1", false);
    await page.keyboard.press("Enter");
    await expect(page.locator(`${GRID}-g1`)).toHaveAttribute("aria-label", /valgt/);
    await expect(page.locator(`${GRID}-f3`)).toHaveAttribute("aria-label", /lovlig trekk/);
    await page.keyboard.press("Escape");
    await expect(page.locator(`${GRID}-g1`)).not.toHaveAttribute("aria-label", /valgt/);

    for (let i = 0; i < 10; i++) await page.keyboard.press("ArrowLeft");
    expect(await cursor(page)).toBe("a1");
  });

  test("musen virker som før (klikk-for-å-flytte)", async ({ page }) => {
    await startVersus(page);
    await page.getByTestId("board-shell").locator('[data-square="e2"]').click();
    await page.getByTestId("board-shell").locator('[data-square="e4"]').click();
    await expect(page.getByTestId("move-announcer")).toHaveText("Hvit bonde til e4");
  });
});

test.describe("trekkbekreftelse", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("chess:confirmMoves", "1"));
  });

  test("trekket er foreløpig til Bekreft; Escape angrer", async ({ page }) => {
    await startVersus(page);
    const live = page.getByTestId("move-announcer");
    await page.locator(GRID).focus();

    await keyMove(page, "e2", "e4", false);
    const bar = page.getByTestId("move-confirm");
    await expect(bar).toBeVisible();
    await expect(live).toContainText("Foreløpig trekk: Hvit bonde til e4");
    // Fortsatt hvit sin tur (ingenting er spilt): trekklisten er tom.
    await expect(page.getByRole("button", { name: no.a11y.confirm })).toBeFocused();

    // Escape angrer, og fokus går tilbake til brettet.
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(page.locator(GRID)).toBeFocused();

    // Samme trekk igjen, nå bekreftet med Enter på Bekreft.
    await keyMove(page, "e2", "e4", false);
    await expect(bar).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(bar).toBeHidden();
    await expect(live).toHaveText("Hvit bonde til e4");
    await expect(page.locator(GRID)).toBeFocused();
    // Nå er det svart sin tur: brettet er snudd, så e7 er nederst.
    await goto(page, "e7", true);
  });
});

test.describe("trekkbekreftelse: skjermleser og fast spor", () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("chess:confirmMoves", "1"));
  });

  test("skjermleser-aktivering (syntetisk click på rutene) velger og flytter; fokus stjeles ikke; sporet har fast høyde", async ({ page }) => {
    await startVersus(page);
    const slot = page.getByTestId("confirm-slot");
    const shell = page.getByTestId("board-shell");
    const slotBefore = await slot.boundingBox();
    const shellBefore = await shell.boundingBox();
    expect(slotBefore && slotBefore.height).toBeGreaterThan(0);

    // Rutene har pointer-events:none, men dispatchede click når handleren.
    await page.locator(`${GRID}-e2`).dispatchEvent("click");
    await page.locator(`${GRID}-e4`).dispatchEvent("click");
    const bar = page.getByTestId("move-confirm");
    await expect(bar).toBeVisible();
    // Fokus lå ikke i rutenettet (ingen tastatur): Bekreft skal ikke få fokus.
    await expect(page.getByRole("button", { name: no.a11y.confirm })).not.toBeFocused();

    const slotAfter = await slot.boundingBox();
    const shellAfter = await shell.boundingBox();
    expect(slotAfter!.height).toBe(slotBefore!.height);
    expect(shellAfter!.y).toBe(shellBefore!.y);
    expect(shellAfter!.height).toBe(shellBefore!.height);

    await page.getByRole("button", { name: no.a11y.confirm }).click();
    await expect(bar).toBeHidden();
    expect((await slot.boundingBox())!.height).toBe(slotBefore!.height);
  });

  test("vanlig museklikk går fortsatt til brettet under rutenettet", async ({ page }) => {
    await startVersus(page);
    await page.getByTestId("board-shell").locator('[data-square="e2"]').click();
    await page.getByTestId("board-shell").locator('[data-square="e4"]').click();
    await expect(page.getByTestId("move-confirm")).toBeVisible();
  });
});

test.describe("høy kontrast", () => {
  test("temaet kan velges og settes på spillvisningen", async ({ page }) => {
    await startVersus(page);
    await page.getByRole("button", { name: no.board.theme }).click();
    await page.getByRole("radio", { name: no.a11y.themeContrast }).click();
    await expect(page.locator("main.game-page")).toHaveAttribute("data-board-theme", "contrast");
  });
});
