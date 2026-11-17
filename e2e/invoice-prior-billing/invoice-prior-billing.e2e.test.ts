/**
 * REQ-474 (demo-loop cycle 3, issue M17) on the real app — "Same job invoiced
 * twice with no warning". Ana Pérez signed a $180 pay-on-completion quote, so
 * INV-001 $180 sat scheduled; the New invoice modal ("Bill a client directly
 * — no quote") then sent INV-002 $180 beside it without a word.
 *
 * Now picking Ana in the modal says "Ana Pérez already has INV-001 ($180.00)
 * scheduled for Q-001", with "Send INV-001 now" (it goes out, no second
 * invoice) and "Link to Q-001" (the invoice is quote-linked, so the REQ-233
 * cap refuses a second $180).
 *
 * Page: /invoices?new=1 (front-end/islands/InvoicesPage.tsx NewInvoiceModal),
 * shared/documents/invoice-form.ts priorBillingFor.
 */
import { story, type StoryTools } from "#shots";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
const SIGNATURE_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAF0lEQVR4nGNgYGD4z4AGmNAFRlgIXQAAiMkBB9dzbnMAAAAASUVORK5CYII=";

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
    body: JSON.stringify({ language: "en", name: "Prior Billing Story" }),
  });
  await me.body?.cancel();
  const [name, value] = cookie.split("=");
  const hosts = new Set([new URL(baseUrl).hostname, "localhost", "127.0.0.1"]);
  await page.context().addCookies(
    [...hosts].flatMap((
      domain,
    ) => [{ name, value, domain, path: "/" }, {
      name: "pm_lang",
      value: "en",
      domain,
      path: "/",
    }]),
  );
  return { auth };
}

/** Ana signs a $180 "Payment upon completion" quote: INV-001 is scheduled. */
async function anaSigned(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const customer = await (await http("/api/customers", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      name: "Ana Pérez",
      email: "ana.perez@blackhole.postmarkapp.com",
      phoneNumber: "+15125550174",
    }),
  })).json();
  const quote = await (await http("/api/quotes", {
    method: "POST",
    headers: auth,
    body: JSON.stringify({
      summary: "Limpieza profunda",
      jobName: "Limpieza profunda",
      customerId: customer.id,
      lineItems: [{
        description: "Limpieza profunda",
        quantity: 1,
        unit: "job",
        price: 18000,
      }],
      estimatedTotal: 18000,
      estimatedCompletionDate: "2099-11-20",
      terms: [{
        stepId: "payment_terms",
        label: "Payment terms",
        value: "Payment upon completion",
      }],
      status: "sent",
    }),
  })).json();
  // POST /quotes keeps a new quote a draft; REQ-460 signs only a sent one
  // (REQ-727: without this the accept was a 409 not_issued, so the story
  // never reached "Send INV-001 now").
  const sent = await http(`/api/quotes/${quote.id}`, {
    method: "PUT",
    headers: auth,
    body: JSON.stringify({ status: "sent" }),
  });
  await sent.body?.cancel();
  const accept = await http(`/api/quotes/${quote.id}/accept`, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ name: "Ana Pérez", signature: SIGNATURE_PNG }),
  });
  await accept.body?.cancel();
  if (accept.status >= 400) throw new Error(`accept: ${accept.status}`);
  return { quoteId: quote.id as string, customerId: customer.id as string };
}

async function anasInvoices(
  http: StoryTools["http"],
  auth: Record<string, string>,
  customerId: string,
  quoteId: string,
) {
  const all = await (await http("/api/invoices", { headers: auth }))
    .json() as Array<
      {
        id: string;
        number?: string;
        customerId?: string;
        quoteId?: string;
        amount?: number;
        status?: string;
      }
    >;
  return all.filter((i) =>
    (i.customerId === customerId || i.quoteId === quoteId) &&
    i.status !== "void"
  );
}

async function clickUntil(
  page: StoryTools["page"],
  selector: string,
  done: () => Promise<boolean>,
): Promise<void> {
  for (let attempt = 0; attempt < 10; attempt++) {
    if (await done()) return;
    try {
      await page.locator(selector).click({ timeout: 2_000 });
    } catch {
      // not clickable yet (hydrating) or gone: the polls below decide
    }
    for (let i = 0; i < 5; i++) {
      if (await done()) return;
      await page.waitForTimeout(200);
    }
  }
  throw new Error(`${selector}: the click never took`);
}

/** /invoices?new=1 with Ana picked — the warning shows. */
async function openModalForAna(
  page: StoryTools["page"],
  customerId: string,
) {
  await page.goto("/invoices?new=1");
  const select = page.locator("[data-cy='new-invoice-client']");
  await select.waitFor({ timeout: 15_000 });
  const prior = page.locator("[data-cy='new-invoice-prior']");
  for (let i = 0; i < 20 && !(await prior.isVisible()); i++) {
    await select.selectOption(customerId).catch(() => {});
    await page.waitForTimeout(500);
  }
  await prior.waitFor({ timeout: 15_000 });
  return prior;
}

Deno.test("REQ-474 M17: picking a client with a scheduled INV-001 in New invoice says so — 'Ana Pérez already has INV-001 ($180.00) scheduled for Q-001' — and 'Send INV-001 now' sends it instead of a second invoice", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quoteId, customerId } = await anaSigned(http, auth);
    const before = await anasInvoices(http, auth, customerId, quoteId);
    expect.eq(
      before.map((i) => `${i.status}:${i.amount}`).join(","),
      "scheduled:18000",
      "signing scheduled INV-001 for the end of the job",
    );
    const inv001 = before[0];

    const prior = await openModalForAna(page, customerId);
    const said = await prior.innerText();
    expect(
      said.includes(
        `Ana Pérez already has ${inv001.number} ($180.00) scheduled for Q-`,
      ),
      `the warning names the scheduled invoice and its quote (${said})`,
    );
    expect(said.includes("Link to Q-"), `offers to link (${said})`);

    const sendNow = "[data-cy='new-invoice-prior-send']";
    // REQ-727 (cycle 5, c4-M16): "Send INV-001 now" opens the send sheet —
    // nothing goes until its Send.
    const sheet = page.locator("[data-cy='send-dialog']");
    await clickUntil(page, sendNow, () => sheet.isVisible());
    await clickUntil(page, "[data-cy='send-keep']", async () => {
      const now = await anasInvoices(http, auth, customerId, quoteId);
      return now.some((i) => i.id === inv001.id && i.status === "sent");
    });
    const after = await anasInvoices(http, auth, customerId, quoteId);
    expect.eq(
      after.map((i) => `${i.number}:${i.status}:${i.amount}`).join(","),
      `${inv001.number}:sent:18000`,
      "INV-001 went out and no second invoice was made",
    );
  }));

Deno.test("REQ-474 M17: 'Link to Q-001' makes the New invoice quote-linked — a second $180 for the same job is refused by the agreement cap (REQ-233), not saved beside INV-001", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const { quoteId, customerId } = await anaSigned(http, auth);

    await openModalForAna(page, customerId);
    const ledger = page.locator("[data-cy='new-invoice-ledger']");
    await clickUntil(
      page,
      "[data-cy='new-invoice-prior-link']",
      () => ledger.isVisible(),
    );
    const ledgerText = await ledger.innerText();
    expect(
      ledgerText.includes("Remaining $0.00"),
      `linked to Q-001, nothing left to bill (${ledgerText})`,
    );
    await page.locator("[data-cy='new-invoice-amount']").fill("180");
    await page.locator("[data-cy='new-invoice-draft']").click();
    await expect.see(
      "That amount is more than what's left to invoice on this agreement.",
      { timeout: 15_000 },
    );
    expect.eq(
      (await anasInvoices(http, auth, customerId, quoteId)).length,
      1,
      "only INV-001 — the job is not billed twice",
    );
  }));
