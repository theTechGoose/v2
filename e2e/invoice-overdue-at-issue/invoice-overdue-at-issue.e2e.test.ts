/**
 * REQ-1126 (LOOP-007 cycle 3, q3-54) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis,
 * then one to write the test, then one to fix it and make it green."
 *
 * QA: /invoices → New invoice, Issue date 2026-10-01, Net 7, Issue → Email.
 * The board says the bill is 42d overdue; the customer's email says "Status
 * Sent" and "Tap below to review it and pay whenever you're ready".
 *
 * Now: the email of an invoice already past due when it is issued (REQ-962
 * allows the backdated issue date) never says "whenever you're ready", and
 * its Status row reads Overdue.
 *
 * Page: /invoices?new=1 (front-end/islands/InvoicesPage.tsx NewInvoiceModal
 * → POST /api/invoices → send sheet → POST /api/invoices/:id/email).
 */
import { story, type StoryTools } from "#shots";
import { ensureService, fillInvoiceLine } from "../_shared/service-lines.ts"; // REQ-921

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
    body: JSON.stringify({ language: "en", name: "Overdue Email Story" }),
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

Deno.test("REQ-1126 q3-54: New invoice issued 2026-10-01 on Net 7, emailed — the outbox email has no 'whenever you're ready' and its Status reads Overdue", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    type Row = { id: string; kind?: string; channel?: string; subject?: string };
    const outbox = async () => {
      const b = await (await http("/api/outbox", { headers: auth })).json();
      return (Array.isArray(b) ? b : (b.items ?? b.messages ?? [])) as Row[];
    };
    const before = new Set((await outbox()).map((r) => r.id));

    const svc = await ensureService(http, auth, "Gutter clean"); // REQ-921
    await page.goto("/invoices?new=1");
    await page.locator("[data-cy='new-invoice-modal']").waitFor({ timeout: 15_000 });
    await page.locator("[data-cy='new-invoice-bill-name']").fill("Rosa Diaz");
    await page.locator("[data-cy='new-invoice-bill-email']").fill(
      "rosa.q354@blackhole.postmarkapp.com",
    );
    await fillInvoiceLine(page, 0, svc, "250");
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-total']")?.textContent ?? "").includes("250")
    );
    await page.locator("[data-cy='new-invoice-issued']").fill("2026-10-01");
    await page.locator("[data-cy='new-invoice-terms']").selectOption("7");
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-due']") as HTMLInputElement | null)?.value ===
        "2026-10-08"
    , undefined, { timeout: 10_000 });

    await page.locator("[data-cy='new-invoice-submit']").click();
    const sheet = page.locator("[data-cy='send-dialog']");
    await sheet.waitFor({ timeout: 15_000 });
    const emailOpt = page.locator("[data-cy='send-option-email']");
    if (await emailOpt.count()) await emailOpt.click();
    const sent = page.waitForResponse((res) =>
      res.request().method() === "POST" && /\/api\/invoices\/[^/]+\/email/.test(res.url())
    );
    await page.locator("[data-cy='send-keep']").click();
    const res = await sent;
    expect(res.ok(), `POST /invoices/:id/email → ${res.status()}`);

    const after = await outbox();
    const mail = after.find((r) => !before.has(r.id) && r.kind === "invoice" && r.channel === "email");
    expect(
      !!mail,
      `the invoice email is in the Outbox (${JSON.stringify(after.map((r) => `${r.kind}:${r.channel}`))})`,
    );
    const { body } = await (await http(`/api/outbox/${mail!.id}`, { headers: auth })).json() as {
      body: string;
    };
    const whenever = body.match(/[^<>]{0,80}whenever you[^<>]{0,40}/)?.[0]?.trim();
    const statusAt = body.indexOf(">Status<");
    const status = statusAt >= 0
      ? (body.slice(statusAt).match(/<\/td><td[^>]*>([^<]*)<\/td>/)?.[1] ?? "").trim()
      : "";
    expect(!whenever, `the past-due email does not say "whenever you're ready" (got "${whenever}")`);
    expect.eq(status, "Overdue", "the email's Status row reads Overdue, like the board's '42d overdue'");
  }));
