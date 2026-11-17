/**
 * REQ-856 — the roof measurement tool on the real shell, end to end: the owner
 * opens /roof, types an address, the aerial window appears, traces four corners
 * on it, closes the facet, sets the pitch and waste, reads the totals, saves,
 * and the measurement is still there after a reload. The served app runs on the
 * FAKE sources (the gate's bare PORT → ROOF_SOURCES=fake), so no imagery or
 * geocoder call leaves the machine.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
  });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ token: body.recoveryToken }),
    });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Roof Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

const ADDRESS = "4505 Socastee Blvd, Myrtle Beach, SC 29588";

/** an island may still be hydrating when its button appears: click until the
 *  page shows the effect (the house pattern). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 10; i++) {
      if (await done()) return;
      await page.waitForTimeout(300);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-856 + REQ-891: /tools/satellite (Tools › Satellite measure; /roof redirects) — an address → the aerial window → four corners traced → pitch and waste → totals → saved, and still there after a reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    // the whole square window must be on screen for the corner clicks
    await page.setViewportSize({ width: 1280, height: 1150 });
    // REQ-891: the old address still lands, on the renamed tool inside Tools
    await page.goto("/roof");
    await page.locator("[data-cy='roof-address']").waitFor({ timeout: 15_000 });
    expect(
      page.url().includes("/tools/satellite"),
      `/roof → /tools/satellite (${page.url()})`,
    );
    await expect.see("Satellite measure");

    // the island may still be hydrating when the input appears (a fill before
    // hydration is lost): type, then click until the address is found; the
    // aerial window follows (a real imagery export can take a while)
    const located = () =>
      page.locator("[data-cy='roof-located']").count().then((n) => n > 0);
    await clickUntil(page, "[data-cy='roof-locate']", async () => {
      if (await located()) return true;
      await page.locator("[data-cy='roof-address']").fill(ADDRESS);
      return false;
    });
    const canvas = page.locator("[data-cy='roof-canvas'][data-ready='1']");
    await canvas.waitFor({ timeout: 60_000 });
    // the imagery line names the source and date the fake reports
    await expect.see("Imagery:");

    // trace a rectangle: four corners at 30/70% of the window (clicks relative to the canvas)
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    for (const [fx, fy] of [[0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]]) {
      await canvas.click({
        position: { x: box.width * fx, y: box.height * fy },
      });
    }
    await page.waitForFunction(() =>
      !document.querySelector("[data-cy='roof-close']")?.hasAttribute(
        "disabled",
      )
    );
    await clickUntil(
      page,
      "[data-cy='roof-close']",
      () =>
        page.locator("[data-cy='roof-facet-row']").count().then((n) => n > 0),
    );
    expect.eq(
      await page.locator("[data-cy='roof-facet-row']").count(),
      1,
      "one facet",
    );

    // REQ-891: a driveway — pick Flat surface: the pitch select goes, the surface is the
    // footprint and roofing squares are not offered; back to Roof and the pitch returns
    await page.locator("[data-cy='roof-kind']").first().selectOption("flat");
    await page.waitForFunction(() =>
      document.querySelectorAll("[data-cy='roof-pitch']").length === 0 &&
      document.querySelectorAll("[data-cy='roof-squares']").length === 0
    );
    await page.locator("[data-cy='roof-kind']").first().selectOption("roof");
    await page.locator("[data-cy='roof-pitch']").first().waitFor({
      timeout: 5_000,
    });
    await page.locator("[data-cy='roof-squares']").waitFor({ timeout: 5_000 });

    // flat pitch: surface equals the footprint; 6/12 raises it by sqrt(1 + (6/12)^2)
    await page.locator("[data-cy='roof-pitch']").first().selectOption("0");
    await page.waitForFunction(() => {
      const n = (sel: string) =>
        Number(
          (document.querySelector(sel)?.textContent ?? "").replace(
            /[^\d.]/g,
            "",
          ),
        );
      return n("[data-cy='roof-total-surface']") ===
        n("[data-cy='roof-total-plan']");
    });
    const num = async (sel: string) =>
      Number((await page.locator(sel).innerText()).replace(/[^\d.]/g, ""));
    const planSqft = await num("[data-cy='roof-total-plan']");
    expect(planSqft > 100, `the traced facet has an area (${planSqft} sqft)`);
    const flat = await num("[data-cy='roof-total-surface']");
    expect.eq(Math.round(flat), Math.round(planSqft), "flat: surface = plan");
    await page.locator("[data-cy='roof-pitch']").first().selectOption("6");
    await page.waitForFunction(
      (p) =>
        Number(
          (document.querySelector("[data-cy='roof-total-surface']")
            ?.textContent ?? "").replace(/[^\d.]/g, ""),
        ) > p,
      planSqft,
    );
    const pitched = await num("[data-cy='roof-total-surface']");
    expect(
      Math.abs(pitched / planSqft - 1.118) < 0.01,
      `6/12 factor (${pitched}/${planSqft})`,
    );

    await page.locator("[data-cy='roof-waste']").fill("10");
    const withWaste = await num("[data-cy='roof-with-waste']");
    expect(
      Math.abs(withWaste / pitched - 1.1) < 0.01,
      `10% waste (${withWaste}/${pitched})`,
    );
    const squares = await num("[data-cy='roof-squares']");
    expect(Math.abs(squares - withWaste / 100) < 0.02, `squares (${squares})`);

    await clickUntil(
      page,
      "[data-cy='roof-save']",
      () =>
        page.locator("[data-cy='roof-saved-card']").count().then((n) => n > 0),
    );
    await expect.see(ADDRESS);

    await page.reload();
    await page.locator("[data-cy='roof-saved-card']").first().waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await page.locator("[data-cy='roof-saved-card']").count(),
      1,
      "the measurement is kept",
    );
    await expect.see(ADDRESS);
  }));
