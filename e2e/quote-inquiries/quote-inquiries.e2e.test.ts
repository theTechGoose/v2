/**
 * REQ-701 (demo-loop cycle 5, issue M21) — "A client's question can't be read
 * or answered from where the notice leads" (pair 9).
 *
 * Linda asked "¿Pueden venir el sábado en la mañana? ¿Se llevan también un
 * colchón?" from her quote link. Rosa clicked the notice "Linda Morales hizo
 * una pregunta" and landed on /quotes?open=… — "Linda's question text is
 * NOWHERE on that panel, no reply box. How do I answer her?"
 *
 * Now the dashboard feed row opens /quotes?open=<id>#questions; the panel
 * shows "Preguntas del cliente" with the question, how she asked to be
 * reached, Responder por texto / Llamar; the answer is texted and the row
 * reads answered.
 *
 * Pages: /dashboard (DashboardPage.tsx), /quotes (QuotesPage.tsx +
 * components/QuoteInquiries.tsx).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const QUESTION =
  "¿Pueden venir el sábado en la mañana? ¿Se llevan también un colchón?";
const ANSWER = "Sí, el sábado a las 9. El colchón son $40 más.";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  // REQ-091: past onboarding, or /dashboard sends her back to the wizard
  await answerQuestions(http, auth, {
    name: "Rosa Delgado",
    businessName: "Junk Monsters",
  });
  const lang = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es" }),
  });
  await lang.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return auth;
}

async function send(
  http: StoryTools["http"],
  headers: Record<string, string>,
  method: string,
  path: string,
  payload?: unknown,
) {
  const res = await http(path, {
    method,
    headers,
    body: payload === undefined ? undefined : JSON.stringify(payload),
  });
  return await res.json().catch(() => ({}));
}

/** an island may still be hydrating when its target appears: click until the effect shows */
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

Deno.test("REQ-701 M21: Linda's question — the feed row opens the quote's questions; the panel shows it with how to reach her, and Rosa answers by text from there", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const linda = await send(http, auth, "POST", "/api/customers", {
      name: "Linda Morales",
      email: "linda.morales@blackhole.postmarkapp.com",
    });
    const quote = await send(http, auth, "POST", "/api/quotes", {
      customerId: linda.id,
      summary: "Retiro de muebles",
      jobName: "Retiro de muebles",
      lineItems: [{
        description: "Retiro de muebles",
        quantity: 1,
        unit: "job",
        price: 52_500,
      }],
      estimatedTotal: 52_500,
      status: "draft",
    });
    await send(http, auth, "PUT", `/api/quotes/${quote.id}`, {
      status: "sent",
      sentAt: new Date().toISOString(),
    });
    // Linda, logged out, on her quote's page
    const asked = await send(
      http,
      JSON_HEADERS,
      "POST",
      `/api/quotes/${quote.id}/inquiry`,
      {
        question: QUESTION,
        contactBack: "(512) 555-6301",
        name: "Linda Morales",
        lang: "es",
      },
    );
    expect.eq(asked.ok, true, "the public form's question was accepted");

    // The notice in Rosa's feed
    await page.goto("/dashboard");
    const rowSel = `a.activity-item--link[href*="open=${quote.id}"]` +
      `:has-text("Linda Morales hizo una pregunta")`;
    const row = page.locator(rowSel).first();
    // first loads of freshly built pages: generous under a loaded host
    await row.waitFor({ timeout: 60_000 });
    expect.eq(
      await row.getAttribute("href"),
      `/quotes?open=${quote.id}#questions`,
      "the inquiry row links to the quote's questions",
    );
    await clickUntil(
      page,
      rowSel,
      () => Promise.resolve(/\/quotes\?open=/.test(page.url())),
    );

    // The panel the notice opened: the question, how to reach her, the actions
    const block = page.locator("[data-cy='quote-inquiries']");
    await block.waitFor({ timeout: 60_000 });
    await expect.see("Preguntas del cliente");
    await expect.see(QUESTION);
    await expect.see("(512) 555-6301");
    const box = await block.boundingBox();
    expect(
      box !== null && box.y < 900 && box.y + box.height > 0,
      "the #questions link scrolled the questions into view",
    );
    const call = page.locator("[data-cy='quote-inquiry-call']");
    expect.eq(
      await call.getAttribute("href"),
      "tel:+15125556301",
      "Llamar dials the number she gave",
    );

    // Answer by text, from the panel
    const reply = page.locator("[data-cy='quote-inquiry-reply']");
    await clickUntil(
      page,
      "[data-cy='quote-inquiry-text']",
      async () => (await reply.count()) > 0,
    );
    await reply.fill(ANSWER);
    await page.locator("[data-cy='quote-inquiry-send']").click();
    await expect.see("Enviada por SMS a +1 (512) 555-6301", {
      timeout: 30_000,
    });
    await expect.see("Contestada por texto");

    const after = await (await http(`/api/quotes/${quote.id}/inquiries`, {
      headers: auth,
    })).json();
    expect.eq(after[0]?.answer?.message, ANSWER, "the answer is on record");
  }));
