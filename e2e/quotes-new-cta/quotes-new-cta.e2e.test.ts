/**
 * REQ-307 (demo-loop cycle 1, issue M11) — "+ New quote" / "Nueva cotización"
 * on /quotes does nothing. The hero CTA must take the owner to the
 * assistant's new-conversation route. Before the fix it was a bare
 * <button> with no handler, so the click left the page exactly where it was.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
  lang: "en" | "es",
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: lang, name: "New Quote Story" }),
  });
  await me.body?.cancel();
  const onboarded = await http("/api/me/onboarded", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({ skipped: true }),
  });
  await onboarded.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: lang,
      domain,
      path: "/",
    }]),
  );
}

for (
  const [lang, label] of [["en", "New quote"], [
    "es",
    "Nueva cotización",
  ]] as const
) {
  Deno.test(`REQ-307 (M11) ${lang}: "${label}" on /quotes opens the assistant`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signIn(http, page, baseUrl, lang);
      await page.goto("/quotes");
      const cta = page.locator(".qph__cta");
      await cta.first().waitFor({ timeout: 15_000 });
      expect(
        (await cta.first().innerText()).includes(label),
        `the CTA reads "${label}"`,
      );
      await cta.first().click();
      // a dead button leaves the URL on /quotes; the link lands on /assistant
      await page.waitForURL(/\/assistant(\?|$)/, { timeout: 15_000 });
      expect.eq(
        new URL(page.url()).pathname,
        "/assistant",
        "landed on /assistant",
      );
    }));
}
