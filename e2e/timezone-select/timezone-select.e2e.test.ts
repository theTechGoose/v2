/**
 * REQ-346 (demo-loop cycle 1, demo issue p8) — the Settings time-zone select
 * read raw IANA ids ("America/New_York") in the browser's default look. It now
 * reads "Eastern (New York)" / "Hora del Este (Nueva York)" and is styled like
 * the App language select beside it; the stored value is still the IANA id.
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
  const phone = `+1305${digits()}`;
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
    body: JSON.stringify({ language: lang, name: "Timezone Label Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: lang, domain, path: "/" },
    ]),
  );
  await page.addInitScript((l) => {
    try {
      localStorage.setItem("pm:lang", l);
    } catch { /* ignore */ }
  }, lang);
  return { auth };
}

const SELECT = "[data-cy='settings-timezone']";

async function selectLook(page: StoryTools["page"], sel: string) {
  return await page.locator(sel).first().evaluate((el) => {
    const s = getComputedStyle(el);
    return `${s.borderTopStyle} ${s.borderRadius} ${s.paddingLeft} ${s.width}`;
  });
}

for (
  const [lang, eastern] of [
    ["en", "Eastern (New York)"],
    ["es", "Hora del Este (Nueva York)"],
  ] as const
) {
  Deno.test(`REQ-346: the time-zone select reads "${eastern}" (${lang}), keeps the IANA value and is styled like the language select`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      await signIn(http, page, baseUrl, lang);
      await page.goto("/settings");
      await page.locator(SELECT).waitFor({ timeout: 15_000 });
      let text = "";
      for (let i = 0; i < 50; i++) {
        text = (await page.locator(`${SELECT} option:checked`).textContent())
          ?.trim() ?? "";
        if (text === eastern) break;
        await page.waitForTimeout(200);
      }
      expect.eq(text, eastern, "the picked zone reads in words");
      expect.eq(
        await page.locator(SELECT).inputValue(),
        "America/New_York",
        "the value is still the IANA id",
      );
      const ids = await page.locator(`${SELECT} option`).allTextContents();
      expect.eq(
        JSON.stringify(ids.filter((x) => x.includes("/"))),
        "[]",
        "no option shows a raw IANA id",
      );
      const lookTz = await selectLook(page, SELECT);
      const lookLang = await selectLook(
        page,
        "select:has(option[value='es']):has(option[value='en'])",
      );
      expect.eq(lookTz, lookLang, "styled like the App language select");
    }));
}
