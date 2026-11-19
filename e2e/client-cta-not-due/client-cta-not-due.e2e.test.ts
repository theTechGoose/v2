/**
 * REQ-1066 — LOOP-007 cycle 2, QA issue q2-56 [BUG_POLISH]: right after the
 * batch send, the /customers card read "$85 outstanding · INV-001 · due in 30
 * days." beside "Send a kind reminder →". The card's CTA must not headline a
 * reminder for an invoice that is not due yet; an overdue one still does.
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
    body: JSON.stringify({ language: "en", name: "Cta Story" }),
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

const nudgeText = async (page: StoryTools["page"], name: string) => {
  const nudge = page.locator(".ccard2", { hasText: name }).locator(
    "[data-cy='ccard2-nudge']",
  );
  await nudge.waitFor({ timeout: 20_000 });
  return ((await nudge.textContent()) ?? "").replace(/\s+/g, " ").trim();
};

Deno.test("REQ-1066 (LOOP-007 q2-56): an $85 invoice sent today, due in 30 days — the customer card does not say 'Send a kind reminder'; an overdue one does", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Cta Story" });
    const fresh = await post(http, auth, "/api/customers", {
      name: "Fresh Fiona",
      phoneNumber: "(512) 555-0161",
    });
    await post(http, auth, "/api/invoices", {
      customerId: fresh.id,
      status: "sent",
      jobName: "Gutter clean",
      amount: 8_500,
      issuedDate: daysFromNow(0),
      dueDate: daysFromNow(30),
    });
    const late = await post(http, auth, "/api/customers", {
      name: "Late Larry",
      phoneNumber: "(512) 555-0162",
    });
    await post(http, auth, "/api/invoices", {
      customerId: late.id,
      status: "sent",
      jobName: "Gutter clean",
      amount: 8_500,
      issuedDate: daysFromNow(-40),
      dueDate: daysFromNow(-10),
    });

    await page.goto("/customers");
    await expect.see("Fresh Fiona");
    const fiona = page.locator(".ccard2", { hasText: "Fresh Fiona" });
    const line = ((await fiona.textContent()) ?? "").replace(/\s+/g, " ");
    console.log(JSON.stringify({ fiona: line }));
    expect(
      /due in 30 days/i.test(line),
      `the fresh card says "due in 30 days" (${line})`,
    );

    const freshCta = await nudgeText(page, "Fresh Fiona");
    const lateCta = await nudgeText(page, "Late Larry");
    console.log(JSON.stringify({ freshCta, lateCta }));
    expect(
      !/kind reminder/i.test(freshCta),
      `an invoice due in 30 days must not headline a reminder (nudge: "${freshCta}")`,
    );
    expect(
      /kind reminder/i.test(lateCta),
      `an overdue invoice still headlines "Send a kind reminder" (nudge: "${lateCta}")`,
    );
  }));
