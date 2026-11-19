/**
 * REQ-1057 (LOOP-007 cycle 2, q2-44) — "Assistant confirms the customer,
 * then immediately asks 'Who is this for?'".
 *
 * A draft quote for a saved customer (Maria Gonzalez), locked in the
 * assistant: the lock prompt says "Quote locked! This one's for Maria
 * Gonzalez — let's set the terms." After Continue, the customer step opens
 * on the one-tap "Use Maria Gonzalez / Change" card (REQ-331) — and that
 * card must CONFIRM her, not ask the open "Who is this for?" question the
 * unknown-customer pick list asks.
 *
 * Page: /assistant/[id] (CustomerStepPanel in front-end/islands/AsstChat.tsx;
 * the lock prompt from backend/src/agents/domain/coordinators/lock-quote).
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const NAME = "Maria Gonzalez";

type Lang = "en" | "es";

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: Lang,
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
      ["/api/me", { name: "Known User", language: lang }],
      ["/api/profile/identity", { businessName: "Known Tile" }],
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
      { name: "pm_lang", value: lang, domain, path: "/" },
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

/** Regrout for Maria Gonzalez $400, locked in the assistant → Continue. */
async function lockAndContinue(tools: StoryTools, lang: Lang) {
  const { page, http, baseUrl } = tools;
  const auth = await signIn(http, page, baseUrl, lang);
  const maria = await postJson(http, auth, "/api/customers", {
    name: NAME,
    email: "maria.gonzalez@blackhole.postmarkapp.com",
  }) as { id: string };
  const quote = await postJson(http, auth, "/api/quotes", {
    customerId: maria.id,
    summary: "Regrout",
    jobName: "Regrout",
    lineItems: [{
      description: "Regrout",
      quantity: 1,
      unit: "ea",
      price: 40_000,
    }],
    estimatedTotal: 40_000,
    status: "draft",
  }) as { id: string };
  const conv = await postJson(http, auth, "/api/agents/conversations", {
    quoteId: quote.id,
  }) as { id: string };
  await postJson(
    http,
    auth,
    `/api/agents/conversations/${conv.id}/lock-quote`,
    { quoteId: quote.id },
  );
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`/assistant/${conv.id}`);
  // what the contractor reads right before Continue: the lock prompt
  const title = page.locator(".continue-cta__title").last();
  await title.waitFor({ state: "visible", timeout: 30_000 });
  const lockPrompt = (await title.innerText()).trim();
  const useKnown = page.locator('[data-cy="customer-use-known"]');
  await clickUntil(
    page,
    "button.continue-cta__btn",
    async () => await useKnown.isVisible(),
  );
  await useKnown.waitFor({ state: "visible", timeout: 20_000 });
  await useKnown.hover(); // the card, on screen, in the evidence
  return lockPrompt;
}

/** Read, in one pass, the thread's text and the known card's heading. */
async function readScreen(page: StoryTools["page"]) {
  return await page.evaluate(() => {
    const btn = document.querySelector('[data-cy="customer-use-known"]');
    // the known card's root: the parent of the options column the
    // "Use <name>" / "Change" buttons sit in
    const card = btn?.closest(".wiz__opts")?.parentElement ?? null;
    const heading =
      card?.querySelector(":scope > h3.wiz__step-q")?.textContent ?? "";
    const hint = card?.querySelector(":scope > .wiz__step-hint")?.textContent ??
      "";
    const headings = [...document.querySelectorAll("h3.wiz__step-q")].map((
      h,
    ) => (h.textContent ?? "").trim());
    return {
      heading: heading.trim(),
      hint: hint.trim(),
      headings,
      thread: document.body.innerText ?? "",
    };
  });
}

const COPY = {
  en: {
    lock: `This one's for ${NAME}`,
    ask: /who is this for\?/i,
  },
  es: {
    lock: `Es para ${NAME}`,
    ask: /¿?para quién es esto\?/i,
  },
} as const;

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-1057 q2-44 (${lang}): after the lock prompt names ${NAME}, the known-customer card confirms her — never 'Who is this for?'`, (t) =>
    story(t, async (tools) => {
      const { page, expect } = tools;
      const lockPrompt = await lockAndContinue(tools, lang);
      const s = await readScreen(page);

      expect(
        lockPrompt.includes(COPY[lang].lock),
        `the lock prompt names ${NAME} (got "${lockPrompt}")`,
      );
      expect(
        !s.headings.some((h) => COPY[lang].ask.test(h)),
        `no step heading asks the open question once ${NAME} is known (got headings ${
          JSON.stringify(s.headings)
        })`,
      );
      expect(
        !COPY[lang].ask.test(s.heading),
        `the known-customer card's heading is not the open question (got "${s.heading}")`,
      );
      expect(
        s.heading === "" || s.heading.includes(NAME),
        `the known-customer card's heading names ${NAME} or there is none (got "${s.heading}")`,
      );
    }));
}
