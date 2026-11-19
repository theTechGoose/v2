/**
 * REQ-1115 — Raphael (LOOP-007): "test every single aspect of this
 * application … one Opus agent per issue to do root cause analysis, then one
 * to write the test, then one to fix it and make it green." Cycle 3, issue
 * q3-39: "Reminder says 'vence pronto' for a bill due in 30 days".
 *
 * In a browser, in Spanish: a Spanish-reading customer with an invoice
 * issued today, due in 30 days. On /customers/<id>, Recordar → Enviar
 * recordatorio sends the reminder nudge; the Outbox's newest reminder email
 * to her must not say "vence pronto" and its subject must not be
 * "Próximo vencimiento: …" — that is the three-days-out copy (REQ-704).
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
  // the backend can still be booting under host load after the front end
  // is up ("backend_unreachable") — wait for it rather than fail sign-in
  let r: Response;
  let body: { recoverable?: boolean; recoveryToken?: string; error?: string };
  for (let i = 0;; i++) {
    r = await http("/api/auth/verify", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ phoneNumber: phone, code: "000000" }),
    });
    body = await r.json();
    if (body.error !== "backend_unreachable" || i >= 90) break;
    await page.waitForTimeout(2_000);
  }
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
    body: JSON.stringify({ language: "es", name: "Marco Ortiz" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "es",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

const iso = (days: number) =>
  new Date(Date.now() + days * 864e5).toISOString().slice(0, 10);

type Row = {
  id: string;
  channel: string;
  kind: string;
  customerId?: string;
  subject?: string;
};

Deno.test("REQ-1115 (LOOP-007 q3-39): Recordar on a Spanish invoice due in 30 days sends a reminder that does not say 'vence pronto' / 'Próximo vencimiento'", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    await page.setViewportSize({ width: 1280, height: 900 });
    const customer = await (await http("/api/customers", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        name: `Lucía Ortiz ${digits()}`,
        email: "lucia.ortiz@blackhole.postmarkapp.com",
        language: "es",
      }),
    })).json();
    expect(typeof customer.id === "string", `customer created (${JSON.stringify(customer)})`);
    const inv = await (await http("/api/invoices", {
      method: "POST",
      headers: auth,
      body: JSON.stringify({
        customerId: customer.id,
        status: "sent",
        jobName: "Pintura de cerca REQ-1115",
        description: "Pintura de cerca",
        lineItems: [{ description: "Pintura de cerca", quantity: 1, price: 82067 }],
        amount: 82067,
        issuedDate: iso(0),
        dueDate: iso(30),
      }),
    })).json();
    expect(typeof inv.id === "string", `invoice created (${JSON.stringify(inv)})`);

    const outboxOf = async () =>
      ((await (await http("/api/outbox", { headers: auth })).json()) as Row[])
        .filter((r) => r.customerId === customer.id && r.channel === "email");
    const before = new Set((await outboxOf()).map((r) => r.id));

    await page.goto(`/customers/${customer.id}?lang=es`);
    await page.locator(
      `[data-cy='customer-workspace'][data-customer='${customer.id}']`,
    ).waitFor({ timeout: 20_000 });
    const remind = page.locator("[data-cy='cws-remind']");
    await remind.waitFor({ timeout: 15_000 });

    const sheet = page.locator("[data-cy='send-dialog']");
    for (let i = 0; i < 20 && !(await sheet.isVisible()); i++) {
      await remind.click({ timeout: 2_000 }).catch(() => {});
      await page.waitForTimeout(400);
    }
    await sheet.waitFor({ timeout: 15_000 });
    const sent = page.waitForResponse((res) =>
      res.request().method() === "POST" &&
      /\/api\/cron\/invoice-reminder$/.test(new URL(res.url()).pathname)
    );
    await page.locator("[data-cy='send-keep']").click();
    const res = await sent;
    expect(res.ok(), `POST /api/cron/invoice-reminder → ${res.status()}`);

    let mail: Row | undefined;
    for (let i = 0; i < 25 && !mail; i++) {
      mail = (await outboxOf()).find((r) => !before.has(r.id) && r.kind === "reminder");
      if (!mail) await page.waitForTimeout(400);
    }
    expect(!!mail, "the Outbox has the new reminder email");
    const { body } = await (await http(`/api/outbox/${mail!.id}`, {
      headers: auth,
    })).json() as { body: string };
    const tone = body.match(/line-height:1\.55">([^<]*)<\/p>/)?.[1] ?? "";
    expect(/^Hola/.test(tone), `the reminder is in Spanish (got "${tone}")`);
    expect(
      !/vence pronto/i.test(body),
      `an invoice due in 30 days must not be "vence pronto" (email says "${tone}")`,
    );
    expect(
      !/Próximo vencimiento/i.test(mail!.subject ?? ""),
      `an invoice due in 30 days must not get the "Próximo vencimiento" subject (got "${mail!.subject}")`,
    );
  }));
