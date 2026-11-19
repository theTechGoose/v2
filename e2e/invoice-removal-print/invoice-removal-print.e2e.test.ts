/**
 * REQ-627 — removing an invoice, with a clear process, in a browser: a sent
 * invoice is voided (kept, Cancelled, the customer's link says so), "Void &
 * duplicate" lands on the corrected draft, bulk Delete skips what it must.
 * REQ-629 — select invoices (or all in view) → ONE PDF, their logo on it.
 */
import { story, type StoryTools } from "#shots";
import { pdfFacts } from "../../backend/src/paperwork/domain/business/pdf-logo/inspect.ts";
import { WIDE_PNG } from "../../backend/src/paperwork/domain/business/pdf-logo/fixtures.ts";

const JSON_HEADERS = { "content-type": "application/json" };
const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
// a 64×16 PNG (4:1) — the business's logo
const LOGO_B64 = btoa(String.fromCharCode(...WIDE_PNG));

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
  await call(http, auth, "PUT", "/api/me", {
    language: "en",
    name: "Alexander Jerez",
  });
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

async function call(
  http: StoryTools["http"],
  auth: Record<string, string>,
  method: string,
  path: string,
  body?: unknown,
) {
  const r = await http(path, {
    method,
    headers: auth,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await r.text();
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

async function seedBusiness(
  http: StoryTools["http"],
  auth: Record<string, string>,
) {
  const f = await call(http, auth, "POST", "/api/files", {
    filename: "logo.png",
    mimeType: "image/png",
    base64: LOGO_B64,
  });
  await call(http, auth, "PUT", "/api/profile/identity", {
    businessName: "A2Z Landscape LLC",
    logoFileId: f.id,
    acceptedPaymentMethods: {
      zelle: { enabled: true, handle: "pay@a2zlandscape.com" },
    },
  });
  return await call(http, auth, "POST", "/api/customers", {
    name: "Randall Belknap",
    address: "725 Frederick Rd, Myrtle Beach, SC 29577",
  });
}

const mkInvoice = (
  http: StoryTools["http"],
  auth: Record<string, string>,
  body: Record<string, unknown>,
) => call(http, auth, "POST", "/api/invoices", { amount: 6500, ...body });

Deno.test("REQ-627 + REQ-983: a sent invoice is voided, not deleted — it stays as Cancelled with the reason, and the customer's link says it's cancelled and can't be paid, with a footer that neither thanks for nor asks about payment", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await seedBusiness(http, auth);
    const inv = await mkInvoice(http, auth, {
      status: "sent",
      customerId: customer.id,
      jobName: "Void me",
    });
    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-void']").waitFor({ timeout: 15_000 });
    expect.eq(
      await page.locator("[data-cy='invoice-delete']").count(),
      0,
      "a sent invoice offers no Delete",
    );
    await page.locator("[data-cy='invoice-void']").click();
    await page.locator("[data-cy='invoice-void-panel']").waitFor();
    await expect.see("the customer may have seen it");
    await page.locator("[data-cy='invoice-void-reason']").fill("Wrong address");
    await page.locator("[data-cy='invoice-void-confirm']").click();
    const note = page.locator("[data-cy='invoice-voided-note']");
    await note.waitFor({ timeout: 15_000 });
    const noteText = await note.innerText();
    expect(
      /Cancelled/.test(noteText) && /Alexander Jerez/.test(noteText) &&
        /Wrong address/.test(noteText),
      `who / when / why: ${noteText}`,
    );
    const after = await call(http, auth, "GET", `/api/invoices/${inv.id}`);
    expect.eq(after.status, "void", "the invoice is void, still there");
    await page.goto(`/i/${inv.id}`);
    await page.locator("[data-cy='invoice-cancelled-note']").waitFor({
      timeout: 15_000,
    });
    await expect.see("please don't pay it");
    expect.eq(
      await page.locator("[data-cy='claim-submit']").count(),
      0,
      "no way to pay it",
    );
    // REQ-983 (LOOP-007 q1-67): the footer agrees with the cancelled state —
    // no thanks for "prompt payment", no question "before paying"
    const footer = await page.evaluate(() => ({
      thanks: document.querySelector("[data-cy='invoice-thanks']")
        ?.textContent ?? null,
      question: document.querySelector("[data-invoice-question]")
        ?.textContent ?? null,
    }));
    expect(
      footer.thanks !== null && footer.question !== null,
      `REQ-983: the footer renders its thanks and question lead-in: ${
        JSON.stringify(footer)
      }`,
    );
    expect(
      !/prompt payment/i.test(footer.thanks ?? ""),
      `REQ-983: a cancelled invoice does not thank for prompt payment: ${footer.thanks}`,
    );
    expect(
      !/before paying/i.test(footer.question ?? ""),
      `REQ-983: a cancelled invoice does not ask for questions before paying: ${footer.question}`,
    );
    // the list keeps it, in the Cancelled track
    await page.goto("/invoices");
    await page.locator("text=Cancelled").first().waitFor({ timeout: 15_000 });
  }));

Deno.test("REQ-627: Void & duplicate cancels the sent invoice and opens a corrected draft copy with a new number", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await seedBusiness(http, auth);
    const inv = await mkInvoice(http, auth, {
      status: "sent",
      customerId: customer.id,
      jobName: "Fix my price",
    });
    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-void']").click({ timeout: 15_000 });
    await page.locator("[data-cy='invoice-void-duplicate']").click();
    await page.waitForURL(
      (u: URL) => {
        const o = u.searchParams.get("open");
        return !!o && o !== inv.id;
      },
      { timeout: 15_000 },
    );
    const newId = new URL(page.url()).searchParams.get("open");
    expect(newId && newId !== inv.id, `opened the copy (${newId})`);
    const copy = await call(http, auth, "GET", `/api/invoices/${newId}`);
    expect.eq(copy.status, "draft", "the copy is a draft");
    expect(
      copy.number !== inv.number,
      `new number ${copy.number} vs ${inv.number}`,
    );
    await page.locator("[data-cy='invoice-edit']").waitFor({ timeout: 15_000 });
    expect(
      !(await page.locator("[data-cy='invoice-edit']").isDisabled()),
      "the copy can be edited",
    );
    const old = await call(http, auth, "GET", `/api/invoices/${inv.id}`);
    expect.eq(old.status, "void", "the original is voided");
  }));

// REQ-964 (LOOP-007 q1, q1-40) — REQ-627 AMENDMENT, refs REQ-926: Void &
// duplicate on a past-due bill with a chargeback fee opens a draft that is
// not due before today and does not silently carry the $35 fee.
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const enCardDate = (iso: string, now: Date) => {
  const d = new Date(iso + "T00:00:00");
  const m = d.toLocaleString("en-US", { month: "short" });
  return d.getFullYear() === now.getFullYear()
    ? `${m} ${d.getDate()}`
    : `${m} ${d.getDate()}, ${d.getFullYear()}`;
};

Deno.test("REQ-964: Void & duplicate on a past-due invoice with a chargeback fee opens a draft due no earlier than today, without the fee line", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await seedBusiness(http, auth);
    const now = new Date();
    const today = isoDay(now);
    const staleDue = isoDay(new Date(now.getTime() - 18 * 86_400_000));
    const issued = isoDay(new Date(now.getTime() - 33 * 86_400_000));
    const inv = await mkInvoice(http, auth, {
      status: "sent",
      customerId: customer.id,
      jobName: "Fence repair",
      issuedDate: issued,
      dueDate: staleDue,
      netDays: 15,
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 100000,
      }],
      subtotalCents: 100000,
      amount: 100000,
    });
    const pay = await call(http, auth, "POST", "/api/payments", {
      invoiceId: inv.id,
      amount: 100000,
      method: "check",
      receivedAt: now.toISOString(),
    });
    await call(http, auth, "POST", `/api/payments/${pay.id}/chargeback`, {
      feeCents: 3500,
      reason: "Check bounced",
    });

    await page.goto(`/invoices?open=${inv.id}`);
    await page.locator("[data-cy='invoice-void']").click({ timeout: 15_000 });
    await page.locator("[data-cy='invoice-void-duplicate']").click();
    await page.waitForURL(
      (u: URL) => {
        const o = u.searchParams.get("open");
        return !!o && o !== inv.id;
      },
      { timeout: 15_000 },
    );
    const newId = new URL(page.url()).searchParams.get("open")!;
    const copy = await call(http, auth, "GET", `/api/invoices/${newId}`);
    expect.eq(copy.status, "draft", "the copy is a draft");

    // the opened draft's card: its Due label is not earlier than today
    const card = page.locator(".qcard", {
      has: page.locator("[data-cy='invoice-cta-drafting']"),
    }).first();
    const dueLabel = (await card.locator(".qcard__val-num").first().innerText({
      timeout: 15_000,
    })).trim();
    expect(
      dueLabel !== enCardDate(staleDue, now),
      `the draft reads "Due ${dueLabel}" — the voided bill's past due date`,
    );
    expect(
      typeof copy.dueDate === "string" && copy.dueDate >= today,
      `the draft is due ${copy.dueDate}, before today ${today}`,
    );
    expect.eq(
      dueLabel,
      enCardDate(copy.dueDate, now),
      "the card shows the draft's own due date",
    );

    // the chargeback fee does not ride along silently
    const feeLines = (copy.lineItems as Array<{ chargebackFor?: string }>)
      .filter((l) => l.chargebackFor !== undefined);
    expect.eq(feeLines.length, 0, "no chargeback fee line on the copy");
    expect.eq(copy.amount, 100000, "the copy is not $1,035");
  }));

Deno.test("REQ-629 + REQ-627: select all in view → one PDF with every invoice and their logo; bulk Delete removes the drafts and reports the skipped ones", (t) =>
  story(t, async ({ page, expect, http, baseUrl }) => {
    const { auth } = await signIn(http, page, baseUrl);
    const customer = await seedBusiness(http, auth);
    const d1 = await mkInvoice(http, auth, {
      status: "draft",
      customerId: customer.id,
      jobName: "Draft one",
    });
    const d2 = await mkInvoice(http, auth, {
      status: "draft",
      customerId: customer.id,
      jobName: "Draft two",
    });
    const s1 = await mkInvoice(http, auth, {
      status: "sent",
      customerId: customer.id,
      jobName: "Sent one",
    });
    await page.goto("/invoices");
    await page.locator("[data-cy='invoices-select-toggle']").click({
      timeout: 15_000,
    });
    await page.locator("[data-cy='invoices-bulk-bar']").waitFor();
    await page.locator("[data-cy='invoices-bulk-select-all']").click();
    await expect.see("3 selected");
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 30_000 }),
      page.locator("[data-cy='invoices-bulk-print']").click(),
    ]);
    expect(
      /^invoices-\d{4}-\d{2}-\d{2}\.pdf$/.test(download.suggestedFilename()),
      download.suggestedFilename(),
    );
    const file = await download.path();
    const f = await pdfFacts(await Deno.readFile(file!));
    expect(f.pages >= 3, `one page per invoice (${f.pages})`);
    expect.eq(f.images, 1, "their logo, embedded once");
    for (const inv of [d1, d2, s1]) {
      expect(f.text.includes(inv.number), `${inv.number} is in the PDF`);
    }
    expect(f.text.includes("pay@a2zlandscape.com"), "how to pay");
    expect(!/docu\s*monster/i.test(f.text), "no DocuMonster on the printout");

    // bulk delete: the drafts go, the sent one is skipped with the reason
    await page.locator("[data-cy='invoices-bulk-delete']").click();
    await page.locator("[data-cy='invoices-bulk-skips']").waitFor();
    await expect.see("sent — void instead");
    await page.locator("[data-cy='invoices-bulk-confirm-go']").click();
    const result = page.locator("[data-cy='invoices-bulk-result']").first();
    await result.waitFor({ timeout: 15_000 });
    const msg = await result.innerText();
    expect(/2 deleted/.test(msg) && /sent — void instead \(1\)/.test(msg), msg);
    for (const gone of [d1, d2]) {
      const r = await http(`/api/invoices/${gone.id}`, { headers: auth });
      await r.body?.cancel();
      expect.eq(r.status, 404, "the draft is gone");
    }
    const kept = await call(http, auth, "GET", `/api/invoices/${s1.id}`);
    expect.eq(kept.status, "sent", "the sent one was skipped");
  }));
