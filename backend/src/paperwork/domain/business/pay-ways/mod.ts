/**
 * REQ-630 — the invoice email and text name every online way the business gets paid, the same
 * ways the invoice page offers (shared/payments/pay-links.ts): card first when the business's
 * Stripe is connected, then Venmo / Cash App / PayPal (amount prefilled), Zelle (to copy) and the
 * business's own payment links. Pure: the coordinators pass the identity's methods and whether
 * Stripe is on.
 */
import { type Lang, t } from "@core/i18n/mod.ts";
import {
  hasCardPayLink,
  payButtons,
  payWayNames,
  projectPayMethods,
} from "#payments/pay-links.ts";

const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";
const TEAL = "#144852";
const GREEN = "#519843";

function joinOr(names: string[], lang: Lang): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} ${t(lang, "payLinks.sms.or")} ${
    names[names.length - 1]
  }`;
}

/** One line for the invoice text — "Pay online by card, Venmo or Extra Pay — all at the link." —
 *  or null when the business takes nothing online. */
export function payWaysSmsLine(
  apm: unknown,
  opts: { card: boolean; lang: Lang },
): string | null {
  const names = payWayNames(projectPayMethods(apm), { card: opts.card })
    .map((n) => (n === "card" ? t(opts.lang, "payLinks.card") : n));
  if (!names.length) return null;
  return t(opts.lang, "payLinks.sms.line", { ways: joinOr(names, opts.lang) });
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function money(cents: number | undefined): string | undefined {
  if (typeof cents !== "number" || !Number.isFinite(cents) || cents <= 0) {
    return undefined;
  }
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** The "Ways to pay" block for the invoice email — one tappable row per way; "" when none. */
export function payWaysEmailHtml(
  apm: unknown,
  opts: {
    card: boolean;
    lang: Lang;
    payUrl: string;
    amountCents?: number;
    note?: string;
  },
): string {
  const { lang } = opts;
  const amount = money(opts.amountCents);
  const methods = projectPayMethods(apm);
  const buttons = payButtons(methods, {
    amountCents: opts.amountCents,
    note: opts.note,
  });
  const rows: string[] = [];
  const btn = (way: string, href: string, label: string, primary = false) =>
    `<a data-pay-way="${way}" href="${
      esc(href)
    }" style="display:block;margin-top:8px;padding:12px 16px;border-radius:10px;text-decoration:none;font-weight:800;font-size:14px;text-align:center;${
      primary
        ? `background:${GREEN};color:#ffffff;border:1px solid ${GREEN}`
        : `background:#ffffff;color:${TEAL};border:1px solid ${LINE}`
    }">${esc(label)}</a>`;
  // REQ-782: a card pay link is a card way too — the row goes to the invoice page's Pay by card
  if (opts.card || hasCardPayLink(methods)) {
    rows.push(btn("card", opts.payUrl, t(lang, "payLinks.email.card"), true));
  }
  for (const b of buttons) {
    if (b.kind === "link") {
      const label = b.method === "link"
        ? b.label
        : amount
        ? t(lang, "payLinks.email.payWith", { amount, brand: b.label })
        : t(lang, "payLinks.email.payWithNoAmount", { brand: b.label });
      rows.push(btn(b.method, b.href, label));
    } else {
      rows.push(
        `<div data-pay-way="${
          esc(b.method)
        }" style="margin-top:8px;padding:12px 16px;border-radius:10px;border:1px dashed ${LINE};color:${INK};font-size:14px;font-weight:700;text-align:center">${
          esc(
            t(lang, "payLinks.email.copyTo", {
              brand: b.label,
              handle: b.value,
            }),
          )
        }</div>`,
      );
    }
  }
  if (!rows.length) return "";
  return `<div data-pay-ways style="margin-top:20px"><div style="font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}">${
    esc(t(lang, "payLinks.email.heading"))
  }</div>${rows.join("")}</div>`;
}
