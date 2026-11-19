/**
 * REQ-691 — Raphael: "fix every issue the demo found, loop until there are
 * none." Demo-loop cycle 5 (run r37f88707), issue p15: in the owner's preview
 * of their own quote, "Hacer una pregunta" kept its active teal text while its
 * disabled twin "Rechazar" was grey; and the invoice card offered "Enviar SMS
 * al cliente" for a customer with no phone. Ask now looks as off as Decline,
 * and a phoneless customer's card shows "Add a phone" (to their card) instead
 * of "Text client"; a customer with a real phone still gets "Text client".
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
    body: JSON.stringify({ language: lang, name: "Text Client Story" }),
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
  const json = await r.json();
  if (!r.ok) {
    throw new Error(
      `POST ${path} → ${r.status} ${JSON.stringify(json).slice(0, 200)}`,
    );
  }
  return json;
}

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

Deno.test("REQ-691 (demo p15, cycle 5): preview Ask is as muted as Decline; Text client only for a customer with a textable phone", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "es");
    const jorge = await post(http, auth, "/api/customers", {
      name: "Jorge Sinfono",
      email: "jorge@blackhole.postmarkapp.com",
    });
    const ana = await post(http, auth, "/api/customers", {
      name: "Ana Contelefono",
      phoneNumber: "+15128675309",
    });

    // (1) the owner's preview of a sent quote
    const quote = await post(http, auth, "/api/quotes", {
      customerId: jorge.id,
      summary: "Reparación de terraza",
      jobName: "Reparación de terraza",
      lineItems: [{
        description: "Reparación de terraza",
        quantity: 1,
        unit: "job",
        price: 250000,
      }],
      estimatedTotal: 250000,
      terms: [{ stepId: "payment_terms", value: "Due Now" }],
      status: "draft",
    });
    const sent = await http(`/api/quotes/${quote.id}`, {
      method: "PUT",
      headers: auth,
      body: JSON.stringify({ status: "sent" }),
    });
    await sent.body?.cancel();
    await page.goto(`/q/${quote.id}`);
    const ask = page.locator("[data-cy='quote-ask']");
    await ask.waitFor({ timeout: 15_000 });
    const colors = await page.evaluate(() => {
      const c = (sel: string) => {
        const el = document.querySelector(sel) as HTMLElement;
        const cs = getComputedStyle(el);
        return { color: cs.color, border: cs.borderTopColor };
      };
      return {
        ask: c("[data-cy='quote-ask']"),
        decline: c("[data-cy='quote-decline']"),
      };
    });
    expect.eq(
      JSON.stringify(colors.ask),
      JSON.stringify(colors.decline),
      `Ask wears Decline's muted text and border (${JSON.stringify(colors)})`,
    );
    expect.eq(await ask.isDisabled(), true, "Ask is disabled in preview");

    // (2) the invoice card back face
    for (const [c, job] of [[jorge, "Sin telefono"], [ana, "Con telefono"]]) {
      await post(http, auth, "/api/invoices", {
        customerId: c.id,
        lineItems: [{
          description: "Lawn",
          quantity: 1,
          unit: "visit",
          price: 6500,
        }],
        amount: 6500,
        status: "scheduled",
        scheduledFor: iso(20),
        dueDate: iso(34),
        jobName: job,
      });
    }
    await page.goto("/invoices");
    const card = (job: string) =>
      page.locator("article.qcard", { hasText: job }).first();
    await card("Sin telefono").waitFor({ timeout: 15_000 });
    const backText = async (job: string) =>
      (await card(job).locator(".qcard__back-foot").innerText()).trim();

    const noPhone = await backText("Sin telefono");
    expect.eq(
      noPhone.includes("Enviar SMS al cliente"),
      false,
      `no "Text client" for a phoneless customer: ${noPhone}`,
    );
    const add = card("Sin telefono").locator("[data-cy='invoice-add-phone']");
    expect.eq(await add.count(), 1, "an Add a phone link instead");
    expect.eq(
      await add.getAttribute("href"),
      `/customers?open=${encodeURIComponent(jorge.id)}`,
      "it opens Jorge's customer card",
    );

    const withPhone = await backText("Con telefono");
    expect.eq(
      withPhone.includes("Enviar SMS al cliente"),
      true,
      `"Text client" stays for a textable phone: ${withPhone}`,
    );
  }));

/**
 * REQ-982 (LOOP-007 cycle 1, q1-65; AMENDMENT to REQ-691): Dana has
 * (843) 555-0142 on file — the reserved 555-01XX block, which can't take a
 * text. Her paid invoice's card said "Add a phone", as if she had none. It
 * must say her number can't receive texts instead, and not offer Add a phone.
 */
Deno.test("REQ-982 (LOOP-007 q1-65): a customer whose phone can't receive texts is not offered Add a phone on her paid invoice card", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const dana = await post(http, auth, "/api/customers", {
      name: "Dana Reserved",
      phoneNumber: "(843) 555-0142",
    });
    expect.eq(
      typeof dana.phoneNumber === "string" &&
        dana.phoneNumber.replace(/\D/g, "").endsWith("8435550142"),
      true,
      `Dana's phone is on file (${dana.phoneNumber})`,
    );
    await post(http, auth, "/api/invoices", {
      customerId: dana.id,
      lineItems: [{
        description: "Gutter cleaning",
        quantity: 1,
        unit: "job",
        price: 18000,
      }],
      amount: 18000,
      status: "paid",
      paidAt: new Date().toISOString(),
      dueDate: iso(0),
      jobName: "Dana gutters",
    });

    await page.goto("/invoices");
    const card = page.locator("article.qcard", { hasText: "Dana gutters" })
      .first();
    await card.waitFor({ timeout: 15_000 });
    const foot = card.locator(".qcard__back-foot");
    const text = (await foot.innerText()).trim();

    expect.eq(
      await card.locator("[data-cy='invoice-add-phone']").count(),
      0,
      `no "Add a phone" for a customer whose phone is on file: ${text}`,
    );
    expect.eq(
      /\bText client\b/.test(text),
      false,
      `no "Text client" for a number that can't take a text: ${text}`,
    );
    expect.eq(
      /can['’]t (receive|take) texts?/i.test(text),
      true,
      `the card says her number can't receive texts: ${text}`,
    );
  }));

/**
 * REQ-1123 (LOOP-007 cycle 3, q3-51; AMENDMENT to REQ-982 / REQ-691): Marisol
 * has (843) 555-0123 on file — the reserved 555-01XX block the send sheet and
 * the /invoices card already flag. Her payment's /payments card back
 * ("Payment trail") still offered "Text client". It must not: it shows a
 * can't-text note (pay-card-cant-text) instead, while a customer with a real
 * phone keeps Text client.
 */
Deno.test("REQ-1123 (LOOP-007 q3, q3-51): the /payments card back offers no Text client for a phone that can't receive texts, and keeps it for a real one", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl, "en");
    const marisol = await post(http, auth, "/api/customers", {
      name: "Marisol Reserved",
      phoneNumber: "(843) 555-0123",
    });
    expect.eq(
      typeof marisol.phoneNumber === "string" &&
        marisol.phoneNumber.replace(/\D/g, "").endsWith("8435550123"),
      true,
      `Marisol's phone is on file (${marisol.phoneNumber})`,
    );
    const ana = await post(http, auth, "/api/customers", {
      name: "Ana Textable",
      phoneNumber: "+15128675309",
    });
    const today = iso(0);
    for (const [c, job] of [[marisol, "Marisol deck"], [ana, "Ana fence"]]) {
      const inv = await post(http, auth, "/api/invoices", {
        customerId: c.id,
        jobName: job,
        lineItems: [{
          description: job,
          quantity: 1,
          unit: "job",
          price: 42000,
        }],
        amount: 42000,
        status: "sent",
        issuedDate: today,
        dueDate: today,
      });
      await post(http, auth, "/api/payments", {
        invoiceId: inv.id,
        amount: 42000,
        method: "check",
        receivedAt: new Date().toISOString(),
      });
    }

    await page.goto("/payments");
    const card = (name: string) =>
      page.locator("[data-cy='payment-card']", { hasText: name }).first();
    await card("Marisol Reserved").waitFor({ timeout: 15_000 });
    await card("Ana Textable").waitFor({ timeout: 15_000 });
    // flip both cards to their Payment trail (a click on the front face)
    // (retry the click until the island has hydrated and the card flips)
    for (const name of ["Marisol Reserved", "Ana Textable"]) {
      const c = card(name);
      const deadline = Date.now() + 15_000;
      while (!/qcard--flipped/.test(await c.getAttribute("class") ?? "")) {
        if (Date.now() > deadline) {
          throw new Error(`${name}'s payment card never flipped`);
        }
        await c.locator(".qcard__client-name").click();
        await page.waitForTimeout(400);
      }
    }

    // read both backs in one evaluate (one render, no straddle)
    const backs = await page.evaluate(() => {
      const out: Record<string, { text: number; cant: number; foot: string }> =
        {};
      for (const c of document.querySelectorAll("[data-cy='payment-card']")) {
        const name = c.querySelector(".qcard__client-name")?.textContent ?? "";
        const key = name.includes("Marisol")
          ? "marisol"
          : name.includes("Ana")
          ? "ana"
          : name;
        out[key] = {
          text: c.querySelectorAll("[data-cy='pay-card-text']").length,
          cant: c.querySelectorAll("[data-cy='pay-card-cant-text']").length,
          foot: (c.querySelector(".qcard__back")?.textContent ?? "")
            .replace(/\s+/g, " ").trim(),
        };
      }
      return out;
    });
    const m = backs.marisol;
    const a = backs.ana;
    expect(!!m && !!a, `both payment cards rendered: ${JSON.stringify(backs)}`);
    expect.eq(
      m.text,
      0,
      `no "Text client" on Marisol's payment card — (843) 555-0123 can't receive texts: ${m.foot}`,
    );
    expect.eq(
      m.cant,
      1,
      `Marisol's payment card says her number can't receive texts (pay-card-cant-text): ${m.foot}`,
    );
    expect.eq(
      a.text,
      1,
      `"Text client" stays on Ana's payment card (a real phone): ${a.foot}`,
    );
    expect.eq(a.cant, 0, `no can't-text note for Ana: ${a.foot}`);
  }));
