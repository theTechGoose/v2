/**
 * REQ-974 (LOOP-007 cycle 1, issue q1-53) — "Setup checklist shows the optional insurance item as
 * '1 thing left' with a red bar".
 *
 * The tester skipped insurance in onboarding and the dashboard said "Termina la configuración —
 * falta 1 cosa" with the bar at 86%, though the item itself reads "Seguro (opcional pero ayuda)".
 * Here, on the real shell in Spanish: an account that answered every onboarding question but
 * insurance opens /dashboard; the checklist does not call the optional item a thing left, its
 * progress bar is full (aria-valuenow 100), and insurance is still listed, linking to
 * /settings#insurance (REQ-227(5): the dashboard keeps it on the setup list).
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
    body: JSON.stringify({ language: "es" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return { auth };
}

Deno.test("REQ-974 q1-53: with only the optional insurance item left, the dashboard checklist (es) does not say 'falta 1 cosa', its bar is full, and insurance stays listed linking to /settings#insurance", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { except: ["insurance"] });
    const r = await http("/api/me/onboarding/deferred", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ question: "insurance" }),
    });
    if (!r.ok) throw new Error(`defer insurance: ${r.status} ${await r.text()}`);
    await r.body?.cancel();

    await page.goto("/dashboard");
    const section = page.getByRole("region", {
      name: "Termina la configuración",
    });
    const insurance = section.getByRole("link", { name: /Seguro/ });
    await insurance.waitFor({ timeout: 20_000 });

    // one read, so the heading, the bar and the item come from the same render
    const seen = await section.evaluate((el: Element) => ({
      heading: el.querySelector("h3")?.textContent?.trim() ?? "",
      pct: el.querySelector('[role="progressbar"]')?.getAttribute(
        "aria-valuenow",
      ) ?? "",
      href: el.querySelector('a[href*="insurance"]')?.getAttribute("href") ??
        "",
    }));
    expect(
      !/falta 1 cosa/.test(seen.heading),
      `the heading does not count the optional item as a thing left (got "${seen.heading}")`,
    );
    expect.eq(seen.pct, "100", "the progress bar is full");
    expect.eq(
      seen.href,
      "/settings#insurance",
      "insurance stays on the list and links to its Settings section",
    );
  }));
