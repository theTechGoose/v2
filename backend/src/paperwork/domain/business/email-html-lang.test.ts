/**
 * REQ-1033 (LOOP-007 cycle 2, q2-16): "Non-shell emails (owner approval, CO
 * receipt, payment receipt) still have bare <html> with no lang". REQ-1016
 * promised every email's `<html lang>` is the language it is written in, but
 * fixed only send-paperwork-email's `shell()`. The payment receipt, the
 * decision alerts' own `shell()` (quote declined, CO approved/declined, the
 * customer's CO receipt), the payment reminder and the coordinators' inline
 * templates (accepted alert, CO request/heads-up, inquiry alert/reply) still
 * open with a bare `<!doctype html>\n<html><body`.
 *
 * Unit: every pure email builder, in "en" and "es", opens with
 * `<!doctype html>\n<html lang="<that lang>">`. Guard: no template under
 * backend/src writes an `<html` root without a `lang=` attribute, so a new
 * template cannot copy the bare boilerplate again.
 */
import { assertEquals } from "#std/assert";
import type { Lang } from "@core/i18n/mod.ts";
import type { Invoice } from "@paperwork/dto/invoice.ts";
import { renderReceiptHtml } from "@paperwork/domain/business/payment-receipt/mod.ts";
import {
  buildChangeOrderDecisionAlert,
  buildChangeOrderReceipt,
  buildQuoteDeclinedAlert,
} from "@paperwork/domain/business/decision-alert/mod.ts";
import { composeReminderCopy } from "@paperwork/domain/coordinators/send-payment-reminder/mod.ts";
import { renderHrEmail } from "@hr/domain/business/hr-email/mod.ts"; // REQ-1169
import { welcomeCopy } from "@hr/domain/coordinators/provisioner/mod.ts"; // REQ-1169

/** The root element's lang, read off the document's first two lines. */
const rootLang = (html: string) =>
  html.match(/^<!doctype html>\s*<html lang="([^"]*)"[\s>]/i)?.[1] ??
    `(no <html lang>: ${JSON.stringify(html.slice(0, 40))})`;

const invoice = {
  id: "i-1",
  userId: "u-1",
  number: "INV-001",
  status: "sent",
  amount: 45_000,
  billTo: { name: "María López", email: "maria@example.com" },
  jobName: "Reparación de cerca",
  dueDate: "2026-12-30",
  createdAt: "2026-11-12T12:00:00Z",
  updatedAt: "2026-11-12T12:00:00Z",
} as unknown as Invoice;

const builders: Record<string, (lang: Lang) => string> = {
  "payment receipt (renderReceiptHtml)": (lang) =>
    renderReceiptHtml({
      invoice,
      businessName: "Ortega Handyman Services",
      intent: { method: "zelle" },
      amount: 20_000,
      lang,
    }),
  "quote declined alert (buildQuoteDeclinedAlert)": (lang) =>
    buildQuoteDeclinedAlert({
      lang,
      customerName: "María López",
      docLabel: "Q-001",
      url: "http://x/quotes?open=q1",
    }).html,
  "owner's change-order approved alert (buildChangeOrderDecisionAlert)": (
    lang,
  ) =>
    buildChangeOrderDecisionAlert({
      lang,
      decision: "approved",
      customerName: "María López",
      ref: "CO-001 on INV-001",
      description: "Add pantry shelving",
      deltaCents: 85_000,
      invoiceTotalCents: 130_000,
      url: "http://x/co",
    }).html,
  "customer's change-order receipt (buildChangeOrderReceipt)": (lang) =>
    buildChangeOrderReceipt({
      lang,
      businessName: "Ortega Handyman Services",
      ref: "CO-001 on INV-001",
      description: "Add pantry shelving",
      deltaCents: 85_000,
      newTotalCents: 130_000,
      approvedName: "María López",
      approvedAt: "2026-11-18T15:00:00Z",
      url: "http://x/co",
    }).html,
  "payment reminder (composeReminderCopy)": (lang) =>
    composeReminderCopy({
      day: 3,
      customerFirst: "María",
      senderFirst: "Luis",
      businessName: "Ortega Handyman Services",
      invoice,
      lang: lang === "es" ? "es" : "en",
    }).emailHtml("http://x/i/1"),
  // REQ-1169 (LOOP-007 q3, q3-103): the HR emails had no <html> root at all, which the
  // guard below cannot see — so their builders are swept here too
  "HR invite / reminder / packet-complete (renderHrEmail)": (lang) =>
    renderHrEmail({
      lang,
      company: "Reyes Lawn & Landscape",
      headline: "Welcome",
      paragraphs: ["Sign your paperwork."],
      cta: { label: "Open", url: "http://x/sign/tok" },
    }),
  "HR dm-email welcome note (welcomeCopy)": (lang) =>
    welcomeCopy(lang === "es" ? "es" : "en", {
      first: "Jose",
      company: "Reyes Lawn & Landscape",
      portalUrl: "http://x",
      username: "",
      password: "",
      startDate: "",
    }).html,
};

for (const [name, build] of Object.entries(builders)) {
  for (const lang of ["es", "en"] as Lang[]) {
    Deno.test(`REQ-1033 (LOOP-007 q2, q2-16): the ${name} in "${lang}" opens <html lang="${lang}">`, () => {
      assertEquals(rootLang(build(lang)), lang);
    });
  }
}

Deno.test("REQ-1033 (LOOP-007 q2, q2-16): guard — no email template under backend/src writes an <html> root without lang=", async () => {
  const src = new URL("../../../", import.meta.url); // backend/src/
  const hits: string[] = [];
  async function walk(dir: URL) {
    for await (const e of Deno.readDir(dir)) {
      const u = new URL(e.name + (e.isDirectory ? "/" : ""), dir);
      if (e.isDirectory) {
        if (e.name === "node_modules" || e.name.startsWith(".")) continue;
        await walk(u);
      } else if (
        e.name.endsWith(".ts") && !e.name.endsWith("test.ts")
      ) {
        const lines = (await Deno.readTextFile(u)).split("\n");
        lines.forEach((l, i) => {
          // an <html> root (not <html-…>), with no lang attribute on it
          for (const m of l.matchAll(/<html(?=[\s>])[^>]*>/gi)) {
            if (!/\slang=/.test(m[0])) {
              hits.push(
                `${u.pathname.slice(src.pathname.length)}:${i + 1}: ${
                  l.trim().slice(0, 40)
                }`,
              );
            }
          }
        });
      }
    }
  }
  await walk(src);
  assertEquals(hits, [], "every <html> root declares its language");
});
