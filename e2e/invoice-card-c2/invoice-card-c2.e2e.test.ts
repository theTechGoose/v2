/**
 * REQ-407 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 2 (run r561db6d4), issues m30 and p13-f: on the real
 * /invoices page an out-for-payment card's back row has ONE "Payment received"
 * (it read "Payment received / Open / Payment received / Mute"), "Adjust
 * invoice" draws an SVG chevron instead of a "▾" glyph, and a scheduled card's
 * subline reads "Scheduled to send Nov 26", never the raw ISO date.
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
    body: JSON.stringify({ language: lang, name: "Card Story" }),
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

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);
const SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

async function mkInvoice(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  extra: Record<string, unknown>,
) {
  const r = await http("/api/invoices", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      customerId,
      lineItems: [{
        description: "Lawn",
        quantity: 1,
        unit: "visit",
        price: 6500,
      }],
      amount: 6500,
      ...extra,
    }),
  });
  return await r.json();
}

Deno.test("REQ-407 (demo m30, p13-f): one 'Payment received' on an out card, an SVG chevron on 'Adjust invoice', a short scheduled date", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Randall Belknap",
        email: "rb@blackhole.postmarkapp.com",
      }),
    })).json();
    await mkInvoice(http, auth, customer.id, {
      status: "sent",
      issuedDate: iso(0),
      dueDate: iso(14),
      jobName: "Out card",
    });
    const when = iso(20);
    await mkInvoice(http, auth, customer.id, {
      status: "scheduled",
      scheduledFor: when,
      dueDate: iso(34),
      jobName: "Scheduled card",
    });
    await page.goto("/invoices");

    const out = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-cta-out']"),
    }).first();
    await out.waitFor({ timeout: 15_000 });
    const back = await out.locator(".qcard__back-foot button").allInnerTexts();
    expect.eq(
      back.filter((s) => s.trim() === "Payment received").length,
      1,
      `one 'Payment received' on the card back (${back.join(" / ")})`,
    );
    const adjust = out.locator("button", { hasText: "Adjust invoice" });
    const adjustHtml = await adjust.innerHTML();
    expect(!/[\u25A0-\u25FF]/.test(adjustHtml), `no ▾ glyph (${adjustHtml})`);
    expect(
      adjustHtml.includes('data-icon="chevron-down"'),
      `an <Icon name=chevron-down> (${adjustHtml})`,
    );

    const sched = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-cta-scheduled']"),
    }).first();
    const subline = (await sched.locator(".qcard__story").innerText()).trim();
    const d = new Date(when + "T00:00:00");
    const short = `${SHORT[d.getMonth()]} ${d.getDate()}`;
    expect(!subline.includes(when), `no ISO date in the subline (${subline})`);
    expect(
      subline.startsWith(`Scheduled to send ${short}`),
      `reads 'Scheduled to send ${short}' (${subline})`,
    );
  }));
