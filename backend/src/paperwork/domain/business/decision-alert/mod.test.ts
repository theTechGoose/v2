/**
 * REQ-948 (LOOP-007 q1-21, q1-22) — the words of the decision alerts: the
 * contractor's decline / change-order alerts and the customer's change-order
 * receipt, in English and Spanish, for an added charge and a credit.
 */
import { assert, assertEquals, assertStringIncludes } from "#std/assert";
import {
  buildChangeOrderDecisionAlert,
  buildChangeOrderReceipt,
  buildQuoteDeclinedAlert,
  channelsOnFile,
  declineReasonLabel,
  fmtDeltaUsd,
  fmtUsd,
} from "./mod.ts";

const plain = (html: string) =>
  html.replace(/<[^>]+>/g, " ").replace(/&#39;/g, "'").replace(/\s+/g, " ");

Deno.test("REQ-948: money reads as dollars, the delta signed both ways", () => {
  assertEquals(fmtUsd(1_045_000), "$10,450.00");
  assertEquals(fmtDeltaUsd(85_000), "+$850.00");
  assertEquals(fmtDeltaUsd(-20_000), "−$200.00");
});

Deno.test("REQ-948: the decline chip is worded in the contractor's language", () => {
  assertEquals(declineReasonLabel("price", "en"), "Price");
  assertEquals(declineReasonLabel("price", "es"), "Precio");
  assertEquals(declineReasonLabel("going_elsewhere", "en"), "Going elsewhere");
  assertEquals(declineReasonLabel("some_new_chip", "en"), "some new chip");
  assertEquals(declineReasonLabel(undefined, "en"), undefined);
});

Deno.test("REQ-948 (q1-22): the quote-decline alert names the customer, the quote, the reason and the note — en", () => {
  const c = buildQuoteDeclinedAlert({
    lang: "en",
    customerName: "María Nguyen",
    docLabel: "Q-001",
    jobName: "Backyard junk removal",
    reason: "price",
    note: "Found someone closer to home",
    url: "http://x/quotes?open=q1",
  });
  assertStringIncludes(c.subject, "María Nguyen declined your quote");
  assertStringIncludes(c.subject, "Q-001");
  const body = plain(c.html);
  for (
    const want of [
      "Backyard junk removal",
      "Reason: Price",
      "Found someone closer to home",
    ]
  ) {
    assertStringIncludes(body, want);
    assertStringIncludes(c.sms, want);
  }
  assertStringIncludes(c.sms, "http://x/quotes?open=q1");
});

Deno.test("REQ-948 (q1-22): the quote-decline alert in Spanish, and without a reason or a note", () => {
  const c = buildQuoteDeclinedAlert({
    lang: "es",
    customerName: "María",
    docLabel: "Q-002",
    url: "http://x",
  });
  assertStringIncludes(c.subject, "María rechazó tu cotización");
  assertStringIncludes(c.sms, "No indicó un motivo.");
  assert(!/Su nota/.test(c.sms), c.sms);
});

Deno.test("REQ-948 (q1-21): the contractor's change-order alert — approved (charge, en) and declined (credit, es)", () => {
  const a = buildChangeOrderDecisionAlert({
    lang: "en",
    decision: "approved",
    customerName: "María Nguyen",
    ref: "CO-001 on INV-001",
    description: "Add pantry shelving",
    deltaCents: 85_000,
    invoiceTotalCents: 1_045_000,
    url: "http://x/invoices?open=i1",
  });
  assertStringIncludes(
    a.subject,
    "María Nguyen approved the change order (+$850.00)",
  );
  assertStringIncludes(a.subject, "CO-001 on INV-001");
  assertStringIncludes(a.sms, "Add pantry shelving");
  assertStringIncludes(a.sms, "The invoice total is now $10,450.00.");
  assertStringIncludes(plain(a.html), "Add pantry shelving");

  const d = buildChangeOrderDecisionAlert({
    lang: "es",
    decision: "declined",
    customerName: "María",
    ref: "CO-002 en INV-001",
    description: "Quitar la repisa",
    deltaCents: -20_000,
    invoiceTotalCents: 960_000,
    url: "http://x",
  });
  assertStringIncludes(
    d.subject,
    "María rechazó la orden de cambio (−$200.00)",
  );
  assertStringIncludes(d.sms, "El total de la factura sigue en $9,600.00.");
});

Deno.test("REQ-948 (q1-21): the customer's receipt names the change, who approved it and when, and the new total — en + es", () => {
  const en = buildChangeOrderReceipt({
    lang: "en",
    businessName: "Cambio Builders",
    ref: "CO-001 on INV-001",
    description: "Add pantry shelving",
    deltaCents: 85_000,
    newTotalCents: 1_045_000,
    approvedName: "María Nguyen",
    approvedAt: "2026-11-18T15:00:00Z",
    url: "http://x/i/i1?lang=en",
  });
  const body = plain(en.html);
  assertStringIncludes(en.subject, "Cambio Builders");
  assertStringIncludes(body, "Add pantry shelving");
  assertStringIncludes(body, "+$850.00");
  assertStringIncludes(body, "Approved by María Nguyen on November 18, 2026.");
  assertStringIncludes(body, "Your new invoice total: $10,450.00.");
  assertStringIncludes(en.html, 'href="http://x/i/i1?lang=en"');
  assertStringIncludes(en.sms, "$10,450.00");

  const es = buildChangeOrderReceipt({
    lang: "es",
    businessName: "Cambio Builders",
    ref: "CO-001 en INV-001",
    description: "Crédito por la repisa",
    deltaCents: -20_000,
    newTotalCents: 940_000,
    approvedAt: "2026-11-18T15:00:00Z",
    url: "http://x",
  });
  const esBody = plain(es.html);
  assertStringIncludes(esBody, "Aprobado el 18 de noviembre de 2026.");
  assertStringIncludes(esBody, "El nuevo total de tu factura: $9,400.00.");
  assertStringIncludes(esBody, "−$200.00");
});

Deno.test("REQ-948: only the channels on file go — a missing phone or email is skipped", () => {
  assertEquals(channelsOnFile({ email: " a@b.co ", phoneNumber: "" }), {
    email: "a@b.co",
  });
  assertEquals(channelsOnFile({ email: null, phoneNumber: "+15125550000" }), {
    phone: "+15125550000",
  });
  assertEquals(channelsOnFile(undefined), {});
});

Deno.test("REQ-948: what the customer typed is escaped in the email", () => {
  const c = buildQuoteDeclinedAlert({
    lang: "en",
    customerName: "<b>X</b>",
    docLabel: "Q-1",
    note: "<script>",
    url: "http://x",
  });
  assert(!c.html.includes("<script>"), "note is escaped");
  assert(!c.html.includes("<b>X</b>"), "name is escaped");
});

// REQ-1055 (LOOP-007 cycle 2, q2-39): /co heads the approved order with the
// JOB's new total (REQ-398 m25) while the receipt showed only the invoice's,
// so the customer saw two unlabeled "new totals". The receipt names both:
// the job total and the linked invoice's total, in the email and the text.
const q239 = (lang: "en" | "es") =>
  buildChangeOrderReceipt(
    {
      lang,
      businessName: "Cambio Builders",
      ref: lang === "es" ? "CO-001 en INV-002" : "CO-001 on INV-002",
      description: "Add a second bathroom vanity",
      deltaCents: 280_000,
      jobTotalCents: 1_120_000,
      newTotalCents: 868_000,
      approvedName: "María Nguyen",
      approvedAt: "2026-11-18T15:00:00Z",
      url: "http://x/i/i2",
    } as Parameters<typeof buildChangeOrderReceipt>[0],
  );

Deno.test("REQ-1055 (q2-39): the receipt names the job total AND the invoice total, each labeled — en", () => {
  const r = q239("en");
  const body = plain(r.html);
  assert(
    /job total[^$]*\$11,200\.00/i.test(body),
    `the email has a labeled job total of $11,200.00: ${body}`,
  );
  assert(
    /INV-002[^$]*total[^$]*\$8,680\.00|invoice total[^$]*\$8,680\.00/i.test(
      body,
    ),
    `the email has a labeled invoice total of $8,680.00: ${body}`,
  );
  assert(
    /job total[^$]*\$11,200\.00/i.test(r.sms),
    `the text has the labeled job total: ${r.sms}`,
  );
  assertStringIncludes(r.sms, "$8,680.00");
});

Deno.test("REQ-1055 (q2-39): the receipt names the job total AND the invoice total, each labeled — es", () => {
  const r = q239("es");
  const body = plain(r.html);
  assert(
    /total del trabajo[^$]*\$11,200\.00/i.test(body),
    `el correo tiene el total del trabajo $11,200.00: ${body}`,
  );
  assert(
    /INV-002[^$]*\$8,680\.00|factura[^$]*\$8,680\.00/i.test(body),
    `el correo tiene el total de la factura $8,680.00: ${body}`,
  );
  assert(
    /total del trabajo[^$]*\$11,200\.00/i.test(r.sms),
    `el texto tiene el total del trabajo: ${r.sms}`,
  );
  assertStringIncludes(r.sms, "$8,680.00");
});
