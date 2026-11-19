/**
 * REQ-958 — LOOP-007 cycle 1, QA issue q1-33 [BUG_CONTRADICTION]: with one
 * $1,000 invoice past due, the /invoices money bar contradicted itself —
 * hero "$1,000 on the way across 1 invoice." beside the tile
 * "OUT FOR PAYMENT $0 · 0 on the way". The hero total keeps every balance
 * still owed (REQ-566), so it must not reuse the Out tile's "on the way"
 * for money that is overdue, and its amount must equal Overdue + Out.
 */
import { story, type StoryTools } from "#shots";
import { answerQuestions } from "../_shared/onboarding-answers.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysFromNow = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

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
    body: JSON.stringify({ language: "en", name: "Overdue Hero" }),
  })).body?.cancel();
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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: Record<string, unknown>,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const money = (s: string) => Number((s.match(/\$([\d,]+(?:\.\d+)?)/)?.[1] ?? "NaN").replace(/,/g, ""));

Deno.test("REQ-958 (LOOP-007 q1-33): one overdue $1,000 invoice — the /invoices hero does not call it 'on the way' while the Out tile says '0 on the way', and the hero amount equals Overdue + Out", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await answerQuestions(http, auth, { name: "Overdue Hero" });
    const ana = await post(http, auth, "/api/customers", { name: "Ana Torres" });
    await post(http, auth, "/api/invoices", {
      customerId: ana.id,
      status: "sent",
      jobName: "Gutter clean",
      amount: 100_000,
      issuedDate: daysFromNow(-20),
      dueDate: daysFromNow(-3),
    });

    await page.goto("/invoices");
    await page.locator("[data-cy='forecast-hero']").waitFor({ timeout: 20_000 });
    await page.locator(".qkpi__cell").nth(1).waitFor({ timeout: 20_000 });

    // read the hero and the tiles in ONE evaluate (no straddled render)
    const bar = await page.evaluate(() => {
      const norm = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
      const cells = [...document.querySelectorAll(".qkpi__cell")];
      const cell = (i: number) => ({
        lbl: norm(cells[i]?.querySelector(".qkpi__lbl")?.textContent),
        val: norm(cells[i]?.querySelector(".qkpi__val")?.textContent),
        sub: norm(cells[i]?.querySelector(".qkpi__sub")?.textContent),
      });
      return {
        hero: norm(document.querySelector("[data-cy='forecast-hero']")?.textContent),
        overdue: cell(0),
        out: cell(1),
      };
    });
    console.log(JSON.stringify(bar));

    expect.eq(bar.overdue.val, "$1,000", "the Overdue tile carries the $1,000");
    expect.eq(bar.out.val, "$0", "the Out for payment tile is $0");
    expect(
      /\b0 on the way\b/.test(bar.out.sub),
      `the Out tile says 0 on the way (${bar.out.sub})`,
    );
    expect(
      bar.hero.includes("$1,000"),
      `the hero carries the $1,000 still owed (${bar.hero})`,
    );
    expect(
      !/on the way/i.test(bar.hero),
      `the hero must not call overdue money "on the way" beside "${bar.out.sub}" (hero: "${bar.hero}")`,
    );
    expect.eq(
      money(bar.hero),
      money(bar.overdue.val) + money(bar.out.val),
      "the hero amount equals the Overdue tile + the Out tile",
    );
  }));
