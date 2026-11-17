/**
 * REQ-655 (demo-loop cycle 5, p18-9c + M12) — extra work on a job whose every
 * invoice is paid. Pair 9 opened Q-001 → "New change order" and got "Every
 * invoice on this job is paid, so a change order has nowhere to go" with a
 * bare "New invoice" link: a blank invoice, not linked to the job.
 *
 * Now the signed quote's panel says "Bill extra work" up front, and it opens
 * the new invoice prefilled with the customer, linked to Q-001; saving it is
 * not refused by the agreement cap (REQ-233) — the extra work is on purpose.
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
    body: JSON.stringify({ language: "en", name: "Paid Job Story" }),
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

async function call(
  http: StoryTools["http"],
  headers: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
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
      // the button is gone or not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

Deno.test("REQ-655 p18-9c: a fully paid job's panel says 'Bill extra work' and opens a new invoice for that customer, linked to the job, that saves", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const ana = await call(http, auth, "POST", "/api/customers", {
      name: "Ana Torres",
      email: "ana@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: ana.id,
      summary: "Lawn mowing — Ana Torres",
      jobName: "Lawn mowing",
      lineItems: [{
        description: "Lawn mowing",
        quantity: 1,
        unit: "job",
        price: 8000,
      }],
      estimatedTotal: 8000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
    for (const inv of await call(http, auth, "GET", "/api/invoices")) {
      await call(http, auth, "DELETE", `/api/invoices/${inv.id}`);
    }
    // INV-001 bills the whole job and is paid
    await call(http, auth, "POST", "/api/invoices", {
      quoteId: quote.id,
      customerId: ana.id,
      status: "paid",
      paidAt: new Date().toISOString(),
      jobName: "Lawn mowing",
      amount: 8000,
    });

    // 1) the panel offers "Bill extra work" before any click — no
    //    "New change order" that leads to a refusal
    await page.goto(`/quotes?open=${quote.id}`);
    await page.locator("[data-cy='quote-lock-note']").waitFor({
      timeout: 15_000,
    });
    const bill = page.locator("[data-cy='quote-bill-extra-work']");
    await bill.waitFor({ timeout: 15_000 });
    expect.eq((await bill.innerText()).trim(), "Bill extra work", "its label");
    expect.eq(
      await page.locator("[data-cy='quote-new-change-order']").count(),
      0,
      "no change-order button on a paid-off job",
    );
    expect(
      ((await bill.getAttribute("href")) ?? "").includes(
        `quoteId=${quote.id}`,
      ),
      "the link carries the job",
    );

    // 2) it opens the new invoice, prefilled with Ana and linked to Q-001
    const modal = page.locator("[data-cy='new-invoice-modal']");
    await clickUntil(
      page,
      "[data-cy='quote-bill-extra-work']",
      async () => (await modal.count()) > 0,
    );
    const client = page.locator("[data-cy='new-invoice-client']");
    for (let i = 0; i < 50 && (await client.inputValue()) !== ana.id; i++) {
      await page.waitForTimeout(200);
    }
    expect.eq(await client.inputValue(), ana.id, "the customer is prefilled");
    await page.locator("[data-cy='new-invoice-jobname']").fill(
      "Hedge trimming",
    );
    await page.locator("[data-cy='new-invoice-amount']").fill("45");
    await page.locator("[data-cy='new-invoice-draft']").click();
    await modal.waitFor({ state: "detached", timeout: 15_000 });

    // 3) the new invoice is on the job — the agreement cap did not refuse it
    const onJob = (await call(http, auth, "GET", "/api/invoices"))
      .filter((i: { quoteId?: string }) => i.quoteId === quote.id);
    expect.eq(onJob.length, 2, "INV-001 and the extra-work invoice");
    const extra = onJob.find((i: { status?: string }) => i.status !== "paid");
    expect.eq(extra?.amount, 4500, "$45.00");
    expect.eq(extra?.customerId, ana.id, "billed to Ana");
  }));
