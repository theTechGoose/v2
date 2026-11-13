/**
 * REQ-287 — "fix every issue the demo found": demo issue test-setup-claims-m2
 * ("The ⌘N and ⌘K shortcut hints advertise shortcuts that have no handler").
 *
 * In a browser, on /assistant: the New-conversation button shows no "⌘N" chip
 * and no modifier-key hint (⌘K, Ctrl+…) appears anywhere on the page — the
 * app binds no modifier shortcut, and Cmd/Ctrl+N is the browser's own
 * new-window key. (Both dictionaries are pinned by the unit test.)
 *
 * Pages: front-end/islands/AsstThreads.tsx (and AsstComposer.tsx, which the
 * live page does not mount — AsstChat renders the composer hint).
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
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
  await answerQuestions(http, auth, {
    name: "Hint User",
    businessName: "Hint Business",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: lang, domain: host, path: "/" },
  ]);
}

Deno.test("REQ-287: /assistant advertises no ⌘N / ⌘K (or any modifier) shortcut that nothing handles", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signIn(http, page, baseUrl, "en");
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/assistant");
    await page.locator(".threads__new").waitFor({ state: "visible" });
    await page.locator(".composer__hint").waitFor({ state: "visible" });

    expect.eq(
      await page.locator(".threads__new-kbd").count(),
      0,
      "the New-conversation button has no keyboard chip",
    );
    const newBtn = (await page.locator(".threads__new").innerText()).trim();
    expect(
      !newBtn.includes("⌘"),
      `New-conversation reads "${newBtn}" — no ⌘`,
    );
    const hint = (await page.locator(".composer__hint").innerText()).trim();
    expect(
      !/⌘|Ctrl\s*\+/.test(hint),
      `composer hint reads "${hint}" — no ⌘/Ctrl`,
    );
    // The only shortcut the app binds is GlobalSearch's bare "/" — no modifier
    // hint (⌘/⌥/Ctrl+/Alt+) may appear anywhere on the page.
    const body = await page.locator("body").innerText();
    const dead = body.match(/(?:⌘|⌥|\b(?:Ctrl|Alt|Cmd)\s*\+\s*)[A-Za-z0-9]/g);
    expect(dead === null, `no modifier-key hint on the page (found ${dead})`);
  }));
