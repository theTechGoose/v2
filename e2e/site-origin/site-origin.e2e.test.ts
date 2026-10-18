/**
 * REQ-085 — Raphael, 2026-10-18, a screenshot of the /landing2 signup card in
 * prod answering his own number with "No pudimos mandar el código. Inténtalo
 * de nuevo.": "in prod, this makes no sesne" — then "fix it."
 *
 * The site's own origin is documonster.com. The old domain is a forwarder now
 * (301 for "/", 404 for every other path, 405 to a POST, no CORS), and prod
 * still told the browser to call the API there — so the card's request died
 * on the preflight and never reached the backend. The code names the new
 * origin everywhere (SITE_ORIGIN, the sitemap, robots), and the card's one
 * request goes to the page's own origin.
 *
 * Pages: front-end/routes/landing.tsx, landing2.tsx (canonical + og:url from
 * shared/quote-flow/site-meta.ts); static/sitemap.xml, static/robots.txt; the
 * signup island front-end/islands/Landing2Signup.tsx through lib/api.ts.
 */
import { story, type StoryTools } from "#shots";

const ORIGIN = "https://documonster.com";
const OLD_DOMAIN = /paperworkmonster\.com/i;
const DESKTOP = { width: 1280, height: 900 };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function headNames(
  page: StoryTools["page"],
  expect: StoryTools["expect"],
  path: string,
) {
  await page.goto(path);
  const canonical = await page.locator('link[rel="canonical"]').getAttribute(
    "href",
  );
  const og = await page.locator('meta[property="og:url"]').getAttribute(
    "content",
  );
  expect(
    canonical === `${ORIGIN}${path}`,
    `${path}: canonical is ${ORIGIN}${path} (got ${canonical})`,
  );
  expect(
    og === `${ORIGIN}${path}`,
    `${path}: og:url is ${ORIGIN}${path} (got ${og})`,
  );
}

Deno.test("REQ-085: the public pages' canonical and og:url name documonster.com", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    await headNames(page, expect, "/landing2");
    await headNames(page, expect, "/landing");
  }));

Deno.test("REQ-085: /sitemap.xml and /robots.txt name documonster.com and never the old domain", (t) =>
  story(t, async ({ page, expect, http }) => {
    await page.setViewportSize(DESKTOP);
    await page.goto("/sitemap.xml");
    const xml = await (await http("/sitemap.xml")).text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length > 0, `the sitemap lists pages (${locs.length})`);
    for (const loc of locs) {
      expect(
        loc.startsWith(`${ORIGIN}/`),
        `sitemap <loc> on the site's origin: ${loc}`,
      );
    }
    expect(!OLD_DOMAIN.test(xml), "the sitemap never names the old domain");

    await page.goto("/robots.txt");
    const robots = await (await http("/robots.txt")).text();
    expect(
      robots.includes(`Sitemap: ${ORIGIN}/sitemap.xml`),
      `robots.txt points at ${ORIGIN}/sitemap.xml`,
    );
    expect(!OLD_DOMAIN.test(robots), "robots.txt never names the old domain");
  }));

Deno.test("REQ-085: the signup card on /landing2 sends the code through the page's own origin", (t) =>
  story(t, async ({ page, expect }) => {
    await page.setViewportSize(DESKTOP);
    const sends: { url: string; status: number }[] = [];
    const failed: string[] = [];
    page.on("response", (res: { url(): string; status(): number }) => {
      if (res.url().includes("/auth/send-otp")) {
        sends.push({ url: res.url(), status: res.status() });
      }
    });
    page.on(
      "requestfailed",
      (req: { url(): string; failure(): { errorText: string } | null }) => {
        if (req.url().includes("/auth/send-otp")) {
          failed.push(`${req.url()} ${req.failure()?.errorText ?? ""}`);
        }
      },
    );

    await page.goto("/landing2");
    const origin = await page.evaluate(() => location.origin);
    await page.locator("#reg-phone").fill(`512${digits()}`);
    await page.locator("[data-cy='l2-send-code']").click();
    await page.locator("[data-cy='dev-code']").waitFor({
      state: "visible",
      timeout: 15_000,
    });

    expect(
      failed.length === 0,
      `no send-otp request failed in the browser (${failed.join("; ")})`,
    );
    expect(
      sends.length === 1,
      `exactly one send-otp request (${sends.length})`,
    );
    expect(
      sends[0]?.url === `${origin}/api/auth/send-otp`,
      `the request is on the page's own origin: ${
        sends[0]?.url
      } (page ${origin})`,
    );
    expect(
      sends[0]?.status === 200,
      `the backend answered 200 (${sends[0]?.status})`,
    );
    expect(
      await page.locator("#reg-code").isVisible(),
      "the card is on the code step",
    );
    expect(
      (await page.locator("[role='alert']").count()) === 0,
      "no error line on the card",
    );
  }));
