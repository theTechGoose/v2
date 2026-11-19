/**
 * REQ-1107 (LOOP-007 cycle 3, q3-31 + q3-104) — "Spanish /quotes 'Consejo del
 * monstruo' tip text is in English". An owner who signed up in English opens
 * /quotes?lang=es: the sidebar tip's heading is Spanish ("Consejo del
 * monstruo") but its body was the backend's English static fallback ("Most
 * quotes are accepted within the first 48 hours…"), because the backend built
 * the sentence from the account language and never saw ?lang= / pm_lang.
 *
 * Both lines of the tip must be Spanish: in the server's first HTML and after
 * the island's client refetch.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signInEnglishOwner(http: StoryTools["http"]) {
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
    body: JSON.stringify({ language: "en", name: "Dana Tip" }),
  });
  await me.body?.cancel();
  return { cookie };
}

const ES_TITLE = "Consejo del monstruo";
const ES_BODY = /primeras 48 horas/;
const EN_BODY = /within the first 48 hours/;

Deno.test("REQ-1107 (LOOP-007 q3, q3-31): an English-account owner on /quotes?lang=es sees the Monster tip body in Spanish, not the English 48-hour fallback", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { cookie } = await signInEnglishOwner(http);

    // 1. The server's first HTML (SSR seed of the insight).
    const res = await http("/quotes?lang=es", {
      headers: { cookie, accept: "text/html" },
      redirect: "manual",
    });
    const html = await res.text();
    expect.eq(res.status, 200, "/quotes?lang=es answers 200 for the signed-in owner");
    expect(html.includes(ES_TITLE), `the first HTML carries the Spanish tip heading "${ES_TITLE}"`);
    expect(
      !EN_BODY.test(html),
      "the first HTML of /quotes?lang=es does not carry the English 'within the first 48 hours' tip body",
    );

    // 2. In the browser, after hydration and the island's own insight refetch.
    const [name, value] = cookie.split("=");
    const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
    await page.context().addCookies([...hosts].map((domain) => ({
      name,
      value,
      domain,
      path: "/",
    })));
    const refetch = page.waitForResponse(
      (x) => new URL(x.url()).pathname.endsWith("/analytics/quotes/insight"),
      { timeout: 30_000 },
    ).catch(() => null);
    await page.goto("/quotes?lang=es");
    await refetch;
    await page.waitForTimeout(1_000); // let the refetched insight render

    const tip = await page.evaluate(() => {
      const cards = [...document.querySelectorAll(".qside__card")];
      const card = cards.find((c) =>
        /Consejo del monstruo|Monster tip/.test(c.textContent ?? "")
      );
      return {
        title: card?.querySelector(".qside__title")?.textContent?.trim() ?? "",
        body: card?.querySelector("p")?.textContent?.trim() ?? "",
      };
    });
    expect.eq(tip.title, ES_TITLE, "the tip heading is Spanish");
    expect(
      !EN_BODY.test(tip.body),
      `the tip body is the English fallback on a Spanish page: "${tip.body}"`,
    );
    expect(ES_BODY.test(tip.body), `the tip body is the Spanish 48-hour sentence (got "${tip.body}")`);
  }));
