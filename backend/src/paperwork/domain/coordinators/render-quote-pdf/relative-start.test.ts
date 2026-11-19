/**
 * REQ-1104 — LOOP-007 cycle 3, issue q3-27 [major/BUG_HARM]: "Signed
 * agreement freezes the relative start date 'Next week'". The terms wizard
 * stores the start preset as its English label ("Next week"), and every
 * reader printed it as a literal — so the signed agreement's Start date
 * named no week at all ("Start date: Next week" / "La próxima semana").
 *
 * The agreement PDF anchors a relative start to the day the quote went out
 * (quote.sentAt ?? createdAt — the same anchor the invoice schedule uses,
 * completion-schedule startFromTerm) and prints that concrete day.
 */
import { assert, assertStringIncludes } from "#std/assert";
import { decodePDFRawStream, PDFDocument, PDFRawStream } from "#pdf-lib";
import type { Quote } from "@paperwork/dto/quote.ts";
import type { User } from "@users/dto/user.ts";
import { formatTermDate } from "#quote-flow/format-helpers.ts";
import { RenderQuotePdf } from "./mod.ts";

/** Every string pdf-lib drew (hex-string / literal Tj operators). */
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

const contractor = {
  id: "u-1104",
  name: "Rosa",
  phoneNumber: "+15125550000",
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
} as User;

const SENT = "2026-11-19T15:00:00.000Z";

function signedQuote(start: string): Quote {
  return {
    id: "4567efab-0000-4000-8000-000000001104",
    userId: "u-1104",
    number: "Q-001",
    version: 1,
    status: "accepted",
    summary: "Fence repair",
    lineItems: [{ description: "Repair", quantity: 1, price: 900_00 }],
    estimatedTotal: 900_00,
    terms: [
      { stepId: "start_date", label: "Start date", value: start },
      { stepId: "payment_terms", label: "Payment terms", value: "50/50" },
    ],
    sentAt: SENT,
    acceptedAt: "2026-11-19T16:00:00.000Z",
    acceptedName: "Linda Park",
    createdAt: "2026-11-18T12:00:00Z",
    updatedAt: "2026-11-19T16:00:00Z",
  } as unknown as Quote;
}

const render = async (start: string, lang: "en" | "es") =>
  await drawnText(
    await new RenderQuotePdf().run({
      quote: signedQuote(start),
      contractor,
      businessName: "Rosa Fences",
      commsLanguage: lang,
      timezone: "America/Chicago",
    }),
  );

Deno.test("REQ-1104 (LOOP-007 q3-27) signed agreement PDF: 'Next week' (sent 2026-11-19) prints the concrete start day Nov 26, 2026 — EN", async () => {
  const text = await render("Next week", "en");
  assertStringIncludes(
    text,
    formatTermDate("2026-11-26", "en"),
    "the agreement's Start date names the week the contractor meant (sent + 7)",
  );
});

Deno.test("REQ-1104 (LOOP-007 q3-27) signed agreement PDF: 'Next week' prints '26 nov 2026' — ES, not a bare 'La próxima semana'", async () => {
  const text = await render("Next week", "es");
  assertStringIncludes(text, formatTermDate("2026-11-26", "es"));
});

Deno.test("REQ-1104 (LOOP-007 q3-27) signed agreement PDF: 'Right away' anchors to the send day, 'Next month' to a month after", async () => {
  assertStringIncludes(
    await render("Right away", "en"),
    formatTermDate("2026-11-19", "en"),
  );
  assertStringIncludes(
    await render("Next month", "en"),
    formatTermDate("2026-12-19", "en"),
  );
  assertStringIncludes(
    await render("Next month", "es"),
    formatTermDate("2026-12-19", "es"),
  );
});

Deno.test("REQ-1104 (LOOP-007 q3-27) signed agreement PDF: TBD and a picked date stay as they are", async () => {
  const tbd = await render("TBD", "en");
  assertStringIncludes(tbd, "TBD");
  assert(!tbd.includes(formatTermDate("2026-11-26", "en")), tbd);
  assertStringIncludes(
    await render("2026-12-03", "en"),
    formatTermDate("2026-12-03", "en"),
  );
});
