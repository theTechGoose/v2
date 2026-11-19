/**
 * REQ-1139 — LOOP-007 cycle 3, issue q3-70 [minor/BUG_CONTRADICTION]: "/i
 * header says 'Enviada/Sent' while the pill says 'PAGO PARCIAL/PARTLY PAID'".
 * QA (in Spanish) issued INV-001 for $1,190.75 and recorded $500. REQ-1073
 * moved the pill and the /invoices stage chip to "Pago parcial", but the
 * REQ-201 headline line (number · version · state) right above it still read
 * "INV-001 · Versión 1 · Enviada" — on /i and on the /invoices card/detail.
 * Each screen is read in ONE page.evaluate (headline + pill together); the
 * headline must not say "Enviada" and must agree with the pill.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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
  const me = await http("/api/me", {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ language: "es", name: "Partly Paid Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "es", domain, path: "/" },
    ]),
  );
  return { auth };
}

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  url: string,
  body: unknown,
) {
  const r = await http(url, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${url} → ${r.status} ${JSON.stringify(json)}`);
  return json;
}

const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const clean = (s: string | null | undefined) =>
  (s ?? "").replace(/\s+/g, " ").trim();

Deno.test("REQ-1139 (LOOP-007 q3-70): after $500 on a $1,190.75 invoice the headline on /i and on the /invoices card and detail agrees with the 'Pago parcial' pill — never 'Enviada'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const name = `Parcial ${digits()}`;
    const job = `Repintar baño ${digits()}`;
    const customer = await post(http, auth, "/api/customers", {
      name,
      email: "parcial@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      jobName: job,
      amount: 119075,
      status: "sent",
      issuedDate: inDays(-1),
      dueDate: inDays(14),
    });
    await post(http, auth, "/api/payments", {
      invoiceId: inv.id,
      amount: 50000,
      method: "check",
      receivedAt: new Date().toISOString().slice(0, 10),
    });
    const after = await (await http(`/api/invoices/${inv.id}`, {
      headers: auth,
    })).json();
    expect.eq(
      after.status,
      "pending",
      "the stored status after a part payment",
    );

    // (1) /i — headline and pill, read together
    await page.goto(`/i/${inv.id}`);
    await page.locator("[data-status-pill]").first().waitFor({
      timeout: 20_000,
    });
    await page.locator("[data-cy='invoice-headline']").waitFor({
      timeout: 20_000,
    });
    const iSeen = await page.evaluate(() => ({
      headline:
        document.querySelector("[data-cy='invoice-headline']")?.textContent ??
          "",
      pill: document.querySelector("[data-status-pill]")?.textContent ?? "",
    }));

    // (2) /invoices card — headline and stage chip, read together
    await page.goto("/invoices");
    const card = page.locator("article.qcard", {
      has: page.locator("[data-cy='invoice-card-job']", { hasText: job }),
    }).first();
    await card.locator("[data-cy='invoice-card-headline']").waitFor({
      timeout: 20_000,
    });
    const cardSeen = await card.evaluate((el) => ({
      headline:
        el.querySelector("[data-cy='invoice-card-headline']")?.textContent ??
          "",
      pill: el.querySelector(".qcard__status")?.textContent ?? "",
    }));

    // (3) /invoices detail
    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-headline']").waitFor({
      timeout: 20_000,
    });
    const detailHeadline = await page.evaluate(() =>
      document.querySelector("[data-cy='invoice-headline']")?.textContent ?? ""
    );

    const seen = {
      iHeadline: clean(iSeen.headline),
      iPill: clean(iSeen.pill),
      cardHeadline: clean(cardSeen.headline),
      cardPill: clean(cardSeen.pill),
      detailHeadline: clean(detailHeadline),
    };
    const all = JSON.stringify(seen);
    // baseline: REQ-1073's pill and chip already say "Pago parcial"
    expect.eq(
      seen.iPill.toLowerCase(),
      "pago parcial",
      `/i pill (all: ${all})`,
    );
    expect.eq(
      seen.cardPill,
      "Pago parcial",
      `/invoices card chip (all: ${all})`,
    );
    // the headline beside them must not contradict them
    const agrees = (h: string) =>
      !/Enviada/.test(h) &&
      (/Pago parcial/i.test(h) ||
        !/·\s*(Enviada|Pendiente|Borrador|Pagada)/.test(h));
    expect.eq(
      /Enviada/.test(seen.iHeadline),
      false,
      `/i headline says 'Enviada' under a 'Pago parcial' pill (all: ${all})`,
    );
    expect.eq(
      agrees(seen.iHeadline),
      true,
      `/i headline agrees with the pill (all: ${all})`,
    );
    expect.eq(
      /Enviada/.test(seen.cardHeadline),
      false,
      `/invoices card headline says 'Enviada' beside 'Pago parcial' (all: ${all})`,
    );
    expect.eq(
      /Enviada/.test(seen.detailHeadline),
      false,
      `/invoices detail headline says 'Enviada' (all: ${all})`,
    );
  }));
