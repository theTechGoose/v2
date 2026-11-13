/**
 * REQ-754 (demo-loop cycle 5v1, issue M5) on the real shell — the verifier's
 * situation: an open /customers tab, and INV-002 issued in another tab from
 * Nueva factura with no customer, only BILL TO "Jorge Ramirez". The open tab
 * stayed at "$100 currently owed" with no Jorge card 15 s later; only a
 * reload updated it. Now the owner's write is announced to his other tabs
 * and the /customers tab re-reads at once.
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
    body: JSON.stringify({ language: "en", name: "Live Roster Story" }),
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

Deno.test("REQ-754 M5 (cycle 5v1): an invoice issued to a typed BILL TO name in one tab shows up on the open /customers tab — new card and the same hero a reload shows — with no reload", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    // INV-001: Ana owes $100
    const ana = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Ana Torres",
        email: "ana.torres@blackhole.postmarkapp.com",
      }),
    })).json();
    const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(
      0,
      10,
    );
    const inv1 = await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: ana.id,
        amount: 10000,
        dueDate: due,
        status: "sent",
        jobName: "Fence repair",
      }),
    });
    await inv1.body?.cancel();

    // the open /customers tab
    await page.goto("/customers");
    await expect.see("Ana Torres");
    await expect.notSee("Jorge Ramirez");
    const heroBefore = await page.locator(".ph2").first().innerText();
    // let the islands hydrate and follow the change feed
    await page.waitForTimeout(1_500);

    // another tab: Nueva factura, no customer, BILL TO "Jorge Ramirez", $100, Issue
    const other = await page.context().newPage();
    await other.goto(new URL("/invoices", baseUrl).href);
    await clickUntil(
      other,
      "[data-cy='invoice-new']",
      async () =>
        await other.locator("[data-cy='new-invoice-modal']").isVisible(),
    );
    await other.locator("[data-cy='new-invoice-client']").selectOption("");
    await other.locator("[data-cy='new-invoice-bill-name']").fill(
      "Jorge Ramirez",
    );
    await other.locator("[data-cy='new-invoice-jobname']").fill(
      "Gate install",
    );
    await other.locator("[data-cy='new-invoice-amount']").fill("100");
    await other.locator("[data-cy='new-invoice-submit']").click();
    await other.locator("[data-cy='new-invoice-modal']").waitFor({
      state: "detached",
      timeout: 15_000,
    });
    const list = await (await http("/api/invoices", { headers: auth }))
      .json() as Array<Record<string, unknown>>;
    expect.eq(list.length, 2, "INV-002 was created");

    // the /customers tab, NOT reloaded: Jorge's card within 10 s
    let live = false;
    for (let i = 0; i < 50 && !live; i++) {
      live = (await page.locator("body").innerText()).includes("Jorge Ramirez");
      if (!live) await page.waitForTimeout(200);
    }
    expect(
      live,
      "the open /customers tab shows Jorge Ramirez without a reload",
    );
    const heroLive = await page.locator(".ph2").first().innerText();

    // the hero is what a fresh load says
    const fresh = await page.context().newPage();
    await fresh.goto(new URL("/customers", baseUrl).href);
    await fresh.locator("text=Jorge Ramirez").first().waitFor({
      timeout: 15_000,
    });
    const heroFresh = await fresh.locator(".ph2").first().innerText();
    expect.eq(
      heroLive,
      heroFresh,
      `the live hero matches a reload (before: ${JSON.stringify(heroBefore)})`,
    );
  }));
