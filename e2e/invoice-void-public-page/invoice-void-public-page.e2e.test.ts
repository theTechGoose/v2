/**
 * REQ-1131 (LOOP-007 cycle 3, q3-61) — a cancelled invoice on the customer's
 * /i page does not tell them how to pay it, and names its state with one word.
 *
 * Bug: REQ-627 gated the pill, the balance block, the cancelled note and the
 * pay UI on `voided`, but the REQ-206 extras still render
 * [data-cy=invoice-payment-instructions] ("PAYMENT INSTRUCTIONS · Zelle: …"),
 * and the REQ-201 headline reads "INV-003 · Version 1 · Void" above a
 * "CANCELLED" pill (es: "Anulada" vs "Cancelada").
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function signIn(http: StoryTools["http"]) {
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
  await call(http, auth, "PUT", "/api/me", {
    language: "en",
    name: "Dana Whitfield",
  });
  return auth;
}

/** A sent invoice with Zelle payment instructions, then voided. */
async function voidedInvoiceWithInstructions(http: StoryTools["http"]) {
  const auth = await signIn(http);
  await call(http, auth, "PUT", "/api/profile/identity", {
    businessName: "Whitfield Fence Co",
    // REQ-925: the business sends in both, so ?lang=es is honoured
    commsLanguages: ["en", "es"],
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "dana@whitfieldfence.com" },
    },
  });
  const customer = await call(http, auth, "POST", "/api/customers", {
    name: "Randall Belknap",
    address: "725 Frederick Rd, Myrtle Beach, SC 29577",
  });
  const inv = await call(http, auth, "POST", "/api/invoices", {
    amount: 6500,
    status: "sent",
    customerId: customer.id,
    jobName: "Fence repair",
    paymentInstructions: "Zelle: dana@whitfieldfence.com",
  });
  await call(http, auth, "POST", `/api/invoices/${inv.id}/void`, {
    reason: "Wrong address",
  });
  const after = await call(http, auth, "GET", `/api/invoices/${inv.id}`);
  if (after.status !== "void") {
    throw new Error(`setup: invoice is ${after.status}, not void`);
  }
  return inv;
}

for (
  const c of [
    { lang: "en", pill: /cancelled/i, stale: /\bVoid\b/, word: "Cancelled" },
    { lang: "es", pill: /cancelada/i, stale: /Anulada/, word: "Cancelada" },
  ] as const
) {
  Deno.test(`REQ-1131 (LOOP-007 q3, q3-61): a cancelled invoice's /i page (${c.lang}) shows no payment instructions, and its headline says "${c.word}" like the pill`, (t) =>
    story(t, async ({ page, expect, http }) => {
      const inv = await voidedInvoiceWithInstructions(http);
      await page.goto(`/i/${inv.id}?lang=${c.lang}`);
      await page.locator("[data-cy='invoice-cancelled-note']").waitFor({
        timeout: 15_000,
      });
      // one read, so the facts come from the same render
      const facts = await page.evaluate(() => ({
        instructions: document.querySelector(
          "[data-cy='invoice-payment-instructions']",
        )?.textContent ?? null,
        headline: document.querySelector("[data-cy='invoice-headline']")
          ?.textContent ?? "",
        pill: document.querySelector("[data-status-pill]")?.textContent ?? "",
      }));
      expect(
        c.pill.test(facts.pill),
        `REQ-627 setup: the pill says ${c.word}: "${facts.pill}"`,
      );
      // both halves of q3-61 are reported together
      const problems: string[] = [];
      if (facts.instructions !== null) {
        problems.push(
          `a cancelled invoice shows no payment instructions — got "${facts.instructions}"`,
        );
      }
      if (!facts.headline.includes(c.word) || c.stale.test(facts.headline)) {
        problems.push(
          `the headline names the state "${c.word}" like the pill ("${facts.pill}") — got "${facts.headline}"`,
        );
      }
      expect(problems.length === 0, `REQ-1131: ${problems.join(" | ")}`);
    }));
}
