/**
 * REQ-360 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 1, issue m11: "Onboarding sample quote looks like
 * real data (in search with Resend) and doesn't fit the trade".
 *
 * A junk-removal business makes its sample the way the wizard does
 * (POST /api/agents/conversations/sample-quote), then:
 *   - the sample is a junk-removal job, not "Home Repair Visit";
 *   - the topbar search (GET /api/search) never lists it;
 *   - /quotes: the Drafting track says "+ sample" over the sample card, and
 *     the sample card offers no Resend and no Copy link.
 *
 * Copy pinned (lang/en.json): ensureSampleQuote.junk.jobName,
 * quoteTrack.count.plusSample, quoteCard.back.resend, quoteCard.back.copyLink.
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

Deno.test("REQ-360: a junk hauler's sample is a junk-removal job and never shows up in search", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth, quoteId } = await junkHaulerWithSample(http, page, baseUrl);
    const jobName = en["ensureSampleQuote.junk.jobName"];
    expect(!!jobName, "the junk-removal job has English copy");
    const q = await (await http(`/api/quotes/${quoteId}`, { headers: auth }))
      .json();
    expect(
      q.jobName === jobName,
      `the sample's job is the junk-removal job (${q.jobName})`,
    );
    for (const term of [jobName, quoteId.slice(0, 8).toUpperCase(), "draft"]) {
      const r = await (await http(
        `/api/search?q=${encodeURIComponent(term)}`,
        { headers: auth },
      )).json();
      const ids = (r.results ?? []).map((h: { id: string }) => h.id);
      expect(
        !ids.includes(quoteId),
        `search "${term}" does not list the sample (${JSON.stringify(ids)})`,
      );
    }
  }));

Deno.test("REQ-360: /quotes says the Drafting track holds a sample, and the sample card offers no Resend or Copy link", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await junkHaulerWithSample(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto("/quotes");
    const card = page.locator(".qcard", {
      hasText: en["ensureSampleQuote.junk.jobName"],
    });
    await card.first().waitFor({ timeout: 15_000 });
    const head = (await page.locator(".qtrack", {
      has: page.locator(".qtrack__num", { hasText: "02" }),
    }).locator(".qtrack__count").innerText()).replace(/\s+/g, " ");
    expect(
      head.includes(en["quoteTrack.count.plusSample"].trim()),
      `the Drafting header says the sample is there (${head})`,
    );
    const foot = await card.first().locator(".qcard__back-foot").innerText();
    expect(
      !foot.includes(en["quoteCard.back.resend"]),
      `no Resend on the sample (${foot})`,
    );
    expect(
      !foot.includes(en["quoteCard.back.copyLink"]),
      `no Copy link on the sample (${foot})`,
    );
  }));
