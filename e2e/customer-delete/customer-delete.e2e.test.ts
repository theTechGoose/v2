/**
 * REQ-802 — "the customers tab has no delete customer tab on the customer
 * cards." In a browser: a card's panel carries Delete customer; the inline
 * question's Delete removes the card (soft delete — GET /api/customers/:id is
 * 404) and flashes "{name} deleted"; Keep leaves another card in place.
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Delete Story" }),
  })).body?.cancel();
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

/** REQ802_SHOTS=<dir>: two extra stills (the panel, the question) for the evidence write-up */
async function still(page: StoryTools["page"], name: string) {
  const dir = Deno.env.get("REQ802_SHOTS");
  if (!dir) return;
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${dir}/${name}.png` });
}

const visible = (page: StoryTools["page"], sel: string) => async () =>
  (await page.locator(sel).count()) > 0 &&
  await page.locator(sel).first().isVisible();

Deno.test("REQ-802: a customer card's panel has Delete customer; Delete removes the card (soft delete, 404 afterwards) and flashes; Keep leaves the card", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const goneName = `Gone Customer ${digits()}`;
    const keptName = `Kept Customer ${digits()}`;
    const mk = async (name: string) =>
      (await http("/api/customers", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ name, phoneNumber: `+1512${digits()}` }),
      })).json();
    const gone = await mk(goneName);
    const kept = await mk(keptName);

    await page.goto("/customers");
    const goneCard = page.locator(".ccard2", { hasText: goneName });
    const keptCard = page.locator(".ccard2", { hasText: keptName });
    await goneCard.waitFor({ timeout: 20_000 });
    await keptCard.waitFor({ timeout: 20_000 });

    // open the panel: the Delete customer action is there
    await goneCard.locator(".ccard2__body").click();
    await goneCard.locator("[data-cy='ccard2-delete']").waitFor({
      timeout: 10_000,
    });
    await goneCard.locator("[data-cy='ccard2-delete']")
      .scrollIntoViewIfNeeded();
    await still(page, "panel-delete-action");
    expect.eq(
      (await goneCard.locator("[data-cy='ccard2-delete']").innerText())
        .trim(),
      "Delete customer",
      "the action reads Delete customer",
    );
    // the inline question, then Delete
    await clickUntil(
      page,
      `.ccard2:has-text("${goneName}") [data-cy='ccard2-delete']`,
      visible(
        page,
        `.ccard2:has-text("${goneName}") [data-cy='ccard2-delete-ask']`,
      ),
    );
    expect(
      (await goneCard.locator("[data-cy='ccard2-delete-ask']").innerText())
        .includes(goneName),
      "the question names the customer",
    );
    // the panel scrolls as a whole (REQ-419): the question scrolls itself into
    // view, so Delete / Keep sit inside the card's box without a hunt
    const yes = goneCard.locator("[data-cy='ccard2-delete-yes']");
    let inView = false;
    for (let i = 0; i < 20 && !inView; i++) {
      const card = await goneCard.boundingBox();
      const btn = await yes.boundingBox();
      inView = !!card && !!btn && btn.y >= card.y &&
        btn.y + btn.height <= card.y + card.height + 1;
      if (!inView) await page.waitForTimeout(100);
    }
    expect(inView, "Delete / Keep scrolled into the card's view");
    await still(page, "panel-delete-ask");
    await yes.click();
    await goneCard.waitFor({ state: "detached", timeout: 15_000 });
    expect.eq(
      await page.locator(".ccard2", { hasText: goneName }).count(),
      0,
      "the deleted card is gone from the board",
    );
    expect.eq(
      await keptCard.count(),
      1,
      "the other card is still there",
    );
    await expect.see(`${goneName} deleted`);
    const r = await http(`/api/customers/${gone.id}`, { headers: auth });
    await r.body?.cancel();
    expect.eq(r.status, 404, "the customer reads as not-found afterwards");

    // Keep on another card leaves it in place
    await keptCard.locator(".ccard2__body").click();
    await clickUntil(
      page,
      `.ccard2:has-text("${keptName}") [data-cy='ccard2-delete']`,
      visible(
        page,
        `.ccard2:has-text("${keptName}") [data-cy='ccard2-delete-ask']`,
      ),
    );
    await keptCard.locator("[data-cy='ccard2-delete-keep']").click();
    await keptCard.locator("[data-cy='ccard2-delete-ask']").waitFor({
      state: "detached",
      timeout: 5_000,
    });
    expect.eq(await keptCard.count(), 1, "Keep leaves the card");
    const k = await http(`/api/customers/${kept.id}`, { headers: auth });
    await k.body?.cancel();
    expect.eq(k.status, 200, "the kept customer still reads");
  }));
