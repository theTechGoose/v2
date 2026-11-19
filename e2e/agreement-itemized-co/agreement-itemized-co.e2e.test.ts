/**
 * REQ-950 (LOOP-007 cycle 1, q1-24 [minor/BUG_CONTRADICTION]) — after the
 * customer approved CO-001 "Heated floor" (+$1,250, attached to the balance
 * invoice INV-002), the deposit invoice INV-001 on /i read "AGREEMENT VALUE
 * $24,500.00" under a table of $9,800 + $13,450 = $23,250, with no Heated
 * floor row: the agreement total counts the approved change order (REQ-679),
 * the itemization did not.
 *
 * The story reads the table rows and the agreement-value card in ONE
 * page.evaluate (the house rule against read races) and asserts the rows add
 * up to the card.
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
    body: JSON.stringify({ language: "en", name: "Tile Job Story" }),
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

const money = (s: string) =>
  Math.round(Number(s.replace(/[^0-9.-]/g, "")) * 100);

Deno.test("REQ-950 q1-24: after CO-001 Heated floor is approved, the deposit invoice's /i job-details rows add up to its AGREEMENT VALUE card ($24,500) and list the Heated floor row", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const priya = await call(http, auth, "POST", "/api/customers", {
      name: "Priya Raman",
      email: "priya@blackhole.postmarkapp.com",
    });
    const quote = await call(http, auth, "POST", "/api/quotes", {
      customerId: priya.id,
      summary: "Bathroom tile — Priya Raman",
      jobName: "Bathroom tile",
      lineItems: [
        {
          description: "Tile demo & prep",
          quantity: 1,
          unit: "job",
          price: 980_000,
        },
        {
          description: "Tile install",
          quantity: 1,
          unit: "job",
          price: 1_345_000,
        },
      ],
      estimatedTotal: 2_325_000,
      status: "draft",
    });
    await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "accepted",
      acceptedAt: new Date().toISOString(),
    });
    for (const inv of await call(http, auth, "GET", "/api/invoices")) {
      await call(http, auth, "DELETE", `/api/invoices/${inv.id}`);
    }
    // INV-001 the 20% deposit, INV-002 the balance — both sent
    const deposit = await call(http, auth, "POST", "/api/invoices", {
      quoteId: quote.id,
      customerId: priya.id,
      status: "sent",
      jobName: "Bathroom tile",
      amount: 465_000,
    });
    const balance = await call(http, auth, "POST", "/api/invoices", {
      quoteId: quote.id,
      customerId: priya.id,
      status: "sent",
      jobName: "Bathroom tile",
      amount: 1_860_000,
    });
    // CO-001 on the balance invoice, approved by Priya at her link
    const co = await call(
      http,
      auth,
      "POST",
      `/api/invoices/${balance.id}/change-orders`,
      {
        description: "Heated floor added under the tile",
        deltaAmountCents: 125_000,
      },
    );
    await call(
      http,
      JSON_HEADERS,
      "POST",
      `/api/change-orders/${co.id}/approve`,
      { name: "Priya Raman" },
    );

    await page.goto(`/i/${deposit.id}?lang=en`);
    await page.locator(".ctr__total-amt").first().waitFor({ timeout: 15_000 });
    // one evaluate: the card and the rows of the same section, one render
    const read = await page.evaluate(() => {
      const card = document.querySelector(".ctr__total-amt");
      const section = card?.closest("section");
      const rows = [...(section?.querySelectorAll("tbody tr") ?? [])].map(
        (tr) => {
          const cells = [...tr.querySelectorAll("td")].map((td) =>
            (td.textContent ?? "").trim()
          );
          return { description: cells[0] ?? "", amount: cells.at(-1) ?? "" };
        },
      );
      return { card: (card?.textContent ?? "").trim(), rows };
    });
    expect.eq(read.card, "$24,500.00", "the agreement value card");
    expect(
      read.rows.some((r) => /heated floor/i.test(r.description)),
      `the approved change order has a row (${JSON.stringify(read.rows)})`,
    );
    expect.eq(
      read.rows.reduce((s, r) => s + money(r.amount), 0),
      money(read.card),
      `the rows add up to the card (${JSON.stringify(read.rows)})`,
    );
  }));
