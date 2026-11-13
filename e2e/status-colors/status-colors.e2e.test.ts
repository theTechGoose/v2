/**
 * REQ-729 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue m16: red/coral marked good
 * or neutral state. On the real shell:
 *  (b) the owner's /i/ preview of a draft bill shows a grey "Draft" pill and
 *      of a scheduled installment a teal "Scheduled · sends <date>" — never
 *      the pink "Due";
 *  (a) the /invoices hero's "nothing outstanding" (and the empty "send your
 *      first one") is brand green, not the coral alarm colour.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

const GREEN = "rgb(81, 152, 67)"; // --brand-green #519843
const PINK = "rgb(217, 78, 78)"; // PINK_DARK #d94e4e

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
    body: JSON.stringify({ language: lang, name: "Status Colors Story" }),
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
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!r.ok) throw new Error(`${path} ${r.status}: ${JSON.stringify(j)}`);
  return j;
}

const line = {
  description: "Painting",
  quantity: 1,
  unit: "job",
  price: 40000,
};

async function pillOf(page: StoryTools["page"], id: string) {
  await page.goto(`/i/${id}`);
  const pill = page.locator("[data-status-pill]").first();
  await pill.waitFor({ timeout: 15_000 });
  return {
    text: (await pill.innerText()).trim(),
    color: await pill.evaluate((el) => getComputedStyle(el).color),
  };
}

for (const lang of ["en", "es"] as const) {
  Deno.test(`REQ-729 m16 (${lang}): the owner's /i/ preview of a draft and a scheduled bill is not a pink 'Due'`, (t) =>
    story(t, async ({ page, expect, http, baseUrl }) => {
      const { auth } = await signIn(http, page, baseUrl, lang);
      const customer = await post(http, auth, "/api/customers", {
        name: "Rosa Cliente",
        email: "rosa@blackhole.postmarkapp.com",
      });
      const draft = await post(http, auth, "/api/invoices", {
        customerId: customer.id,
        lineItems: [line],
        amount: 40000,
        status: "draft",
        dueDate: iso(14),
        jobName: "Draft job",
      });
      const scheduled = await post(http, auth, "/api/invoices", {
        customerId: customer.id,
        lineItems: [line],
        amount: 40000,
        status: "scheduled",
        scheduledFor: "2027-01-15",
        dueDate: "2027-02-15",
        jobName: "Scheduled job",
      });

      const d = await pillOf(page, draft.id);
      const draftWord = lang === "es" ? "BORRADOR" : "DRAFT";
      expect(d.text.toUpperCase() === draftWord, `draft pill: ${d.text}`);
      expect(d.color !== PINK, `draft pill colour not pink: ${d.color}`);

      const s = await pillOf(page, scheduled.id);
      const want = lang === "es"
        ? "PROGRAMADA · SE ENVÍA 15 ENE"
        : "SCHEDULED · SENDS JAN 15";
      expect(s.text.toUpperCase() === want, `scheduled pill: ${s.text}`);
      expect(s.color !== PINK, `scheduled pill colour not pink: ${s.color}`);
    }));
}

Deno.test("REQ-729 m16: the /invoices hero's good news ('send your first one', 'nothing outstanding') is green, not coral", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    await page.setViewportSize({ width: 1280, height: 900 });
    const em = page.locator("[data-cy='forecast-hero'] em").first();

    await page.goto("/invoices");
    await em.waitFor({ timeout: 20_000 });
    const emptyText =
      (await page.locator("[data-cy='forecast-hero']").innerText()).trim();
    expect(emptyText.startsWith("No invoices yet"), `empty hero: ${emptyText}`);
    const emptyColor = await em.evaluate((el) => getComputedStyle(el).color);
    expect(emptyColor === GREEN, `empty hero em colour: ${emptyColor}`);

    const customer = await post(http, auth, "/api/customers", {
      name: "Paid Cliente",
      email: "paid@blackhole.postmarkapp.com",
    });
    await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      lineItems: [line],
      amount: 40000,
      status: "paid",
      paidAt: new Date().toISOString(),
      dueDate: iso(0),
      jobName: "Paid job",
    });
    await page.goto("/invoices");
    await page.locator("[data-cy='forecast-hero']", { hasText: "All clear" })
      .waitFor({ timeout: 20_000 });
    const clearColor = await em.evaluate((el) => getComputedStyle(el).color);
    expect(clearColor === GREEN, `'nothing outstanding' colour: ${clearColor}`);
  }));
