import { expect, test } from "@playwright/test";

import { no } from "@/lib/locale/no";

// Fysisk modus M5a: publiser -> QR-rapport fra en annen enhet -> arrangøren godkjenner
// -> resultatet står i den offentlige siden. Kjører mot lokal Supabase (migr. 0016).
const L = no.physicalCloud;

test("publiser → spiller melder via QR-side → arrangør godkjenner → offentlig side viser resultatet", async ({ page, browser }) => {
  test.setTimeout(120_000);
  await page.goto("/arranger/fysisk");
  await page.getByRole("link", { name: no.physical.newTournament }).click();
  await page.getByLabel(no.physical.nameLabel).fill("Skytest");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page.getByLabel(no.physical.pasteLabel).fill("Anna; 1500; A\nBjørn; 1400; A\nCecilie; 1300; B\nDavid; 1200; B");
  await page.getByRole("button", { name: no.physical.pasteImport }).click();
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: no.physical.confirmCreate }).click();
  await expect(page.getByRole("heading", { name: "Skytest" })).toBeVisible();
  const url = page.url();
  const id = url.split("/").pop()!.split("?")[0];
  const origin = new URL(url).origin;

  await page.getByRole("button", { name: no.physical.pairRound(1) }).click();
  await page.getByRole("button", { name: no.physical.publishRound }).click();

  // Publiser til skyen
  await page.getByTestId("cloud-menu").getByRole("button").first().click();
  await expect(page.getByTestId("cloud-status")).toHaveText(L.status.unpublished);
  await page.getByRole("button", { name: L.publish, exact: true }).click();
  await expect(page.getByTestId("cloud-status")).toHaveText(L.status.synced);
  await page.getByRole("button", { name: L.showCode }).click();
  await expect(page.getByTestId("cloud-host-code")).toHaveText(/^[A-Z]{4}-[A-Z0-9]{2}$/);

  // Den offentlige siden er oppe og viser parringene (runden er publisert og pushet).
  const pub = await browser.newContext();
  const pubPage = await pub.newPage();
  await pubPage.goto(`${origin}/f/${id}`);
  await expect(pubPage.getByTestId("public-pairings").locator("tbody tr")).toHaveCount(2, { timeout: 20_000 });
  await expect(pubPage.getByTestId("public-standings").locator("tbody tr")).toHaveCount(4);
  expect(await pubPage.content()).not.toContain(await page.getByTestId("cloud-host-code").innerText());

  // Bordkort henter bordnøklene -> QR, og nøklene caches lokalt.
  await page.goto(`${origin}/arranger/fysisk/${id}/skriv/bordkort?runde=1`);
  await expect(page.locator(".pp-qr img")).toHaveCount(2, { timeout: 20_000 });
  const k = await page.evaluate((tid) => {
    const m = JSON.parse(localStorage.getItem(`sundaychess:physical-cloud:${tid}`) ?? "{}");
    return m.keys?.["1|1"] as string | undefined;
  }, id);
  expect(k).toBeTruthy();

  // Spilleren (annen enhet, ingen innlogging) melder resultatet på brett 1.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const p2 = await phone.newPage();

  // Forfalsket nøkkel avvises.
  await p2.goto(`${origin}/f/${id}/r/1/1?k=forged`);
  await p2.getByRole("button", { name: L.resultWhite }).click();
  await p2.getByRole("button", { name: L.repSend }).click();
  await expect(p2.locator(".banner-error")).toHaveText(L.repBadKey, { timeout: 20_000 });

  await p2.goto(`${origin}/f/${id}/r/1/1?k=${encodeURIComponent(k!)}`);
  await p2.getByRole("button", { name: L.repIWhite }).click();
  await p2.getByRole("button", { name: L.resultWhite }).click();
  await p2.getByRole("button", { name: L.repSend }).click();
  await expect(p2.getByTestId("report-sent")).toBeVisible({ timeout: 20_000 });
  // Laster siden på nytt husker den at meldingen er sendt.
  await p2.reload();
  await expect(p2.getByTestId("report-sent")).toBeVisible();

  // Arrangøren ser meldingen (poller hvert 10. sekund) og godkjenner.
  await page.goto(url);
  const card = page.getByTestId("report-board-1");
  await expect(card).toBeVisible({ timeout: 30_000 });
  await card.getByRole("button", { name: L.approve }).click();
  await expect(card).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId("cloud-status")).toHaveText(L.status.synced, { timeout: 20_000 });

  // Resultatet står i den offentlige siden og i tabellen.
  await pubPage.reload();
  await expect(pubPage.getByTestId("public-pairings").locator("tbody tr").first().locator("td").nth(3)).toHaveText("1–0", { timeout: 30_000 });
  await expect(pubPage.getByTestId("public-standings").locator("tbody tr").first().locator("td").last()).toHaveText("1");

  await pub.close();
  await phone.close();
});

// Review-runden: enhets-id (to telefoner), samstemt bare fra to ulike telefoner, foreldede meldinger etter
// bytte, og navnepolicy (initialer er standard på den offentlige siden).
test("to telefoner er samstemte, én telefon er det aldri, bytte etter publisering gjør meldinger foreldet; initialer offentlig", async ({ page, browser }) => {
  test.setTimeout(180_000);
  const p = no.physical;
  await page.goto("/arranger/fysisk");
  await page.getByRole("link", { name: p.newTournament }).click();
  await page.getByLabel(p.nameLabel).fill("Reviewtest");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page.getByLabel(p.pasteLabel).fill("Anna Hansen; 1500; Klubb A\nBjørn Berg; 1400; Klubb A\nCecilie Dahl; 1300; Klubb B\nDavid Moe; 1200; Klubb B");
  await page.getByRole("button", { name: p.pasteImport }).click();
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: p.confirmCreate }).click();
  await expect(page.getByRole("heading", { name: "Reviewtest" })).toBeVisible();
  const url = page.url();
  const id = url.split("/").pop()!.split("?")[0];
  const origin = new URL(url).origin;
  await page.getByRole("button", { name: p.pairRound(1) }).click();
  await page.getByRole("button", { name: p.publishRound }).click();

  // Publiser med standard navnepolicy (initialer er forhåndsvalgt).
  await page.getByTestId("cloud-menu").getByRole("button").first().click();
  await expect(page.getByTestId("public-names").getByRole("radio").first()).toBeChecked();
  await page.getByRole("button", { name: L.publish, exact: true }).click();
  await expect(page.getByTestId("cloud-status")).toHaveText(L.status.synced);

  const pub = await browser.newContext();
  const pubPage = await pub.newPage();
  await pubPage.goto(`${origin}/f/${id}`);
  await expect(pubPage.getByTestId("public-pairings").locator("tbody tr")).toHaveCount(2, { timeout: 20_000 });
  const html = await pubPage.content();
  expect(html).toContain("Anna H.");
  for (const hidden of ["Hansen", "Berg", "Dahl", "Moe", "Klubb A"]) expect(html).not.toContain(hidden);

  await page.goto(`${origin}/arranger/fysisk/${id}/skriv/bordkort?runde=1`);
  await expect(page.locator(".pp-qr img")).toHaveCount(2, { timeout: 20_000 });
  const keys = await page.evaluate((tid) => JSON.parse(localStorage.getItem(`sundaychess:physical-cloud:${tid}`) ?? "{}").keys as Record<string, string>, id);

  const phone = async (board: number, side: "white" | "black", result: string) => {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const pg = await ctx.newPage();
    await pg.goto(`${origin}/f/${id}/r/1/${board}?k=${encodeURIComponent(keys[`1|${board}`])}`);
    expect(await pg.content()).not.toContain("Hansen");
    await pg.getByRole("button", { name: side === "white" ? L.repIWhite : L.repIBlack }).click();
    await pg.getByRole("button", { name: result }).click();
    await pg.getByRole("button", { name: L.repSend }).click();
    await expect(pg.getByTestId("report-sent")).toBeVisible({ timeout: 20_000 });
    return { ctx, pg };
  };

  // Brett 1: hvit og svart melder det samme fra HVER sin telefon -> samstemt.
  const a = await phone(1, "white", L.resultWhite);
  const b = await phone(1, "black", L.resultWhite);
  // Brett 2: ÉN telefon melder først som hvit, så (Meld på nytt) som svart -> fortsatt én melding, aldri samstemt.
  const c = await phone(2, "white", L.resultDraw);
  await c.pg.getByRole("button", { name: L.repChange }).click();
  await c.pg.getByRole("button", { name: L.repIBlack }).click();
  await c.pg.getByRole("button", { name: L.resultDraw }).click();
  await c.pg.getByRole("button", { name: L.repSend }).click();
  await expect(c.pg.getByTestId("report-sent")).toBeVisible({ timeout: 20_000 });

  await page.goto(url);
  const card1 = page.getByTestId("report-board-1");
  await expect(card1).toBeVisible({ timeout: 30_000 });
  await expect(card1.getByText(L.reportAgree)).toBeVisible();
  await expect(page.getByRole("button", { name: L.approveAgreed })).toBeVisible();
  const card2 = page.getByTestId("report-board-2");
  await expect(card2).toBeVisible({ timeout: 30_000 });
  await expect(card2.getByRole("button", { name: L.approve })).toHaveCount(1);
  await expect(card2.getByText(L.reportAgree)).toHaveCount(0);

  // Bytte etter publisering: meldingene gjaldt de gamle spillerne og vises ikke lenger.
  await page.getByRole("button", { name: p.editPairing }).click();
  await page.getByRole("dialog").getByRole("button", { name: p.editPairingStart }).click();
  await page.locator('[data-board="1"] .pr-player').first().click();
  await page.locator('[data-board="2"] .pr-player').first().click();
  await page.getByRole("button", { name: p.editPairingDone }).click();
  await expect(page.getByTestId("report-board-1")).toBeHidden({ timeout: 15_000 });
  await expect(page.getByTestId("report-board-2")).toBeHidden();
  await expect(page.getByRole("button", { name: L.approveAgreed })).toBeHidden();

  await a.ctx.close();
  await b.ctx.close();
  await c.ctx.close();
  await pub.close();
});

// To faner med samme turnering: bare én kan skrive; den andre er skrivebeskyttet og kan ta over.
test("andre fane er skrivebeskyttet og kan ta over", async ({ page, context }) => {
  await page.goto("/arranger/fysisk");
  await page.getByRole("link", { name: no.physical.newTournament }).click();
  await page.getByLabel(no.physical.nameLabel).fill("Låstest");
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: no.common.next }).click();
  await page.getByLabel(no.physical.pasteLabel).fill("Anna\nBjørn\nCecilie\nDavid");
  await page.getByRole("button", { name: no.physical.pasteImport }).click();
  await page.getByRole("button", { name: no.common.next }).click();
  await page.getByRole("button", { name: no.physical.confirmCreate }).click();
  await expect(page.getByRole("heading", { name: "Låstest" })).toBeVisible();
  await expect(page.getByTestId("readonly-banner")).toHaveCount(0);

  const second = await context.newPage();
  await second.goto(page.url());
  await expect(second.getByTestId("readonly-banner")).toBeVisible();
  await expect(second.getByRole("button", { name: no.physical.pairRound(1) })).toBeDisabled();

  // Første fane arbeider videre; andre fane tar over og ser det som ble gjort.
  await page.getByRole("button", { name: no.physical.pairRound(1) }).click();
  await expect(page.getByTestId("save-state")).toHaveAttribute("data-state", "saved");
  second.once("dialog", (d) => void d.accept());
  await second.getByRole("button", { name: L.lockTakeOver }).click();
  await expect(second.getByTestId("readonly-banner")).toBeHidden();
  await expect(second.getByRole("button", { name: no.physical.publishRound })).toBeVisible();
  await expect(page.getByTestId("readonly-banner")).toBeVisible();
});
