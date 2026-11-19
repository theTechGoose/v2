/**
 * REQ-990 (LOOP-007 cycle 1, q1-70 + q1-78), amending REQ-323 / REQ-924.
 *
 * q1-70: for a customer never billed the /customers board card says "Nothing
 * billed yet" / "Sin facturar" (REQ-323) while her page's Balance KPI
 * (`cws-owed-amount`) says "All paid up" / "Todo pagado" beside "Invoices: 0".
 * q1-78: for a billed, paid-up customer the sidebar row, the board card and
 * the KPI use three words ("Paid up" / "Settled" / "All paid up"; ES "Al día" /
 * "Saldado" / "Todo pagado"). Each screen's facts are read in ONE evaluate.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function signIn(http: StoryTools["http"], page: StoryTools["page"], baseUrl: string) {
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
  if (!cookie) throw new Error(`sign-in: no session cookie (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  await (await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "en", name: "Zero Balance Story" }),
  })).body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies([...hosts].flatMap((domain) => [
    { name, value, domain, path: "/" },
    { name: "pm_lang", value: "en", domain, path: "/" },
  ]));
  return auth;
}

async function post(http: StoryTools["http"], auth: Record<string, string>, url: string, body: unknown) {
  const r = await http(url, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const WORDS = {
  en: { nothing: "Nothing billed yet" },
  es: { nothing: "Sin facturar" },
} as const;

Deno.test("REQ-990 / REQ-323 (q1-70, q1-78): the board card, the sidebar row and the customer page's Balance KPI say the same zero-balance word — Nothing billed yet / Sin facturar when never billed, one paid-up word when billed — in EN and ES", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const tag = digits();
    const neo = await post(http, auth, "/api/customers", { name: `Neo Never ${tag}` });
    const pat = await post(http, auth, "/api/customers", { name: `Pat Paid ${tag}` });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: pat.id,
      jobName: "Gutter cleaning",
      amount: 20000,
      status: "sent",
      issuedDate: inDays(-5),
      dueDate: inDays(25),
    });
    await post(http, auth, "/api/payments", {
      invoiceId: inv.id,
      amount: 20000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    });

    /** the board card's balance and the sidebar row's line, one evaluate */
    async function boardWords(id: string) {
      await page.locator(`.ccard2[data-customer-id='${id}'] .ccard2__bal-val`).waitFor({ timeout: 20_000 });
      await page.locator(`[data-cy='nav-customer-row'][data-id='${id}'] [data-cy='nav-customer-line']`).waitFor({ timeout: 20_000 });
      return await page.evaluate((cid) => ({
        board: document.querySelector(`.ccard2[data-customer-id='${cid}'] .ccard2__bal-val`)?.textContent?.trim(),
        sidebar: document.querySelector(`[data-cy='nav-customer-row'][data-id='${cid}'] [data-cy='nav-customer-line']`)?.textContent?.trim(),
      }), id);
    }
    /** her page's Balance KPI, its hint, the Invoices count and her sidebar row, one evaluate */
    async function pageWords(id: string) {
      await page.goto(`/customers/${id}`);
      await page.locator(`[data-cy='customer-workspace'][data-customer='${id}'] [data-cy='cws-owed-amount']`).waitFor({ timeout: 20_000 });
      await page.locator(`[data-cy='nav-customer-row'][data-id='${id}'] [data-cy='nav-customer-line']`).waitFor({ timeout: 20_000 });
      return await page.evaluate((cid) => ({
        kpi: document.querySelector("[data-cy='cws-owed-amount']")?.textContent?.trim(),
        hint: document.querySelector("[data-cy='cws-owed'] .cws-kpi__hint")?.textContent?.trim(),
        sidebar: document.querySelector(`[data-cy='nav-customer-row'][data-id='${cid}'] [data-cy='nav-customer-line']`)?.textContent?.trim(),
      }), id);
    }

    for (const lang of ["en", "es"] as const) {
      if (lang === "es") {
        await page.locator("[data-cy='topbar-lang-es']").click();
        await page.waitForFunction(() => document.documentElement.lang === "es", undefined, { timeout: 15_000 });
      }
      await page.goto("/customers");
      const neoBoard = await boardWords(neo.id);
      const patBoard = await boardWords(pat.id);
      const neoPage = await pageWords(neo.id);
      const patPage = await pageWords(pat.id);

      // q1-70 — never billed: the board's REQ-323 word everywhere
      expect.eq(neoBoard.board, WORDS[lang].nothing, `${lang}: the board card says nothing billed (REQ-323)`);
      expect.eq(neoPage.kpi, neoBoard.board, `${lang}: Neo's Balance KPI says what the board says (got "${neoPage.kpi}", board "${neoBoard.board}")`);
      expect.eq(neoBoard.sidebar, neoBoard.board, `${lang}: Neo's sidebar row says what the board says (got "${neoBoard.sidebar}")`);
      expect.eq(neoPage.sidebar, neoBoard.board, `${lang}: on her page, Neo's sidebar row agrees`);

      // q1-78 — billed and paid: one word on the three surfaces
      expect(patBoard.board !== WORDS[lang].nothing, `${lang}: Pat was billed — not "nothing billed"`);
      expect.eq(patPage.kpi, patBoard.board, `${lang}: Pat's Balance KPI = the board card (got "${patPage.kpi}", board "${patBoard.board}")`);
      expect.eq(patBoard.sidebar, patBoard.board, `${lang}: Pat's sidebar row = the board card (got "${patBoard.sidebar}", board "${patBoard.board}")`);
      expect.eq(patPage.sidebar, patBoard.board, `${lang}: on her page, Pat's sidebar row = the board card`);
    }
  }));
