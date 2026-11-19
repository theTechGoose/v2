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
  lang: "en" | "es" = "en",
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
    body: JSON.stringify({ language: lang }),
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

/**
 * REQ-1086 (LOOP-007 cycle 3, issue q3-9): the /customers hero lede printed
 * "$691 currently owed to you" ("$691 que te deben actualmente") while the
 * board card and the sidebar on the same screen read "$690.75" — the hero
 * rounded with its own maximumFractionDigits: 0. It must read to the cent and
 * agree with the card and the sidebar, in English and Spanish.
 */
const heroStory = (lang: "en" | "es") => (t: Deno.TestContext) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl, lang);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Rosa Hero", email: "rosa@example.test" }),
    })).json();
    if (!customer?.id) {
      throw new Error(`seed customer: ${JSON.stringify(customer)}`);
    }
    const job = `Fence repair ${digits()}`;
    const today = new Date().toISOString().slice(0, 10);
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
        issuedDate: today,
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

    await page.goto("/customers");
    const cardSel =
      `.ccard2[data-customer-id='${customer.id}'] .ccard2__bal-val`;
    const rowSel =
      `[data-cy='nav-customer-row'][data-id='${customer.id}'] [data-cy='nav-customer-line']`;
    await page.locator(cardSel).waitFor({ timeout: 20_000 });
    await page.locator(".ph2__sub strong").first().waitFor({
      timeout: 20_000,
    });
    await page.locator(rowSel).waitFor({ timeout: 20_000 });
    // one evaluate: the hero, the card and the sidebar read in one render
    const seen = await page.evaluate(
      ({ cardSel, rowSel }) => {
        const money = (s: string | null | undefined) =>
          (s ?? "").match(/\$[\d,]+(?:\.\d+)?/)?.[0] ?? "";
        const strongs = [
          ...document.querySelectorAll(".ph2__sub strong"),
        ].map((e) => e.textContent?.trim() ?? "");
        return {
          hero: strongs.find((s) => s.includes("$")) ?? "",
          heroLine: document.querySelector(".ph2__sub")?.textContent
            ?.replace(/\s+/g, " ").trim() ?? "",
          card: money(document.querySelector(cardSel)?.textContent),
          sidebar: money(document.querySelector(rowSel)?.textContent),
        };
      },
      { cardSel, rowSel },
    );
    expect.eq(
      JSON.stringify({
        hero: seen.hero,
        card: seen.card,
        sidebar: seen.sidebar,
      }),
      JSON.stringify({
        hero: "$690.75",
        card: "$690.75",
        sidebar: "$690.75",
      }),
      `the /customers hero (${lang}) reads money owed to the cent, like the card and the sidebar — hero line: "${seen.heroLine}"`,
    );
  });

Deno.test(
  "REQ-1086 (LOOP-007 q3, q3-9) en: the /customers hero reads $690.75 owed to the cent — a $1,190.75 invoice part-paid by $500 — the same as the board card and the sidebar",
  heroStory("en"),
);

Deno.test(
  "REQ-1086 (LOOP-007 q3, q3-9) es: the /customers hero reads $690.75 owed to the cent — a $1,190.75 invoice part-paid by $500 — the same as the board card and the sidebar",
  heroStory("es"),
);
