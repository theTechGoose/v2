/**
 * REQ-513 (demo-loop cycle 3, issue p8-pair1-b) — "'Upload your logo' opens the top of Settings".
 *
 * The demo tapped the dashboard checklist's "Upload your logo" and landed on the hero of
 * /settings, the logo button several screens down. Here, on the real shell at a phone's size:
 * an account past onboarding with the logo and insurance put off sees the checklist; its logo
 * item opens /settings#logo with the logo button on screen and focused, and its insurance item
 * opens /settings#insurance with that card on screen — never the top of the page.
 */
import { story, type StoryTools } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const PHONE = { width: 390, height: 740 };

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return { auth };
}

/** the section the hash names is on screen, the page has scrolled to it, and focus sits inside it */
async function landedOn(page: StoryTools["page"], anchor: string) {
  await page.waitForFunction(
    (id: string) => {
      const el = document.getElementById(id);
      if (!el || location.hash !== `#${id}`) return false;
      const r = el.getBoundingClientRect();
      const onScreen = r.top < innerHeight && r.bottom > 0 && r.top > -r.height;
      return onScreen && scrollY > 0 && !!document.activeElement &&
        el.contains(document.activeElement);
    },
    anchor,
    { timeout: 15_000 },
  ).catch(async () => {
    const seen = await page.evaluate((id: string) => {
      const el = document.getElementById(id);
      return {
        url: location.pathname + location.hash,
        exists: !!el,
        top: el?.getBoundingClientRect().top ?? null,
        scrollY,
        focused: document.activeElement?.outerHTML.slice(0, 120) ?? null,
      };
    }, anchor);
    throw new Error(`#${anchor} was not revealed: ${JSON.stringify(seen)}`);
  });
}

Deno.test("REQ-513 p8-pair1-b: the dashboard checklist's 'Upload your logo' opens Settings at the logo button (focused, on screen), and 'Insurance' opens the insurance card — not the top of Settings", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { except: ["logo", "insurance"] });
    for (const question of ["logo", "insurance"]) {
      const r = await http("/api/me/onboarding/deferred", {
        method: "POST",
        headers: auth,
        body: JSON.stringify({ question }),
      });
      if (!r.ok) {
        throw new Error(`defer ${question}: ${r.status} ${await r.text()}`);
      }
      await r.body?.cancel();
    }
    await page.setViewportSize(PHONE);

    await page.goto("/dashboard");
    const logoItem = page.getByRole("link", { name: "Upload your logo" });
    await logoItem.waitFor({ timeout: 20_000 });
    expect.eq(
      await logoItem.getAttribute("href"),
      "/settings#logo",
      "the logo item links to its section",
    );
    await logoItem.click();
    await page.waitForURL((u: URL) => u.pathname === "/settings", {
      timeout: 20_000,
    });
    await landedOn(page, "logo");
    const focused = await page.evaluate(() =>
      (document.activeElement as HTMLElement | null)?.getAttribute(
        "aria-label",
      ) ?? ""
    );
    expect(
      /logo/i.test(focused),
      `the logo upload button has focus (got "${focused}")`,
    );

    await page.goto("/dashboard");
    const insuranceItem = page.getByRole("link", {
      name: "Insurance (optional but helps)",
    });
    await insuranceItem.waitFor({ timeout: 20_000 });
    await insuranceItem.click();
    await page.waitForURL((u: URL) => u.pathname === "/settings", {
      timeout: 20_000,
    });
    await landedOn(page, "insurance");
  }));
