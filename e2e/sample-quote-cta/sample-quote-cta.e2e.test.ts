/**
 * REQ-614 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 4, issue m16: "Onboarding sample quote sits in the
 * pipeline with 'Finish + send'".
 *
 * A junk-removal business makes its sample the way the wizard does
 * (POST /api/agents/conversations/sample-quote), then on /quotes:
 *   - the sample card's front CTA reads "View sample" (never "Finish + send")
 *     and links to the customer view /q/<id>;
 *   - the quote panel opened from the card's back ("Open quote") says it is a
 *     sample and offers no Copy link and no Edit.
 *
 * Copy pinned (lang/en.json): quoteCard.cta.viewSample,
 * quoteCard.cta.finishSend, quotesPage.open.sampleNote,
 * quotesPage.open.copyLink.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const en = JSON.parse(
  await Deno.readTextFile(new URL("../../lang/en.json", import.meta.url)),
) as Record<string, string>;

async function junkHaulerWithSample(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
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
  const send = async (path: string, payload: unknown, method = "POST") =>
    await (await http(path, {
      method,
      headers: auth,
      body: JSON.stringify(payload),
    })).json();
  await send("/api/me", { name: "Dana Ortiz", language: "en" }, "PUT");
  await send(
    "/api/profile/identity",
    { businessName: "Haul-Away Junk Removal" },
    "PUT",
  );
  const made = await send("/api/agents/conversations/sample-quote", {});
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth, quoteId: made.quoteId as string };
}

Deno.test("REQ-614: the sample card's CTA is 'View sample' to /q/<id>, and its panel offers no Copy link", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { quoteId } = await junkHaulerWithSample(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");
    const card = page.locator(".qcard", {
      hasText: en["ensureSampleQuote.junk.jobName"],
    }).first();
    await card.waitFor({ timeout: 15_000 });
    const cta = card.locator('[data-cy="qcard-cta"]');
    const text = (await cta.innerText()).replace(/\s+/g, " ").trim();
    expect(
      !text.includes(en["quoteCard.cta.finishSend"]),
      `the sample offers no "${en["quoteCard.cta.finishSend"]}" (${text})`,
    );
    expect(
      text.startsWith(en["quoteCard.cta.viewSample"]),
      `the sample CTA reads "${en["quoteCard.cta.viewSample"]}" (${text})`,
    );
    const href = await cta.getAttribute("href");
    expect(href === `/q/${quoteId}`, `the CTA opens /q/${quoteId} (${href})`);

    await page.goto(`/quotes?open=${encodeURIComponent(quoteId)}`);
    const panel = page.locator('[data-cy="quote-open-panel"]');
    await panel.waitFor({ timeout: 15_000 });
    await page.locator('[data-cy="quote-sample-note"]').waitFor({
      timeout: 15_000,
    });
    const actions = await panel.innerText();
    expect(
      !actions.includes(en["quotesPage.open.copyLink"]),
      `no Copy link on the sample's panel`,
    );
    expect(
      (await panel.locator('[data-cy="quote-edit"]').count()) === 0,
      "no Edit on the sample's panel",
    );
  }));
