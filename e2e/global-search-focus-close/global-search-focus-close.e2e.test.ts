/**
 * REQ-976 (LOOP-007 cycle 1, q1-57) — on /communications the header search
 * (front-end/islands/GlobalSearch.tsx) stayed open with a stale
 * "No match for “512”" after focus moved to another field. The panel closed
 * only on an outside mousedown, Escape or a row pick — never when focus left
 * by keyboard or a programmatic focus — and a debounced /search answer that
 * landed after the user clicked away re-opened it.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
) {
  const phone = `+1512${digits()}`;
  // under host load the backend can still be booting when the front end is up
  let r: Response;
  let body: Record<string, unknown>;
  for (let tries = 0;; tries++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable" || tries >= 90) break;
    await new Promise((res) => setTimeout(res, 1_000));
  }
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Search Focus Story" }),
  });
  await me.body?.cancel();
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

const INPUT = "[data-cy='global-search-input']";
const PANEL = "[data-cy='global-search-results']";
const AREA_CODE = "[data-cy='comms-search']";

/** true once the results panel is gone; false if it is still up after `ms` */
async function panelGoneWithin(
  page: StoryTools["page"],
  ms: number,
): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if ((await page.locator(PANEL).count()) === 0) return true;
    await page.waitForTimeout(100);
  }
  return (await page.locator(PANEL).count()) === 0;
}

/** type a query and wait for the panel to answer THAT query with "no match" */
async function noMatchFor(page: StoryTools["page"], q: string) {
  await page.locator(INPUT).fill(q);
  await page.locator(
    `${PANEL}[data-state='ready'][data-q='${q}'] [data-cy='global-search-empty']`,
  ).waitFor({ timeout: 15_000 });
}

Deno.test("REQ-976 q1-57: on /communications, '512' answers 'no match' and the panel closes when focus moves on — by Tab and by focusing the area-code field", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Search Focus Story" });
    await page.goto("/communications");
    await page.locator(INPUT).waitFor({ timeout: 15_000 });
    await page.locator(AREA_CODE).waitFor({ timeout: 15_000 });

    await noMatchFor(page, "512");
    await page.keyboard.press("Tab");
    const tabbed = await page.evaluate(() =>
      !document.activeElement?.closest("[data-cy='global-search']")
    );
    expect(tabbed, "precondition: Tab moved focus out of the search box");
    expect(
      await panelGoneWithin(page, 2_000),
      "REQ-976: after Tab the search panel still shows the stale 'No match for “512”'",
    );

    // back in the box (the panel re-opens on focus), then focus the area-code field directly
    await page.locator(INPUT).focus();
    await noMatchFor(page, "5120");
    await page.locator(AREA_CODE).focus();
    expect(
      await panelGoneWithin(page, 2_000),
      "REQ-976: after focus moved to the area-code field the search panel is still open",
    );
  }));

Deno.test("REQ-976 q1-57: typing in the header search and clicking the area-code field right away — the late search answer does not re-open the panel", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Search Focus Story" });
    await page.goto("/communications");
    await page.locator(INPUT).waitFor({ timeout: 15_000 });
    await page.locator(AREA_CODE).waitFor({ timeout: 15_000 });

    // the box is hydrated: typing opens its panel
    await page.locator(INPUT).fill("51");
    await page.locator(PANEL).waitFor({ timeout: 15_000 });
    // a real network: the '512' answer is held in flight until the click has landed
    let release: () => void = () => {};
    const held = new Promise<void>((r) => release = r);
    let asked: () => void = () => {};
    const requested = new Promise<void>((r) => asked = r);
    await page.route(
      (u) =>
        u.pathname.endsWith("/search") && u.searchParams.get("q") === "512",
      async (route) => {
        asked();
        await held;
        await route.continue();
      },
    );
    // type, then click the area-code field while the search is in flight
    await page.locator(INPUT).fill("512");
    await page.locator(AREA_CODE).click();
    expect(
      await page.evaluate(() =>
        document.activeElement?.getAttribute("data-cy") === "comms-search"
      ),
      "precondition: focus is in the area-code field",
    );
    await requested; // the debounced '512' search went out
    expect(
      await panelGoneWithin(page, 2_000),
      "precondition: the click outside closed the search panel",
    );
    // armed only now: the held request cannot answer before release(), and a
    // timer started before fill+click+the 2 s wait expired on a loaded host
    const searched = page.waitForResponse(
      (r) =>
        new URL(r.url()).pathname.endsWith("/search") &&
        new URL(r.url()).searchParams.get("q") === "512",
      { timeout: 15_000 },
    );
    release();
    await searched; // the late answer for '512' has landed
    await page.waitForTimeout(500); // and has had time to render
    expect.eq(
      await page.locator(PANEL).count(),
      0,
      "REQ-976: the late '512' answer re-opened the search panel after the click moved focus away",
    );
  }));
