/**
 * REQ-934 (LOOP-007 cycle 1, issue q1-5; amends REQ-715) — "Customer set to
 * Español is invoiced in English from her own page".
 *
 * QA (fleet-r3db0ac6f-4): a customer saved with "Customer's language" =
 * Español; her page /customers/<id> → Send invoice → one line at $1,250 →
 * Issue invoice. The send sheet's "Sends in" ended on English (pressed), and
 * the invoice email went out with <html lang="en"> and ?lang=en — while the
 * payment email for the same invoice later went out in Spanish.
 *
 * The dialog starts on her language (defaultSendLang), then GET
 * /invoices/:id/send-preview (no lang) answers the account default — the
 * preview never looks at the customer — and replaces it.
 *
 *  1. Carmen (language es) and a catalogue service, through the API.
 *  2. /customers/<id> → Send invoice → the line → Issue invoice.
 *  3. Once every send-preview request has settled, "Sends in" is Español.
 *  4. Send: the outbox's invoice email is Spanish — <html lang="es">, ?lang=es.
 *
 * Pages: /customers/<id> (CustomerWorkspace.tsx → InvoicesPage.tsx
 * NewInvoiceModal → components/InvoiceSendDialog.tsx).
 */
import { story, type StoryTools } from "#shots";
import { ensureService, fillInvoiceLine } from "../_shared/service-lines.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const phone = () =>
  `+1512${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`;

async function signIn(
  http: StoryTools["http"],
  page: StoryTools["page"],
  baseUrl: string,
): Promise<Record<string, string>> {
  const r = await http("/api/auth/verify", {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ phoneNumber: phone(), code: "000000" }),
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
  if (!cookie) throw new Error(`sign-in: no session (${JSON.stringify(body)})`);
  const auth = { ...JSON_HEADERS, cookie };
  for (
    const [path, payload] of [
      ["/api/me", { name: "Luis Ortega", language: "en" }],
      // REQ-925: the account sends in both languages (QA saw the Español pill)
      ["/api/profile/identity", {
        businessName: "Ortega Handyman Services",
        commsLanguages: ["en", "es"],
      }],
    ] as const
  ) {
    const res = await http(path, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify(payload),
    });
    await res.body?.cancel();
  }
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((domain) => [
      { name, value, domain, path: "/" },
      { name: "pm_lang", value: "en", domain, path: "/" },
    ]),
  );
  return auth;
}

/** an island may still be hydrating when its button appears: click until the page shows the effect */
async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).first().click({ timeout: 2_000 });
    } catch {
      // not clickable yet: the polls below say whether the effect landed
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

type OutboxRow = {
  id: string;
  kind: string;
  channel: string;
  status: string;
  language?: string;
};

Deno.test("REQ-934 q1-5 (REQ-715): from a Spanish-speaking customer's own page, Send invoice → Issue invoice keeps 'Sends in' on Español and the invoice email goes out in Spanish", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    // 1 — Carmen reads Spanish; a service to bill
    const cr = await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: "Carmen Núñez",
        email: "carmen@blackhole.postmarkapp.com",
        language: "es",
      }),
    });
    const carmen = await cr.json() as { id: string; language?: string };
    expect.eq(carmen.language, "es", "Carmen is saved as Spanish-speaking");
    const svc = await ensureService(http, auth, "Faucet repair");

    // every send-preview request the sheet makes, pending or settled
    let pending = 0;
    let settled = 0;
    const isPreview = (url: string) =>
      /\/invoices\/[^/?]+\/send-preview\?/.test(url);
    page.on("request", (r) => {
      if (isPreview(r.url())) pending++;
    });
    const done = (r: { url(): string }) => {
      if (isPreview(r.url())) {
        pending--;
        settled++;
      }
    };
    page.on("requestfinished", done);
    page.on("requestfailed", done);

    // 2 — her page → Send invoice → one line → Issue invoice
    await page.goto(`/customers/${carmen.id}`);
    const modal = page.locator("[data-cy='new-invoice-modal']");
    await clickUntil(
      page,
      "[data-cy='cws-send-invoice']",
      async () => await modal.isVisible(),
    );
    await fillInvoiceLine(page, 0, svc, "1250");
    await page.locator("[data-cy='new-invoice-submit']").click();
    const dialog = page.locator("[data-cy='send-dialog']");
    await dialog.waitFor({ state: "visible", timeout: 15_000 });

    // 3 — open "What they'll get"; once every send-preview request (the
    // sheet's default-language ask included) has settled, the pill still
    // reads her language and the preview is the Spanish invoice
    await clickUntil(
      page,
      "[data-cy='send-preview'] summary",
      async () =>
        (await page.locator("[data-cy='send-preview']").getAttribute(
          "open",
        )) !== null,
    );
    await page.locator("[data-cy='send-preview-subject']").waitFor({
      timeout: 15_000,
    });
    for (let quiet = 0, i = 0; i < 100 && quiet < 5; i++) {
      quiet = pending === 0 && settled > 0 ? quiet + 1 : 0;
      await page.waitForTimeout(200);
    }
    const invLang = ((await (await http("/api/invoices", { headers: auth }))
      .json()) as Array<{ lang?: string }>)[0]?.lang;
    const pills = await page.evaluate(() => ({
      subject: document.querySelector("[data-cy='send-preview-subject']")
        ?.textContent?.trim(),
      es: document.querySelector("[data-cy='send-lang-es']")?.getAttribute(
        "aria-pressed",
      ),
      en: document.querySelector("[data-cy='send-lang-en']")?.getAttribute(
        "aria-pressed",
      ),
    }));
    expect.eq(
      `es=${pills.es} en=${pills.en}`,
      "es=true en=false",
      `'Sends in' is on Español — her language — once the preview has loaded (invoice lang=${invLang}, preview subject=${
        JSON.stringify(pills.subject)
      })`,
    );
    expect.eq(
      pills.subject?.startsWith("Factura "),
      true,
      `"What they'll get" is the Spanish invoice: ${
        JSON.stringify(pills.subject)
      }`,
    );

    // 4 — Send: the invoice email is in Spanish
    await page.locator("[data-cy='send-keep']").click();
    let row: OutboxRow | undefined;
    for (let i = 0; i < 50 && !row; i++) {
      const list = await (await http("/api/outbox", { headers: auth }))
        .json() as OutboxRow[];
      row = list.find((r) => r.kind === "invoice" && r.channel === "email");
      if (!row) await new Promise((res) => setTimeout(res, 200));
    }
    if (!row) throw new Error("no invoice email reached the outbox");
    const msg = await (await http(`/api/outbox/${row.id}`, { headers: auth }))
      .json() as OutboxRow & { body?: string };
    const html = msg.body ?? "";
    const htmlLang = /<html[^>]*\blang="([a-z]+)"/.exec(html)?.[1];
    const linkLang = /\/i\/[^"'\s]*\?lang=([a-z]+)/.exec(html)?.[1] ??
      /\?lang=([a-z]+)/.exec(html)?.[1];
    expect.eq(
      `language=${row.language} html=${htmlLang} link=${linkLang}`,
      "language=es html=es link=es",
      'the invoice email to her goes out in Spanish (<html lang="es">, ?lang=es)',
    );
  }));
