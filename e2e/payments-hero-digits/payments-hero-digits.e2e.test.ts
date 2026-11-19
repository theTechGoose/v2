/**
 * REQ-1150 — LOOP-007 cycle 3, issue q3-81, in a browser: a fresh account
 * (no payments yet) opens /payments and the hero sub-line `.pph__sub` writes
 * every clearing duration in digits — never "ACH in two days, checks in up to
 * 5 business days" / "ACH en dos días, cheques en hasta 5 días hábiles".
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
  const me = await http("/api/me", {
    method: "PUT",
    headers: { ...JSON_HEADERS, cookie },
    body: JSON.stringify({ language: lang, name: "Payments Hero Story" }),
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
}

const CASES = [
  {
    lang: "en" as const,
    words: /\b(one|two|three|four|five|six|seven|eight|nine|ten|a week)\b/i,
    ach: /ACH in [^,]*\d/,
    check: "up to 5 business days",
  },
  {
    lang: "es" as const,
    words:
      /(?<![\p{L}])(dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|una semana)(?![\p{L}])/iu,
    ach: /ACH en [^,]*\d/,
    check: "hasta 5 días hábiles",
  },
];

async function heroUsesDigits(
  { page, expect, http, baseUrl }: StoryTools,
  c: (typeof CASES)[number],
) {
  await signIn(http, page, baseUrl, c.lang);
  await page.goto(`/payments?lang=${c.lang}`);
  const sub = page.locator(".pph__sub");
  await sub.waitFor({ timeout: 15_000 });
  const text = (await sub.textContent())?.replace(/\s+/g, " ").trim() ?? "";
  expect(text.includes(c.check), `keeps "${c.check}" — got "${text}"`);
  expect(!c.words.test(text), `no spelled-out number — got "${text}"`);
  expect(c.ach.test(text), `the ACH half uses a digit — got "${text}"`);
}

Deno.test("REQ-1150 q3-81 (en): the empty /payments hero writes every duration in digits (LOOP-007 q3)", (t) =>
  story(t, (tools) => heroUsesDigits(tools, CASES[0])));

Deno.test("REQ-1150 q3-81 (es): the empty /payments hero writes every duration in digits (LOOP-007 q3)", (t) =>
  story(t, (tools) => heroUsesDigits(tools, CASES[1])));
