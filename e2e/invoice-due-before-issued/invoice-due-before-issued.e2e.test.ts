/**
 * REQ-962 (LOOP-007 cycle 1, q1-39) — Raphael: "test every single aspect of
 * this application … one Opus agent per issue to do root cause analysis,
 * then one to write the test, then one to fix it and make it green."
 *
 * QA found: on /invoices → New invoice, Issue date Nov 19 and a typed Due
 * date of Nov 1 → "Issue invoice" created INV-002, emailed the customer
 * "— due November 1, 2026" and listed it as overdue at birth.
 *
 * Now: a due date before the issue date is refused in the form with an
 * error; no invoice is created and nothing is in the outbox.
 *
 * Page: /invoices?new=1 (front-end/islands/InvoicesPage.tsx NewInvoiceModal
 * → POST /api/invoices).
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
    body: JSON.stringify({ language: "en", name: "Due Date Story" }),
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

Deno.test("REQ-962 q1-39: New invoice with Issue date 2026-11-19 and Due date 2026-11-01 is refused in the form — an error shows, no invoice is created, the outbox is empty", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const list = async () =>
      await (await http("/api/invoices", { headers: auth })).json() as Array<
        {
          number?: string;
          status?: string;
          issuedDate?: string;
          dueDate?: string;
        }
      >;
    const outbox = async () => {
      const r = await http("/api/outbox", { headers: auth });
      const b = await r.json();
      return (Array.isArray(b) ? b : (b.items ?? b.messages ?? [])) as Array<
        { subject?: string }
      >;
    };

    const svc = await ensureService(http, auth, "Gutter clean"); // REQ-921
    await page.goto("/invoices?new=1");
    await page.locator("[data-cy='new-invoice-modal']").waitFor({
      timeout: 15_000,
    });
    await page.locator("[data-cy='new-invoice-bill-name']").fill("Rosa Diaz");
    await page.locator("[data-cy='new-invoice-bill-email']").fill(
      "rosa.q139@blackhole.postmarkapp.com",
    );
    await fillInvoiceLine(page, 0, svc, "250");
    await page.waitForFunction(() =>
      (document.querySelector("[data-cy='new-invoice-total']")?.textContent ??
        "").includes("250")
    );
    await page.locator("[data-cy='new-invoice-issued']").fill("2026-11-19");
    await page.locator("[data-cy='new-invoice-due']").fill("2026-11-01");
    expect.eq(
      await page.locator("[data-cy='new-invoice-due']").inputValue(),
      "2026-11-01",
      "the typed due date is in the field",
    );

    await page.locator("[data-cy='new-invoice-submit']").click();
    const alert = page.locator("[data-cy='new-invoice-modal'] [role=alert]");
    const sheet = page.locator("[data-cy='send-dialog']");
    // whichever comes first: the form's refusal, or the send sheet on a
    // created invoice — where the owner presses Send, as QA did
    const deadline = Date.now() + 15_000;
    let sheetOpened = false;
    while (Date.now() < deadline) {
      if (await alert.isVisible().catch(() => false)) break;
      if (await sheet.isVisible().catch(() => false)) {
        sheetOpened = true;
        break;
      }
      await page.waitForTimeout(250);
    }
    if (sheetOpened) {
      // the invoice exists already; press Send as QA did so the outbox shows
      // what reached the customer (a slow host's screenshot must not hide
      // the assertions below)
      try {
        await page.locator("[data-cy='send-keep']").click();
        const until = Date.now() + 15_000;
        while (Date.now() < until && (await outbox()).length === 0) {
          await page.waitForTimeout(250);
        }
      } catch { /* the list + outbox assertions below say what happened */ }
    }

    const all = await list();
    expect.eq(
      all.length,
      0,
      `no invoice was created (got ${
        JSON.stringify(
          all.map((i) => ({
            number: i.number,
            status: i.status,
            issuedDate: i.issuedDate,
            dueDate: i.dueDate,
          })),
        )
      })`,
    );
    const mail = await outbox();
    expect.eq(
      mail.length,
      0,
      `nothing went to the customer (outbox: ${
        JSON.stringify(mail.map((m) => m.subject))
      })`,
    );
    expect(await alert.isVisible(), "the form shows an error");
    const why = await alert.innerText();
    expect(/due|issue/i.test(why), `the error is about the dates (${why})`);
  }));
