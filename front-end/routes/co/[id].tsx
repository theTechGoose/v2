import { asset, Head } from "fresh/runtime";
import { define } from "../../utils.ts";
import DocTitle from "../../components/DocTitle.tsx";
import SiteFooter from "../../components/SiteFooter.tsx";
import { ssrBackendGetAuthed } from "../../lib/backend-fetch.ts";
import { getSessionId } from "../../lib/auth.ts";
import { type Lang, tFor } from "../../lib/i18n.ts";
import {
  langToggleHref,
  resolvePublicLang,
} from "../../../shared/quote-flow/public-lang.ts";
import PublicChangeOrderActions from "../../islands/PublicChangeOrderActions.tsx";
import PublicLangToggle from "../../islands/PublicLangToggle.tsx";
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
  /** this INVOICE's total before / after the order */
  currentAmount?: number;
  newAmount?: number;
  /** REQ-398 (demo m25): the JOB's agreed total before / after the order */
  jobCurrentAmount?: number;
  jobNewAmount?: number;
  /** REQ-398 (demo M15): the viewer is the business itself — a preview */
  internal?: boolean;
  businessName?: string;
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
  // REQ-398 (demo M15): the read carries the viewer's session, so the
  // backend can tell the business's own preview from the customer.
  const r = await ssrBackendGetAuthed<ChangeOrderPublic>(
    `/change-orders/${id}/public`,
    getSessionId(ctx.req),
  );
  const co = r.ok ? r.data : undefined;
  // Chrome language — REQ-398 (demo p13-j): the link's ?lang= (the EN | ES
  // toggle below, and the language the order was sent in) first, then the
  // visitor's own saved choice (pm_lang cookie), over the document's
  // generation language (P-12) — exactly like /i (REQ-272).
  const url = new URL(ctx.req.url);
  const lang: Lang = resolvePublicLang({
    query: url.searchParams.get("lang"),
    cookie: ctx.req.headers.get("cookie"),
    docLang: co?.commsLanguage,
    header: ctx.req.headers.get("accept-language"),
  });
  // <html lang> says what this page actually paints (REQ-122 contract).
  ctx.state.lang = lang;
  const hasJob = co?.jobCurrentAmount != null && co?.jobNewAmount != null;

  return (
    <>
      <Head>
        <DocTitle
          lang={lang}
          title={(l) => tFor(l, "changeOrderPublic.docTitle")}
        />
        <link key="css-landing" rel="stylesheet" href={asset("/landing.css")} />
        <link
          key="css-public-lang"
          rel="stylesheet"
          href={asset("/public-lang.css")}
        />
      </Head>
      <div
        style={`min-height:100dvh;background:${BG};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${INK};display:flex;flex-direction:column;scroll-padding-bottom:var(--kb-inset, 0px)`}
      >
        <div style="flex:1;width:100%;max-width:592px;margin:0 auto;padding:32px 16px calc(64px + var(--kb-inset, 0px))">
          {/* REQ-398 (demo p13-j): the same EN | ES switch as /i and /q */}
          <PublicLangToggle
            lang={lang}
            hrefs={{
              en: langToggleHref(url.href, "en"),
              es: langToggleHref(url.href, "es"),
            }}
          />
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
                  <div
                    style={`font-size:11px;font-weight:800;letter-spacing:.18em;text-transform:uppercase;color:${PINK_DARK}`}
                  >
                    {co.businessName ??
                      tFor(lang, "changeOrderPublic.contractorFallback")}
                  </div>
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
                    {
                      /* REQ-398 (demo m25): the JOB total is the headline —
                        a change order adjusts one invoice, but the customer
                        reads the big number as the job's. */
                    }
                    {hasJob
                      ? (
                        <div
                          data-cy="co-job-total"
                          style={`margin-top:16px;padding-top:14px;border-top:1px solid ${LINE}`}
                        >
                          <div style="display:flex;justify-content:space-between;align-items:baseline;gap:12px;font-weight:800;font-size:16px;color:#1c2c30">
                            <span>
                              {tFor(lang, "changeOrderPublic.jobTotal")}
                            </span>
                            <span>
                              <span style={`color:${MUTED};font-weight:700`}>
                                {money(co.jobCurrentAmount!)}
                              </span>
                              {" → "}
                              <span
                                style={`color:${
                                  co.status === "declined" ? MUTED : GREEN
                                }`}
                              >
                                {money(co.jobNewAmount!)}
                              </span>
                            </span>
                          </div>
                          {co.invoice && co.currentAmount != null &&
                              co.newAmount != null
                            ? (
                              <div
                                data-cy="co-invoice-delta"
                                style={`margin-top:4px;color:${MUTED};font-size:13px`}
                              >
                                {tFor(
                                  lang,
                                  co.deltaAmountCents >= 0
                                    ? "changeOrderPublic.addedToInvoice"
                                    : "changeOrderPublic.creditedOnInvoice",
                                  {
                                    number: co.invoice.number,
                                    from: money(co.currentAmount),
                                    to: money(co.newAmount),
                                  },
                                )}
                              </div>
                            )
                            : null}
                        </div>
                      )
                      : null}
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
                              {
                                /* REQ-398: with the job headline above, the
                                  invoice rows say "This invoice". */
                              }
                              {tFor(
                                lang,
                                hasJob
                                  ? (co.status === "approved"
                                    ? "changeOrderPublic.thisInvoiceBefore"
                                    : "changeOrderPublic.thisInvoiceNow")
                                  : co.status === "approved"
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
                          <div
                            style={hasJob
                              ? `display:flex;justify-content:space-between;font-weight:700;color:${INK}`
                              : "display:flex;justify-content:space-between;font-weight:800;color:#1c2c30;font-size:16px;margin-top:4px"}
                          >
                            <span>
                              {
                                /* A declined order's "new total" never took
                                  effect — frame it as a proposal. */
                              }
                              {tFor(
                                lang,
                                hasJob
                                  ? (co.status === "declined"
                                    ? "changeOrderPublic.thisInvoiceProposed"
                                    : "changeOrderPublic.thisInvoiceAfter")
                                  : co.status === "declined"
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
                    internal={co.internal === true}
                    search={url.search}
                    version={co.version}
                  />
                </div>
              </article>
            )}
        </div>
        <SiteFooter lang={lang} document />
      </div>
    </>
  );
});
