/**
 * REQ-1104 — LOOP-007 cycle 3, issue q3-27 [major/BUG_HARM]: "Signed
 * agreement freezes the relative start date 'Next week'". The demo signed a
 * quote whose start term was the wizard's "Next week" preset; afterwards the
 * signed agreement (/q and its PDF) and the deposit invoice raised at
 * signing (/i INV-001) all read "Start date: Next week" — a clause that names
 * a different week every time it is read.
 *
 * Through the real composed app: the quote is sent today, the customer signs
 * via POST /quotes/:id/accept (which bills the deposit the same day), then
 * the agreement PDF (GET /quotes/:id/pdf) and the deposit invoice PDF
 * (GET /invoices/:id/pdf) must both carry the concrete start day — the very
 * day the invoice schedule works out (startFromTerm(term, sentAt)).
 */
import "#reflect-metadata";
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import { Module } from "#danet/core";
import { bootstrapServer } from "#mrg-keystone/danet";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import { PaperworkModule } from "@paperwork/mod-root.ts";
import { UsersModule } from "@users/mod-root.ts";
import { OtpStore } from "@users/domain/data/otp-store/mod.ts";
import { SessionStore } from "@users/domain/data/session-store/mod.ts";
import { QuoteStore } from "@paperwork/domain/data/quote-store/mod.ts";
import { InvoiceStore } from "@paperwork/domain/data/invoice-store/mod.ts";
import { resetKv } from "@core/data/kv/mod.ts";
import { formatTermDate } from "#quote-flow/format-helpers.ts";
import { startFromTerm } from "#quote-flow/completion-schedule.ts";

@Module({ imports: [UsersModule, PaperworkModule] })
class TestApp {}

const PORT = 40000 + Math.floor(Math.random() * 20000);
const base = () => `http://localhost:${PORT}`;

async function login(phone: string): Promise<string> {
  await (await fetch(`${base()}/auth/send-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone }),
  })).body?.cancel();
  const stored = await new OtpStore().get(phone);
  const v = await fetch(`${base()}/auth/verify-otp`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneNumber: phone, code: stored!.code }),
  }).then((r) => r.json());
  return v.sessionId;
}

/** Every string pdf-lib drew (Flate-compressed hex-string Tj operators). */
async function drawnText(bytes: Uint8Array): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  let out = "";
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (!(obj instanceof PDFRawStream)) continue;
    let s: string;
    try {
      s = new TextDecoder("latin1").decode(decodePDFRawStream(obj).decode());
    } catch {
      continue;
    }
    for (const m of s.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) {
      let line = "";
      for (let i = 0; i + 1 < m[1].length; i += 2) {
        line += String.fromCharCode(parseInt(m[1].slice(i, i + 2), 16));
      }
      out += line + "\n";
    }
    for (const m of s.matchAll(/\(((?:[^()\\]|\\.)*)\)\s*Tj/g)) {
      out += m[1] + "\n";
    }
  }
  return out.replace(/\s*\n\s*/g, " ");
}

async function pdfText(path: string): Promise<string> {
  const res = await fetch(`${base()}${path}`);
  assertEquals(res.status, 200, path);
  return await drawnText(new Uint8Array(await res.arrayBuffer()));
}

Deno.test("REQ-1104 (LOOP-007 q3-27): signed through POST /quotes/:id/accept, the agreement PDF and the same-day deposit invoice PDF state the concrete start day for 'Next week', the day the invoice schedule uses", async () => {
  Deno.env.set("KV_PATH", ":memory:");
  Deno.env.delete("POSTMARK_API_KEY");
  await resetKv();
  const server = await bootstrapServer(TestApp, { port: PORT, swagger: false });
  await server.listen();
  try {
    const sid = await login("+15125551104");
    const owner = (await new SessionStore().get(sid))!;
    const quotes = new QuoteStore();
    const q = await quotes.create(owner.userId, {
      summary: "Fence repair",
      lineItems: [{
        description: "Fence repair",
        quantity: 1,
        unit: "job",
        price: 120_000,
      }],
      estimatedTotal: 120_000,
      terms: [
        { stepId: "start_date", label: "Start date", value: "Next week" },
        {
          stepId: "payment_terms",
          label: "Payment terms",
          value: "Deposit + balance",
        },
      ],
    } as never);
    // Sent today at noon UTC — the anchor every reader shares.
    const today = new Date().toISOString().slice(0, 10);
    const sentAt = `${today}T12:00:00.000Z`;
    await quotes.update(
      q.id,
      owner.userId,
      { status: "sent", sentAt } as never,
    );

    const acc = await fetch(`${base()}/quotes/${q.id}/accept`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Linda Park" }),
    });
    assertEquals(acc.status, 200, await acc.text());

    // The day the app itself schedules from (completion-schedule).
    const startIso = startFromTerm("Next week", new Date(sentAt))!
      .toISOString().slice(0, 10);
    const startDay = formatTermDate(startIso, "en");

    const agreement = await pdfText(`/quotes/${q.id}/pdf`);
    assertStringIncludes(agreement, "Linda Park", "the PDF is the signed copy");
    // Both surfaces are checked before failing, so a red names every one.
    const wrong: string[] = [];
    if (!agreement.includes(startDay)) {
      wrong.push(
        `agreement PDF: Start date should name ${startDay}, got "${
          /START DATE (.{0,40})/.exec(agreement)?.[1] ?? "(no start row)"
        }"`,
      );
    }

    const invoices = (await new InvoiceStore().listByUser(owner.userId))
      .filter((i) => (i as { quoteId?: string }).quoteId === q.id);
    assert(invoices.length > 0, "signing billed the deposit");
    const deposit = invoices.sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt)
    )[0];
    const bill = await pdfText(`/invoices/${deposit.id}/pdf`);
    if (!bill.includes(startDay)) {
      wrong.push(
        `deposit invoice PDF: Start date should name ${startDay}, got "${
          /START DATE (.{0,40})/.exec(bill)?.[1] ?? "(no start row)"
        }"`,
      );
    }
    assertEquals(wrong, [], wrong.join("\n"));
  } finally {
    await server.stop();
    await resetKv();
  }
});
