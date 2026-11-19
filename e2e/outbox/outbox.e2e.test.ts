/**
 * REQ-784 — Raphael: "And yes to a sent message outbox." Demo-loop cycle
 * dv1, issue d12 "A sent-messages outbox shows every email and text that
 * went to customers"; cycle 1 m33: "/messages redirects to /assistant; no
 * way to check what was sent or in which language."
 *
 * The check, as the verifier will run it: send a quote by email + text, an
 * invoice and a change order to a Spanish-speaking customer whose cell is
 * the reserved (512) 555-0188; open the outbox from the sidebar; each is
 * listed with channel, language and status (the texts "not texted" and
 * why); opening the quote email shows exactly what she was sent. Then the
 * same page in Spanish.
 *
 * Page: /messages (routes/messages/index.tsx + islands/OutboxPage.tsx +
 * components/OutboxView.tsx). API: GET /api/outbox, GET /api/outbox/:id.
 */
import { story, type StoryTools } from "#shots";

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
      ["/api/profile/identity", { businessName: "Ortega Handyman Services" }],
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

async function post(
  http: StoryTools["http"],
  auth: Record<string, string>,
  path: string,
  payload: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(payload),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`${path} → ${r.status} ${JSON.stringify(json)}`);
  return json;
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

type Row = {
  id: string;
  channel: string;
  status: string;
  kind: string;
  language: string;
};

Deno.test("REQ-784 d12: a quote by email + text, an invoice and a change order to María (Spanish, 555 cell) are all in the Outbox — channel, language, status — and the quote email opens exactly as sent; the page reads in Spanish too", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });

    const maria = await post(http, auth, "/api/customers", {
      name: "María López",
      email: "maria@blackhole.postmarkapp.com",
      phoneNumber: "(512) 555-0188",
      language: "es",
    });
    // 1 — the quote, by email + text, from its conversation (the Send button)
    const quote = await post(http, auth, "/api/quotes", {
      customerId: maria.id,
      summary: "Fence repair and gate",
      jobName: "Fence Repair",
      lineItems: [{
        description: "Fence repair and gate",
        quantity: 1,
        unit: "job",
        price: 45000,
      }],
      estimatedTotal: 45000,
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
      customerId: maria.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "both",
    });
    // 2 — an invoice, emailed
    const invoice = await post(http, auth, "/api/invoices", {
      customerId: maria.id,
      quoteId: quote.id,
      jobName: "Fence Repair",
      lineItems: [{
        description: "Deposit",
        quantity: 1,
        unit: "job",
        price: 20000,
      }],
      amount: 20000,
      dueDate: "2026-12-30",
    });
    await post(http, auth, `/api/invoices/${invoice.id}/email`, {});
    // 3 — a change order on it (the request goes out by email; the 555 cell is skipped)
    await post(http, auth, `/api/invoices/${invoice.id}/change-orders`, {
      description: "Second coat of stain",
      deltaAmountCents: 12000,
    });

    const listed = await (await http("/api/outbox", { headers: auth }))
      .json() as Row[];
    const summary = listed.map((r) =>
      `${r.kind}:${r.channel}:${r.status}:${r.language}`
    ).sort();
    expect.eq(
      summary.join(" "),
      [
        "changeOrder:email:sent:es",
        "changeOrder:text:not_sent:es",
        "invoice:email:sent:es",
        "quote:email:sent:es",
        "quote:text:not_sent:es",
      ].join(" "),
      "every customer message is recorded, the skipped texts included",
    );

    // 4 — the sidebar's Outbox row opens the page
    // (a fresh account's /dashboard is onboarding-gated — REQ-091 — so start
    // from /customers, which carries the same sidebar)
    await page.goto("/customers");
    const nav = page.locator(".sb__nav");
    await nav.locator("a[href='/messages']").waitFor({ timeout: 20_000 });
    await nav.locator(".nav-item__label", { hasText: "Outbox" }).waitFor({
      timeout: 20_000,
    });
    await clickUntil(
      page,
      ".sb__nav a[href='/messages']",
      () => Promise.resolve(new URL(page.url()).pathname === "/messages"),
    );
    const rows = page.locator("[data-cy='outbox-row']");
    await rows.first().waitFor({ timeout: 20_000 });
    expect.eq(await rows.count(), 5, "five messages listed");
    await expect.see("Outbox");

    const rowFor = (id: string) =>
      page.locator(`[data-cy='outbox-row'][data-id='${id}']`);
    // textContent, not innerText: the status chip is CSS-uppercased
    const cellText = async (id: string, cy: string) =>
      ((await rowFor(id).locator(`[data-cy='${cy}']`).textContent()) ?? "")
        .trim();
    const quoteMail = listed.find((r) =>
      r.kind === "quote" && r.channel === "email"
    )!;
    const quoteText = listed.find((r) =>
      r.kind === "quote" && r.channel === "text"
    )!;
    const coMail = listed.find((r) =>
      r.kind === "changeOrder" && r.channel === "email"
    )!;
    const invMail = listed.find((r) => r.kind === "invoice")!;
    expect.eq(
      await cellText(quoteMail.id, "outbox-row-channel"),
      "Email",
      "the quote went by email",
    );
    expect.eq(
      await cellText(quoteMail.id, "outbox-row-language"),
      "Spanish",
      "in her language",
    );
    expect.eq(
      await cellText(quoteMail.id, "outbox-row-customer"),
      "María López",
      "to her",
    );
    expect(
      (await cellText(quoteMail.id, "outbox-row-status")).startsWith("Sent"),
      "the quote email went",
    );
    expect(
      (await cellText(quoteMail.id, "outbox-row-message")).startsWith(
        "Cotización",
      ),
      "its subject is the Spanish one she got",
    );
    expect.eq(
      await cellText(quoteText.id, "outbox-row-channel"),
      "Text",
      "the quote's text is its own row",
    );
    const why = await cellText(quoteText.id, "outbox-row-status");
    expect(
      why.includes("Not texted") && why.includes("555"),
      `the text says it didn't go and why: ${why}`,
    );
    expect(
      (await cellText(coMail.id, "outbox-row-what")).startsWith("Change order"),
      "the change order is named",
    );
    expect(
      (await cellText(invMail.id, "outbox-row-what")).startsWith("Invoice"),
      "the invoice is named",
    );

    // 5 — open the quote email: the HTML she was sent, in a sandboxed frame
    const frame = page.locator("iframe[data-cy='outbox-email-frame']");
    await clickUntil(
      page,
      `[data-cy='outbox-row'][data-id='${quoteMail.id}'] [data-cy='outbox-open']`,
      async () => (await frame.count()) > 0,
    );
    const opened = await (await http(`/api/outbox/${quoteMail.id}`, {
      headers: auth,
    })).json() as { body: string };
    expect.eq(
      await frame.getAttribute("srcdoc"),
      opened.body,
      "the frame holds the email exactly as sent",
    );
    expect.eq(await frame.getAttribute("sandbox"), "", "sandboxed");
    const inFrame = await page.frameLocator(
      "iframe[data-cy='outbox-email-frame']",
    ).locator("body").innerText();
    expect(inFrame.includes("María"), "the email greets María");
    await page.locator("[data-cy='outbox-detail-close']").click();
    await frame.waitFor({ state: "detached", timeout: 5_000 });

    // 6 — the same page in Spanish
    await (await http("/api/me", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ language: "es" }),
    })).body?.cancel();
    const hosts = new Set([
      new URL(baseUrl).hostname,
      "localhost",
      "127.0.0.1",
    ]);
    await page.context().addCookies(
      [...hosts].map((domain) => ({
        name: "pm_lang",
        value: "es",
        domain,
        path: "/",
      })),
    );
    await page.goto("/messages?lang=es");
    await rows.first().waitFor({ timeout: 20_000 });
    await page.locator("[data-cy='outbox-title']", {
      hasText: "Bandeja de salida",
    }).waitFor({ timeout: 20_000 });
    expect.eq(
      await cellText(quoteMail.id, "outbox-row-language"),
      "Español",
      "the language, named in Spanish",
    );
    expect.eq(
      await cellText(quoteMail.id, "outbox-row-channel"),
      "Correo",
      "the channel, in Spanish",
    );
    expect(
      (await cellText(quoteMail.id, "outbox-row-status")).startsWith(
        "Enviado",
      ),
      "Enviado",
    );
    expect(
      (await cellText(quoteText.id, "outbox-row-status")).includes(
        "Texto no enviado",
      ),
      "the skipped text, in Spanish",
    );
  }));

/**
 * REQ-1016 (LOOP-007 cycle 1, q1-102): "Spanish Paid email is marked
 * <html lang="en">". Every customer email's `<html lang>` is the language it
 * is written in. QA5's path: an amount-only invoice (no quote behind it) to
 * a Spanish-speaking customer, a payment recorded that closes it, and the
 * paid email opened from the Outbox. The email reads Spanish and its
 * document says so.
 */
Deno.test('REQ-1016 (LOOP-007 q1, q1-102): the Spanish paid email of an amount-only invoice opens in the Outbox as <html lang="es">', (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    // QA5's account writes to its customers in Spanish (the business's comms language)
    const idRes = await http("/api/profile/identity", {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({
        businessName: "Ortega Handyman Services",
        commsLanguage: "es",
        commsLanguages: ["es"],
      }),
    });
    const idBody = await idRes.text();
    expect(idRes.ok, `the account writes in Spanish: ${idRes.status} ${idBody}`);
    const maria = await post(http, auth, "/api/customers", {
      name: "María López",
      email: "maria@blackhole.postmarkapp.com",
      language: "es",
    });
    const invoice = await post(http, auth, "/api/invoices", {
      customerId: maria.id,
      jobName: "Reparación de cerca",
      amount: 45000,
      status: "sent",
      dueDate: "2026-12-30",
    });
    await post(http, auth, "/api/payments", {
      invoiceId: invoice.id,
      amount: 45000,
      method: "zelle",
      receivedAt: new Date().toISOString(),
    });

    // the paid email is dispatched with the payment; poll the outbox for it
    let paid: (Row & { docId?: string; preview?: string }) | undefined;
    let seen = "";
    for (let i = 0; i < 40 && !paid; i++) {
      const listed = await (await http("/api/outbox", { headers: auth }))
        .json() as (Row & { docId?: string; preview?: string })[];
      paid = listed.find((r) =>
        r.kind === "invoicePaid" && r.channel === "email" &&
        r.docId === invoice.id
      );
      seen = JSON.stringify(listed);
      if (!paid) await page.waitForTimeout(250);
    }
    expect(!!paid, `the paid email is in the Outbox: ${seen}`);
    expect.eq(paid!.language, "es", `recorded as Spanish: ${seen}`);
    const opened = await (await http(`/api/outbox/${paid!.id}`, {
      headers: auth,
    })).json() as { body: string };
    expect(
      opened.body.includes("<title>Factura"),
      "the paid email is written in Spanish",
    );
    expect.eq(
      opened.body.slice(0, opened.body.indexOf(">", 16) + 1),
      '<!doctype html>\n<html lang="es">',
      "the stored HtmlBody opens with a Spanish root element",
    );

    // what the owner sees: the Outbox row opens the email; its document is Spanish
    await page.goto("/messages");
    const frame = page.locator("iframe[data-cy='outbox-email-frame']");
    await page.locator(`[data-cy='outbox-row'][data-id='${paid!.id}']`)
      .waitFor({ timeout: 20_000 });
    await clickUntil(
      page,
      `[data-cy='outbox-row'][data-id='${paid!.id}'] [data-cy='outbox-open']`,
      async () => (await frame.count()) > 0,
    );
    const docLang = await page.frameLocator(
      "iframe[data-cy='outbox-email-frame']",
    ).locator("html").getAttribute("lang");
    expect.eq(docLang, "es", "the opened email's <html lang>");

 * REQ-991 (LOOP-007 cycle 1, q1-73): "Outbox table shows only 3 of 8
 * columns at 390px" — on a phone every column, the status chip and the
 * row's Open button are on screen, with no hidden sideways scroller.
 */
Deno.test("REQ-991 q1-73: at 390x844 the Outbox shows every column of a row — status chip and Open on screen, nothing hidden in a sideways scroller", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const auth = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 390, height: 844 });
    const maria = await post(http, auth, "/api/customers", {
      name: "María López",
      email: "maria@blackhole.postmarkapp.com",
      phoneNumber: "(512) 555-0188",
      language: "es",
    });
    const quote = await post(http, auth, "/api/quotes", {
      customerId: maria.id,
      summary: "Fence repair and gate",
      jobName: "Fence Repair",
      lineItems: [{
        description: "Fence repair and gate",
        quantity: 1,
        unit: "job",
        price: 45000,
      }],
      estimatedTotal: 45000,
      status: "draft",
    });
    const conv = await post(http, auth, "/api/agents/conversations", {
      quoteId: quote.id,
      customerId: maria.id,
    });
    await post(http, auth, `/api/agents/conversations/${conv.id}/send-quote`, {
      quoteId: quote.id,
      channel: "both",
    });

    await page.goto("/messages");
    await page.locator("[data-cy='outbox-row']").first().waitFor({
      timeout: 20_000,
    });
    const m = await page.evaluate(() => {
      const vw = globalThis.innerWidth;
      const table = document.querySelector(
        "[data-cy='outbox-table']",
      ) as HTMLElement;
      const wrap = table.parentElement as HTMLElement;
      const row = document.querySelector("[data-cy='outbox-row']")!;
      const right = (sel: string) => {
        const el = row.querySelector(sel) as HTMLElement | null;
        return el ? Math.round(el.getBoundingClientRect().right) : -1;
      };
      const cells = [
        "outbox-row-when",
        "outbox-row-customer",
        "outbox-row-channel",
        "outbox-row-language",
        "outbox-row-what",
        "outbox-row-message",
        "outbox-row-status",
      ].map((cy) => [cy, right(`[data-cy='${cy}']`)]);
      return {
        vw,
        cells,
        chip: right("[data-cy='outbox-row-status'] .chip"),
        open: right("[data-cy='outbox-open']"),
        wrapScroll: wrap.scrollWidth,
        wrapClient: wrap.clientWidth,
      };
    });
    const off = m.cells.filter(([, r]) => (r as number) > m.vw).map(([cy]) =>
      cy
    );
    expect(
      off.length === 0,
      `REQ-991 every column is on screen at ${m.vw}px — off-screen: ${
        off.join(", ")
      } (${JSON.stringify(m.cells)})`,
    );
    expect(
      m.chip > 0 && m.chip <= m.vw,
      `REQ-991 the status chip is on screen (right ${m.chip} > ${m.vw})`,
    );
    expect(
      m.open > 0 && m.open <= m.vw,
      `REQ-991 the row's Open button is on screen (right ${m.open} > ${m.vw})`,
    );
    expect(
      m.wrapScroll <= m.wrapClient,
      `REQ-991 nothing hides in the table's sideways scroller (scrollWidth ${m.wrapScroll} > clientWidth ${m.wrapClient})`,
    );
  }));
