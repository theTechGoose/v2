/**
 * REQ-1072 (LOOP-007 cycle 2, issue q2-61) — Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it green."
 *
 * A $1,190.75 invoice: the customer page's owes KPI read "$1,190.75" while
 * FACTURADO (TOTAL) beside it read "$1,191". After a $500 payment the owes
 * KPI read "$690.75", the /customers board card "$691 due" and the /invoices
 * hero "$691" next to the Out tile's "$690.75". Every one of them must read
 * to the cent (REQ-961 fmtMoneyTotal rule).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const CENTS = 119_075;
const PAID = 50_000;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
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
  if (!cookie) throw new Error(`sign-in: no cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, { name: "Cents Customer Story" });
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

Deno.test("REQ-1072 q2-61: a $1,190.75 invoice part-paid by $500 reads to the cent on /customers/<id> KPIs, the /customers board and the /invoices hero", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Rosa Cents", email: "rosa@example.test" }),
    })).json();
    if (!customer?.id) {
      throw new Error(`seed customer: ${JSON.stringify(customer)}`);
    }
    const job = `Fence repair ${digits()}`;
    const due = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(
      0,
      10,
    );
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        jobName: job,
        status: "sent",
        // a sent invoice carries its issue date, as the UI's Send sets it; without it a
        // part-paid invoice (status "pending") reads as a draft on /invoices
        issuedDate: new Date().toISOString().slice(0, 10),
        dueDate: due,
        lineItems: [{
          description: job,
          quantity: 1,
          unit: "job",
          price: CENTS,
        }],
        amount: CENTS,
      }),
    })).json();
    if (!inv?.id) throw new Error(`seed invoice: ${JSON.stringify(inv)}`);

    const kpis = async () => {
      await page.goto(`/customers/${customer.id}`);
      const owed = page.locator("[data-cy='cws-owed-amount']");
      await owed.waitFor({ timeout: 20_000 });
      await page.waitForFunction(
        () =>
          /\$\d/.test(
            document.querySelector("[data-cy='cws-owed-amount']")
              ?.textContent ?? "",
          ),
        undefined,
        { timeout: 20_000 },
      );
      return await page.evaluate(() => ({
        owed: document.querySelector("[data-cy='cws-owed-amount']")?.textContent
          ?.trim(),
        billed: document.querySelector("[data-cy='cws-billed'] .cws-kpi__val")
          ?.textContent?.trim(),
        paid: document.querySelector("[data-cy='cws-paid'] .cws-kpi__val")
          ?.textContent?.trim(),
      }));
    };

    const before = await kpis();

    const pay = await http("/api/payments", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        invoiceId: inv.id,
        amount: PAID,
        method: "check",
        receivedAt: new Date().toISOString(),
      }),
    });
    if (!pay.ok) {
      throw new Error(`seed payment: ${pay.status} ${await pay.text()}`);
    }
    await pay.body?.cancel();

    const after = await kpis();

    // /customers board card
    await page.goto("/customers");
    const cardSel =
      `.ccard2[data-customer-id='${customer.id}'] .ccard2__bal-val`;
    await page.locator(cardSel).waitFor({ timeout: 20_000 });
    const board = (await page.locator(cardSel).innerText()).trim();

    // /invoices hero vs the Out tile
    await page.goto("/invoices");
    const hero = page.locator("[data-cy='forecast-hero'] em").first();
    await hero.waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      () =>
        /\$\d/.test(
          document.querySelector("[data-cy='forecast-hero'] em")?.textContent ??
            "",
        ),
      undefined,
      { timeout: 20_000 },
    );
    const heroAmt = (await hero.innerText()).trim();

    expect.eq(
      JSON.stringify({
        beforeOwed: before.owed,
        beforeBilled: before.billed,
        afterOwed: after.owed,
        afterBilled: after.billed,
        afterPaid: after.paid,
        board,
        hero: heroAmt,
      }),
      JSON.stringify({
        beforeOwed: "$1,190.75",
        beforeBilled: "$1,190.75",
        afterOwed: "$690.75",
        afterBilled: "$1,190.75",
        afterPaid: "$500",
        board: "$690.75 due",
        hero: "$690.75",
      }),
      "the customer page's owes/billed/paid KPIs, the board card and the /invoices hero all reconcile to the cent",
    );
  }));
