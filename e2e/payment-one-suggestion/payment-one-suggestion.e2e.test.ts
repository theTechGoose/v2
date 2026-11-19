/**
 * REQ-1105 (LOOP-007 cycle 3, q3-29; cites REQ-258 / REQ-265 / REQ-672) —
 * "Two 'Suggested' badges on the payment step": the QA tester's Q-001 job
 * message ended "30% deposit", and at "When do you want to get paid?" both
 * "30/30/40" and "Deposit + balance" carried the "Suggested" tag.
 *
 * Two sources fed the tag with no tie-break (AsstChat.tsx, the
 * `.wiz-opt__tag` condition): the front end's own parse of the message
 * (wizardPrefillFor → deposit_bal, REQ-265/936) OR the backend's
 * `payload.suggestedOptionId` (the model's create_quote paymentTerms,
 * REQ-258) — which the model gave as '30_30_40'.
 *
 * Seeded like REQ-265's quote-prefill story (the typed message is the quote's
 * description, a conversation on it, transition-to-terms). The model's
 * '30_30_40' is stood in on the server's real replies: every wizard payload
 * for the payment step gets `suggestedOptionId: "30_30_40"`, exactly what
 * terms-prefill sends when the model said so. The step must still show ONE
 * suggestion, on "Deposit + balance".
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const TYPED =
  "new quote for Maria Lopez 512-555-0129 maria.lopez@example.com, 1408 Elm St Austin TX 78702. exterior $4,850, fence $1,275.50. 30% deposit";

async function signIn(
  phone: string,
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
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
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Suggest User", language: "en" }],
      ["/api/profile/identity", { businessName: "Suggest Business" }],
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
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

/** Every payment-step wizard payload in a JSON reply gets the model's
 *  '30_30_40' as its suggestion. Returns how many it touched. */
function injectModelSuggestion(node: unknown): number {
  if (Array.isArray(node)) {
    return node.reduce((n, v) => n + injectModelSuggestion(v), 0);
  }
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  let n = 0;
  if (o.stepId === "payment_terms" && Array.isArray(o.options)) {
    o.suggestedOptionId = "30_30_40";
    n++;
  }
  for (const v of Object.values(o)) n += injectModelSuggestion(v);
  return n;
}

Deno.test("REQ-1105 (LOOP-007 q3, q3-29): '30% deposit' — the payment step shows exactly one 'Suggested' tag, on Deposit + balance, even when the model suggested 30/30/40", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn("+15125551105", http, page, baseUrl);
    const post = async (path: string, payload?: unknown) => {
      const res = await http(path, {
        method: "POST",
        headers: auth,
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      return await res.json().catch(() => ({}));
    };
    const quote = await post("/api/quotes", {
      summary: "Exterior paint and fence",
      description: TYPED,
      lineItems: [
        {
          description: "Exterior paint",
          quantity: 1,
          unit: "ea",
          price: 485000,
        },
        { description: "Fence", quantity: 1, unit: "ea", price: 127550 },
      ],
      estimatedTotal: 612550,
    });
    const conv = await post("/api/agents/conversations", {
      quoteId: quote.id,
    });
    await post(`/api/agents/conversations/${conv.id}/transition-to-terms`);

    let injected = 0;
    await page.route(
      (url) => url.pathname.includes("/api/agents/"),
      async (route) => {
        const res = await route.fetch();
        const type = res.headers()["content-type"] ?? "";
        if (!type.includes("application/json")) {
          await route.fulfill({ response: res });
          return;
        }
        const json = await res.json();
        injected += injectModelSuggestion(json);
        await route.fulfill({
          status: res.status(),
          headers: res.headers(),
          contentType: "application/json",
          body: JSON.stringify(json),
        });
      },
    );

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${conv.id}`);

    // Customer step: the create form, filled from the sentence.
    const form = page.locator(".cust-create").first();
    await form.waitFor({ state: "visible", timeout: 20_000 });
    const nameInput = form.locator("input.cust-pick__search").first();
    let typedName = "";
    for (let i = 0; i < 40 && !typedName; i++) {
      typedName = (await nameInput.inputValue()).trim();
      if (!typedName) await page.waitForTimeout(250);
    }
    if (!typedName) await nameInput.fill("Maria Lopez");
    await form.locator(".cust-create__btn--primary").click();

    // Start date and duration: not in the sentence — any answer.
    await page.getByText(/when does the job start/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.locator(".wiz__opts .wiz-opt:visible").first().click();
    await page.getByText(/how long will the job take/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    await page.locator(".wiz__opts .wiz-opt:visible").first().click();

    // Payment: one suggestion, the stated deposit.
    await page.getByText(/when do you want to get paid/i).first().waitFor({
      state: "visible",
      timeout: 20_000,
    });
    expect(
      injected > 0,
      "the model's 30_30_40 suggestion reached the payment step's payload",
    );
    // Wait for the front end's own parse to land (the quote loads after the
    // step renders), then read every tag in one evaluate.
    let tagged: string[] = [];
    for (let i = 0; i < 40; i++) {
      tagged = await page.evaluate(() =>
        Array.from(
          document.querySelectorAll(".wiz__opts .wiz-opt"),
        ).filter((b) =>
          (b as HTMLElement).offsetParent !== null &&
          b.querySelector(".wiz-opt__tag")
        ).map((b) =>
          (b.textContent ?? "").replace(/Suggested/g, "").replace(/\s+/g, " ")
            .trim()
        )
      );
      if (tagged.some((s) => /deposit\s*\+\s*balance/i.test(s))) break;
      await page.waitForTimeout(250);
    }
    expect.eq(
      tagged.length,
      1,
      `exactly one 'Suggested' tag on the payment step — got ${
        JSON.stringify(tagged)
      }`,
    );
    expect(
      /deposit\s*\+\s*balance/i.test(tagged[0] ?? ""),
      `the one 'Suggested' tag sits on Deposit + balance (got ${
        JSON.stringify(tagged)
      })`,
    );
    const fromMsg = await page.evaluate(() =>
      Array.from(document.querySelectorAll(".wiz__opts .wiz-opt"))
        .filter((b) =>
          (b as HTMLElement).offsetParent !== null &&
          (b.getAttribute("title") ?? "") === "From your message"
        ).map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim())
    );
    expect(
      fromMsg.every((s) => /deposit\s*\+\s*balance/i.test(s)),
      `no chip but Deposit + balance claims "From your message" (got ${
        JSON.stringify(fromMsg)
      })`,
    );
  }));
