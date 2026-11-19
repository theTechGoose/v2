/**
 * REQ-1138 (LOOP-007 cycle 3, q3-69) — "Deleting a customer who still owes
 * money orphans the debt, and /customers disagrees with itself".
 *
 * Lucía has a $1,000.00 invoice, part-paid $179.33, so she owes $820.67;
 * Beto owes nothing. On /customers/<Lucía> → More → Delete customer the
 * question must say she still owes $820.67 (it said only "Their quotes and
 * invoices stay"). After the delete, the /customers headline owed figure must
 * equal what the "Owe you" chip / cards carry ($0 with "Owe you 0") — it read
 * "$821 currently owed" next to "Owe you 0" — in EN and ES. The /invoices card
 * of her invoice never links to the 404 customer.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
) {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: `+1512${digits()}`, code: "000000" }),
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
    body: JSON.stringify({ language: lang, name: "Delete Owes Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  return auth;
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${JSON.stringify(j)}`);
  return j;
}

/** Lucía owes $820.67 on a part-paid invoice; Beto owes nothing */
async function seed(http: StoryTools["http"], auth: Record<string, string>) {
  const lucia = await post(http, auth, "/api/customers", {
    name: `Lucía Owes ${digits()}`,
    phoneNumber: `+1512${digits()}`,
  });
  await post(http, auth, "/api/customers", {
    name: `Beto Settled ${digits()}`,
    phoneNumber: `+1512${digits()}`,
  });
  const job = `Fence repair ${digits()}`;
  const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  const inv = await post(http, auth, "/api/invoices", {
    customerId: lucia.id,
    jobName: job,
    status: "sent",
    dueDate: due,
    lineItems: [{ description: job, quantity: 1, unit: "job", price: 100000 }],
    amount: 100000,
  });
  await post(http, auth, "/api/payments", {
    invoiceId: inv.id,
    amount: 17933,
    method: "cash",
    receivedAt: new Date().toISOString(),
  });
  return { lucia, job, invId: inv.id as string };
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
      // not clickable yet
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

/** the hero's owed figure and the "Owe you" chip's count, read in ONE evaluate */
async function heroVsChip(page: StoryTools["page"], chipLabel: string) {
  await page.locator(".ph2__sub").waitFor({ timeout: 20_000 });
  await page.locator(".ctoolbar2__filter").first().waitFor({ timeout: 20_000 });
  return await page.evaluate((label) => {
    const sub = document.querySelector(".ph2__sub");
    const money = [...(sub?.querySelectorAll("strong") ?? [])]
      .map((s) => s.textContent?.trim() ?? "")
      .find((s) => s.startsWith("$")) ?? "";
    const chip = [...document.querySelectorAll(".ctoolbar2__filter")]
      .find((b) => b.textContent?.trim().startsWith(label));
    const count = chip?.querySelector(".ctoolbar2__filter-count")?.textContent
      ?.trim() ?? "";
    return {
      heroOwed: money,
      heroOwedNumber: Number(money.replace(/[^0-9.]/g, "")),
      oweYou: Number(count),
      sub: sub?.textContent?.replace(/\s+/g, " ").trim() ?? "",
    };
  }, chipLabel);
}

Deno.test("REQ-1138 (LOOP-007 q3, q3-69): EN — More → Delete on a customer who owes $820.67 says so; after Delete anyway the /customers hero owed agrees with 'Owe you'; the /invoices card never links to the deleted customer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, "en");
    const { lucia, job } = await seed(http, auth);

    await page.goto(`/customers/${lucia.id}`);
    await page.locator(
      `[data-cy='customer-workspace'][data-customer='${lucia.id}']`,
    ).waitFor({ timeout: 20_000 });
    await clickUntil(
      page,
      "[data-cy='cws-more']",
      visible(page, "[data-cy='cws-menu']"),
    );
    await clickUntil(
      page,
      "[data-cy='cws-delete']",
      visible(page, "[data-cy='cws-delete-ask']"),
    );
    const ask = (await page.locator("[data-cy='cws-delete-ask']").innerText())
      .replace(/\s+/g, " ").trim();
    expect(
      ask.includes("$820.67"),
      `the delete question says she still owes $820.67 — got "${ask}"`,
    );

    // "Delete anyway"
    await page.locator("[data-cy='cws-delete-yes']").click();
    await page.waitForURL((u) => u.pathname === "/customers", {
      timeout: 20_000,
    });
    const gone = await http(`/api/customers/${lucia.id}`, { headers: auth });
    await gone.body?.cancel();
    expect.eq(gone.status, 404, "Delete anyway deleted her");

    const en = await heroVsChip(page, "Owe you");
    expect.eq(en.oweYou, 0, "no customer on the board owes");
    expect.eq(
      en.heroOwedNumber,
      0,
      `the hero's owed figure agrees with "Owe you ${en.oweYou}" — got ${en.heroOwed} in "${en.sub}"`,
    );

    await page.goto("/invoices");
    const card = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-card-job']", { hasText: job }),
    }).first();
    await card.waitFor({ timeout: 20_000 });
    const links = await card.evaluate((el, id) =>
      [...el.querySelectorAll("a[href]")]
        .map((a) => a.getAttribute("href") ?? "")
        .filter((h) => h.includes(id)), lucia.id);
    expect.eq(
      links.length,
      0,
      `the invoice card never links to the deleted customer (${JSON.stringify(links)})`,
    );
  }));

Deno.test("REQ-1138 (LOOP-007 q3, q3-69): ES — after deleting a customer who owes $820.67 (force=1), the /customers hero owed agrees with 'Te deben'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, "es");
    const { lucia } = await seed(http, auth);
    const d = await http(`/api/customers/${lucia.id}?force=1`, {
      method: "DELETE",
      headers: auth,
    });
    if (!d.ok) throw new Error(`force delete: ${d.status} ${await d.text()}`);
    await d.body?.cancel();

    await page.goto("/customers");
    const es = await heroVsChip(page, "Te deben");
    expect.eq(es.oweYou, 0, "ningún cliente del tablero debe");
    expect.eq(
      es.heroOwedNumber,
      0,
      `the hero's owed figure agrees with "Te deben ${es.oweYou}" — got ${es.heroOwed} in "${es.sub}"`,
    );
  }));
