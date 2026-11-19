/**
 * REQ-1089 (LOOP-007 cycle 3, issues q3-13 + q3-14) — Raphael: "test every
 * single aspect of this application … one Opus agent per issue to do root
 * cause analysis, then one to write the test, then one to fix it and make it
 * green."
 *
 * One $1,000.50 invoice due today (this week) and one $225.30 invoice past due.
 * The /invoices hero printed "$1,001 expected this week" above
 * "… $1,000.50", and "⚠ $225 at risk" beside an Overdue tile of "$225.30":
 * the hero's forecast totals went through the rounding fmtMoney.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const WEEK_CENTS = 100_050;
const RISK_CENTS = 22_530;

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
  await answerQuestions(http, auth, { name: "Forecast Cents" });
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

async function invoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  job: string,
  cents: number,
  dueDate: string,
): Promise<string> {
  const inv = await (await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId,
      jobName: job,
      status: "sent",
      dueDate,
      lineItems: [{ description: job, quantity: 1, unit: "job", price: cents }],
      amount: cents,
    }),
  })).json();
  if (!inv?.id) throw new Error(`seed invoice: ${JSON.stringify(inv)}`);
  return inv.id as string;
}

Deno.test("REQ-1089 q3-13/q3-14: the /invoices hero reads '$1,000.50 expected this week' and '⚠ $225.30 at risk' — never $1,001 or $225", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ name: "Greg Pruitt", email: "greg@example.test" }),
    })).json();
    // the forecast windows are UTC days (compute-invoice-forecast isoDay)
    const today = new Date().toISOString().slice(0, 10);
    const pastDue = new Date(Date.now() - 5 * 86_400_000).toISOString().slice(
      0,
      10,
    );
    await invoice(
      http,
      auth,
      customer.id,
      `Fence ${digits()}`,
      WEEK_CENTS,
      today,
    );
    await invoice(
      http,
      auth,
      customer.id,
      `Gate ${digits()}`,
      RISK_CENTS,
      pastDue,
    );
    const forecast = await (await http("/api/invoices/forecast/this-week", {
      headers: auth,
    })).json().catch(() => null);

    await page.goto("/invoices");
    const risk = page.locator("[data-cy='forecast-at-risk']");
    await risk.waitFor({ timeout: 20_000 });
    await page.waitForFunction(
      () =>
        /expected this week/.test(
          document.querySelector("[data-cy='forecast-hero']")?.textContent ??
            "",
        ),
      undefined,
      { timeout: 20_000 },
    );
    // read the three correlated facts in one round trip
    const read = await page.evaluate(() => {
      const txt = (s: string) =>
        (document.querySelector(s) as HTMLElement | null)?.innerText.trim() ??
          "";
      const tiles = [...document.querySelectorAll(".qkpi__cell")].map((c) =>
        (c as HTMLElement).innerText.trim()
      );
      return {
        hero: txt("[data-cy='forecast-hero']"),
        risk: txt("[data-cy='forecast-at-risk']"),
        overdueTile: tiles.find((t) => /overdue/i.test(t)) ?? "",
      };
    });
    expect.eq(
      JSON.stringify({
        heroWeek: read.hero.includes("$1,000.50 expected this week"),
        heroRounded: /\$1,001(?![\d.])/.test(read.hero),
        riskExact: read.risk.includes("$225.30"),
        riskRounded: /\$225(?![\d.])/.test(read.risk),
        tileExact: read.overdueTile.includes("$225.30"),
      }),
      JSON.stringify({
        heroWeek: true,
        heroRounded: false,
        riskExact: true,
        riskRounded: false,
        tileExact: true,
      }),
      `hero ${JSON.stringify(read.hero)} · at-risk ${
        JSON.stringify(read.risk)
      } · Overdue tile ${JSON.stringify(read.overdueTile)} · forecast ${
        JSON.stringify(forecast &&
          {
            thisWeekCents: forecast.thisWeekCents,
            atRiskCents: forecast.atRiskCents,
          })
      }`,
    );
  }));
