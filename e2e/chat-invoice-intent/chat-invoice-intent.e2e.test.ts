/**
 * REQ-656 (demo-loop cycle 5, run r37f88707, M9) on the real app — pair 8:
 * in a new assistant chat the contractor types the starter chip's own words,
 * "Trabajo terminado, necesito facturar: Jorge Ruiz, jorge.ruiz@example.com,
 * sacamos un refrigerador y una lavadora viejos, $200. Que pague hoy."
 *
 * The demo's chat drafted "Q-002 · Cotización redactada". Now the reply
 * says it started the invoice for Jorge Ruiz, $200, and the chat opens the
 * chip's invoice flow at its price step, the pad already at $200, and no
 * quote is drafted.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx; the reply from
 * backend/src/agents/domain/coordinators/handle-chat-message, the offer rule
 * from shared/quote-flow/chat-invoice-flow-offer.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SAID =
  "Trabajo terminado, necesito facturar: Jorge Ruiz, jorge.ruiz@example.com, sacamos un refrigerador y una lavadora viejos, $200. Que pague hoy.";

/** Signed in, past onboarding, in Spanish. */
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
  if (!cookie) {
    throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  }
  const auth = { ...JSON_HEADERS, cookie };
  await answerQuestions(http, auth, {
    name: "Rosa Delgado",
    businessName: "Delgado Hauling",
  });
  const lang = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es" }),
  });
  await lang.body?.cancel();
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "es", domain: host, path: "/" },
  ]);
  return auth;
}

/** Type the line and send it once the island is live (a keypress before
 *  hydration is lost); never twice. */
async function say(page: StoryTools["page"], text: string) {
  const box = page.locator(".composer textarea.composer__input");
  const mine = page.locator(".msg.msg--user", { hasText: text });
  const pad = page.locator(".chat__price-capture");
  await box.waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await mine.count() > 0 || await pad.count() > 0) return;
    await box.fill(text);
    await box.press("Enter");
    for (let i = 0; i < 4; i++) {
      if (await mine.count() > 0 || await pad.count() > 0) return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`"${text}" was never sent`);
}

Deno.test("REQ-656 M9: pair 8 — 'Trabajo terminado, necesito facturar: Jorge Ruiz … $200' typed opens the invoice flow at $200; no quote is drafted", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await say(page, SAID);

    const money = page.locator(".chat__price-capture input.mi__input");
    await money.waitFor({ state: "visible", timeout: 30_000 });
    await money.hover(); // the pad, on screen, in the evidence
    expect.eq(
      (await money.inputValue()).trim(),
      "200",
      "the invoice flow's pad opens at the typed $200",
    );
    const recap = await page.locator(".chat__price-details-recap-text")
      .innerText();
    expect(
      recap.includes("Jorge Ruiz"),
      `the flow carries the job details (got: ${recap})`,
    );
    expect.eq(
      await page.locator(".action-card").count(),
      0,
      "no quote card was drafted",
    );
    const quotes = await (await http("/api/quotes", { headers: auth }))
      .json() as { isSample?: boolean }[];
    expect.eq(
      quotes.filter((q) => !q.isSample).length,
      0,
      "no quote exists",
    );
    // the thread keeps the reply, and its offer
    const convoId = new URL(page.url()).pathname.split("/").pop() ?? "";
    const detail = await (await http(`/api/agents/conversations/${convoId}`, {
      headers: auth,
    })).json() as {
      messages?: { role: string; content: string; payload?: unknown }[];
    };
    const reply = (detail.messages ?? []).find((m) =>
      m.role === "assistant" &&
      (m.payload as { invoiceFlow?: unknown } | undefined)?.invoiceFlow
    );
    expect(!!reply, "the reply carries the invoice flow");
    expect(
      !!reply && reply.content.includes("Jorge Ruiz") &&
        reply.content.includes("$200"),
      `the reply names who and how much (got: ${reply?.content})`,
    );
  }));

/** REQ-752 (demo-loop cycle 5v1, M9 re-test): the verifier typed
 *  "Trabajo terminado con Juan Pérez, hazle la factura de $800" and got
 *  "Empecé la factura por $800: elige el cliente…" with the Nombre field
 *  empty — "con Juan Pérez" was never read as who to bill. */
const SAID_CON = "Trabajo terminado con Juan Pérez, hazle la factura de $800";

Deno.test("REQ-752 M9: 'Trabajo terminado con Juan Pérez, hazle la factura de $800' opens the invoice flow at $800 for Juan Pérez", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await say(page, SAID_CON);

    const money = page.locator(".chat__price-capture input.mi__input");
    await money.waitFor({ state: "visible", timeout: 30_000 });
    expect.eq(
      (await money.inputValue()).trim(),
      "800",
      "the invoice flow's pad opens at the typed $800",
    );
    const convoId = new URL(page.url()).pathname.split("/").pop() ?? "";
    const detail = await (await http(`/api/agents/conversations/${convoId}`, {
      headers: auth,
    })).json() as {
      messages?: { role: string; content: string; payload?: unknown }[];
    };
    const reply = (detail.messages ?? []).find((m) =>
      m.role === "assistant" &&
      (m.payload as { invoiceFlow?: unknown } | undefined)?.invoiceFlow
    );
    const offer = (reply?.payload as
      | { invoiceFlow?: { customerName?: string } }
      | undefined)?.invoiceFlow;
    expect.eq(
      offer?.customerName,
      "Juan Pérez",
      "the invoice flow is prefilled with who to bill",
    );
    expect(
      !!reply && reply.content.includes("Juan Pérez") &&
        !/elige el cliente/i.test(reply.content),
      `the reply names Juan Pérez, not 'elige el cliente' (got: ${reply?.content})`,
    );
  }));

/** REQ-768 (demo-loop cycle 5v3, M9 re-test): the verifier typed "Ya
 *  terminé el trabajo de Mike Johnson, mándale la factura" for a customer
 *  whose quote was never sent and got "Esta cotización aún no se ha enviado.
 *  Envíala primero…" — no invoice flow. Now the flow opens at the quote's
 *  $1,250, for Mike Johnson. */
const SAID_MIKE = "Ya terminé el trabajo de Mike Johnson, mándale la factura";

Deno.test("REQ-768 M9: 'Ya terminé el trabajo de Mike Johnson, mándale la factura' (his quote never sent) opens the invoice flow at $1,250, never 'Envíala primero'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const mike = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Mike Johnson",
        email: "mike@blackhole.postmarkapp.com",
      }),
    })).json() as { id: string };
    const made = await http("/api/quotes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: mike.id,
        summary: "Reparación de deck",
        jobName: "Reparación de deck",
        lineItems: [{
          description: "Reparación de deck",
          quantity: 1,
          unit: "ea",
          price: 125_000,
        }],
        estimatedTotal: 125_000,
        status: "draft",
      }),
    });
    await made.body?.cancel();
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/assistant");
    await say(page, SAID_MIKE);

    const money = page.locator(".chat__price-capture input.mi__input");
    await money.waitFor({ state: "visible", timeout: 30_000 });
    await money.hover();
    expect.eq(
      (await money.inputValue()).trim().replace(/,/g, ""),
      "1250",
      "the invoice flow's pad opens at the quote's $1,250",
    );
    const convoId = new URL(page.url()).pathname.split("/").pop() ?? "";
    const detail = await (await http(`/api/agents/conversations/${convoId}`, {
      headers: auth,
    })).json() as {
      messages?: { role: string; content: string; payload?: unknown }[];
    };
    const said = (detail.messages ?? []).filter((m) => m.role === "assistant")
      .map((m) => m.content).join(" ");
    expect(
      !/Env[ií]ala primero/i.test(said),
      `no "Envíala primero" (got: ${said})`,
    );
    const offer = (detail.messages ?? []).map((m) =>
      (m.payload as
        | { invoiceFlow?: { customerName?: string; amountCents?: number } }
        | undefined)?.invoiceFlow
    ).find((o) => !!o);
    expect.eq(offer?.customerName, "Mike Johnson", "who to bill");
    expect.eq(offer?.amountCents, 125_000, "the quote's amount");
  }));

/** REQ-772 (demo-loop cycle 5v5, M9 re-test of REQ-768): the verifier's
 *  draft Q-001 "Fence painting — Maria Lopez", $800, drafted by the chat
 *  with no saved customer. In Q-001's own thread "Job done for Maria, need
 *  to invoice her" answered "started an invoice for The customer, $800" and
 *  opened the price step at $800 — but Continue closed the panel and left
 *  the plain composer: no customer step, no invoice. Now the reply names
 *  Maria Lopez and Continue lands on the invoice wizard's "Who is this
 *  for?" in its own thread, Q-001 untouched. */
const SAID_MARIA = "Job done for Maria, need to invoice her";

Deno.test("REQ-772 M9: in draft Q-001's thread (no saved customer), 'Job done for Maria, need to invoice her' → $800 → Continue reaches the invoice's 'Who is this for?' — never the plain composer", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const me = await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "en" }),
    });
    await me.body?.cancel();
    await page.context().addCookies([{
      name: "pm_lang",
      value: "en",
      domain: new URL(baseUrl).hostname,
      path: "/",
    }]);
    const q1 = await (await http("/api/quotes", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        summary: "Fence painting — Maria Lopez",
        jobName: "Fence painting",
        lineItems: [{
          description: "Fence painting",
          quantity: 1,
          unit: "ea",
          price: 80_000,
        }],
        estimatedTotal: 80_000,
        status: "draft",
      }),
    })).json() as { id: string };
    const thread = await (await http("/api/agents/conversations", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ quoteId: q1.id }),
    })).json() as { id: string };
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/assistant/${thread.id}`);
    await say(page, SAID_MARIA);

    const money = page.locator(".chat__price-capture input.mi__input");
    await money.waitFor({ state: "visible", timeout: 30_000 });
    expect.eq(
      (await money.inputValue()).trim(),
      "800",
      "the invoice flow's pad opens at Q-001's $800",
    );
    const said = await (await http(`/api/agents/conversations/${thread.id}`, {
      headers: auth,
    })).json() as { messages?: { role: string; content: string }[] };
    const reply = (said.messages ?? []).filter((m) => m.role === "assistant")
      .map((m) => m.content).join(" ");
    expect(
      reply.includes("Maria Lopez") && !/The customer/.test(reply),
      `the reply names Maria Lopez, not "The customer" (got: ${reply})`,
    );

    await page.locator(".chat__price-capture .chat__price-continue").click();
    const who = page.getByText("Who is this for?").first();
    await who.waitFor({ state: "visible", timeout: 30_000 });
    await who.hover();

    const now = new URL(page.url()).pathname.split("/").pop() ?? "";
    expect(now !== thread.id, "the invoice runs in its own thread");
    const conv = await (await http(`/api/agents/conversations/${now}`, {
      headers: auth,
    })).json() as {
      conversation?: { docKind?: string; quoteId?: string };
    };
    expect.eq(conv.conversation?.docKind, "invoice", "the invoice wizard");
    const after = await (await http(`/api/quotes/${q1.id}`, {
      headers: auth,
    })).json() as { summary?: string; estimatedTotal?: number };
    expect.eq(after.summary, "Fence painting — Maria Lopez", "Q-001 untouched");
    expect.eq(after.estimatedTotal, 80_000, "Q-001's total untouched");
  }));

/** REQ-777: open the step's "Tell the assistant…" box (once the island is
 *  live), type and send — never twice. */
async function sayOnStep(page: StoryTools["page"], text: string) {
  const open = page.locator("[data-cy=step-composer-open]");
  const input = page.locator("[data-cy=step-composer-input]");
  const mine = page.locator(".msg.msg--user", { hasText: text });
  const pad = page.locator(".chat__price-capture");
  await open.first().waitFor({ state: "visible", timeout: 20_000 });
  for (let attempt = 0; attempt < 20; attempt++) {
    if (await mine.count() > 0 || await pad.count() > 0) return;
    if (await input.count() === 0) {
      await open.first().click();
      await page.waitForTimeout(250);
      continue;
    }
    await input.fill(text);
    await input.press("Enter");
    for (let i = 0; i < 8; i++) {
      if (await mine.count() > 0 || await pad.count() > 0) return;
      await page.waitForTimeout(250);
    }
  }
  throw new Error(`"${text}" was never sent`);
}

/** REQ-777 (demo-loop cycle dv1, M9 verify round 6): draft Q-001 "Bathroom
 *  Tile Installation", drafted with nobody named, then Ana Diaz set in the
 *  quote's own setup questions (the wizard's customer step — it binds her by
 *  id, no snapshot, no "— Ana Diaz" tail). "Job done, need to invoice her"
 *  in Q-001's thread lost her. Now the reply names Ana Diaz, the pad opens
 *  at Q-001's $1,450, and Continue's "Who is this for?" carries Ana Diaz —
 *  in English and in Spanish. */
for (
  const run of [
    {
      lang: "en",
      said: "Job done, need to invoice her",
      whoFor: "Who is this for?",
    },
    {
      lang: "es",
      said: "Trabajo terminado, necesito facturarle",
      whoFor: "¿Para quién es esto?",
    },
  ] as const
) {
  Deno.test(`REQ-777 M9 (dv1): Ana Diaz set through Q-001's wizard; '${run.said}' (${run.lang}) in its thread → $1,450 → Continue → '${run.whoFor}' with Ana Diaz`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const auth = await signIn(http, page, baseUrl);
      const me = await http("/api/me", {
        method: "PUT",
        headers: auth,
        body: JSON.stringify({ language: run.lang }),
      });
      await me.body?.cancel();
      await page.context().addCookies([{
        name: "pm_lang",
        value: run.lang,
        domain: new URL(baseUrl).hostname,
        path: "/",
      }]);
      const q1 = await (await http("/api/quotes", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          summary: "Bathroom Tile Installation",
          jobName: "Bathroom Tile Installation",
          lineItems: [{
            description: "Bathroom tile installation",
            quantity: 1,
            unit: "ea",
            price: 145_000,
          }],
          estimatedTotal: 145_000,
          status: "draft",
        }),
      })).json() as { id: string };
      const thread = await (await http("/api/agents/conversations", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ quoteId: q1.id }),
      })).json() as { id: string };
      // The quote's setup questions: into terms, then the customer step.
      const terms = await http(
        `/api/agents/conversations/${thread.id}/transition-to-terms`,
        { method: "POST", headers: auth },
      );
      await terms.body?.cancel();
      const picked = await http("/api/agents/wizard/answer", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({
          conversationId: thread.id,
          stepId: "customer",
          optionId: "create_new",
          customValue: "Ana Diaz",
          customer: {
            create: { name: "Ana Diaz", email: "ana.diaz@example.com" },
          },
        }),
      });
      expect(picked.ok, `the wizard's customer step took Ana Diaz`);
      await picked.body?.cancel();

      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`/assistant/${thread.id}`);
      // Mid-wizard the thread shows "Tell the assistant…" (REQ-392), the
      // box the verifier typed in.
      await sayOnStep(page, run.said);

      const money = page.locator(".chat__price-capture input.mi__input");
      await money.waitFor({ state: "visible", timeout: 30_000 });
      expect.eq(
        (await money.inputValue()).trim().replace(/,/g, ""),
        "1450",
        "the invoice flow's pad opens at Q-001's $1,450",
      );
      const said = await (await http(
        `/api/agents/conversations/${thread.id}`,
        { headers: auth },
      )).json() as { messages?: { role: string; content: string }[] };
      const reply = (said.messages ?? []).filter((m) => m.role === "assistant")
        .map((m) => m.content).join(" ");
      expect(
        reply.includes("Ana Diaz") && !/The customer|El cliente/.test(reply),
        `the reply names Ana Diaz (got: ${reply})`,
      );

      await page.locator(".chat__price-capture .chat__price-continue").click();
      const who = page.getByText(run.whoFor).first();
      await who.waitFor({ state: "visible", timeout: 30_000 });
      // Ana Diaz is a saved customer now: the step offers her in one tap
      // ("Use Ana Diaz", REQ-331) — or, at worst, a form filled with her.
      // The step reads the customer list first ("Loading customers…").
      const useKnown = page.locator('[data-cy="customer-use-known"]');
      let filled = false;
      let known = "";
      for (let i = 0; i < 80 && !filled && !known.includes("Ana Diaz"); i++) {
        await page.waitForTimeout(250);
        filled = await page.locator("input").evaluateAll((els) =>
          els.some((e) => (e as HTMLInputElement).value === "Ana Diaz")
        );
        known = await useKnown.count() > 0
          ? (await useKnown.first().innerText())
          : "";
      }
      expect(
        known.includes("Ana Diaz") || filled,
        `the customer step carries Ana Diaz (offered: "${known}")`,
      );
      await who.hover();
    }));
}
