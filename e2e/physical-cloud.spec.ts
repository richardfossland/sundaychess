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
  await expect(p2.getByRole("alert")).toHaveText(L.repBadKey, { timeout: 20_000 });

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
  const panel = page.getByTestId("reports-panel");
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(panel.getByTestId("report-board-1")).toBeVisible();
  await panel.getByTestId("report-board-1").getByRole("button", { name: L.approve }).click();
  await expect(panel).toBeHidden({ timeout: 20_000 });
  await expect(page.getByTestId("cloud-status")).toHaveText(L.status.synced, { timeout: 20_000 });

  // Resultatet står i den offentlige siden og i tabellen.
  await pubPage.reload();
  await expect(pubPage.getByTestId("public-pairings").locator("tbody tr").first().locator("td").nth(3)).toHaveText("1–0", { timeout: 30_000 });
  await expect(pubPage.getByTestId("public-standings").locator("tbody tr").first().locator("td").last()).toHaveText("1");

  await pub.close();
  await phone.close();
});
