import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { no } from "@/lib/locale/no";
import { tekst as storskjermTekst } from "@/lib/client/storskjerm/tekst";
import { openAs, publicFlowMatch, type Match } from "./fixtures/match";
import type { StoredPlayer } from "@/lib/client/identity";
import { seedHostCode, seedPlayer } from "./helpers/identity";

// Varig designtest: håndhever designreglene fra designrunden D0–D7 på tvers av
// sidene, så en senere endring ikke stille ødelegger mobil, mørkt tema eller
// storskjermen.
//
// Reglene, per side og per kombinasjon av størrelse og tema:
//   1. ingen horisontal overflyt (scrollWidth <= innerWidth)
//   2. ingen synlig tekst under 13 px
//   3. ingen synlig knapp, lenke eller felt lavere enn 40 px (kun på 375 px)
//   4. storskjerm og spillvisning passer i én skjermhøyde (scrollHeight <= innerHeight)
//
// Feilmeldingene lister elementene som bryter, med tag, tekst og mål.
//
// Spec-en setter selv viewport og fargetema, så den kjøres bare i
// desktop-chromium (ellers ville hver side bli testet to ganger).
//
// DB-fri del: sider som ikke trenger Supabase. DB-del: én turnering via de
// offentlige rutene (publicFlowMatch), gjenbrukt av alle testene i den delen.

const MOBILE = { width: 375, height: 812 };
const DESKTOP = { width: 1280, height: 820 };
const TV = { width: 1280, height: 720 };

const SCHEMES = ["light", "dark"] as const;
type Scheme = (typeof SCHEMES)[number];

/** Minste skriftstørrelse (px) som skal vises noe sted. */
const MIN_FONT = 13;
/** Minste høyde (px) på noe man trykker på, på telefon. */
const MIN_TARGET = 40;

test.beforeEach(({}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "setter egne viewporter; kjøres kun én gang");
});

interface Violations {
  overflowX: string | null;
  smallText: string[];
  smallTargets: string[];
  overflowY: string | null;
}

/**
 * Måler alle reglene i selve siden. Alt kjører i én evaluate, så målingen er
 * rask og ser nøyaktig det en bruker ser (computed style, ikke kildekoden).
 */
async function measure(page: Page, opts: { targets: boolean }): Promise<Violations> {
  return page.evaluate(
    ({ minFont, minTarget, targets }) => {
      const label = (el: Element) => {
        const text = (el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
        const aria = el.getAttribute("aria-label");
        const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className : "";
        return `<${el.tagName.toLowerCase()}${cls ? "." + cls.split(/\s+/)[0] : ""}> «${text || aria || ""}»`;
      };
      const visible = (el: Element) => {
        const h = el as HTMLElement;
        if (typeof h.checkVisibility === "function" && !h.checkVisibility({ visibilityProperty: true })) return false;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) return false;
        // Visuelt skjulte hjelpeelementer (sr-only: klippet til 1 px).
        const cs = getComputedStyle(el);
        if (cs.clip === "rect(0px, 0px, 0px, 0px)" || cs.clipPath === "inset(50%)") return false;
        return true;
      };

      // 1. Horisontal overflyt.
      const doc = document.documentElement;
      const overflowX =
        doc.scrollWidth > window.innerWidth
          ? `scrollWidth ${doc.scrollWidth} > innerWidth ${window.innerWidth}`
          : null;

      // 2. Skriftstørrelse: hver tekstnode med innhold, målt på forelderen.
      const smallText: string[] = [];
      const seen = new Set<Element>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walker.nextNode(); n; n = walker.nextNode()) {
        const parent = n.parentElement;
        if (!parent || seen.has(parent)) continue;
        if (!(n.textContent ?? "").trim()) continue;
        if (parent.closest("script,style,noscript,option,svg,[aria-hidden='true']")) continue;
        if (!visible(parent)) continue;
        const size = parseFloat(getComputedStyle(parent).fontSize);
        if (size < minFont) {
          seen.add(parent);
          smallText.push(`${label(parent)} ${size}px`);
        }
      }

      // 3. Trykkflater (kun smal skjerm). Tekstlenker midt i en setning er
      //    unntatt (WCAG 2.5.8 «inline»); alt annet må være minst 40 px høyt.
      const smallTargets: string[] = [];
      if (targets) {
        const sel =
          "button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=radio], [role=tab]";
        for (const el of Array.from(document.querySelectorAll(sel))) {
          if (!visible(el)) continue;
          const cs = getComputedStyle(el);
          if (el.tagName === "A" && cs.display === "inline") continue;
          // Radio/avkrysning som er skjult bak en synlig label.
          if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
            const lab = el.closest("label");
            if (lab && lab.getBoundingClientRect().height >= minTarget) continue;
          }
          const h = el.getBoundingClientRect().height;
          if (h < minTarget - 0.5) smallTargets.push(`${label(el)} ${Math.round(h * 10) / 10}px`);
        }
      }

      // 4. Høyde (sjekkes av kalleren; målet leveres her).
      const overflowY =
        doc.scrollHeight > window.innerHeight
          ? `scrollHeight ${doc.scrollHeight} > innerHeight ${window.innerHeight}`
          : null;

      return { overflowX, smallText, smallTargets, overflowY };
    },
    { minFont: MIN_FONT, minTarget: MIN_TARGET, targets: opts.targets },
  );
}

/** Kjører alle reglene og samler brudd i én lesbar feilmelding. */
async function expectDesign(
  page: Page,
  where: string,
  opts: { targets: boolean; fitsHeight?: boolean },
): Promise<void> {
  const v = await measure(page, opts);
  const problems: string[] = [];
  if (v.overflowX) problems.push(`horisontal overflyt: ${v.overflowX}`);
  if (v.smallText.length) problems.push(`tekst under ${MIN_FONT} px:\n    ${v.smallText.join("\n    ")}`);
  if (v.smallTargets.length) problems.push(`trykkflater under ${MIN_TARGET} px:\n    ${v.smallTargets.join("\n    ")}`);
  if (opts.fitsHeight && v.overflowY) problems.push(`passer ikke i én skjermhøyde: ${v.overflowY}`);
  expect(problems, `${where} bryter designreglene:\n  ${problems.join("\n  ")}`).toEqual([]);
}

/** Åpner siden i gitt størrelse og tema og venter til innholdet har satt seg. */
async function open(page: Page, url: string, size: { width: number; height: number }, scheme: Scheme) {
  await page.setViewportSize(size);
  await page.emulateMedia({ colorScheme: scheme });
  await page.goto(url);
  // Fonter og første tegning må være ferdig før noe måles.
  await page.evaluate(() => document.fonts.ready);
  // Innfadingen ved sidelasting (opacity 0 → 1) skal være ferdig, ellers måler
  // vi tomme sider og reglene består uten å teste noe.
  // Evig løpende animasjoner (puls o.l.) hoppes over.
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter((a) => Number.isFinite(Number(a.effect?.getComputedTiming().endTime)))
        .map((a) => a.finished.catch(() => {})),
    ),
  );
}

/**
 * Storskjermen ligger i `.presentasjon-fit` (overflow: hidden), så
 * `scrollHeight <= innerHeight` kan aldri feile: det som stikker ut blir bare
 * klippet. Mål i stedet at hvert element inni hvert `.tv-card` slutter innenfor
 * kortets nedre kant.
 */
async function expectCardsNotClipped(page: Page, where: string): Promise<void> {
  const result = await page.evaluate(() => {
    const cards = Array.from(document.querySelectorAll(".tv-card"));
    const bad: string[] = [];
    for (const card of cards) {
      const bottom = card.getBoundingClientRect().bottom;
      for (const el of Array.from(card.querySelectorAll("*"))) {
        const h = el as HTMLElement;
        if (typeof h.checkVisibility === "function" && !h.checkVisibility({ visibilityProperty: true })) continue;
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        if (r.bottom > bottom + 1) {
          const cls = typeof h.className === "string" ? h.className.split(/\s+/)[0] : "";
          bad.push(`<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> «${(el.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 30)}» slutter ${Math.round(r.bottom)} > kort ${Math.round(bottom)}`);
        }
      }
    }
    return { cards: cards.length, bad };
  });
  expect(result.cards, `${where}: fant ingen .tv-card å måle`).toBeGreaterThan(0);
  expect(result.bad, `${where}: innhold klippes av kortet:\n  ${result.bad.slice(0, 8).join("\n  ")}`).toEqual([]);
}

const size = (s: { width: number }) => (s.width === MOBILE.width ? "375" : String(s.width));

// ---------------------------------------------------------------------------
// DB-frie sider
// ---------------------------------------------------------------------------

const STATIC_PAGES: { name: string; url: string; ready?: (page: Page) => Promise<void> }[] = [
  { name: "forsiden", url: "/" },
  { name: "/play", url: "/play" },
  { name: "/versus", url: "/versus" },
  { name: "/arranger", url: "/arranger" },
  { name: "/arranger/fysisk", url: "/arranger/fysisk" },
  { name: "/arranger/fysisk/ny (steg 1)", url: "/arranger/fysisk/ny" },
  { name: "/host/login", url: "/host/login" },
  { name: "/solo (velg farge)", url: "/solo" },
];

test.describe("designregler uten database", () => {
  for (const scheme of SCHEMES) {
    for (const vp of [MOBILE, DESKTOP]) {
      for (const p of STATIC_PAGES) {
        test(`${p.name} · ${size(vp)} px · ${scheme}`, async ({ page }) => {
          await open(page, p.url, vp, scheme);
          await expectDesign(page, `${p.name} (${vp.width}×${vp.height}, ${scheme})`, {
            targets: vp.width === MOBILE.width,
          });
        });
      }

      test(`/solo med startet parti · ${size(vp)} px · ${scheme}`, async ({ page }) => {
        await open(page, "/solo", vp, scheme);
        await page.getByRole("button", { name: new RegExp(`^${no.solo.start}`) }).click();
        await expect(page.getByTestId("board-shell")).toBeVisible();
        // Spillvisningen skal passe i én skjermhøyde både på desktop og på en
        // moderne telefon (375×812). På de minste telefonene (360×640) har
        // brettet et gulv på ~300 px og siden scroller heller enn at brettet
        // blir uspillelig lite; det dekkes av «mobil»-testene under.
        await expectDesign(page, `/solo i parti (${vp.width}×${vp.height}, ${scheme})`, {
          targets: vp.width === MOBILE.width,
          fitsHeight: true,
        });
      });
    }
  }
});

test.describe("tastatur", () => {
  test("Segmented: piltast flytter både valg og fokus", async ({ page }) => {
    await open(page, "/arranger/fysisk/ny", DESKTOP, "light");
    const group = page.getByRole("radiogroup").first();
    const radios = group.getByRole("radio");
    expect(await radios.count()).toBeGreaterThanOrEqual(2);
    await radios.first().focus();
    await expect(radios.first()).toBeChecked();

    await page.keyboard.press("ArrowRight");
    await expect(radios.nth(1)).toBeChecked();
    await expect(radios.nth(1)).toBeFocused();

    await page.keyboard.press("ArrowLeft");
    await expect(radios.first()).toBeChecked();
    await expect(radios.first()).toBeFocused();
  });
});

test.describe("skjermleser", () => {
  test("Stepper på telefon: <nav> «Steg» har lesbart innhold i tilgjengelighetstreet", async ({ page }) => {
    await open(page, "/arranger/fysisk/ny", MOBILE, "light");
    const nav = page.getByRole("navigation", { name: no.wizard.step });
    await expect(nav).toBeVisible();
    // Lista er display:none under 640 px; kompaktteksten må da være det som leses.
    await expect(nav.getByText(new RegExp(`^${no.wizard.step} 1 ${no.wizard.of} `))).toBeVisible();
    await expect(nav.locator("[aria-hidden='true']:not(.stepper-num)")).toHaveCount(0);
    expect(await nav.evaluate((el) => (el as HTMLElement).innerText.trim().length)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Sider med database: én turnering gjenbrukes av alle testene under.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Små telefoner: turneringsparti og venterom (D2/D3). Egen turnering med
// reaksjoner og klokke slått på, så den rike spillvisningen (`gl-rich`) testes.
// ---------------------------------------------------------------------------

const SMALL_PHONES = [
  { width: 360, height: 640 },
  { width: 375, height: 667 },
];
/** Brettet skal aldri bli mindre enn dette på telefon (gulvet i CSS er ~300). */
const MIN_BOARD = 280;

test.describe("mobil: turneringsparti og venterom", () => {
  test.describe.configure({ mode: "serial" });

  let game: Match;
  let bye: StoredPlayer | null = null;

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    try {
      const post = async <T,>(path: string, data: unknown): Promise<T> => {
        const res = await request.post(path, { data });
        expect(res.status(), `POST ${path} → ${res.status()} ${await res.text()}`).toBe(200);
        return (await res.json()) as T;
      };
      const t = await post<{ id: string; joinPin: string; hostCode: string }>("/api/tournament", {
        title: process.env.E2E_TITLE ?? "E2E",
        config: { reactions: true, clockSec: 300, roundTimerSec: 600 },
      });
      type Joined = { tournamentId: string; playerId: string; resumeCode: string; displayName: string };
      const joined: Joined[] = [];
      // Tre spillere: ett parti og én frirunde (venterommet).
      for (const name of ["Ada", "Bo", "Cy"]) joined.push(await post<Joined>("/api/join", { pin: t.joinPin, displayName: name }));
      await post("/api/round/start", { tournamentId: t.id, hostCode: t.hostCode });
      const board = (await (await request.get(`/api/tournament/${t.id}`)).json()) as {
        games: { id: string; status: string; whitePlayerId: string; blackPlayerId: string | null }[];
      };
      const byId = new Map(joined.map((j) => [j.playerId, j]));
      const stored = (j: Joined): StoredPlayer => ({
        tournamentId: j.tournamentId,
        playerId: j.playerId,
        resumeCode: j.resumeCode,
        displayName: j.displayName,
      });
      const live = board.games.find((g) => g.status === "live" && g.blackPlayerId);
      expect(live, "runde 1 ga ikke noe parti").toBeTruthy();
      const byeGame = board.games.find((g) => g.status === "bye");
      expect(byeGame, "runde 1 ga ingen frirunde").toBeTruthy();
      game = {
        tournamentId: t.id,
        gameId: live!.id,
        hostCode: t.hostCode,
        white: stored(byId.get(live!.whitePlayerId)!),
        black: stored(byId.get(live!.blackPlayerId!)!),
      };
      bye = stored(byId.get(byeGame!.whitePlayerId)!);
    } finally {
      await request.dispose();
    }
  });

  /** Knapper og felt der teksten er bredere enn knappen (kuttet). */
  async function clippedButtons(page: Page): Promise<string[]> {
    return page.evaluate(() =>
      Array.from(document.querySelectorAll("main button, .game-layout button"))
        .filter((b) => b.getBoundingClientRect().width > 0 && b.scrollWidth > b.clientWidth + 1)
        .map((b) => `«${(b.textContent ?? "").trim().slice(0, 30)}» scrollWidth ${b.scrollWidth} > clientWidth ${b.clientWidth}`),
    );
  }

  for (const vp of SMALL_PHONES) {
    test(`turneringsparti · ${vp.width}×${vp.height}: brett ≥ ${MIN_BOARD} px, ingen kuttede knapper`, async ({ context }) => {
      // openAs åpner en NY side i konteksten (ikke `page`-fixturen).
      const page = await openAs(context, game.white);
      await page.setViewportSize(vp);
      await page.evaluate(() => document.fonts.ready);
      const board = await page.getByTestId("board-shell").boundingBox();
      expect(board, "brettet har ingen størrelse").not.toBeNull();
      expect(board!.width, `brettet er bare ${Math.round(board!.width)} px bredt`).toBeGreaterThanOrEqual(MIN_BOARD);
      expect(await clippedButtons(page), "knapper kuttes").toEqual([]);

      // Reaksjonene ligger i én rad (ikke stablet loddrett).
      const tops = await page.locator(".reaction-btn").evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().top)))]);
      expect(tops.length, "reaksjonene skal ligge i én rad").toBeLessThanOrEqual(1);

      // Trykkflater: ikke målt her; brettets 8×8 ruter (37,5 px på 300 px) er ikke knapper i designreglenes forstand.
      await expectDesign(page, `turneringsparti (${vp.width}×${vp.height})`, { targets: false });
    });

    test(`venterom · ${vp.width}×${vp.height}: ingen overflyt, ingen kuttede knapper`, async ({ page, context }) => {
      await seedPlayer(context, bye!);
      await page.setViewportSize(vp);
      await page.goto("/play");
      await expect(page.locator(".pl-status-main")).toBeVisible({ timeout: 25_000 });
      await page.evaluate(() => document.fonts.ready);
      expect(await clippedButtons(page), "knapper kuttes").toEqual([]);
      // Trykkflater utelatt: venterommet viser et øvelsesbrett med ruter under 40 px.
      await expectDesign(page, `venterom (${vp.width}×${vp.height})`, { targets: false });
    });
  }
});

test.describe("designregler med turnering", () => {
  // Serielt: alle deler turneringen som lages i beforeAll.
  test.describe.configure({ mode: "serial" });

  let tournamentId = "";
  let hostCode = "";

  test.beforeAll(async ({ playwright }) => {
    const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    try {
      // Runde 1 er startet: arrangørvisningen er i liga, så Oversikt/Live-
      // veksleren og «Mer»-menyen har alt de skal vise.
      const match = await publicFlowMatch(request, { white: "Ada", black: "Bo" });
      tournamentId = match.tournamentId;
      hostCode = match.hostCode;
    } finally {
      await request.dispose();
    }
  });

  async function hostContext(context: BrowserContext) {
    await seedHostCode(context, tournamentId, hostCode);
  }

  for (const scheme of SCHEMES) {
    for (const vp of [MOBILE, DESKTOP]) {
      test(`arrangør /host/<id> · ${size(vp)} px · ${scheme}`, async ({ page, context }) => {
        await hostContext(context);
        await open(page, `/host/${tournamentId}`, vp, scheme);
        await expect(page.getByRole("radio", { name: no.host.boardToggle })).toBeVisible();
        await expectDesign(page, `arrangør (${vp.width}×${vp.height}, ${scheme})`, {
          targets: vp.width === MOBILE.width,
        });
      });
    }

    test(`storskjerm ?visning=tavle · 1280×720 · ${scheme}`, async ({ page, context }) => {
      await hostContext(context);
      await open(page, `/host/${tournamentId}?visning=tavle`, TV, scheme);
      await expect(page.getByRole("button", { name: storskjermTekst.tavle.avslutt })).toBeVisible();
      await expectDesign(page, `storskjerm (1280×720, ${scheme})`, {
        targets: false,
        fitsHeight: true,
      });
      await expectCardsNotClipped(page, `storskjerm (1280×720, ${scheme})`);
    });
  }

  test("«Mer»-menyen på 375 px viser de tre handlingene og lukkes med Escape", async ({ page, context }) => {
    await hostContext(context);
    await open(page, `/host/${tournamentId}`, MOBILE, "light");

    const more = page.getByRole("button", { name: no.host.more });
    await expect(more).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "false");

    // Før menyen åpnes er handlingene skjult på smal skjerm.
    const show = page.getByRole("button", { name: storskjermTekst.knapp });
    await expect(show).toBeHidden();

    await more.click();
    await expect(more).toHaveAttribute("aria-expanded", "true");

    // Det holder at de er synlige og aktive: å klikke dem åpner vinduer og
    // nedlastinger, som gjør testen ustabil.
    const items = [
      show,
      page.getByTestId("host-download-file"),
      page.getByRole("button", { name: no.diag.open }),
    ];
    for (const item of items) {
      await expect(item).toBeVisible();
      await expect(item).toBeEnabled();
      const box = await item.boundingBox();
      expect(box, "menyvalget har ingen plass på skjermen").not.toBeNull();
      expect(box!.height, "menyvalget er for lavt å trykke på").toBeGreaterThanOrEqual(MIN_TARGET - 0.5);
      expect(box!.x + box!.width, "menyvalget stikker ut til høyre").toBeLessThanOrEqual(MOBILE.width);
    }

    await page.keyboard.press("Escape");
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(show).toBeHidden();
  });

  test("Oversikt/Live-veksleren bytter visning", async ({ page, context }) => {
    await hostContext(context);
    await open(page, `/host/${tournamentId}`, DESKTOP, "light");

    const board = page.getByRole("radio", { name: no.host.boardToggle });
    const live = page.getByRole("radio", { name: no.host.liveToggle });
    await expect(board).toBeChecked();

    await live.click();
    await expect(live).toBeChecked();
    await expect(board).not.toBeChecked();
    // Live-rutenettet har brettet til partiet; tabellvisningen har det ikke.
    await expect(page.locator(".live-board").first()).toBeVisible();

    await board.click();
    await expect(board).toBeChecked();
    await expect(page.locator(".live-board")).toHaveCount(0);
  });
});
