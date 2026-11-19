/**
 * REQ-1093 — Raphael: "test every single aspect of this application … one
 * Opus agent per issue to do root cause analysis, then one to write the test,
 * then one to fix it and make it green." LOOP-007 cycle 3, issues q3-11 and
 * q3-12 (amends REQ-473 + REQ-961).
 *
 * After a 50/50 signing of a $5,125.50 job, /dashboard in Spanish read
 * "Próximo: $2,563 se cobra el dic 3" in the money bar and "$5,126" /
 * "Vence nov 26" in the Active jobs card. One document's amount is shown to
 * the cent, Spanish dates are day-first ("3 dic"), and a scheduled installment
 * is one we remind the owner to send, not one that "se cobra".
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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
    body: JSON.stringify({ language: "es" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!r.ok) {
    throw new Error(`${method} ${path}: ${r.status} ${await r.text()}`);
  }
  return await r.json();
}

/** A signed 50/50 $5,125.50 job: deposit INV paid, the $2,562.75 balance scheduled. */
async function seed(
  http: StoryTools["http"],
  auth: Record<string, string>,
): Promise<string> {
  await answerQuestions(http, auth, {
    name: "Cents Dates Story",
    businessName: "Cents Dates LLC",
  });
  const customer = await call(http, auth, "POST", "/api/customers", {
    name: "Rosa Delgado",
    email: "rosa@blackhole.postmarkapp.com",
  });
  const line = {
    description: "Kitchen remodel",
    quantity: 1,
    unit: "job",
    price: 512_550,
  };
  const quote = await call(http, auth, "POST", "/api/quotes", {
    customerId: customer.id,
    summary: "Kitchen remodel — Rosa Delgado",
    jobName: "Kitchen remodel",
    lineItems: [line],
    estimatedTotal: 512_550,
    status: "draft",
    terms: [{
      stepId: "payment_terms",
      label: "Payment terms",
      value: "50% deposit, 50% on completion",
    }],
  });
  await call(http, auth, "PUT", `/api/quotes/${quote.id}`, {
    status: "accepted",
    acceptedAt: new Date().toISOString(),
  });
  for (const inv of await call(http, auth, "GET", "/api/invoices")) {
    await call(http, auth, "DELETE", `/api/invoices/${inv.id}`);
  }
  const half = { ...line, price: 256_275 };
  await call(http, auth, "POST", "/api/invoices", {
    quoteId: quote.id,
    customerId: customer.id,
    status: "paid",
    paidAt: new Date().toISOString(),
    jobName: "Kitchen remodel",
    dueDate: inDays(0),
    lineItems: [half],
    amount: 256_275,
  });
  const scheduled = inDays(14);
  await call(http, auth, "POST", "/api/invoices", {
    quoteId: quote.id,
    customerId: customer.id,
    status: "scheduled",
    scheduledFor: scheduled,
    jobName: "Kitchen remodel",
    dueDate: inDays(44),
    lineItems: [half],
    amount: 256_275,
  });
  return scheduled;
}

/** "3 dic" — the house Spanish short date (day-first, no period). */
function esDay(iso: string): string {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("es-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).replace(".", "");
}

Deno.test("REQ-1093 (LOOP-007 q3, q3-11 + q3-12): /dashboard in Spanish after a 50/50 $5,125.50 signing — upcoming '$2,562.75 … <d> <mon>' without 'se cobra'; the job card '$5,125.50' and 'Vence <d> <mon>'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const scheduled = await seed(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/dashboard?lang=es");
    const up = page.locator("[data-cy='money-upcoming']");
    await up.waitFor({ timeout: 20_000 });
    const job = page.locator(".job").first();
    await job.waitFor({ timeout: 20_000 });
    // one evaluate: both panels read off the same render
    const { upcoming, jobText } = await page.evaluate(() => ({
      upcoming: (document.querySelector("[data-cy='money-upcoming']")
        ?.textContent ?? "").replace(/\s+/g, " ").trim(),
      jobText: ((document.querySelector(".job") as HTMLElement | null)
        ?.innerText ?? "").replace(/\s+/g, " ").trim(),
    }));

    const day = esDay(scheduled);
    const checks: [boolean, string][] = [
      // q3-11: the money bar's upcoming line
      [upcoming.includes("$2,562.75"), "upcoming shows $2,562.75 to the cent"],
      [upcoming.includes(day), `upcoming reads "${day}" day-first`],
      [!/se cobra/i.test(upcoming), 'upcoming has no "se cobra"'],
      // q3-12: the Active jobs card
      [jobText.includes("$5,125.50"), "job card shows $5,125.50 to the cent"],
      [!jobText.includes("$5,126"), "job card not rounded to $5,126"],
      [
        /Vence \d{1,2} [a-zé]{3,4}/.test(jobText),
        'job card due is day-first "Vence <d> <mon>"',
      ],
      [
        !/Vence [a-zé]{3,4}\.? \d/.test(jobText),
        'job card due is not month-first "Vence <mon> <d>"',
      ],
    ];
    const failed = checks.filter(([ok]) => !ok).map(([, m]) => m);
    expect(
      failed.length === 0,
      `${failed.join("; ")} — upcoming="${upcoming}" job="${jobText}"`,
    );
  }));
