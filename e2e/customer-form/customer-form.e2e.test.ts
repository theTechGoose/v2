/**
 * REQ-625 — "They tried to do a new customer and it only allows them to add
 * the name and phone." In a browser: the Clients page's New customer form has
 * every field A2Z's QuickBooks customers carry (name, company, phone, email,
 * street, city, state, zip) plus notes; the saved customer shows its address;
 * the client's card → Open card → Edit opens the same form prefilled and the
 * change shows at once; on a phone the form stacks without clipping.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es" = "en",
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "A2Z Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  return { auth };
}

/** an island may still be hydrating when its button appears: click until the effect lands */
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
      // not clickable yet — the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

const visible = (page: StoryTools["page"], sel: string) => async () =>
  (await page.locator(sel).count()) > 0 &&
  await page.locator(sel).first().isVisible();

Deno.test("REQ-625: Clients → New customer takes name, company, phone, email, street, city, state, zip and notes; the customer shows its address; Open card → Edit changes it and it shows at once", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Maria Lopez ${digits()}`;
    await page.goto("/customers");
    await page.locator(".ph2__cta").waitFor({ timeout: 20_000 });
    await clickUntil(
      page,
      ".ph2__cta",
      visible(page, "[data-cy='customer-form']"),
    );
    await expect.see("New customer");
    for (
      const cy of [
        "cf-name",
        "cf-business",
        "cf-phone",
        "cf-email",
        "cf-street",
        "cf-city",
        "cf-state",
        "cf-zip",
        "cf-notes",
      ]
    ) {
      expect(
        await page.locator(`[data-cy='${cy}']`).isVisible(),
        `the form has ${cy}`,
      );
    }
    const form = page.locator("[data-cy='customer-form']");
    await form.locator("[data-cy='cf-name']").fill(name);
    await form.locator("[data-cy='cf-business']").fill("Lopez Properties LLC");
    // an international number is kept as typed (lenient phone)
    await form.locator("[data-cy='cf-phone']").fill("+52 55 1234 5678");
    await form.locator("[data-cy='cf-email']").fill(
      "maria@blackhole.postmarkapp.com",
    );
    await form.locator("[data-cy='cf-street']").fill("4410 Ranch Rd");
    await form.locator("[data-cy='cf-city']").fill("Austin");
    await form.locator("[data-cy='cf-state']").fill("TX");
    await form.locator("[data-cy='cf-zip']").fill("78735");
    await form.locator("[data-cy='cf-notes']").fill("Gate code 4411");
    expect.eq(
      await form.locator("[data-cy='cf-phone']").inputValue(),
      "+52 55 1234 5678",
      "the phone is not cut to ten digits",
    );
    await form.locator("[data-cy='cf-save']").click();
    await page.locator("[data-cy='customer-form']").waitFor({
      state: "detached",
      timeout: 15_000,
    });

    // stored: the parts and the composed address
    const list = await (await http("/api/customers", { headers: auth })).json();
    const saved = list.find((c: { name: string }) => c.name === name);
    expect(!!saved, "the customer was saved");
    expect.eq(
      saved.address,
      "4410 Ranch Rd, Austin, TX 78735",
      "the composed address",
    );
    expect.eq(saved.businessName, "Lopez Properties LLC", "the company");
    expect.eq(saved.phoneNumber, "+52 55 1234 5678", "the phone as typed");
    expect.eq(saved.notes, "Gate code 4411", "the notes");

    // on the board (REQ-799: the page has no search box; the card is on page one): its panel shows the address
    const card = page.locator(".ccard2", { hasText: name });
    await card.waitFor({ timeout: 15_000 });
    await clickUntil(
      page,
      `.ccard2:has-text("${name}") .ccard2__name`,
      async () => (await page.locator(".ccard2--open").count()) > 0,
    );
    await expect.see("4410 Ranch Rd, Austin, TX 78735");

    // REQ-625/626: Open card → the sheet → Edit → the same form, prefilled
    await clickUntil(
      page,
      ".ccard2--open [data-cy='ccard2-open']",
      visible(page, "[data-cy='client-sheet']"),
    );
    await expect.see("Gate code 4411");
    await page.locator("[data-cy='client-sheet-edit']").click();
    const edit = page.locator("[data-cy='customer-form'][data-mode='edit']");
    await edit.waitFor({ timeout: 10_000 });
    await expect.see("Edit customer");
    expect.eq(
      await edit.locator("[data-cy='cf-city']").inputValue(),
      "Austin",
      "prefilled city",
    );
    expect.eq(
      await edit.locator("[data-cy='cf-street']").inputValue(),
      "4410 Ranch Rd",
      "prefilled street",
    );
    await edit.locator("[data-cy='cf-street']").fill("88 Creek Bend");
    await edit.locator("[data-cy='cf-city']").fill("Round Rock");
    await edit.locator("[data-cy='cf-zip']").fill("78664");
    await edit.locator("[data-cy='cf-save']").click();
    await edit.waitFor({ state: "detached", timeout: 15_000 });
    // shows at once — in the sheet, no reload
    await page.locator("[data-cy='client-sheet-address']", {
      hasText: "88 Creek Bend, Round Rock, TX 78664",
    }).waitFor({ timeout: 10_000 });
    const got =
      await (await http(`/api/customers/${saved.id}`, { headers: auth }))
        .json();
    expect.eq(
      got.address,
      "88 Creek Bend, Round Rock, TX 78664",
      "saved via PUT /customers/:id",
    );
    expect.eq(got.number, saved.number, "the customer keeps its number");
    // and on the board, once the sheet is closed
    await page.locator("[data-cy='client-sheet-close']").click();
    await page.locator(".ccard2", { hasText: name }).waitFor();
    await clickUntil(
      page,
      `.ccard2:has-text("${name}") .ccard2__name`,
      async () => (await page.locator(".ccard2--open").count()) > 0,
    );
    await expect.see("88 Creek Bend, Round Rock, TX 78664");
  }));

Deno.test("REQ-625: on a phone (390px) the New customer form stacks — every field inside the dialog, none overlapping; in Spanish too", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl, "es");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/customers");
    await page.locator(".ph2__cta").waitFor({ timeout: 20_000 });
    await clickUntil(
      page,
      ".ph2__cta",
      visible(page, "[data-cy='customer-form']"),
    );
    await expect.see("Nuevo cliente");
    await expect.see("Calle y número");
    await expect.see("Código postal");
    const form = page.locator("[data-cy='customer-form']");
    const box = (await form.boundingBox())!;
    expect(
      box.x >= 0 && box.x + box.width <= 390 + 0.5,
      `the dialog fits the screen (${box.x}+${box.width})`,
    );
    const boxes: Array<
      { cy: string; x: number; y: number; width: number; height: number }
    > = [];
    for (
      const cy of [
        "cf-name",
        "cf-business",
        "cf-phone",
        "cf-email",
        "cf-street",
        "cf-city",
        "cf-state",
        "cf-zip",
        "cf-notes",
      ]
    ) {
      const b = (await form.locator(`[data-cy='${cy}']`).boundingBox())!;
      expect(
        b.x >= box.x && b.x + b.width <= box.x + box.width + 0.5,
        `${cy} inside the dialog (${b.x}..${b.x + b.width} in ${box.x}..${
          box.x + box.width
        })`,
      );
      expect(b.width >= 80, `${cy} is wide enough to type in (${b.width}px)`);
      boxes.push({ cy, ...b });
    }
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width &&
          a.y < b.y + b.height && b.y < a.y + a.height;
        expect(!overlap, `${a.cy} and ${b.cy} do not overlap`);
      }
    }
    // the save button is reachable
    await form.locator("[data-cy='cf-save']").scrollIntoViewIfNeeded();
    expect(
      await form.locator("[data-cy='cf-save']").isVisible(),
      "Guardar is reachable",
    );
  }));
