/**
 * REQ-1090 (LOOP-007 cycle 3, issue q3-17) — Raphael: "test every single
 * aspect of this application … one Opus agent per issue to do root cause
 * analysis, then one to write the test, then one to fix it and make it green."
 *
 * After a deposit + balance agreement is signed, the deposit invoice is sent
 * and the balance invoice is "scheduled" (not out with the customer yet). The
 * customer page's "Billed (lifetime)" tile showed the deposit amount only, but
 * its hint read "Invoices: 2" — the scheduled balance was counted, not summed.
 * The count must cover the same invoices as the amount: "Invoices: 1".
 *
 * Pages: /q/[id] accept → SendSignedConfirmation (deposit sent + balance
 * scheduled), /customers/<id> (front-end/islands/CustomerWorkspace.tsx, the
 * `[data-cy='cws-billed']` tile; amount from backend workspaceSummary).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

type Lang = "en" | "es";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: Lang,
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
  await answerQuestions(http, auth, { name: "Billed Count Story" });
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

/** a $2,400 50/50 quote signed on /q: deposit $1,200 sent + balance $1,200 scheduled */
async function signedDepositAndBalance(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Dana Whitfield",
      email: "dana.whitfield@blackhole.postmarkapp.com",
      phoneNumber: "+15125550233",
    }),
  })).json();
  if (!customer?.id) throw new Error(`seed customer: ${JSON.stringify(customer)}`);
  const quote = await (await http("/api/quotes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      summary: "Interior paint — 3 rooms",
      jobName: "Interior paint",
      customerId: customer.id,
      lineItems: [{
        description: "Paint 3 rooms",
        quantity: 1,
        unit: "job",
        price: 240000,
      }],
      estimatedTotal: 240000,
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "50 / 50",
      }],
      status: "sent",
    }),
  })).json();
  const sent = await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ status: "sent" }),
  });
  await sent.body?.cancel();
  const accept = await http(`/api/quotes/${quote.id}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Dana Whitfield", signature: SIGNATURE_PNG }),
  });
  await accept.body?.cancel();
  if (accept.status >= 400) throw new Error(`accept: ${accept.status}`);
  const all = await (await http("/api/invoices", { headers: auth }))
    .json() as Array<{ quoteId?: string; amount?: number; status?: string }>;
  const deal = all
    .filter((i) => i.quoteId === quote.id && i.status !== "void")
    .map((i) => `${i.status}:${i.amount}`)
    .sort();
  return { customerId: customer.id as string, deal };
}

const EXPECT: Record<Lang, { billed: string; hint: string }> = {
  en: { billed: "$1,200", hint: "Invoices: 1" },
  es: { billed: "$1,200", hint: "Facturas: 1" },
};

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1090 q3-17 (${lang}): after a 50/50 agreement is signed (deposit sent, balance scheduled), the 'Billed (lifetime)' tile counts the invoices it sums — ${EXPECT[lang].billed} · ${EXPECT[lang].hint}, not 2`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const auth = await signIn(http, page, baseUrl, lang);
      const { customerId, deal } = await signedDepositAndBalance(http, auth);
      // the precondition QA saw: one sent deposit and one scheduled balance
      expect.eq(
        JSON.stringify(deal),
        JSON.stringify(["scheduled:120000", "sent:120000"]),
        "the signed 50/50 agreement billed a sent deposit and a scheduled balance",
      );

      await page.goto(`/customers/${customerId}`);
      await page.locator("[data-cy='cws-billed']").waitFor({ timeout: 20_000 });
      await page.waitForFunction(
        () =>
          /\$\d/.test(
            document.querySelector("[data-cy='cws-billed'] .cws-kpi__val")
              ?.textContent ?? "",
          ),
        undefined,
        { timeout: 20_000 },
      );
      // one evaluate: the amount and its count read from the same render
      const tile = await page.evaluate(() => ({
        billed: document.querySelector("[data-cy='cws-billed'] .cws-kpi__val")
          ?.textContent?.trim(),
        hint: document.querySelector("[data-cy='cws-billed'] .cws-kpi__hint")
          ?.textContent?.trim(),
      }));
      expect.eq(
        JSON.stringify(tile),
        JSON.stringify(EXPECT[lang]),
        "the Billed tile's count covers the same invoices as its amount (the scheduled balance is in neither)",
      );
    }));
}
