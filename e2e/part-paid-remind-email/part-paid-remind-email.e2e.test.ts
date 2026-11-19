/**
 * REQ-1028 — LOOP-007 cycle 2, issues q2-9 + q2-20, in a browser on the real
 * shell.
 *
 * QA: INV-001 is $1,190.75 with $500 paid. The owner (UI in English) opens
 * the customer page → Remind → Email only → Español → Send.
 *
 * Integration (qa-loop): REQ-1031 (q2-8) made the customer page's Remind send
 * the reminder nudge, not the first-send invoice email this story checks; the
 * invoice email's send sheet is reached from the /customers board's "Send a
 * kind reminder" (REQ-1029, q2-10), which REQ-1066 (q2-56) offers only for
 * money that is due — so the invoice here is overdue. The Spanish email
 * headlines "Monto a pagar $1,190.75", reads "Estado Pending", and shows the
 * $690.75 balance only at the bottom. The email must headline the $690.75
 * balance (money card + preheader) and its Estado must be a Spanish word.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const inDays = (n: number) =>
  new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

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
    body: JSON.stringify({ language: "en", name: "Luis Ortega" }),
  });
  await me.body?.cancel();
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
  body: unknown,
) {
  const r = await http(path, {
    method: "POST",
    headers: auth,
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${path} → ${r.status} ${await r.text()}`);
  return await r.json();
}

type Row = { id: string; kind: string; channel: string; createdAt?: string };

Deno.test("REQ-1028 q2-9/q2-20: Remind (Email only, Español) on a $1,190.75 invoice with $500 paid emails the $690.75 balance and a Spanish Estado, never 'Pending'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await post(http, auth, "/api/customers", {
      name: "Carmen Ruiz",
      email: "carmen.ruiz@blackhole.postmarkapp.com",
    });
    const inv = await post(http, auth, "/api/invoices", {
      customerId: customer.id,
      status: "sent",
      jobName: "Cambio de piso de cocina",
      issuedDate: inDays(-40),
      dueDate: inDays(-10),
      lineItems: [{
        description: "Cambio de piso de cocina",
        quantity: 1,
        unit: "job",
        price: 119_075,
      }],
      amount: 119_075,
    });
    await post(http, auth, "/api/payments", {
      invoiceId: inv.id,
      amount: 50_000,
      method: "check",
      receivedAt: new Date().toISOString(),
    });
    const before = new Set(
      ((await (await http("/api/outbox", { headers: auth })).json()) as Row[])
        .map((r) => r.id),
    );

    await page.goto("/customers");
    const nudge = `.ccard2:has-text('Carmen Ruiz') [data-cy='ccard2-nudge']`;
    await page.locator(nudge).waitFor({ timeout: 15_000 });
    const dialog = page.locator("[data-cy='send-dialog']");
    for (let i = 0; i < 20 && (await dialog.count()) === 0; i++) {
      await page.locator(nudge).click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    await dialog.waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='send-option-email']").click();
    await page.locator("[data-cy='send-lang-es']").click();
    await page.locator("[data-cy='send-lang-es'][aria-pressed='true']")
      .waitFor({ timeout: 10_000 });
    const sent = page.waitForResponse((res) =>
      res.request().method() === "POST" &&
      new RegExp(`/api/invoices/${inv.id}/email`).test(res.url())
    );
    await page.locator("[data-cy='send-keep']").click();
    const res = await sent;
    expect(res.ok(), `POST /invoices/:id/email → ${res.status()}`);

    const after = (await (await http("/api/outbox", { headers: auth }))
      .json()) as Row[];
    const mail = after.find((r) =>
      !before.has(r.id) && r.kind === "invoice" && r.channel === "email"
    );
    expect(
      !!mail,
      `the reminder email is in the Outbox (${
        JSON.stringify(after.map((r) => `${r.kind}:${r.channel}`))
      })`,
    );
    const { body } = await (await http(`/api/outbox/${mail!.id}`, {
      headers: auth,
    })).json() as { body: string };

    const pre = body.match(
      /<span style="display:none!important[^"]*">([^<]*)<\/span>/,
    )?.[1] ?? "";
    const card = body.match(
      /(?:class="pw-amt-n"|font-size:28px;letter-spacing:-0\.02em;)[^>]*>\s*(\$[\d,]+\.\d\d)/,
    )?.[1] ?? "";
    const estadoAt = body.indexOf(">Estado<");
    const estado = estadoAt >= 0
      ? (body.slice(estadoAt).match(/<\/td><td[^>]*>([^<]*)<\/td>/)?.[1] ?? "")
        .trim()
      : "";

    expect.eq(card, "$690.75", "the money card asks for the $690.75 balance");
    expect(
      pre.includes("$690.75") && !pre.includes("$1,190.75"),
      `the preheader names the $690.75 balance (got "${pre}")`,
    );
    expect(
      estado !== "" && estado.toLowerCase() !== "pending",
      `the Estado row is a Spanish word, not "Pending" (got "${estado}")`,
    );
    expect(
      !/>\s*Pending\s*</.test(body),
      "no cell of the Spanish email reads 'Pending'",
    );
  }));
