/**
 * REQ-921 — services are the only thing a business offers. On the real
 * shell: New invoice has no "What's it for" / "Details"; each line is the
 * house search picker over the services (the live catalogue, A→Z, nothing
 * archived, nothing typed becomes a line — REQ-979: a typed name may be
 * added to the catalogue first)
 * + price, with + to add a row and − to remove one; the saved invoice bills
 * exactly those services. A repeat visit picks its services from the same
 * dropdown and can no longer make one up.
 */
import { story, type StoryTools } from "#shots";
import {
  addVisitService,
  ensureService,
  fillInvoiceLine,
  pickerRows,
  pickerShows,
} from "../_shared/service-lines.ts";

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
    body: JSON.stringify({ language: "en", name: "Service Lines Story" }),
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
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

async function catalogue(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const mow = await ensureService(http, auth, "Mowing");
  const edge = await ensureService(http, auth, "Edging");
  const old = await ensureService(http, auth, "Old service");
  const r = await http(`/api/field/task-types/${old.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ archived: true }),
  });
  await r.body?.cancel();
  return { mow, edge };
}

Deno.test("REQ-921: New invoice lines are a service dropdown + price with + and −; no 'What's it for' / 'Details'; the draft bills exactly the picked services", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { mow, edge } = await catalogue(http, auth);

    await page.goto("/invoices");
    await clickUntil(
      page,
      "[data-cy='invoice-new']",
      async () =>
        await page.locator("[data-cy='new-invoice-modal']").isVisible(),
    );
    const modal = page.locator("[data-cy='new-invoice-modal']");
    expect.eq(
      await modal.locator(
        "[data-cy='new-invoice-jobname'], [data-cy='new-invoice-description']",
      ).count(),
      0,
      "no 'What's it for' and no 'Details' field",
    );

    // one row to start; its service is the search picker over the live catalogue, A→Z
    const svc0 = "[data-cy='new-invoice-line-service-0']";
    await page.locator(`${svc0} [data-cy='search-select-input']`).waitFor({
      timeout: 15_000,
    });
    expect.eq(
      await modal.locator("[data-cy='new-invoice-line-0'] select").count(),
      0,
      "the service is not a plain <select>",
    );
    expect.eq(
      JSON.stringify(await pickerRows(page, svc0)),
      JSON.stringify(["Edging", "Mowing"]),
      "the picker lists the live services only (the archived one is out)",
    );
    // typing narrows it; REQ-979 (amends REQ-921): a name that is no service
    // offers to add it to the catalogue — it never bills as free text
    const box0 = page.locator(`${svc0} [data-cy='search-select-input']`);
    await box0.click();
    await box0.fill("mow");
    expect.eq(
      JSON.stringify(
        (await page.locator(`${svc0} [data-cy='search-select-label']`)
          .allInnerTexts()).map((t) => t.trim()),
      ),
      JSON.stringify(["Mowing"]),
      "typing narrows the services",
    );
    await box0.fill("Snow plowing");
    await page.locator(`${svc0} [data-cy='search-select-create']`).waitFor();
    expect.eq(
      (await page.locator(`${svc0} [data-cy='search-select-create']`)
        .innerText()).trim(),
      '+ Add "Snow plowing" as a service',
      "REQ-979: the only '+ Add' row adds a catalogue service (not picked here)",
    );
    await box0.fill("");
    await box0.press("Escape");

    // a row with no service picked is refused
    await page.locator("[data-cy='new-invoice-line-price-0']").fill("80");
    await page.locator("[data-cy='new-invoice-draft']").click();
    await modal.getByText("Pick a service on every line.").waitFor({
      timeout: 10_000,
    });

    // Mowing $80, + → Edging $25, + → a third row, − removes it
    await fillInvoiceLine(page, 0, mow, "80");
    await page.locator("[data-cy='new-invoice-line-add']").click();
    await fillInvoiceLine(page, 1, edge, "25");
    await page.locator("[data-cy='new-invoice-line-add']").click();
    await page.locator("[data-cy='new-invoice-line-2']").waitFor();
    await page.locator("[data-cy='new-invoice-line-remove-2']").click();
    expect.eq(
      await modal.locator("[data-cy^='new-invoice-line-service-']").count(),
      2,
      "− removed the third row",
    );
    expect.eq(
      await pickerShows(page, "[data-cy='new-invoice-line-service-1']"),
      "Edging",
      "the rows above keep their picks",
    );
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-total']")?.textContent ??
        "").includes("$105.00")
    );

    await page.locator("[data-cy='new-invoice-draft']").click();
    await modal.waitFor({ state: "detached", timeout: 15_000 });
    const invoices = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<Record<string, unknown>>;
    expect.eq(invoices.length, 1, "one invoice was saved");
    const inv = invoices[0];
    expect.eq(
      JSON.stringify(
        ((inv.lineItems ?? []) as Array<Record<string, unknown>>).map((l) => [
          l.description,
          l.quantity,
          l.price,
        ]),
      ),
      JSON.stringify([["Mowing", 1, 8000], ["Edging", 1, 2500]]),
      "the invoice bills the two picked services at their prices",
    );
    expect.eq(inv.jobName, "Mowing, Edging", "its name is the services billed");
    expect.eq(inv.amount, 10500, "$105.00");

    // Edit: the lines are the same picker, each showing its service
    await page.goto(`/invoices?open=${inv.id}`);
    const panel = page.locator("[data-cy='invoice-detail']");
    await clickUntil(
      page,
      "[data-cy='invoice-edit']",
      async () =>
        await panel.locator("[data-cy='invoice-edit-form']").isVisible(),
    );
    const edit0 = "[data-cy='invoice-edit-line-service-0']";
    await page.waitForFunction(
      (sel) =>
        (document.querySelector(`${sel} [data-cy='search-select-input']`) as
          | HTMLInputElement
          | null)?.value === "Mowing",
      edit0,
      { timeout: 15_000 },
    );
    expect.eq(
      JSON.stringify(await pickerRows(page, edit0)),
      JSON.stringify(["Edging", "Mowing"]),
      "the edit line picks from the same catalogue",
    );
  }));

Deno.test("REQ-921: a repeat visit picks its services from the search picker — no typing a new one — and a picked service leaves the list", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { mow } = await catalogue(http, auth);

    await page.goto("/field/subscriptions");
    await clickUntil(
      page,
      "[data-cy='subs-new']",
      async () =>
        await page.locator(
          "[data-cy='subs-service'] [data-cy='search-select-input']",
        ).isVisible(),
    );
    expect.eq(
      await page.locator("[data-cy='subs-type-q']").count(),
      0,
      "no free-text service box",
    );
    const sel = "[data-cy='subs-service']";
    expect.eq(
      JSON.stringify(await pickerRows(page, sel)),
      JSON.stringify(["Edging", "Mowing"]),
      "the visit's picker lists the live services only",
    );

    // + with nothing picked is refused
    await page.locator("[data-cy='subs-price']").fill("65");
    await page.locator("[data-cy='subs-add-item']").click();
    expect.eq(
      await page.locator("[data-cy='subs-error']").innerText(),
      "Pick a service on every line.",
      "a row needs a picked service",
    );

    await addVisitService(page, mow, "65");
    const rows = page.locator("[data-cy='subs-item']");
    await rows.first().waitFor({ timeout: 10_000 });
    expect.eq(await rows.count(), 1, "one service row");
    expect.eq(
      (await rows.first().locator(".name").innerText()).trim(),
      "Mowing",
      "the row is the picked service",
    );
    expect.eq(
      await pickerShows(page, sel),
      "",
      "the picker is empty again for the next service",
    );
    expect.eq(
      JSON.stringify(await pickerRows(page, sel)),
      JSON.stringify(["Edging"]),
      "a picked service leaves the picker",
    );
    await page.locator("[data-cy='subs-item-remove']").click();
    expect.eq(await rows.count(), 0, "− removed the row");
  }));
