/**
 * REQ-1169 (LOOP-007 q3, q3-103) — amends REQ-884b / REQ-1003 / REQ-1036, citing REQ-1033 and
 * REQ-628: every email the HR module writes (the new hire's invite and 24-hour reminder, the
 * packet-complete note to HR, the dm-email welcome note) is drawn in the house email layout the
 * paperwork emails share (payment-receipt, decision-alert, send-paperwork-email): it opens with
 * emailRoot(lang) (the doctype, then a root element carrying the lang), a cream #f7f6f1 body, the white 560px card,
 * the business's name as a wordmark at the top (emailLogoHtml), a #144852 Helvetica 900
 * headline and a #144852 CTA. Pure: text in, HTML out; every string is escaped here.
 */
import type { Lang } from "@core/i18n/mod.ts";
import { emailRoot } from "@paperwork/domain/business/email-root/mod.ts";
import { emailLogoHtml } from "@paperwork/domain/business/email-logo/mod.ts";

export type HrEmail = {
  lang: Lang;
  /** who the wordmark names — the hiring business; empty → no wordmark */
  company: string;
  headline: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  /** the small grey lines under the CTA (the raw link, the HR contact) */
  notes?: string[];
};

function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
}

export function renderHrEmail(m: HrEmail): string {
  const logo = emailLogoHtml({ kind: "wordmark", text: m.company.trim() }, {
    align: "left",
  });
  const paragraphs = m.paragraphs
    .filter((p) => p.trim())
    .map((p) => `
    <p style="margin:14px 0 0;color:#1c2c30;font-size:15px;line-height:1.55">${
      escapeHtml(p)
    }</p>`)
    .join("");
  const cta = m.cta
    ? `
    <div style="margin-top:22px">
      <a data-hr-cta href="${
      escapeHtml(m.cta.url)
    }" style="display:inline-block;background:#144852;color:#fff;text-decoration:none;font-weight:800;font-size:15px;padding:12px 22px;border-radius:12px">${
      escapeHtml(m.cta.label)
    }</a>
    </div>`
    : "";
  const notes = (m.notes ?? [])
    .filter((n) => n.trim())
    .map((n) => `
    <p style="margin:12px 0 0;color:#6b7a7e;font-size:12px;line-height:1.5;word-break:break-all">${
      escapeHtml(n)
    }</p>`)
    .join("");
  return `${
    emailRoot(m.lang)
  }<body style="margin:0;padding:32px 16px;background:#f7f6f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1c2c30">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:18px;padding:28px 32px;box-shadow:0 8px 32px rgba(20,72,82,0.08)">
    ${logo}
    <div style="margin-top:18px;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;font-weight:900;font-size:24px;letter-spacing:-0.02em;color:#144852">${
    escapeHtml(m.headline)
  }</div>${paragraphs}${cta}${notes}
  </div>
</body></html>`;
}
