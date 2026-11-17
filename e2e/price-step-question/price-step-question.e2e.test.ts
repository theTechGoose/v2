/**
 * REQ-444 — demo-loop cycle 3, issue M21: "The assistant ignores questions
 * and says changes are done when they are not". On Pick a price pair 6 typed
 * "does this include the quartz slab material or just labor?? … ¿y el precio
 * incluye el permiso de plomería? add permit if not" and got only "Re-priced
 * with your note — Competitive $17,000 · Market $20,000 · Premium $24,000."
 *
 * Story 1: a question typed in the step's "Tell the assistant…" box goes to
 * the chat model WITH the tiers on screen and what they include; its answer
 * shows on the step — never the re-price template — and the tiers stay.
 * Story 2: when the answer added the permit to the job details, the step
 * shows the new details and the quote is drafted from them. The model's
 * update_job_details is stood in on the chat reply (the stub LLM a local run
 * uses cannot call a tool from outside the server); the server half — the
 * tool call, the rewrite, the re-price — is covered by
 * backend/src/agents/domain/coordinators/handle-chat-message/price-question.int.test.ts
 * and the HTTP e2e beside the chat controller.
 *
 * Page: /assistant (island front-end/islands/AsstChat.tsx; the rules
 * shared/quote-flow/step-composer.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

const TYPED =
  "Kitchen gut for Ana Lopez: demo the old kitchen, install IKEA cabinets she buys, quartz countertop 48 sqft.";
const QUESTION =
  "does this include the quartz slab material or just labor?? ¿y el precio incluye el permiso de plomería?";
const ADD_PERMIT = "add the plumbing permit if it's not in there";
/** The re-price templates the demo got instead of an answer. */
const TEMPLATES = ["Re-priced with your note", "couldn't re-price"];

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
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  }).then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Priya Nair",
    businessName: "Nair Kitchen & Bath",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

/** an island may still be hydrating when its button appears: click until the
 *  page shows the effect (the house pattern). */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch { /* not clickable yet */ }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** help me price it → the job → confirm the details → Pick a price. */
async function toPickAPrice(
  tools: StoryTools,
): Promise<Record<string, string>> {
  const { page, http, baseUrl } = tools;
  const auth = await signIn(http, page, baseUrl);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/assistant");
  await clickUntil(
    page,
    "button.chat__empty-prompt:has-text('help me price it')",
    () => page.locator(".chat__details-prompt-bubble").isVisible(),
  );
  await page.locator("textarea.composer__input").fill(TYPED);
  await page.locator("button.composer__send").click();
  await page.locator("[data-cy=confirm-details]").waitFor({
    state: "visible",
    timeout: 30_000,
  });
  await page.locator(".chat__jobopts .chat__price-continue").first().click();
  await page.locator("[data-cy=pricing-option]").first().waitFor({
    state: "visible",
    timeout: 30_000,
  });
  return auth;
}

interface StepBody {
  content?: string;
  step?: {
    id?: string;
    job?: string;
    scope?: string;
    options?: { label?: unknown; priceCents?: unknown }[];
    basis?: string;
  };
}

/** Open the compact box, type, send; returns the chat request's body. */
async function tellTheAssistant(
  page: StoryTools["page"],
  text: string,
): Promise<StepBody> {
  await clickUntil(
    page,
    ".chat__price-capture [data-cy=step-composer-open]",
    async () =>
      (await page.locator("[data-cy=step-composer-input]").count()) > 0,
  );
  const input = page.locator("[data-cy=step-composer-input]");
  await input.fill(text);
  const sent = page.waitForRequest((r) =>
    r.url().includes("/agents/chat") && r.method() === "POST"
  );
  const answered = page.waitForResponse((r) =>
    r.url().includes("/agents/chat") && r.request().method() === "POST"
  );
  answered.catch(() => {});
  await input.press("Enter");
  const req = await sent;
  await answered;
  return JSON.parse(req.postData() ?? "{}");
}

const tierTexts = (page: StoryTools["page"]) =>
  page.locator("[data-cy=pricing-option]").allInnerTexts();
const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US")}`;

Deno.test("REQ-444 M21: a question typed on Pick a price is answered on the step — it goes with the tiers on screen and what they include, never gets the re-price template, and the tiers stay", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    await toPickAPrice(tools);
    const before = await tierTexts(page);
    expect(before.length > 0, "tiers on screen");

    const body = await tellTheAssistant(page, QUESTION);
    expect.eq(body.content, QUESTION, "the question is what is sent");
    expect.eq(body.step?.id, "price", "sent with the step it was typed on");
    const options = body.step?.options ?? [];
    expect.eq(
      options.length,
      before.length,
      `the tiers on screen ride with it (${JSON.stringify(body.step)})`,
    );
    options.forEach((o, i) => {
      expect(
        typeof o.label === "string" && before[i].includes(o.label) &&
          typeof o.priceCents === "number" &&
          before[i].includes(money(o.priceCents)),
        `tier ${i + 1} is the one on screen (${JSON.stringify(o)} vs ${
          before[i]
        })`,
      );
    });
    expect(
      body.step?.basis === "labor_and_materials" ||
        body.step?.basis === "labor_materials_as_noted",
      `with what they include (${body.step?.basis})`,
    );

    const note = page.locator("[data-cy=step-composer-note]");
    await note.waitFor({ state: "visible", timeout: 30_000 });
    await note.hover(); // the evidence's frame of the answered step
    const said = (await note.innerText()).trim();
    expect(said.length > 0, "the answer shows on the step");
    for (const template of TEMPLATES) {
      expect(!said.includes(template), `not the re-price template: ${said}`);
    }
    expect.eq(
      JSON.stringify(await tierTexts(page)),
      JSON.stringify(before),
      "a question re-prices nothing",
    );
  }));

Deno.test("REQ-444 M21: an answer that adds the permit to the job details changes the step — the details on screen show it and the quote is drafted from them", (t) =>
  story(t, async (tools) => {
    const { page, expect } = tools;
    await toPickAPrice(tools);
    const recap = page.locator(".chat__price-details-recap-text");
    expect(
      !(await recap.innerText()).includes("Plumbing permit"),
      "no permit in the details yet",
    );

    // The chat model's update_job_details, stood in on the server's real
    // reply: the details on screen plus the permit.
    let rewritten = "";
    await page.route(
      (url) => url.pathname.endsWith("/agents/chat"),
      async (route) => {
        const sent = JSON.parse(route.request().postData() ?? "{}") as StepBody;
        const res = await route.fetch();
        const json = await res.json() as {
          newMessages?: {
            role?: string;
            content?: string;
            payload?: Record<string, unknown>;
          }[];
        };
        const shown = (sent.step?.scope ?? sent.step?.job ?? "").trim();
        rewritten = `${shown}\nPlumbing permit`.trim();
        for (const m of json.newMessages ?? []) {
          if (m.role !== "assistant" || m.payload?.step !== "price") continue;
          m.content =
            "The permit wasn't in the job details — I added it. Updated the job details: added Plumbing permit.";
          m.payload = { step: "price", scope: rewritten };
        }
        await route.fulfill({
          status: res.status(),
          contentType: "application/json",
          body: JSON.stringify(json),
        });
      },
    );

    await tellTheAssistant(page, ADD_PERMIT);
    const note = page.locator("[data-cy=step-composer-note]");
    await note.waitFor({ state: "visible", timeout: 30_000 });
    expect(
      (await note.innerText()).includes("added Plumbing permit"),
      "the answer shows on the step",
    );
    await page.waitForFunction(
      () =>
        (document.querySelector(".chat__price-details-recap-text")
          ?.textContent ?? "").includes("Plumbing permit"),
      undefined,
      { timeout: 10_000 },
    );
    await recap.hover(); // the evidence's frame of the new details
    expect.eq(
      await page.locator("[data-cy=pricing-option]").count() > 0,
      true,
      "the tiers are still there to pick",
    );

    // Pick a tier: the quote is drafted from the details on screen. Picking
    // creates the quote and loads the thread's page afresh, so the click goes
    // through the raw mouse (no post-click frame) and the story waits for the
    // load (as REQ-392's story does).
    const created = page.waitForRequest((r) =>
      /\/quotes$/.test(new URL(r.url()).pathname) && r.method() === "POST"
    );
    const tier = page.locator("[data-cy=pricing-option]").first();
    await tier.scrollIntoViewIfNeeded();
    const at = await tier.boundingBox();
    expect(at !== null, "the tier is on screen");
    const loaded = page.waitForEvent("load", { timeout: 30_000 });
    await page.mouse.click(at!.x + at!.width / 2, at!.y + at!.height / 2);
    const quote = JSON.parse((await created).postData() ?? "{}") as {
      description?: string;
      descriptionByLang?: Record<string, string>;
    };
    await loaded;
    expect.eq(
      quote.description,
      rewritten,
      "the quote's job details are the ones on screen",
    );
    expect(
      (quote.description ?? "").includes("Plumbing permit"),
      `with the permit (${quote.description})`,
    );
    const byLang = quote.descriptionByLang ?? {};
    expect(
      byLang.en === undefined || byLang.en === rewritten,
      `the English copy is the new one (${byLang.en})`,
    );
    expect.eq(
      byLang.es,
      undefined,
      "a language the answer didn't rewrite is not kept stale — the send translates it",
    );
  }));
