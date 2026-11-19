/**
 * REQ-1103 (LOOP-007 cycle 3, q3-30) — "/i accessible text runs a sentence
 * into the amount: 'Tell us how$1,935.15'".
 *
 * On the customer's /i page the claim label's text and the balance span are
 * siblings with no text node between them (only CSS margin-left), so the
 * DOM text reads "Already paid? Tell us how$1,935.15" (pay buttons shown) or
 * "How would you like to pay?$1,935.15" (no pay buttons). This story reads
 * the label's textContent in the real browser, in both branches.
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Claim Label Space Story" }),
  })).body?.cancel();
  // a fresh business with NO payment methods (and no Stripe / Square)
  await (await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ businessName: "Northside Builders" }),
  })).body?.cancel();
  // the browser is the CUSTOMER's — only a language pick, no owner session
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].map((domain) => ({
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    })),
  );
  return { auth };
}

async function call(
  http: StoryTools["http"],
  method: string,
  path: string,
  headers: Record<string, string>,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) {
    throw new Error(
      `${method} ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

Deno.test("REQ-1103 (LOOP-007 q3-30): /i claim label text keeps whitespace between the sentence and the balance, with and without pay buttons", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await call(http, "POST", "/api/customers", auth, {
      name: "Dana Whitfield",
      email: "dana@blackhole.postmarkapp.com",
    });
    const quote = await call(http, "POST", "/api/quotes", auth, {
      customerId: customer.id,
      summary: "Deck repair",
      jobName: "Deck repair",
      lineItems: [{
        description: "Deck repair",
        quantity: 1,
        unit: "job",
        price: 193515,
      }],
      estimatedTotal: 193515,
      status: "draft",
    });
    await call(http, "PUT", `/api/quotes/${quote.id}`, auth, {
      status: "sent",
    });
    await call(http, "POST", `/api/quotes/${quote.id}/accept`, JSON_HEADERS, {
      name: "Dana Whitfield",
      signature: "data:image/png;base64,iVBORw0KGgo=",
    });
    const invoices = await call(http, "GET", "/api/invoices", auth);
    const billed = invoices.filter((i: { quoteId?: string }) =>
      i.quoteId === quote.id
    );
    expect.eq(billed.length, 1, "the signature billed one invoice");
    const invId = billed[0].id as string;

    // one evaluate: the label's raw textContent + innerText, read together
    const readLabel = () =>
      page.evaluate(() => {
        const amount = document.querySelector("[data-cy='claim-balance']");
        const label = amount?.parentElement as HTMLElement | null;
        return {
          text: label?.textContent ?? "",
          inner: label?.innerText ?? "",
          amount: amount?.textContent ?? "",
        };
      });

    for (
      const [name, methods, sentence] of [
        [
          "pay buttons (Venmo)",
          { venmo: { enabled: true, handle: "@northside" } },
          "Tell us how",
        ],
        ["no pay buttons (cash)", { cash: { enabled: true } }, "pay?"],
      ] as const
    ) {
      await call(http, "PUT", "/api/profile/identity", auth, {
        businessName: "Northside Builders",
        acceptedPaymentMethods: methods,
      });
      await page.goto(`/i/${invId}`);
      await page.locator("[data-cy='claim-balance']").waitFor({
        timeout: 15_000,
      });
      const got = await readLabel();
      expect.eq(got.amount.trim(), "$1,935.15", `${name}: the balance shown`);
      expect.eq(
        got.text.toLowerCase().includes(sentence.toLowerCase()),
        true,
        `${name}: label branch (${JSON.stringify(got.text)})`,
      );
      expect.eq(
        /(^|\s)\$1,935\.15/.test(got.text),
        true,
        `${name}: label textContent runs into the amount: ${JSON.stringify(got.text)}`,
      );
      expect.eq(
        /(^|\s)\$1,935\.15/.test(got.inner),
        true,
        `${name}: label innerText runs into the amount: ${JSON.stringify(got.inner)}`,
      );
    }
  }));
