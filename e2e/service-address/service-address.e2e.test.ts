/**
 * REQ-263 — demo issue ai-assistant-m2: "Job address dropped from the quote
 * ('412 Oak St Austin')". In a browser: the address already on the quote (the
 * assistant extracts it from the typed sentence) pre-fills the wizard's
 * customer step; what the contractor confirms there lands on the quote; the
 * customer's agreement (/q) shows it in English and Spanish.
 *
 * The conversation is seeded the way the assistant's own dev seed does it (a
 * quote → a conversation on it → transition-to-terms): no LLM turn, so the
 * story is the same on the gate's fakes and on a pin.
 *
 * Pages: /assistant/[id] (CustomerStepPanel in front-end/islands/AsstChat.tsx)
 * and /q/[id] (front-end/components/quote-doc.tsx).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

/** A fresh, onboarded, English account on the page's browser context;
 *  returns the request headers that act as that account. */
async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Site User", language: "en" }],
      ["/api/profile/identity", { businessName: "Site Cleaning" }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
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

Deno.test("REQ-263: the job address on the quote pre-fills the customer step, the confirmed address lands on the quote, and the agreement shows it (EN + ES)", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const post = async (path: string, payload?: unknown) => {
      const res = await http(path, {
        method: "POST",
        headers: auth,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      return await res.json().catch(() => ({}));
    };
    // what the assistant writes when the contractor typed
    // "Deep clean for Maria Lopez, 412 Oak St Austin, $350"
    const quote = await post("/api/quotes", {
      summary: "Deep clean — Maria Lopez",
      serviceAddress: "412 Oak St Austin",
      lineItems: [{
        description: "Deep clean",
        quantity: 1,
        unit: "ea",
        price: 35000,
      }],
      estimatedTotal: 35000,
      status: "sent",
    });
    const conv = await post("/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(`/api/agents/conversations/${conv.id}/transition-to-terms`);

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conv.id}`);
    // A fresh account has nobody to pick: the step opens on the create form
    // (once its customer list has loaded).
    await page.locator(".cust-create").waitFor({
      state: "visible",
      timeout: 20_000,
    });

    // 1. pre-filled from the quote
    const address = page.locator("[data-cy='wizard-service-address']");
    await address.waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForFunction(
      () =>
        (document.querySelector(
          "[data-cy='wizard-service-address']",
        ) as HTMLInputElement | null)?.value === "412 Oak St Austin",
      undefined,
      { timeout: 20_000 },
    );

    // 2. the contractor completes it; it lands on the quote
    await address.fill("412 Oak St, Austin TX 78704");
    await page.locator(".cust-create input.cust-pick__search").first().fill(
      "Maria Lopez",
    );
    await page.locator(".cust-create input[type=tel]").fill("5125550199");
    await page.locator(".cust-create__btn--primary").click();
    await page.getByText(/when does the job start/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    const stored = await (await http(`/api/quotes/${quote.id}`, {
      headers: auth,
    })).json();
    expect.eq(
      stored.serviceAddress,
      "412 Oak St, Austin TX 78704",
      "the confirmed job address is on the quote",
    );

    // 3. the customer's agreement shows it, in both languages
    for (
      const [lang, label] of [
        ["en", "Service address"],
        ["es", "Dirección del servicio"],
      ] as const
    ) {
      await page.goto(`/q/${quote.id}?lang=${lang}`);
      const site = page.locator("[data-cy='quote-doc-service-address']");
      await site.waitFor({ state: "visible", timeout: 20_000 });
      const text = (await site.innerText()).replace(/\s+/g, " ");
      expect(
        text.toLowerCase().includes(label.toLowerCase()) &&
          text.includes("412 Oak St, Austin TX 78704"),
        `the /q?lang=${lang} agreement names the job site (${text})`,
      );
    }
  }));
