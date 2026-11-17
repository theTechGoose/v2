/**
 * REQ-514 — demo-loop cycle 3, issue p8-pair4-b: "Dashboard empty-state text
 * flush to the card edge". On a fresh account the dashboard's Active jobs and
 * Quotes awaiting panels show their empty copy; `.panel` has no padding, and
 * those blocks padded 4 px / 0 px on the sides, so the text
 * touched the 20 px-radius border. Now each empty text sits at least 18 px
 * (the panel header's inset) inside its panel, at desktop and phone widths.
 */
import { story, type StoryTools } from "#shots";
import {
  answerQuestions,
  JSON_HEADERS,
} from "../_shared/onboarding-answers.ts";

const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
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
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en" }),
  })).body?.cancel();
  // past onboarding, or /dashboard sends the account back to the wizard
  await answerQuestions(http, auth, { name: "Edge Empty" });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
}

const EMPTY_TEXTS = [
  "No jobs in flight yet.",
  "No quotes out yet.",
];

for (const width of [1280, 390]) {
  Deno.test(`REQ-514 (demo p8-pair4-b, cycle 3): at ${width} px the dashboard's empty-state text sits ≥ 18 px inside its panel`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await page.setViewportSize({ width, height: 900 });
      await signIn(http, page, baseUrl);
      await page.goto("/dashboard");
      for (const text of EMPTY_TEXTS) {
        const el = page.locator(".panel").getByText(text, { exact: false })
          .first();
        await el.waitFor({ timeout: 20_000 });
        const gap = await el.evaluate((node) => {
          const panel = (node as HTMLElement).closest(".panel")!;
          const p = panel.getBoundingClientRect();
          // the text's own box (a Range), not its block's, so padding counts
          const range = document.createRange();
          range.selectNodeContents(node);
          const r = range.getBoundingClientRect();
          return { left: r.left - p.left, right: p.right - r.right };
        });
        expect(
          gap.left >= 18,
          `"${text}" left inset ${gap.left.toFixed(1)} px ≥ 18`,
        );
        expect(
          gap.right >= 18,
          `"${text}" right inset ${gap.right.toFixed(1)} px ≥ 18`,
        );
      }
    }));
}
