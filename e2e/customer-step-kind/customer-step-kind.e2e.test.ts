/**
 * REQ-532 (demo-loop cycle 3, issue p8-pair5-b) — "fix every issue the demo
 * found, loop until there are none". Pair 5 tapped "Person" on the lock-quote
 * CTA and the "Who is this for?" form still offered "Business Name
 * (optional)".
 *
 * Page: /assistant/[id] (CustomerStepPanel in front-end/islands/AsstChat.tsx).
 *  - Person   → no business-name input; a "+ Add a business name" link reveals
 *               it on demand.
 *  - Business → the required field reads "Business name"; no second
 *               business-name input; the customer saved is a business whose
 *               businessName is what was typed.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
      ["/api/me", { name: "Kind User", language: "en" }],
      ["/api/profile/identity", { businessName: "Kind Plumbing" }],
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

async function postJson(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  payload?: unknown,
) {
  const res = await http(path, {
    method: "POST",
    headers: auth,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return await res.json().catch(() => ({}));
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** a locked draft quote with no customer → the "Business / Person" CTA, then the create form */
async function openCreateFormAs(
  tools: StoryTools,
  auth: Record<string, string>,
  kind: "Business" | "Person",
) {
  const { page, http } = tools;
  const quote = await postJson(http, auth, "/api/quotes", {
    summary: "Water heater swap",
    jobName: "Water heater swap",
    lineItems: [{
      description: "Water heater swap",
      quantity: 1,
      unit: "ea",
      price: 120000,
    }],
    estimatedTotal: 120000,
    status: "draft",
  });
  const conv = await postJson(http, auth, "/api/agents/conversations", {
    quoteId: quote.id,
  });
  await postJson(
    http,
    auth,
    `/api/agents/conversations/${conv.id}/lock-quote`,
    { quoteId: quote.id },
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/assistant/${conv.id}`);
  const form = page.locator(".cust-create");
  await clickUntil(
    page,
    `button.continue-cta__btn:has-text('${kind}')`,
    async () => await form.isVisible(),
  );
  return form;
}

Deno.test("REQ-532 p8-pair5-b: Person → no 'Business Name (optional)' field; '+ Add a business name' reveals it", (t) =>
  story(t, async (tools) => {
    const { page, expect, http, baseUrl } = tools;
    const auth = await signIn(http, page, baseUrl);
    const form = await openCreateFormAs(tools, auth, "Person");

    const name = form.locator("input.cust-pick__search").first();
    expect.eq(
      await name.getAttribute("placeholder"),
      "Name",
      "a person's required field is their name",
    );
    expect.eq(
      await page.locator("[data-cy='wizard-business-name']").count(),
      0,
      "no business-name input after picking Person",
    );
    expect(
      !(await form.innerText()).includes("Business Name (optional)"),
      "the form never offers 'Business Name (optional)' to a person",
    );

    const add = page.locator("[data-cy='wizard-add-business-name']");
    await add.waitFor({ state: "visible", timeout: 10_000 });
    await clickUntil(
      page,
      "[data-cy='wizard-add-business-name']",
      async () =>
        await page.locator("[data-cy='wizard-business-name']").isVisible(),
    );
    expect(
      await page.locator("[data-cy='wizard-business-name']").isVisible(),
      "'+ Add a business name' reveals the optional input",
    );
  }));

Deno.test("REQ-532 p8-pair5-b: Business → the required field is 'Business name', no second business-name input, saved as a business", (t) =>
  story(t, async (tools) => {
    const { page, expect, http, baseUrl } = tools;
    const auth = await signIn(http, page, baseUrl);
    const form = await openCreateFormAs(tools, auth, "Business");

    const name = form.locator("input.cust-pick__search").first();
    expect.eq(
      await name.getAttribute("placeholder"),
      "Business name",
      "a business's required field is the business name",
    );
    expect.eq(
      await page.locator("[data-cy='wizard-business-name']").count(),
      0,
      "no second, optional business-name input for a business",
    );
    expect.eq(
      await page.locator("[data-cy='wizard-add-business-name']").count(),
      0,
      "no '+ Add a business name' for a business",
    );

    await name.fill("Riley Roofing Co");
    await form.locator("input[type=tel]").fill("5125550163");
    await clickUntil(
      page,
      ".cust-create button:has-text('Next')",
      async () => !(await form.isVisible()),
    );

    let saved:
      | { name?: string; businessName?: string; isBusiness?: boolean }
      | undefined;
    for (let i = 0; i < 25 && !saved; i++) {
      const res = await http("/api/customers", { headers: auth });
      const body = await res.json().catch(() => []);
      const list = (Array.isArray(body) ? body : body.customers ?? body.items ??
        []) as Array<
          { name?: string; businessName?: string; isBusiness?: boolean }
        >;
      saved = list.find((c) => c.name === "Riley Roofing Co");
      if (!saved) await page.waitForTimeout(200);
    }
    expect(!!saved, "the business customer was created");
    expect.eq(saved?.isBusiness, true, "saved as a business");
    expect.eq(
      saved?.businessName,
      "Riley Roofing Co",
      "its business name is what was typed in the required field",
    );
  }));
