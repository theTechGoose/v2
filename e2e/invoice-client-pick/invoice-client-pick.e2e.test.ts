/**
 * REQ-201 / REQ-206 on the real shell — the standalone invoice form, the
 * number · version · state headline, the pending-revision publish, the paid
 * lock, and the quote-ledger deep link into the form.
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
    body: JSON.stringify({ language: "en", name: "Numbering Story" }),
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

async function mkCustomer(
  http: StoryTools["http"],
  auth: Record<string, string>,
  extra: Record<string, unknown> = {},
) {
  return await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Ann Lee",
      email: "ann.lee@blackhole.postmarkapp.com",
      phoneNumber: "+15125550199",
      address: "1 Main St, Austin, TX 78701",
      ...extra,
    }),
  })).json();
}

Deno.test("REQ-809: the new-invoice client box — focusing it (or any field) keeps the modal where it is, and clicking a client picks it and closes the list", (t) =>
  story(t, async ({ page, http, baseUrl, expect }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const ann = await mkCustomer(http, auth);
    for (let i = 0; i < 12; i++) {
      await mkCustomer(http, auth, { name: `Susan Filler ${i}` });
    }
    await page.goto("/invoices");
    await clickUntil(
      page,
      "[data-cy='invoice-new']",
      async () =>
        await page.locator("[data-cy='new-invoice-modal']").isVisible(),
    );
    const modalScroll = () =>
      page.evaluate(() =>
        (document.querySelector("[data-cy='new-invoice-modal']")!
          .parentElement as HTMLElement).scrollTop
      );
    const box = page.locator(
      "[data-cy='new-invoice-client'] [data-cy='search-select-input']",
    );
    await box.waitFor({ timeout: 15_000 });
    expect.eq(await modalScroll(), 0, "the modal opens at the top");

    // focus the client box: the modal stays put and the box stays in view
    await box.click();
    await page.waitForTimeout(700); // past the keyboard-reveal timers (60…500 ms)
    expect.eq(
      await modalScroll(),
      0,
      "focusing the client box does not scroll the modal",
    );
    expect(await box.isVisible(), "the client box is still in view");
    expect(
      (await page.locator(
        "[data-cy='new-invoice-client'] [data-cy='search-select-option']",
      ).count()) > 0,
      "the list is open with clients",
    );

    // click a client: it is picked and the list closes
    await box.fill("Ann");
    await page.locator(
      "[data-cy='new-invoice-client'] [data-cy='search-select-option']",
    ).filter({ hasText: "Ann Lee" }).first().click();
    await page.waitForTimeout(400);
    expect.eq(
      await page.locator(
        "[data-cy='new-invoice-client'] input[name='customerId']",
      ).inputValue(),
      ann.id,
      "the client is picked",
    );
    expect.eq(
      await page.locator(
        "[data-cy='new-invoice-client'] [data-cy='search-select-list']",
      ).count(),
      0,
      "the list closed on the pick",
    );
    expect.eq(
      await box.inputValue(),
      "C-001 · Ann Lee",
      "the box shows the pick",
    );
    expect.eq(
      await modalScroll(),
      0,
      "the pick does not scroll the modal either",
    );

    // any other field: the job name box does not scroll the modal to its submit button
    await page.locator("[data-cy='new-invoice-jobname']").click();
    await page.waitForTimeout(700);
    expect.eq(
      await modalScroll(),
      0,
      "focusing the job name does not scroll the modal",
    );
  }));
