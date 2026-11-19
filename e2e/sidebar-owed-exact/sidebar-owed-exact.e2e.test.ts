/**
 * REQ-1041 (LOOP-007 cycle 2, q2-25), amending REQ-924(a).
 *
 * A customer owes $1,750.00. On her page /customers/<id> the Balance KPI
 * (`cws-owed-amount`) reads "$1,750.00" while her sidebar row
 * (`nav-customer-line`, `.cnav__sub`) read "Owes $1.8k" / "Debe $1.8k" —
 * `shortMoney` rounded the debt UP. The row must show the same amount the KPI
 * shows and never more than she owes. Both facts are read in ONE evaluate.
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
    body: JSON.stringify({ language: "en", name: "Sidebar Owed Story" }),
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


/** "$1,750.00" / "$1,750" / "$1.8k" → dollars claimed */
function dollarsIn(s: string | undefined): number | null {
  const m = (s ?? "").match(/\$\s?([\d,]+(?:\.\d+)?)(k?)/i);
  if (!m) return null;
  const n = Number(m[1].replace(/,/g, ""));
  return m[2] ? n * 1000 : n;
}

Deno.test("REQ-1041 (LOOP-007 q2-25): a customer owing $1,750.00 — her sidebar row shows the same amount as the Balance KPI on her page, never the rounded-up \"$1.8k\", in EN and ES", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    const tag = digits();
    const cust = await post(http, auth, "/api/customers", { name: `Olive Owes ${tag}` });
    await post(http, auth, "/api/invoices", {
      customerId: cust.id,
      jobName: "Deck staining",
      amount: 175000,
      status: "sent",
      issuedDate: inDays(-3),
      dueDate: inDays(27),
    });

    for (const lang of ["en", "es"] as const) {
      if (lang === "es") {
        await page.locator("[data-cy='topbar-lang-es']").click();
        await page.waitForFunction(() => document.documentElement.lang === "es", undefined, { timeout: 15_000 });
      }
      await page.goto(`/customers/${cust.id}`);
      await page.locator(`[data-cy='customer-workspace'][data-customer='${cust.id}'] [data-cy='cws-owed-amount']`).waitFor({ timeout: 20_000 });
      await page.locator(`[data-cy='nav-customer-row'][data-id='${cust.id}'] [data-cy='nav-customer-line']`).waitFor({ timeout: 20_000 });
      const seen = await page.evaluate((cid) => ({
        kpi: document.querySelector("[data-cy='cws-owed-amount']")?.textContent?.trim(),
        sidebar: document.querySelector(`[data-cy='nav-customer-row'][data-id='${cid}'] [data-cy='nav-customer-line']`)?.textContent?.trim(),
      }), cust.id);

      const kpi = dollarsIn(seen.kpi);
      const side = dollarsIn(seen.sidebar);
      expect.eq(kpi, 1750, `${lang}: the Balance KPI reads $1,750.00 (got "${seen.kpi}")`);
      expect(!/1[.,]8\s?k/i.test(seen.sidebar ?? ""), `${lang}: the sidebar row does not round the debt up to $1.8k (got "${seen.sidebar}")`);
      expect(side !== null && side <= 1750, `${lang}: the sidebar row never shows more than she owes (got "${seen.sidebar}", owes $1,750.00)`);
      expect.eq(side, kpi, `${lang}: the sidebar row shows the same amount as the KPI (sidebar "${seen.sidebar}", KPI "${seen.kpi}")`);
      expect((seen.sidebar ?? "").includes("1,750"), `${lang}: the sidebar row reads "1,750" like the KPI (got "${seen.sidebar}")`);
    }
  }));
