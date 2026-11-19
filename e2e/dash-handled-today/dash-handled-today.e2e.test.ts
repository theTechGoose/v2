/**
 * REQ-1134 (LOOP-007 cycle 3, q3-66) — the tester confirmed INV-001's
 * payment, then issued INV-002, recorded a $400.25 check, charged it back
 * with a $35 fee, recorded the cash that replaced it, then issued INV-003
 * and voided it. /dashboard's "What we handled today" showed only
 * "Payment recorded: $400.25 from Greg Pruitt" — as if the check were good —
 * with no chargeback row, no void row, and the first payment pushed off by
 * a fixed 4-row cap. Every one of today's owner actions belongs on it.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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

async function issue(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  cents: number,
) {
  return await call(http, auth, "POST", "/api/invoices", {
    customerId,
    status: "sent",
    jobName: `Job ${digits()}`,
    amount: cents,
  });
}

async function record(
  http: StoryTools["http"],
  auth: Record<string, string>,
  invoiceId: string,
  cents: number,
  method: string,
) {
  return await call(http, auth, "POST", "/api/payments", {
    invoiceId,
    amount: cents,
    method,
    receivedAt: new Date().toISOString(),
  });
}

Deno.test("REQ-1134 (LOOP-007 q3-66): /dashboard 'What we handled today' lists the chargeback, the void and every earlier action of the day", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, {
      name: "Handled Today Story",
      businessName: "Handled Today LLC",
    });
    const ana = await call(http, auth, "POST", "/api/customers", {
      name: "Ana Torres",
    });
    const greg = await call(http, auth, "POST", "/api/customers", {
      name: "Greg Pruitt",
    });
    const rosa = await call(http, auth, "POST", "/api/customers", {
      name: "Rosa Delgado",
    });

    // INV-001 paid first — the oldest thing done today
    const inv1 = await issue(http, auth, ana.id, 25000);
    await record(http, auth, inv1.id, 25000, "zelle");
    // INV-002: a check, charged back with the $35 fee, then cash
    const inv2 = await issue(http, auth, greg.id, 40025);
    const check = await record(http, auth, inv2.id, 40025, "check");
    await call(http, auth, "POST", `/api/payments/${check.id}/chargeback`, {
      feeCents: 3500,
      reason: "Check bounced",
    });
    await record(http, auth, inv2.id, 43525, "cash");
    // INV-003: issued, then voided
    const inv3 = await issue(http, auth, rosa.id, 12000);
    await call(http, auth, "POST", `/api/invoices/${inv3.id}/void`, {
      reason: "Duplicate",
    });

    await page.goto("/dashboard");
    const panel = page.locator("#activity");
    await panel.waitFor({ timeout: 20_000 });
    // the feed loads after hydration; wait for the newest owner row to show
    let text = "";
    for (let i = 0; i < 40; i++) {
      text = (await panel.textContent()) ?? "";
      if (text.includes("Rosa Delgado")) break;
      await page.waitForTimeout(500);
    }
    expect.eq(
      /chargeback/i.test(text) && text.includes("Greg Pruitt"),
      true,
      `the panel names Greg Pruitt's chargeback — panel: ${text}`,
    );
    expect.eq(
      /void/i.test(text) && text.includes("Rosa Delgado"),
      true,
      `the panel names the void of Rosa Delgado's invoice — panel: ${text}`,
    );
    expect.eq(
      text.includes("Payment recorded: $250 from Ana Torres"),
      true,
      `the day's first payment is still on the panel (no 4-row cap) — panel: ${text}`,
    );
  }));
