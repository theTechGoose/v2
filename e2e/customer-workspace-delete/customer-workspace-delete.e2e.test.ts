/**
 * REQ-1075 (LOOP-007 cycle 2, q2-65) — "No Delete action on the customer's own
 * page". In a browser: /customers/<id> → More → Delete customer asks inline
 * (REQ-802's question, Delete / Keep, no native dialog); Keep leaves her;
 * Delete soft-deletes (GET /api/customers/:id is 404), lands on /customers
 * with "{name} deleted", and she is gone from the board and the sidebar.
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
    body: JSON.stringify({ language: "en", name: "Workspace Delete Story" }),
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

const visible = (page: StoryTools["page"], sel: string) => async () =>
  (await page.locator(sel).count()) > 0 &&
  await page.locator(sel).first().isVisible();

async function openMenuAndAsk(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
) {
  await clickUntil(
    page,
    "[data-cy='cws-more']",
    visible(page, "[data-cy='cws-menu']"),
  );
  const item = page.locator("[data-cy='cws-menu'] [data-cy='cws-delete']");
  expect.eq(
    await item.count(),
    1,
    "the More menu offers Delete customer (cws-delete)",
  );
  if ((await item.count()) === 0) {
    const items = await page.locator("[data-cy='cws-menu'] [role='menuitem']")
      .allInnerTexts();
    throw new Error(
      `no cws-delete in the More menu; it holds ${
        JSON.stringify(items.map((s) => s.trim()))
      }`,
    );
  }
  expect.eq(
    (await item.innerText()).trim(),
    "Delete customer",
    "the item reads Delete customer",
  );
  await clickUntil(
    page,
    "[data-cy='cws-delete']",
    visible(page, "[data-cy='cws-delete-ask']"),
  );
}

Deno.test("REQ-1075 (q2-65): the customer's own page has More → Delete customer; Keep leaves her; Delete soft-deletes (404), lands on /customers with the flash, and she leaves the board and the sidebar", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Page Delete ${digits()}`;
    const r = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name, phoneNumber: `+1512${digits()}` }),
    });
    const c = await r.json();
    if (!r.ok) {
      throw new Error(`create customer → ${r.status} ${JSON.stringify(c)}`);
    }

    let nativeDialog = false;
    page.on("dialog", (d) => {
      nativeDialog = true;
      d.dismiss().catch(() => {});
    });

    await page.goto(`/customers/${c.id}`);
    await page.locator(
      `[data-cy='customer-workspace'][data-customer='${c.id}']`,
    ).waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='cws-more']").waitFor({ timeout: 20_000 });

    // Keep: the question goes, she stays
    await openMenuAndAsk(page, expect);
    expect(
      (await page.locator("[data-cy='cws-delete-ask']").innerText()).includes(
        name,
      ),
      "the question names the customer",
    );
    await page.locator("[data-cy='cws-delete-keep']").click();
    await page.locator("[data-cy='cws-delete-ask']").waitFor({
      state: "detached",
      timeout: 5_000,
    });
    const kept = await http(`/api/customers/${c.id}`, { headers: auth });
    await kept.body?.cancel();
    expect.eq(kept.status, 200, "Keep leaves the customer");
    expect.eq(
      new URL(page.url()).pathname,
      `/customers/${c.id}`,
      "Keep stays on her page",
    );

    // Delete: soft delete, back on the board with the flash
    await openMenuAndAsk(page, expect);
    await page.locator("[data-cy='cws-delete-yes']").click();
    await page.waitForURL((u) => u.pathname === "/customers", {
      timeout: 20_000,
    });
    await expect.see(`${name} deleted`);
    expect.eq(nativeDialog, false, "no native dialog was opened");
    const gone = await http(`/api/customers/${c.id}`, { headers: auth });
    await gone.body?.cancel();
    expect.eq(gone.status, 404, "the customer reads as not-found afterwards");
    await page.waitForTimeout(1_000);
    const left = await page.evaluate((id) => ({
      card: [...document.querySelectorAll(".ccard2")].filter((el) =>
        el.textContent?.includes(id.name)
      ).length,
      row: document.querySelectorAll(
        `[data-cy='nav-customer-row'][data-id='${id.id}']`,
      ).length,
    }), { id: c.id, name });
    expect.eq(left.card, 0, "she is gone from the board");
    expect.eq(left.row, 0, "she is gone from the sidebar");
  }));
