/**
 * REQ-798 — the dashboard's money bar, in a browser: a sent quote, a won quote with no invoice,
 * an overdue, an open and a paid invoice; the five columns carry the amounts and counts; the
 * overdue invoice is listed by default; the paid segment lists the paid invoice; the estimates
 * column lists the quote and its row opens /quotes?open=<id>.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

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
    body: JSON.stringify({ language: "en", name: "Money Bar" }),
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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: Record<string, unknown>,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
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

const col = (k: string) => `[data-cy='money-col'][data-bucket='${k}']`;
const seg = (k: string) => `[data-cy='money-seg'][data-bucket='${k}']`;
const rows = "[data-cy='money-row']";

Deno.test("REQ-798: the dashboard's money bar shows estimates / unbilled / overdue / open / paid with their counts; the overdue invoice is listed first; the paid segment lists the paid invoice; the estimates column lists the quote and opens it", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Money Bar" });
    const ana = await post(http, auth, "/api/customers", {
      name: "Ana Torres",
    });
    const bo = await post(http, auth, "/api/customers", { name: "Bo Reyes" });

    const sent = await post(http, auth, "/api/quotes", {
      customerId: ana.id,
      jobName: "Fence stain",
      summary: "Fence stain",
      lineItems: [{
        description: "Stain",
        quantity: 1,
        unit: "job",
        price: 120_000,
      }],
      estimatedTotal: 120_000,
    });
    // a POST with status "sent" is filed as a draft; the send is a PUT (quote-controller)
    await (await http(`/api/quotes/${sent.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    })).body?.cancel();
    // a won job with nothing billed yet: accept bills the agreed terms, so
    // those bills are dropped (as the REQ-473 story does) to leave it unbilled
    const won = await post(http, auth, "/api/quotes", {
      customerId: bo.id,
      jobName: "Deck build",
      summary: "Deck build",
      lineItems: [{
        description: "Deck",
        quantity: 1,
        unit: "job",
        price: 500_000,
      }],
      estimatedTotal: 500_000,
      status: "draft",
    });
    await (await http(`/api/quotes/${won.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        status: "accepted",
        acceptedAt: new Date().toISOString(),
      }),
    })).body?.cancel();
    for (
      const inv of await (await http("/api/invoices", { headers: auth }))
        .json()
    ) {
      await (await http(`/api/invoices/${inv.id}`, {
        method: "DELETE",
        headers: auth,
      })).body?.cancel();
    }
    const overdue = await post(http, auth, "/api/invoices", {
      customerId: ana.id,
      status: "sent",
      jobName: "Gutter clean",
      amount: 50_000,
      issuedDate: daysFromNow(-20),
      dueDate: daysFromNow(-3),
    });
    await post(http, auth, "/api/invoices", {
      customerId: ana.id,
      status: "sent",
      jobName: "Window wash",
      amount: 30_000,
      issuedDate: daysFromNow(0),
      dueDate: daysFromNow(20),
    });
    const paid = await post(http, auth, "/api/invoices", {
      customerId: bo.id,
      status: "paid",
      paidAt: new Date().toISOString(),
      jobName: "Pressure wash",
      amount: 65_000,
      issuedDate: daysFromNow(-10),
      dueDate: daysFromNow(5),
    });

    await page.goto("/dashboard");
    await page.locator(col("overdue")).waitFor({ timeout: 20_000 });

    // 1. the five columns: amount over "n <bucket>"
    const text = async (sel: string) =>
      (await page.locator(sel).innerText()).replace(/\s+/g, " ").trim();
    expect.eq(
      await text(col("estimates")),
      "$1,200 1 estimate out",
      "estimates column",
    );
    expect.eq(
      await text(col("unbilled")),
      "$5,000 1 job not yet billed",
      "unbilled column",
    );
    expect.eq(
      await text(col("overdue")),
      "$500 1 overdue invoice",
      "overdue column",
    );
    expect.eq(await text(col("open")), "$300 1 open invoice", "open column");
    expect.eq(
      await text(col("paid")),
      "$650 1 paid in the last 30 days",
      "paid column",
    );
    await expect.see("$800"); // owed = overdue + open

    // 2. overdue is selected by default and lists the overdue invoice
    const first = await text(rows);
    expect(
      first.includes("Ana Torres"),
      `the overdue row names the customer (${first})`,
    );
    expect(
      first.includes(overdue.number),
      `the overdue row carries ${overdue.number} (${first})`,
    );
    expect(
      first.includes("3 days overdue") || first.includes("overdue"),
      `the row says overdue (${first})`,
    );
    expect(first.includes("$500"), `the row shows the balance (${first})`);
    expect.eq(
      await page.locator(seg("overdue")).getAttribute("aria-pressed"),
      "true",
      "the overdue segment is pressed",
    );

    // 3. the paid segment lists the paid invoice
    await clickUntil(
      page,
      seg("paid"),
      async () =>
        (await page.locator(rows).count()) === 1 &&
        (await text(rows)).includes(paid.number),
    );
    const paidRow = await text(rows);
    expect(
      paidRow.includes("Bo Reyes") && paidRow.includes("$650"),
      `the paid row (${paidRow})`,
    );
    expect(
      paidRow.includes("Paid"),
      `the paid row says when it was paid (${paidRow})`,
    );

    // 4. the estimates column lists the quote; its row opens the quote
    await clickUntil(
      page,
      col("estimates"),
      async () => (await text(rows).catch(() => "")).includes(sent.number),
    );
    const quoteRow = await text(rows);
    // the column and the segment follow the pick (not only the list)
    expect.eq(
      await page.locator(seg("estimates")).getAttribute("aria-pressed"),
      "true",
      "the estimates segment is pressed",
    );
    expect(
      ((await page.locator(col("estimates")).getAttribute("class")) ?? "")
        .includes("moneybar__col--on"),
      "the estimates column is highlighted",
    );
    expect.eq(
      await page.locator(seg("paid")).getAttribute("aria-pressed"),
      "false",
      "the paid segment is released",
    );
    expect(
      quoteRow.includes("Ana Torres") && quoteRow.includes("$1,200"),
      `the quote row (${quoteRow})`,
    );
    await page.locator(rows).first().click();
    await page.waitForURL(
      (u) => u.pathname === "/quotes" && u.searchParams.get("open") === sent.id,
      { timeout: 15_000 },
    );
  }));
