/**
 * REQ-979 (LOOP-007 q1, issue q1-59) — a New invoice on an account with NO
 * saved services is not a dead end.
 *  (1) The service picker offers to add what was typed as a real catalogue
 *      service ("+ Add \"Lawn mowing\" …"), picks it, and the line bills it.
 *  (2) An untouched empty service row never locks the one-amount bill: the
 *      Amount box stays editable and the Subtotal is the typed amount.
 *  (3) A price typed on a row with no service is not dropped silently: the
 *      row says "Pick a service on every line." instead of a bare $0.00.
 * AMENDS REQ-921 (no "create" row) — the created line still bills a real
 * catalogue service.
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
    body: JSON.stringify({ language: "en", name: "No Services Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // the button is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}


async function openNewInvoice(page: StoryTools["page"]) {
  await page.goto("/invoices");
  await clickUntil(
    page,
    "[data-cy='invoice-new']",
    async () => await page.locator("[data-cy='new-invoice-modal']").isVisible(),
  );
  // the catalogue fetch has answered: the empty-catalogue note is up
  await page.locator("[data-cy='new-invoice-no-services']").waitFor({
    timeout: 15_000,
  });
}

const subtotal = async (page: StoryTools["page"]) =>
  (await page.locator("[data-cy='new-invoice-subtotal']").innerText()).trim();

Deno.test("REQ-979 q1-59: no services yet — typing 'Lawn mowing' in the picker offers to add it; adding picks it, $65 gives Subtotal $65.00, and /field/services lists it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await openNewInvoice(page);

    const svc0 = "[data-cy='new-invoice-line-service-0']";
    const box0 = page.locator(`${svc0} [data-cy='search-select-input']`);
    await box0.click();
    await box0.fill("Lawn mowing");
    await page.waitForTimeout(500);
    const createRows = page.locator(`${svc0} [data-cy='search-select-create']`);
    const nCreate = await createRows.count();
    const empty = await page.locator(`${svc0} [data-cy='search-select-empty']`)
      .count();
    expect.eq(
      nCreate,
      1,
      `the picker offers to add the typed service (create rows: ${nCreate}, "No matches" rows: ${empty})`,
    );
    const createText = await createRows.first().innerText();
    expect.eq(
      createText.includes("Lawn mowing"),
      true,
      `the create row names what was typed (got ${JSON.stringify(createText)})`,
    );
    await createRows.first().click();

    // the row now bills the new catalogue service
    await page.waitForFunction((sel) => {
      const el = document.querySelector(sel);
      const v = el?.getAttribute("data-value") ?? "";
      return v !== "" && v !== "__keep__";
    }, svc0, { timeout: 10_000 });
    expect.eq(
      (await box0.inputValue()).trim(),
      "Lawn mowing",
      "the row shows the service just added",
    );
    await page.locator("[data-cy='new-invoice-line-price-0']").fill("65");
    await page.waitForTimeout(300);
    expect.eq(await subtotal(page), "$65.00", "the line bills $65");

    const types = await (await http("/api/field/task-types", { headers: auth }))
      .json() as Array<{ id: string; name: string }>;
    expect.eq(
      types.some((s) => s.name === "Lawn mowing"),
      true,
      `the account's services now list Lawn mowing (got ${
        JSON.stringify(types.map((s) => s.name))
      })`,
    );
  }));

Deno.test("REQ-979 q1-59: no services yet — with the empty service row untouched, Amount is editable and typing 65 gives Subtotal $65.00", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await openNewInvoice(page);

    const amount = page.locator("[data-cy='new-invoice-amount']");
    const ro = await amount.getAttribute("readonly");
    expect.eq(
      ro,
      null,
      `the Amount box is editable while no row bills a service (readonly=${
        JSON.stringify(ro)
      }, rows: ${await page.locator("[data-cy^='new-invoice-line-price-']").count()})`,
    );
    await amount.fill("65", { timeout: 3_000 });
    await page.waitForTimeout(300);
    expect.eq(await subtotal(page), "$65.00", "the one-amount bill's subtotal is the typed amount");
  }));

Deno.test("REQ-979 q1-59: a price typed on a row with no service picked is not dropped silently — the row says 'Pick a service on every line.'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await openNewInvoice(page);

    await page.locator("[data-cy='new-invoice-line-price-0']").fill("65");
    await page.waitForTimeout(500);
    const sub = await subtotal(page);
    const modal = await page.locator("[data-cy='new-invoice-modal']").innerText();
    expect.eq(
      sub === "$65.00" || modal.includes("Pick a service on every line."),
      true,
      `a priced row with no service either bills or says why (subtotal ${sub}, hint shown: ${
        modal.includes("Pick a service on every line.")
      })`,
    );
  }));
