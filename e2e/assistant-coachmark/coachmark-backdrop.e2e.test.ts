/**
 * REQ-290 — demo cycle 1, issues m17 + p12: in a browser, the dashboard's coach overlay (a fresh
 * account's first visit) is drawn with no backdrop-filter — the spotlighted "My assistant" item
 * stays sharp — and its hint reads "Tap anywhere to dismiss"; and the stage's mirror frame shell
 * (MIRROR_SRCDOC) forces backdrop-filter to none on anything mirrored into it, so a scaled stage
 * paints no ghost checklist.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";
import { MIRROR_SRCDOC } from "../../front-end/lib/demo-mode/mirror-replay.ts";

const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;
const JSON_HEADERS = { "content-type": "application/json" };

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
  // the account's own language wins over the pm_lang cookie — pin it to English
  await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  });
  await answerQuestions(http, auth, {
    name: "Coach User",
    businessName: "Coach Business",
  });
  const [name, value] = cookie.split("=");
  const host = new URL(baseUrl).hostname;
  await page.context().addCookies([
    { name, value, domain: host, path: "/" },
    { name: "pm_lang", value: "en", domain: host, path: "/" },
  ]);
}

Deno.test("REQ-290: the dashboard coach overlay has no backdrop-filter and reads 'Tap anywhere to dismiss'; the stage's mirror frame forces backdrop-filter to none", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await signIn(http, page, baseUrl);
    await page.goto("/dashboard");
    const dialog = page.locator("[role='dialog'][aria-label]").first();
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    const seen = await dialog.evaluate((el) => {
      const cs = getComputedStyle(el);
      return {
        backdrop: cs.getPropertyValue("backdrop-filter") ||
          cs.getPropertyValue("-webkit-backdrop-filter"),
        inline: el.getAttribute("style") ?? "",
        text: (el.textContent ?? "").replace(/\s+/g, " ").trim(),
      };
    });
    expect(
      seen.backdrop === "none",
      `the coach overlay computes no backdrop-filter (got "${seen.backdrop}")`,
    );
    expect(
      !/backdrop-filter/i.test(seen.inline),
      "the coach overlay declares no backdrop-filter inline",
    );
    expect(
      seen.text.includes("Tap anywhere to dismiss"),
      `the hint reads "Tap anywhere to dismiss" (got "${seen.text}")`,
    );
    expect(!seen.text.includes("tap anywhere to dismiss"), "no lowercase hint");

    // the stage's frame shell: anything mirrored into it with a backdrop-filter computes to none
    await page.goto("about:blank");
    const stage = await page.evaluate(async (srcdoc) => {
      const f = document.createElement("iframe");
      f.srcdoc = srcdoc;
      document.body.appendChild(f);
      await new Promise((r) => (f.onload = r));
      const d = f.contentDocument!;
      const el = d.createElement("div");
      el.setAttribute(
        "style",
        "position:fixed;inset:0;backdrop-filter:blur(2px);-webkit-backdrop-filter:blur(2px)",
      );
      d.body.appendChild(el);
      const cs = f.contentWindow!.getComputedStyle(el);
      return cs.getPropertyValue("backdrop-filter") ||
        cs.getPropertyValue("-webkit-backdrop-filter");
    }, MIRROR_SRCDOC);
    expect(
      stage === "none",
      `an inline backdrop-filter inside MIRROR_SRCDOC computes to none (got "${stage}")`,
    );
  }));
