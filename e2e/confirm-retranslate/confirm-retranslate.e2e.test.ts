/**
 * REQ-441 — demo-loop cycle 3, issue M23: "Spanish customer copy drops the
 * user-added job line (es 10 lines vs en 11)".
 *
 * In "help me price it" the contractor confirms a drafted card after adding a
 * line with "Add your own…". The quote used to be created with the English
 * description carrying the added line but the Spanish copy taken from the
 * card's ORIGINAL pre-generated bullets — one line short. Now the edited
 * lines are translated for the other language before the quote is created.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

const TYPED = "Swap the bathroom vanity and hook up the plumbing";
const EN = ["Remove old vanity", "Install new vanity"];
const ES = ["Retirar el mueble viejo", "Instalar el mueble nuevo"];
const ADDED = "Haul away debris";
const ES_OF: Record<string, string> = {
  [EN[0]]: ES[0],
  [EN[1]]: ES[1],
  [ADDED]: "Retirar los escombros",
};
const OPTIONS = {
  options: [1, 2, 3].map((n) => ({
    id: `opt${n}`,
    jobName: `Vanity swap ${n}`,
    summary: `Vanity swap ${n}`,
    bullets: n === 1 ? EN : [...EN, `Extra ${n}`],
    byLang: {
      en: {
        jobName: `Vanity swap ${n}`,
        summary: `Vanity swap ${n}`,
        bullets: n === 1 ? EN : [...EN, `Extra ${n}`],
      },
      es: {
        jobName: `Cambio de mueble ${n}`,
        summary: `Cambio de mueble ${n}`,
        bullets: n === 1 ? ES : [...ES, `Extra ${n}`],
      },
    },
  })),
  langs: ["en", "es"],
};

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  })
    .then((x) => x.body?.cancel());
  await answerQuestions(http, auth, {
    name: "Vanity Pro",
    businessName: "Vanity Pro LLC",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
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

Deno.test("REQ-441 M23: a line added with 'Add your own…' on the confirmed card reaches the quote's Spanish copy", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.route(
      "**/api/agents/job-details/options",
      (route) =>
        route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(OPTIONS),
        }),
    );
    const translated: string[][] = [];
    await page.route("**/agents/job-details/translate", async (route) => {
      const { texts } = JSON.parse(route.request().postData() ?? "{}") as {
        texts: string[];
      };
      translated.push(texts);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ texts: texts.map((x) => ES_OF[x] ?? x) }),
      });
    });
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

    // The first card is selected: add a line of our own to it.
    const add = page.locator(".chat__jobopt-add-input").first();
    await add.waitFor({ state: "visible", timeout: 10_000 });
    await add.fill(ADDED);
    await add.press("Enter");
    await page.locator(".chat__jobopts .chat__price-continue").first().click();

    const create = page.waitForRequest((r) =>
      /\/quotes$/.test(new URL(r.url()).pathname) && r.method() === "POST"
    );
    const tier = page.locator("[data-cy=pricing-option]").first();
    await tier.waitFor({ state: "visible", timeout: 30_000 });
    await tier.click();
    const body = JSON.parse((await create).postData() ?? "{}") as {
      description?: string;
      descriptionByLang?: Record<string, string>;
    };
    expect.eq(
      body.descriptionByLang?.en,
      [...EN, ADDED].join("\n"),
      "the English copy carries the added line",
    );
    expect.eq(
      body.descriptionByLang?.es,
      [...ES, "Retirar los escombros"].join("\n"),
      "the Spanish copy carries the added line too — translated, never the pre-edit 2-line copy",
    );
    expect.eq(
      JSON.stringify(translated),
      JSON.stringify([[...EN, ADDED]]),
      "the edited lines were translated once, for Spanish",
    );
  }));
