/**
 * REQ-400 — demo-loop cycle 2, issue M5 (pair 7, Priya 09:11–09:12): "Edit
 * job details → the ENGLISH preview now shows first 3 bullets in SPANISH,
 * then 3 English ones."
 *
 * The review card's pencil seeded the job picker with the rows the card was
 * SHOWING — the preview language's, Spanish with the toggle on Español — and
 * applyJobOption stored the picked card's lines as the contractor's own
 * (English) description. In the browser now: an English contractor with a
 * quote whose details exist in English and Spanish previews it in Español,
 * opens "Edit job details", adds an English line and continues — the picker's
 * current card held the ENGLISH lines, and the English preview and the stored
 * description carry no Spanish line.
 *
 * Page: front-end/routes/assistant/[threadId].tsx → islands/AsstChat.tsx
 * (editJobDetails → shared/quote-flow/edit-job-details.ts).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const EN_LINES = [
  "Remove old tub/shower combo",
  "Install curbless walk-in shower",
  "Porcelain tile 12x24 on walls",
];
const ES_LINES = [
  "Retirar la bañera/ducha antigua",
  "Instalar ducha a nivel del suelo",
  "Azulejos de porcelana 12x24 en paredes",
];
const ADDED = "Heated bathroom floor";

type Http = StoryTools["http"];

async function signIn(http: Http, page: StoryTools["page"], baseUrl: string) {
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
  // The demo's account: sends in English AND Spanish — the review card
  // offers the "Preview in" English | Español toggle.
  await http("/api/profile/identity", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ commsLanguages: ["en", "es"] }),
  }).then((x) => x.body?.cancel());
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
  return auth;
}

async function api(
  http: Http,
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(`/api${path}`, {
    method,
    headers: auth,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  if (r.status >= 400) {
    throw new Error(`${method} ${path} → ${r.status} ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

/** The quote as the picker left it (details in English + Spanish), locked,
 *  its terms answered up to the send CTA. */
async function quoteAtReview(
  http: Http,
  auth: Record<string, string>,
): Promise<{ convoId: string; quoteId: string }> {
  const quote = await api(http, auth, "POST", "/quotes", {
    summary: "Master bath remodel",
    jobName: "Master Bath Remodel",
    description: EN_LINES.join("\n"),
    descriptionByLang: {
      en: EN_LINES.join("\n"),
      es: ES_LINES.join("\n"),
    },
    lang: "en",
    lineItems: [{
      description: "Master bath remodel",
      quantity: 1,
      unit: "ea",
      price: 2_800_000,
    }],
    estimatedTotal: 2_800_000,
    status: "draft",
  });
  const conv = await api(http, auth, "POST", "/agents/conversations", {
    quoteId: quote.id,
  });
  const convoId: string = conv?.id ?? conv?.conversation?.id;
  await api(http, auth, "POST", `/agents/conversations/${convoId}/lock-quote`, {
    quoteId: quote.id,
  });
  const trans = await api(
    http,
    auth,
    "POST",
    `/agents/conversations/${convoId}/transition-to-terms`,
    {},
  );
  await api(http, auth, "POST", "/agents/wizard/answer", {
    conversationId: convoId,
    stepId: trans?.activeStepId ?? "customer",
    optionId: "create_new",
    customValue: "Maria Gutierrez",
  });
  for (let i = 0; i < 15; i++) {
    const snap = await api(
      http,
      auth,
      "GET",
      `/agents/conversations/${convoId}`,
    );
    const msgs = (snap?.messages ?? []) as Array<
      { kind?: string; payload?: Record<string, unknown> }
    >;
    if (
      msgs.some((m) =>
        m.kind === "continue_cta" && m.payload?.toPhase === "send"
      )
    ) return { convoId, quoteId: quote.id };
    const last = [...msgs].reverse().find((m) => m.kind === "wizard");
    const p = (last?.payload ?? {}) as {
      stepId?: string;
      options?: Array<{ id?: string }>;
    };
    const optionId = p.options?.find((o) => o.id && o.id !== "custom")?.id;
    if (!p.stepId || !optionId) {
      await new Promise((r) => setTimeout(r, 500));
      continue;
    }
    await api(http, auth, "POST", "/agents/wizard/answer", {
      conversationId: convoId,
      stepId: p.stepId,
      optionId,
    });
  }
  throw new Error("the wizard never reached the send CTA");
}

/** An island may still be hydrating when its button appears: click until
 *  the page shows the effect. */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
) {
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
}

Deno.test("REQ-400 M5: preview in Español → Edit job details → add an English line → the English details hold no Spanish line", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const { convoId, quoteId } = await quoteAtReview(http, auth);
    await page.setViewportSize({ width: 1280, height: 900 });

    await page.goto(`/assistant/${convoId}`);
    const review = page.locator(".quote-review").first();
    await review.waitFor({ state: "visible", timeout: 20_000 });
    const details = review.locator(".quote-review__section", {
      has: page.locator('[data-cy="review-job-details-edit"]'),
    });
    const detailText = async () =>
      (await details.innerText()).replace(/\s+/g, " ");

    // The demo's step: the "Preview in" toggle on Español.
    const espanol = ".quote-review__langpill:has-text('Español')";
    await clickUntil(
      page,
      espanol,
      async () => (await detailText()).includes(ES_LINES[0]),
    );
    expect(
      (await detailText()).includes(ES_LINES[0]),
      `the Spanish preview shows the Spanish details ("${await detailText()}")`,
    );

    // "Edit job details" → the picker opens (first its "Writing up your
    // options…" wait), then on the CURRENT card, pre-selected.
    await clickUntil(
      page,
      '[data-cy="review-job-details-edit"]',
      () => page.locator(".chat__jobopts").first().isVisible(),
    );
    const current = page.locator(".chat__jobopt.is-selected").first();
    await current.waitFor({ state: "visible", timeout: 60_000 });
    const seeded = (await current.locator(".chat__jobopt-text").allInnerTexts())
      .map((s) => s.trim());
    expect.eq(
      JSON.stringify(seeded),
      JSON.stringify(EN_LINES),
      "the current card is the contractor's own English lines, not the Spanish preview rows",
    );
    // REQ-446 (cycle 3, m13): the pencil edits the current card in place —
    // no regenerated, reworded alternatives beside it.
    expect.eq(
      await page.locator(".chat__jobopt").count(),
      1,
      "the pencil opens the current card alone (REQ-446)",
    );

    // Add an English line and continue.
    const add = current.locator(".chat__jobopt-add-input");
    await add.fill(ADDED);
    await add.press("Enter");
    // A custom line asks "Want me to professionalize that?" — keep it as
    // typed.
    const pop = page.locator(".chat__pro-pop").first();
    const popped = await pop.waitFor({ state: "visible", timeout: 5_000 })
      .then(() => true, () => false);
    if (popped) {
      await page.locator(".chat__pro-pop-no").first().click();
      await pop.waitFor({ state: "hidden", timeout: 10_000 });
    }
    await page.locator(".chat__jobopts .chat__price-continue").first().click();

    // Back on the review card: switch to English and read the details.
    await review.waitFor({ state: "visible", timeout: 20_000 });
    await clickUntil(
      page,
      ".quote-review__langpill:has-text('English')",
      async () => (await detailText()).includes(ADDED),
    );
    const english = await detailText();
    expect(english.includes(ADDED), `the added line is there ("${english}")`);
    for (const es of ES_LINES) {
      expect(
        !english.includes(es),
        `the English preview carries no Spanish line "${es}" ("${english}")`,
      );
    }

    // And what is stored: the quote's own (English) description.
    const stored = await api(http, auth, "GET", `/quotes/${quoteId}`);
    const lines = String(stored.description ?? "").split("\n");
    for (const es of ES_LINES) {
      expect(
        !lines.includes(es),
        `the stored description has no Spanish line (${JSON.stringify(lines)})`,
      );
    }
    expect(lines.includes(ADDED), `the stored description has the added line`);
    const storedEn = String(stored.descriptionByLang?.en ?? "").split("\n");
    for (const es of ES_LINES) {
      expect(
        !storedEn.includes(es),
        `descriptionByLang.en has no Spanish line (${
          JSON.stringify(storedEn)
        })`,
      );
    }
  }));
