/**
 * REQ-948 (LOOP-007 q1-21, q1-22) — the words of the messages that tell
 * people about a customer's decision:
 *
 *   • the contractor, when the customer declines a quote (reason + note);
 *   • the contractor, when the customer approves or declines a change order
 *     (what changed, the delta, the invoice total after the decision);
 *   • the customer, a receipt of the change order she approved (what
 *     changed, who approved it and when, her new total).
 *
 * Pure: every builder takes plain facts and returns `{ subject, html, sms }`
 * so the copy is unit-testable without the stores or the transports. The
 * coordinator SendDecisionAlert picks the recipients and sends.
 */
import { type Lang, t } from "@core/i18n/mod.ts";

export interface AlertCopy {
  subject: string;
  html: string;
  sms: string;
}

/** "$10,450.00" */
export function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "−" : "";
  return `${sign}$${
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** "+$850.00" / "−$200.00" — a change order's signed delta. */
export function fmtDeltaUsd(cents: number): string {
  return `${cents < 0 ? "−" : "+"}${fmtUsd(Math.abs(cents))}`;
}

/** "November 18, 2026" / "18 de noviembre de 2026" (UTC, like the PDFs). */
export function fmtDecisionDate(iso: string | undefined, lang: Lang): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(+d)) return iso ?? "";
  return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

const REASON_KEYS: Record<string, string> = {
  price: "publicQuoteActions.reason.price",
  timing: "publicQuoteActions.reason.timing",
  going_elsewhere: "publicQuoteActions.reason.goingElsewhere",
  goingElsewhere: "publicQuoteActions.reason.goingElsewhere",
  other: "publicQuoteActions.reason.other",
};

/** The decline chip in words, as the customer saw it ("Price" / "Precio"). */
export function declineReasonLabel(
  reason: string | undefined,
  lang: Lang,
): string | undefined {
  const r = reason?.trim();
  if (!r) return undefined;
  const key = REASON_KEYS[r];
  return key ? t(lang, key) : r.replace(/_/g, " ");
}

/** Which channels a message can go out on, from what is on file. */
export function channelsOnFile(
  who: { email?: string | null; phoneNumber?: string | null } | undefined,
): { email?: string; phone?: string } {
  const email = who?.email?.trim() || undefined;
  const phone = who?.phoneNumber?.trim() || undefined;
  return { ...(email ? { email } : {}), ...(phone ? { phone } : {}) };
}

// ── quote declined → contractor ──────────────────────────────────────────

export function buildQuoteDeclinedAlert(o: {
  lang: Lang;
  customerName: string;
  /** "Q-001 · Version 2" */
  docLabel: string;
  jobName?: string;
  reason?: string;
  note?: string;
  url: string;
}): AlertCopy {
  const { lang } = o;
  const job = o.jobName?.trim();
  const head = job
    ? t(lang, "decisionAlert.quoteDeclined.headlineJob", {
      name: o.customerName,
      job,
    })
    : t(lang, "decisionAlert.quoteDeclined.headline", {
      name: o.customerName,
    });
  const reason = declineReasonLabel(o.reason, lang);
  const note = o.note?.trim();
  const reasonLine = reason
    ? t(lang, "decisionAlert.quoteDeclined.reason", { reason })
    : t(lang, "decisionAlert.quoteDeclined.noReason");
  const noteLine = note
    ? t(lang, "decisionAlert.quoteDeclined.note", { note })
    : undefined;
  const subject = `${head} · ${o.docLabel}`;
  const sms = [
    `${o.docLabel}: ${head}.`,
    reasonLine,
    noteLine,
    `→ ${o.url}`,
  ].filter(Boolean).join(" ");
  const html = shell({
    lang,
    ref: o.docLabel,
    headline: head,
    paragraphs: [reasonLine, ...(noteLine ? [noteLine] : [])],
    body: t(lang, "decisionAlert.quoteDeclined.body"),
    cta: t(lang, "decisionAlert.quoteDeclined.cta"),
    url: o.url,
  });
  return { subject, html, sms };
}

// ── change order decided → contractor ────────────────────────────────────

export function buildChangeOrderDecisionAlert(o: {
  lang: Lang;
  decision: "approved" | "declined";
  customerName: string;
  /** "CO-001 on INV-5000" */
  ref: string;
  description: string;
  deltaCents: number;
  /** the invoice total after the decision (approve: moved; decline: unchanged) */
  invoiceTotalCents?: number;
  url: string;
}): AlertCopy {
  const { lang } = o;
  const k = o.decision === "approved" ? "coApproved" : "coDeclined";
  const delta = fmtDeltaUsd(o.deltaCents);
  const headline = t(lang, `decisionAlert.${k}.headline`, {
    name: o.customerName,
    delta,
  });
  const totalLine = typeof o.invoiceTotalCents === "number"
    ? t(lang, `decisionAlert.${k}.total`, {
      total: fmtUsd(o.invoiceTotalCents),
    })
    : undefined;
  const subject = `${headline} — ${o.ref}`;
  const sms = [
    `${o.ref}: ${headline}: ${o.description.trim()}.`,
    totalLine,
    `→ ${o.url}`,
  ].filter(Boolean).join(" ");
  const html = shell({
    lang,
    ref: o.ref,
    headline,
    paragraphs: [o.description, delta, ...(totalLine ? [totalLine] : [])],
    body: t(lang, `decisionAlert.${k}.body`, { name: o.customerName }),
    cta: t(lang, "decisionAlert.co.cta"),
    url: o.url,
  });
  return { subject, html, sms };
}

// ── change order approved → customer receipt ─────────────────────────────

export function buildChangeOrderReceipt(o: {
  lang: Lang;
  businessName: string;
  /** "CO-001 on INV-5000" */
  ref: string;
  description: string;
  deltaCents: number;
  /** the linked invoice's total after the order */
  newTotalCents: number;
  /** REQ-1055: the JOB's agreed total after the order (quote total +
   *  approved change orders) — the figure /co heads with. When present the
   *  receipt names both totals, each labeled; absent (no linked quote) it
   *  keeps the single invoice-total line. */
  jobTotalCents?: number;
  /** REQ-1055: the invoice's number as the customer knows it ("INV-002"),
   *  only for an issued invoice */
  invoiceLabel?: string;
  approvedName?: string;
  approvedAt?: string;
  url: string;
  /** REQ-628: the business's logo, or its name as a wordmark */
  logoHtml?: string;
}): AlertCopy {
  const { lang } = o;
  const delta = fmtDeltaUsd(o.deltaCents);
  const total = fmtUsd(o.newTotalCents);
  const date = fmtDecisionDate(o.approvedAt, lang);
  const who = o.approvedName?.trim();
  const approvedLine = who
    ? t(lang, "decisionAlert.coReceipt.approvedBy", { name: who, date })
    : t(lang, "decisionAlert.coReceipt.approvedOn", { date });
  // REQ-1055 (LOOP-007 q2-39): with the job total known, name both totals —
  // "Job total: $11,200.00." then "Invoice INV-002 total: $8,680.00." — so
  // the receipt and /co (which heads with the job total) agree on words.
  const jobTotal = typeof o.jobTotalCents === "number"
    ? fmtUsd(o.jobTotalCents)
    : undefined;
  const invoice = [
    t(lang, "decisionAlert.coReceipt.invoiceNoun"),
    o.invoiceLabel?.trim(),
  ].filter(Boolean).join(" ");
  const totalLines = jobTotal
    ? [
      t(lang, "decisionAlert.coReceipt.jobTotal", { total: jobTotal }),
      t(lang, "decisionAlert.coReceipt.invoiceTotal", { invoice, total }),
    ]
    : [t(lang, "decisionAlert.coReceipt.newTotal", { total })];
  const subject = `${
    t(lang, "decisionAlert.coReceipt.subject", { business: o.businessName })
  } — ${o.ref}`;
  const sms = `${o.ref}: ${
    jobTotal
      ? t(lang, "decisionAlert.coReceipt.smsJob", {
        business: o.businessName,
        what: o.description.trim(),
        delta,
        jobTotal,
        invoice,
        total,
        url: o.url,
      })
      : t(lang, "decisionAlert.coReceipt.sms", {
        business: o.businessName,
        what: o.description.trim(),
        delta,
        total,
        url: o.url,
      })
  }`;
  const html = shell({
    lang,
    ref: o.ref,
    headline: t(lang, "decisionAlert.coReceipt.headline"),
    paragraphs: [o.description, delta, approvedLine, ...totalLines],
    body: t(lang, "decisionAlert.coReceipt.body", {
      business: o.businessName,
    }),
    cta: t(lang, "decisionAlert.coReceipt.cta"),
    url: o.url,
    ...(o.logoHtml ? { logoHtml: o.logoHtml } : {}),
  });
  return { subject, html, sms };
}

// ── shared email shell ───────────────────────────────────────────────────

function shell(o: {
  lang: Lang;
  ref: string;
  headline: string;
  paragraphs: string[];
  body: string;
  cta: string;
  url: string;
  logoHtml?: string;
}): string {
  const top = o.logoHtml ??
    `<div style="font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:#d94e4e">${
      escapeHtml(t(o.lang, "brand.name"))
    }</div>`;
  const paras = o.paragraphs.map((p) =>
    `<p style="margin:10px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">${
      escapeHtml(p)
    }</p>`
  ).join("\n    ");
  return `<!doctype html>
<html><body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    ${top}
    <div data-doc-ref style="margin-top:10px;font-size:12px;font-weight:800;color:#6b7a7e">${
    escapeHtml(o.ref)
  }</div>
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${
    escapeHtml(o.headline)
  }</div>
    ${paras}
    <p style="margin:14px 0 0;color:#6b7a7e;font-size:14px;line-height:1.55">${
    escapeHtml(o.body)
  }</p>
    <a href="${
    escapeHtml(o.url)
  }" style="display:inline-block;margin-top:20px;background:#519843;color:#fff;font-weight:800;font-size:14px;padding:12px 22px;border-radius:12px;text-decoration:none">${
    escapeHtml(o.cta)
  }</a>
  </div>
</body></html>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });
}
