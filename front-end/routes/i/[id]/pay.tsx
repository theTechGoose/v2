/**
 * REQ-782 (demo-loop dv1, d10) — Raphael: "Card payments should be a link to a separate portal."
 *
 * /i/:id/pay — the card payment portal for a business that connected its own Stripe (REQ-212):
 * the business's name, the invoice and the amount due, then the pay card (REQ-213/216's
 * `PublicCardPay`, charged on the business's key). "Pay by card" on /i/:id opens it in a new
 * tab. Nothing to pay here (paid, void, no Stripe) → a short note and the way back.
 */
import { asset, Head } from "fresh/runtime";
import { define } from "../../../utils.ts";
import DocTitle from "../../../components/DocTitle.tsx";
import SiteFooter from "../../../components/SiteFooter.tsx";
import { ssrBackendGet } from "../../../lib/backend-fetch.ts";
import { fmtMoneyExact } from "../../../lib/format.ts";
import { type Lang, tFor } from "../../../lib/i18n.ts";
import { resolvePublicLang } from "../../../../shared/quote-flow/public-lang.ts";
import {
  publicBusinessLabel,
  publicDocTitle,
} from "../../../../shared/documents/public-brand.ts";
import PublicCardPay, {
  type CardConfig,
} from "../../../islands/PublicCardPay.tsx";
import { BG, INK, MUTED, TEAL } from "../../../components/doc-parts.tsx";
import SquareCheckout from "../../../islands/SquareCheckout.tsx"; // REQ-803
import type { SquareConfig } from "../../../../shared/payments/square.ts"; // REQ-803

interface InvoiceHead {
  id: string;
  number?: string;
  docLang?: string;
  contractor?: {
    name?: string;
    businessName?: string;
    commsLanguage?: string;
  };
}

export default define.page(async function CardPortal(ctx) {
  const id = ctx.params.id;
  const [inv, cardRes, squareRes] = await Promise.all([
    ssrBackendGet<InvoiceHead>(`/invoices/${id}/public`),
    ssrBackendGet<CardConfig>(`/invoices/${id}/card`),
    ssrBackendGet<SquareConfig>(`/invoices/${id}/square`), // REQ-803
  ]);
  const invoice = inv.ok ? inv.data : undefined;
  const card = cardRes.ok && cardRes.data?.available ? cardRes.data : undefined;
  // REQ-803 — the business's own Square: this page offers its checkout (the no-script way)
  const square = !card && squareRes.ok && squareRes.data?.available
    ? squareRes.data
    : undefined;
  const url = new URL(ctx.req.url);
  const lang: Lang = resolvePublicLang({
    query: url.searchParams.get("lang"),
    cookie: ctx.req.headers.get("cookie"),
    docLang: invoice?.docLang ?? invoice?.contractor?.commsLanguage,
    header: ctx.req.headers.get("accept-language"),
  });
  ctx.state.lang = lang;
  const business = card?.merchantName?.trim() ||
    square?.merchantName?.trim() ||
    publicBusinessLabel(invoice?.contractor) ||
    tFor(lang, "publicInvoice.contractorFallback.capital");
  const back = `/i/${encodeURIComponent(id)}${lang === "es" ? "?lang=es" : ""}`;

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) =>
            publicDocTitle(tFor(l, "payByCard.portal.heading"), business)}
        />
        <link key="css-landing" rel="stylesheet" href={asset("/landing.css")} />
        <link
          key="css-paycard"
          rel="stylesheet"
          href={asset("/paycard.css")}
        />
      </Head>
      <div
        style={`min-height:100dvh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};display:flex;flex-direction:column`}
      >
        <main
          data-cy="card-portal"
          style="flex:1;width:100%;max-width:560px;margin:0 auto;padding:32px 16px 64px;box-sizing:border-box"
        >
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <h1
              style={`margin:0;font-size:22px;font-weight:800;color:${TEAL}`}
            >
              {tFor(lang, "payByCard.portal.heading")}
            </h1>
            {card || square
              ? (
                <span
                  data-status-pill
                  style="background:rgba(20,72,82,0.08);color:#144852;font-weight:800;font-size:11px;letter-spacing:.12em;text-transform:uppercase;padding:7px 14px;border-radius:999px"
                >
                  {tFor(lang, "publicInvoice.status.due")}
                </span>
              )
              : null}
          </div>
          <p
            data-cy="card-portal-invoice"
            style={`margin:6px 0 0;color:${MUTED};font-size:14px`}
          >
            {invoice?.number
              ? tFor(lang, "payByCard.portal.invoice", {
                number: invoice.number,
                business,
              })
              : tFor(lang, "payByCard.portal.invoiceNoNumber", { business })}
          </p>
          {card
            ? (
              <>
                <div
                  data-cy="card-portal-amount"
                  style={`margin-top:14px;font-size:13px;color:${MUTED}`}
                >
                  {tFor(lang, "payByCard.portal.amount")}{" "}
                  <strong style={`color:${INK};font-size:20px`}>
                    {fmtMoneyExact(card.amountCents ?? 0)}
                  </strong>
                </div>
                <PublicCardPay invoiceId={id} config={card} lang={lang} />
              </>
            )
            : square
            ? (
              <>
                <div
                  data-cy="card-portal-amount"
                  style={`margin-top:14px;font-size:13px;color:${MUTED}`}
                >
                  {tFor(lang, "payByCard.portal.amount")}{" "}
                  <strong style={`color:${INK};font-size:20px`}>
                    {fmtMoneyExact(square.amountCents ?? 0)}
                  </strong>
                </div>
                <div style="margin-top:18px">
                  <SquareCheckout
                    invoiceId={id}
                    lang={lang}
                    amountCents={square.amountCents}
                    version={square.version}
                    business={business}
                  />
                </div>
              </>
            )
            : (
              <p
                data-cy="card-portal-unavailable"
                style={`margin:20px 0 0;background:#fff;border-radius:14px;padding:18px 20px;font-size:14px;color:${INK}`}
              >
                {tFor(lang, "payByCard.portal.unavailable")}
              </p>
            )}
          <p style="margin:22px 0 0;text-align:center">
            <a
              href={back}
              data-cy="card-portal-back"
              style={`color:${TEAL};font-weight:700;font-size:14px`}
            >
              {tFor(lang, "payByCard.portal.back")}
            </a>
          </p>
        </main>
        <SiteFooter lang={lang} document credited />
      </div>
    </>
  );
});
