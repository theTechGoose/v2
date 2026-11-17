/**
 * REQ-276 — demo issue i18n-formatting-m8: a Spanish contractor saw English
 * formats ("Miércoles · noviembre 11", "8:55 PM"), calques ("Ellos mantienen
 * las luces encendidas.") and English words ("pipeline") in the Spanish app.
 * The pages: /dashboard (DashTopbar date line), /customers and /quotes (empty
 * heroes), in a browser, signed in as a Spanish-language contractor.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

async function signInEs(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
  const phone = `+1512${digits()}`;
  const r = await http("/api/auth/verify", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ phoneNumber: phone, code: "000000" }) });
  let body = await r.json();
  let cookie = (r.headers.get("set-cookie") ?? "").split(";")[0];
  if (body.recoverable === true) {
    const f = await http("/api/auth/start-fresh", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ token: body.recoveryToken }) });
    body = await f.json();
    cookie = (f.headers.get("set-cookie") ?? "").split(";")[0];
  }
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  const me = await http("/api/me", { method: "PUT", headers: auth, body: JSON.stringify({ language: "es", name: "Rosa Formatos" }) });
  await me.body?.cancel();
  // past onboarding, or /dashboard sends the account back to the wizard
  await answerQuestions(http, auth, { name: "Rosa Formatos" });
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [{ name, value, domain, path: "/" }, { name: "pm_lang", value: "es", domain, path: "/" }]));
}

const ES_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

Deno.test("REQ-276: a Spanish contractor reads Spanish formats and wording — the date line is 'Miércoles · 11 de noviembre', no calque, no 'pipeline'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    await signInEs(http, page, baseUrl);

    await page.goto("/dashboard");
    const line = page.locator(".topbar__greet-line");
    await line.waitFor();
    const now = new Date();
    const want = `${now.getDate()} de ${ES_MONTHS[now.getMonth()]}`;
    let text = "";
    for (let i = 0; i < 25 && !text.includes(want); i++) {
      text = (await line.innerText()).trim();
      if (!text.includes(want)) await page.waitForTimeout(200);
    }
    expect(text.includes(want), `date line in Spanish order ("${want}"): "${text}"`);
    expect(/^[A-ZÁÉÍÓÚÑ]/.test(text), `date line opens with a capital: "${text}"`);

    await page.goto("/customers");
    await expect.see("Son los que te dan de comer.");
    const customers = await page.locator("body").innerText();
    expect(!/luces encendidas/i.test(customers), "no 'luces encendidas' calque on /customers");

    await page.goto("/quotes");
    await expect.see("Todavía no hay nada en curso.");
    const quotes = await page.locator("body").innerText();
    expect(!/pipeline/i.test(quotes), "no English 'pipeline' on /quotes");
  }));
