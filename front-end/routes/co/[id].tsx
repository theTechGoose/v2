import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import SiteFooter from "../../components/SiteFooter.tsx";
import BizBrand from "../../components/BizBrand.tsx";
import { publicDocTitle } from "../../../shared/documents/public-brand.ts";
import { ssrBackendGet } from "../../lib/backend-fetch.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import { resolvePublicLang } from "../../../shared/quote-flow/public-lang.ts";
import PublicChangeOrderActions from "../../islands/PublicChangeOrderActions.tsx";
import { docHeadline } from "../../../shared/documents/linked-view.ts";

interface ChangeOrderPublic {
  id: string;
  /** REQ-198/201/205: the order's number, version, and the documents it belongs to. */
  number?: string;
  version?: number;
  invoice?: { id: string; number: string; url: string; status?: string };
  quote?: { id: string; number: string; url: string; accepted?: boolean };
  approvedName?: string;
  description: string;
  deltaAmountCents: number;
  status: "pending" | "approved" | "declined";
  currentAmount?: number;
  newAmount?: number;
  businessName?: string;
  /** REQ-628: the business has a logo on file (served via /api/public-logo/invoice/:invoiceId) */
  hasLogo?: boolean;
  commsLanguage?: "en" | "es";
  decidedAt?: string;
}

const TEAL = "#144852";
const GREEN = "#519843";
const INK = "#1c2c30";
const MUTED = "#6b7a7e";
const LINE = "#e3e8e6";
const CREAM = "#fffdf7";
const BG = "#f7f6f1";
const PINK = "#FF6B6B";
const PINK_DARK = "#d94e4e";

function money(cents: number): string {
  return `$${
    (cents / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

export default define.page(async function PublicChangeOrder(ctx) {
  const id = ctx.params.id;
  const r = await ssrBackendGet<ChangeOrderPublic>(
    `/change-orders/${id}/public`,
  );
  const co = r.ok ? r.data : undefined;
  // Chrome language — the visitor's own saved choice (pm_lang cookie) wins over
  // the document's generation language, exactly like /q and /c (P-12). Falls
  // back to the contractor's outgoing-comms language from the backend payload.
  const lang: Lang = resolvePublicLang({
    cookie: ctx.req.headers.get("cookie"),
    docLang: co?.commsLanguage,
    header: ctx.req.headers.get("accept-language"),
  });

  return (
    <>
      <Head>
        {/* REQ-628: the tab names the business, never DocuMonster */}
        <title>
          {publicDocTitle(
            tFor(lang, "changeOrderPublic.docTitle"),
            co?.businessName,
          )}
        </title>
        <link rel="stylesheet" href={asset("/landing.css")} />
      </Head>
      <div
        style={`min-height:100dvh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};display:flex;flex-direction:column;scroll-padding-bottom:var(--kb-inset, 0px)`}
      >
        <div style="flex:1;width:100%;max-width:592px;margin:0 auto;padding:32px 16px calc(64px + var(--kb-inset, 0px))">
          {!co
            ? (
              <div style="background:#fff;border-radius:18px;padding:32px;box-shadow:0 8px 32px rgba(20,72,82,0.08);text-align:center">
                <div style={`font-weight:800;color:${TEAL};font-size:18px`}>
                  {tFor(lang, "changeOrderPublic.error.title")}
                </div>
                <p style={`margin:8px 0 0;color:${MUTED};font-size:14px`}>
                  {tFor(lang, "changeOrderPublic.error.message")}
                </p>
              </div>
            )
            : (
              <article
                style={`background:${CREAM};border-radius:24px;box-shadow:0 14px 50px rgba(20,72,82,0.10);overflow:hidden;border:1px solid rgba(255,107,107,0.10)`}
              >
                <div
                  style={`height:8px;background:linear-gradient(90deg,${PINK} 0%,${PINK_DARK} 100%)`}
                />
                <div style="padding:32px 32px 36px">
                  {/* REQ-628: their logo, or their name as a wordmark */}
                  <BizBrand
                    logoSrc={co.hasLogo && co.invoice
                      ? `/api/public-logo/invoice/${co.invoice.id}`
                      : undefined}
                    name={co.businessName ??
                      tFor(lang, "changeOrderPublic.contractorFallback")}
                  />
                  <h1
                    style={`margin:12px 0 0;font-weight:900;font-size:28px;letter-spacing:-0.02em;color:${TEAL};line-height:1.1`}
                  >
                    {tFor(lang, "changeOrderPublic.heading")}
                  </h1>
                  {
                    /* REQ-205: "CO-001 · Version 1 · Approved · Nov 6, 2026"
                      and the documents this order belongs to, by number. */
                  }
                  <div
                    data-cy="co-headline"
                    style={`margin-top:8px;font-size:13px;font-weight:800;color:${TEAL}`}
                  >
                    {docHeadline(
                      {
                        number: co.number ??
                          `#${co.id.slice(0, 8).toUpperCase()}`,
                        version: co.version ?? 1,
                        state: co.status,
                        date: co.status === "pending"
                          ? undefined
                          : co.decidedAt,
                      },
                      lang,
                    )}
                  </div>
                  {(co.invoice || co.quote)
                    ? (
                      <div
                        data-cy="co-links"
                        style={`margin-top:6px;display:flex;gap:14px;flex-wrap:wrap;font-size:13px`}
                      >
                        {co.invoice
                          ? (
                            <a
                              data-cy="co-invoice-link"
                              href={co.invoice.url}
                              style={`color:${TEAL};font-weight:700;text-decoration:none`}
                            >
                              {tFor(lang, "public.doc.coInvoice", {
                                number: co.invoice.number,
                              })}
                            </a>
                          )
                          : null}
                        {co.quote
                          ? (
                            <a
                              data-cy="co-quote-link"
                              href={co.quote.url}
                              style={`color:${TEAL};font-weight:700;text-decoration:none`}
                            >
                              {tFor(lang, "public.doc.coQuote", {
                                number: co.quote.number,
                              })}
                            </a>
                          )
                          : null}
                      </div>
                    )
                    : null}
                  <p style={`margin:10px 0 0;color:${MUTED};font-size:14px`}>
                    {tFor(lang, "changeOrderPublic.intro")}
                  </p>

                  <section
                    style={`margin-top:22px;background:#fff;border:1px solid ${LINE};border-radius:14px;padding:18px 20px`}
                  >
                    <div
                      style={`font-size:11px;font-weight:800;letter-spacing:.14em;text-transform:uppercase;color:${MUTED}`}
                    >
                      {tFor(lang, "changeOrderPublic.whatsChanging")}
                    </div>
                    <p
                      style={`margin:8px 0 0;color:${INK};font-size:15px;line-height:1.55`}
                    >
                      {co.description}
                    </p>
                    <div
                      style={`margin-top:16px;padding-top:14px;border-top:1px solid ${LINE};display:flex;flex-direction:column;gap:6px;font-size:14px`}
                    >
                      {co.currentAmount != null
                        ? (
                          <div style="display:flex;justify-content:space-between">
                            <span style={`color:${MUTED}`}>
                              {
                                /* After approval the live invoice already
                                  includes the delta, so the snapshot reads
                                  as the *previous* total. */
                              }
                              {tFor(
                                lang,
                                co.status === "approved"
                                  ? "changeOrderPublic.previousTotal"
                                  : "changeOrderPublic.currentTotal",
                              )}
                            </span>
                            <span>{money(co.currentAmount)}</span>
                          </div>
                        )
                        : null}
                      <div style="display:flex;justify-content:space-between">
                        <span style={`color:${MUTED}`}>
                          {co.deltaAmountCents >= 0
                            ? tFor(lang, "changeOrderPublic.added")
                            : tFor(lang, "changeOrderPublic.credit")}
                        </span>
                        <span
                          style={`color:${
                            co.deltaAmountCents >= 0 ? INK : GREEN
                          }`}
                        >
                          {co.deltaAmountCents >= 0 ? "+" : "−"}
                          {money(Math.abs(co.deltaAmountCents))}
                        </span>
                      </div>
                      {co.newAmount != null
                        ? (
                          <div style="display:flex;justify-content:space-between;font-weight:800;color:#1c2c30;font-size:16px;margin-top:4px">
                            <span>
                              {
                                /* A declined order's "new total" never took
                                  effect — frame it as a proposal. */
                              }
                              {tFor(
                                lang,
                                co.status === "declined"
                                  ? "changeOrderPublic.proposedTotal"
                                  : "changeOrderPublic.newTotal",
                              )}
                            </span>
                            <span
                              style={`color:${
                                co.status === "declined" ? MUTED : GREEN
                              }`}
                            >
                              {money(co.newAmount)}
                            </span>
                          </div>
                        )
                        : null}
                    </div>
                  </section>

                  <PublicChangeOrderActions
                    changeOrderId={co.id}
                    initialStatus={co.status}
                    approvedName={co.approvedName}
                    lang={lang}
                  />
                </div>
              </article>
            )}
        </div>
        <SiteFooter lang={lang} />
      </div>
    </>
  );
});
