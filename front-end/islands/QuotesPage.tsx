/**
 * Top-level data island for /quotes. The SSR route renders only the page
 * shell; this island fetches the pipeline + win-rate + insight from the
 * backend on mount.
 */
import { useEffect, useRef, useState } from "preact/hooks";
import {
  type Insight,
  type QuoteCard as BackendQuoteCard,
  type QuoteLedger,
  quotesClient,
  type QuoteVersion,
  type WinRate,
} from "../clients/quotes.ts";
import { api, ApiError } from "../lib/api.ts";
import { startListRefresh } from "../lib/list-refresh.ts";
import { openQuoteMoved } from "../lib/live-doc-refresh.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { fmtMoney, fmtMoneyExact } from "../lib/format.ts";
import {
  docHeadline,
  ledgerSummary,
  shortDate,
  versionChangeLine,
  versionHistoryLine,
} from "../../shared/documents/linked-view.ts";
import {
  invoiceState,
  pendingOtherContentChanged,
  pendingRevisionChanges,
  quoteBadgeStatus,
  quoteState,
  versionChanges,
} from "../../shared/documents/versions.ts";
import {
  DecidedRow,
  QSideBig,
  QSideRate,
  QSideTip,
  QuotesHero,
  QuotesKpis,
} from "../components/QuotesSections.tsx";
import QuoteTrack from "./QuoteTrack.tsx";
import QuoteCard from "./QuoteCard.tsx";
import {
  DRAFT_TRACK_STAGES,
  OUT_STAGES,
  type Quote,
} from "../lib/quotes-seed.ts";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";
import { langSignal, tFor } from "../lib/i18n.ts";
import { quoteJobTitle } from "../../shared/quote-flow/job-name.ts";
import {
  canReviseQuote,
  editableLines,
  type EditableQuoteLine,
  editorTotalCents,
  linesPatch,
  nextVersionOf,
} from "../lib/quote-line-edit.ts";
import {
  quotesHeroNumbers,
  sampleTrackCounts,
} from "../lib/headline-counts.ts";
import {
  buildViewedReceipt,
  classifyReceipts,
  type CustomerReceipt,
  type TrailMessage,
  type ViewedReceipt,
} from "../../shared/quote-flow/receipts.ts";

// Inner sort order for the "Out for response" track — most engaged
// (opened) at top, then sent, cooling, stale. Mirrors the reference's
// pipeline layout.
const STAGE_ORDER = { opened: 0, sent: 1, cooling: 2, stale: 3 } as const;

function initialsFromName(name: string | null | undefined): string {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "—";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function clientFromSummary(summary: string | null | undefined): string {
  if (!summary) return "—";
  const m = summary.match(/—\s*(.+)$/);
  return m ? m[1].trim() : "—";
}

function mapCard(c: BackendQuoteCard, lang: "en" | "es"): Quote {
  // UX-17: the customer-less onboarding sample explains itself instead of
  // rendering bare "—" placeholders in the avatar tile and client line.
  const sampleClient = c.isSample === true
    ? tFor(lang, "quoteCard.sampleClient")
    : null;
  const fallbackClient = sampleClient ?? clientFromSummary(c.summary);
  const client = c.customerName ?? fallbackClient;
  return {
    id: c.id,
    // REQ-313 (m48): the card shows the quote's own number, not its position.
    number: c.number,
    version: c.version,
    // Prefer the ≤3-word Job Name (roadmap p.10) so cards read the same as
    // the quote, agreement, and invoice headings; summary is the fallback.
    // REQ-394 (cycle 2, p9): in the app's language — jobNameByLang[lang].
    title: quoteJobTitle(c, lang) ?? tFor(lang, "quotesPage.untitledQuote"),
    client,
    customerId: c.customerId,
    initials: initialsFromName(c.customerName ?? fallbackClient),
    stage: c.stage,
    value: c.estimatedTotal ?? 0,
    daysIn: c.daysIn,
    opens: c.opens,
    sentDays: c.sentDays,
    decidedDays: c.decidedDays ?? undefined,
    ...(c.lastDelivery?.channel ? { channel: c.lastDelivery.channel } : {}),
    band: ["#FFB3B3", "#FF6B6B"],
    shadow: "rgba(255,107,107,0.35)",
    ...(c.isSample === true ? { isSample: true } : {}),
  };
}

interface State {
  loading: boolean;
  error: string | null;
  quotes: Quote[];
  winRate: WinRate | null;
  insight: Insight | null;
}

interface OpenQuoteState {
  loading: boolean;
  quote: BackendQuoteCard | null;
  /** Customer-facing deliveries only (shared classifyReceipts — P-32). */
  receipts: CustomerReceipt[];
  /** "Viewed by the client" receipt when the doc was actually opened. */
  viewed: ViewedReceipt | null;
  /** REQ-205: the documents ledger — null when the backend has none. */
  ledger: QuoteLedger | null;
  /** REQ-201: the quote's own version history (current last). */
  versions: QuoteVersion[];
}

/** REQ-205 — the "Documents" ledger under the open quote: the headline
 *  (number · version · state · date), the totals, one row per invoice /
 *  change order / work order, the version history, and the publish /
 *  next-invoice actions. */
function QuoteLedgerSection(
  { lang, q, ledger, versions, onPublished }: {
    lang: "en" | "es";
    q: BackendQuoteCard;
    ledger: QuoteLedger;
    versions: QuoteVersion[];
    onPublished: () => void;
  },
) {
  const [publishing, setPublishing] = useState(false);
  const [publishErr, setPublishErr] = useState<string | null>(null);
  const [published, setPublished] = useState(false);
  // REQ-304 (demo M28): publishing is a two-step — the button opens a
  // preview that says what Version N changes, and only its Publish posts.
  const [confirming, setConfirming] = useState(false);
  // REQ-395 (demo M12): an unwanted draft revision can be thrown away.
  const [discarding, setDiscarding] = useState(false);
  const summary = ledgerSummary(ledger);
  const state = quoteState(q);
  const headline = docHeadline(
    {
      number: ledger.quote.number,
      version: ledger.quote.version,
      state,
      date: state === "accepted" ? q.acceptedAt : q.publishedAt ?? q.sentAt,
    },
    lang,
  );
  const pending = q.pendingRevision &&
    Object.keys(q.pendingRevision).length > 0;
  const previewChanges = pendingRevisionChanges(
    q as Record<string, unknown> & {
      pendingRevision?: Record<string, unknown>;
    },
  );
  const previewLine = previewChanges
    ? versionChangeLine(previewChanges, lang)
    : "";
  // REQ-395 (demo M12): "Wording or terms updated" only when such a field
  // really differs; a revision equal to the live version has nothing to publish.
  const otherChanged = pendingOtherContentChanged(
    q as Record<string, unknown> & {
      pendingRevision?: Record<string, unknown>;
    },
  );
  const nothingToPublish = !previewLine && !otherChanged;
  const locked = ledger.quote.accepted;
  const rowStyle =
    "display:flex;justify-content:space-between;gap:10px;align-items:baseline;padding:6px 0;border-bottom:1px solid rgba(26,83,92,0.08);font-size:13px";
  const numStyle = "font-weight:800;color:var(--brand-teal,#144852)";
  const mutedStyle = "color:var(--fg-muted,#6b7560)";
  const linkStyle =
    "color:var(--brand-teal,#144852);text-decoration:none;font-weight:700";

  async function discard() {
    if (discarding || publishing) return;
    setDiscarding(true);
    setPublishErr(null);
    try {
      await quotesClient.discardRevision(q.id);
      setConfirming(false);
      onPublished();
    } catch {
      setPublishErr(tFor(lang, "quotes.ledger.discardError"));
    } finally {
      setDiscarding(false);
    }
  }

  async function publish() {
    if (publishing) return;
    setPublishing(true);
    setPublishErr(null);
    try {
      await quotesClient.publish(q.id, { notify: true, language: lang });
      setPublished(true);
      setConfirming(false);
      onPublished();
    } catch (err) {
      const reason = err instanceof ApiError
        ? (err.body as { reason?: string } | null)?.reason
        : undefined;
      setPublishErr(
        reason === "locked_signed"
          ? tFor(lang, "quotes.ledger.lockedNote")
          : reason === "nothing_to_publish"
          ? tFor(lang, "quotes.ledger.nothingToPublish")
          : tFor(lang, "quotes.ledger.publishError"),
      );
    } finally {
      setPublishing(false);
    }
  }

  return (
    <section
      class="qopen__ledger"
      data-cy="quote-ledger"
      style="margin-top:16px;padding-top:14px;border-top:1px dashed rgba(26,83,92,0.16)"
    >
      <div style="display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;align-items:center">
        <div>
          <div class="qopen__eyebrow">
            {tFor(lang, "quotes.ledger.title")}
          </div>
          <div
            data-cy="quote-headline"
            style="font-weight:800;color:var(--brand-teal,#144852);font-size:14px"
          >
            {headline}
          </div>
        </div>
        {pending && !locked && (
          <span style="display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span
              data-cy="quote-pending-badge"
              style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#fff6e5;color:#8a5a10;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase"
            >
              {tFor(lang, "quotes.ledger.unpublished")}
            </span>
            {/* REQ-395 (demo M12): a quiet ghost — the customer keeps the published version */}
            <button
              type="button"
              class="qopen__btn"
              data-cy="quote-discard-draft"
              disabled={discarding || publishing}
              onClick={discard}
              style="background:transparent;border-color:transparent;color:var(--fg-muted,#6b7560);padding:4px 8px;font-size:12px"
            >
              {discarding
                ? tFor(lang, "quotes.ledger.discarding")
                : tFor(lang, "quotes.ledger.discardDraft")}
            </button>
          </span>
        )}
      </div>

      {locked && (
        <p
          data-cy="quote-lock-note"
          style={`margin:8px 0 0;font-size:12.5px;${mutedStyle}`}
        >
          {tFor(lang, "quotes.ledger.lockedNote")}
        </p>
      )}

      {/* Totals */}
      <div
        data-cy="quote-ledger-totals"
        style="margin-top:12px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px"
      >
        {summary.rows.map((r) => (
          <div
            key={r.key}
            data-cy={`ledger-${r.key}`}
            style={`padding:10px 12px;border-radius:10px;background:${
              r.key === "remaining"
                ? "rgba(81,152,67,0.08)"
                : "rgba(26,83,92,0.04)"
            };font-size:13px;${mutedStyle}`}
          >
            {tFor(lang, `quotes.ledger.${r.key}`)}{" "}
            <strong style="display:block;font-size:16px;color:var(--brand-teal,#144852);font-variant-numeric:tabular-nums">
              {fmtMoneyExact(r.cents)}
            </strong>
          </div>
        ))}
        {summary.overpaid && (
          <div
            data-cy="ledger-overpaid"
            style="padding:10px 12px;border-radius:10px;background:rgba(168,59,59,0.08);font-size:13px;color:#a83b3b;font-weight:700"
          >
            {tFor(lang, "quotes.ledger.overpaid")}{" "}
            <strong style="display:block;font-size:16px;font-variant-numeric:tabular-nums">
              {fmtMoneyExact(summary.overpaidCents)}
            </strong>
          </div>
        )}
      </div>

      {/* Invoices */}
      <div style="margin-top:14px">
        <div class="qopen__eyebrow">
          {tFor(lang, "quotes.ledger.invoices")}
        </div>
        {ledger.invoices.length === 0
          ? (
            <p style={`margin:4px 0 0;font-size:13px;${mutedStyle}`}>
              {tFor(lang, "quotes.ledger.noInvoices")}
            </p>
          )
          : ledger.invoices.map((inv) => (
            <a
              key={inv.id}
              data-cy="ledger-invoice-row"
              href={`/invoices?open=${encodeURIComponent(inv.id)}`}
              style={`${rowStyle};text-decoration:none;color:inherit`}
            >
              <span style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline">
                <span style={numStyle}>{inv.number}</span>
                <span style={mutedStyle}>
                  {tFor(lang, "quotes.ledger.versionN", { n: inv.version })}
                </span>
                <span style={mutedStyle}>
                  {tFor(
                    lang,
                    `public.doc.state.${
                      invoiceState({ status: inv.status, version: inv.version })
                    }`,
                  )}
                </span>
                {inv.dueDate && (
                  <span style={mutedStyle}>
                    {tFor(lang, "quotes.ledger.due", {
                      date: shortDate(inv.dueDate, lang),
                    })}
                  </span>
                )}
              </span>
              <span style="text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap">
                <strong>{fmtMoneyExact(inv.amountCents)}</strong>
                <span style={`display:block;font-size:11.5px;${mutedStyle}`}>
                  {tFor(lang, "quotes.ledger.paidBalance", {
                    paid: fmtMoneyExact(inv.paidCents),
                    balance: fmtMoneyExact(inv.balanceCents),
                  })}
                </span>
              </span>
            </a>
          ))}
      </div>

      {/* Change orders */}
      {ledger.changeOrders.length > 0 && (
        <div style="margin-top:14px">
          <div class="qopen__eyebrow">
            {tFor(lang, "quotes.ledger.changeOrders")}
          </div>
          {ledger.changeOrders.map((co) => (
            <div key={co.id} data-cy="ledger-co-row" style={rowStyle}>
              <span style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline">
                <a
                  href={co.url}
                  target="_blank"
                  rel="noopener"
                  style={linkStyle}
                >
                  {co.number}
                </a>
                <span style={mutedStyle}>
                  {tFor(lang, `public.doc.state.${co.status}`)}
                </span>
                {co.invoiceNumber && (
                  <span style={mutedStyle}>
                    {tFor(lang, "quotes.ledger.onInvoice", {
                      number: co.invoiceNumber,
                    })}
                  </span>
                )}
              </span>
              <strong style="font-variant-numeric:tabular-nums;white-space:nowrap">
                {co.deltaAmountCents >= 0 ? "+" : "−"}
                {fmtMoneyExact(Math.abs(co.deltaAmountCents))}
              </strong>
            </div>
          ))}
        </div>
      )}

      {/* Work orders */}
      {ledger.workOrders.length > 0 && (
        <div style="margin-top:14px">
          <div class="qopen__eyebrow">
            {tFor(lang, "quotes.ledger.workOrders")}
          </div>
          {ledger.workOrders.map((wo) => (
            <a
              key={wo.id}
              data-cy="ledger-wo-row"
              href={wo.url}
              style={`${rowStyle};text-decoration:none;color:inherit`}
            >
              <span style="display:flex;gap:8px;flex-wrap:wrap;align-items:baseline">
                <span style={numStyle}>{wo.number}</span>
                <span style={mutedStyle}>
                  {tFor(lang, `workOrders.status.${wo.status}`)}
                </span>
                {wo.assignee && <span>{wo.assignee}</span>}
                {wo.scheduledFor && (
                  <span style={mutedStyle}>
                    {shortDate(wo.scheduledFor, lang)}
                  </span>
                )}
              </span>
              {wo.description && (
                <span
                  style={`${mutedStyle};text-align:right;max-width:50%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`}
                >
                  {wo.description}
                </span>
              )}
            </a>
          ))}
        </div>
      )}

      {/* Version history */}
      {versions.length > 0 && (
        <details style="margin-top:12px" data-cy="quote-versions">
          <summary
            style={`cursor:pointer;font-size:12.5px;font-weight:700;${mutedStyle}`}
          >
            {tFor(lang, "quotes.ledger.versionHistory", {
              n: versions.length,
            })}
          </summary>
          <ul style="margin:6px 0 0;padding-left:18px;font-size:12.5px;line-height:1.7">
            {versions.map((v, i) => {
              // REQ-248: what this version changed against the one before
              const changed = i > 0
                ? versionChangeLine(
                  versionChanges(versions[i - 1].content, v.content),
                  lang,
                )
                : "";
              return (
                <li key={v.version}>
                  {versionHistoryLine(v, lang)}
                  {v.current && (
                    <span style={` ${mutedStyle}`}>
                      {` · ${tFor(lang, "quotes.ledger.current")}`}
                    </span>
                  )}
                  {changed && (
                    <div
                      data-cy="quote-version-changes"
                      style={`font-size:12px;${mutedStyle}`}
                    >
                      {changed}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </details>
      )}

      {/* REQ-304: the publish preview — what Version N changes, Publish / Cancel */}
      {pending && !locked && confirming && (
        <div
          data-cy="quote-publish-preview"
          style="margin-top:14px;padding:12px 14px;border:1px solid rgba(26,83,92,0.18);border-radius:10px;background:rgba(26,83,92,0.04)"
        >
          <div style={`font-size:13.5px;font-weight:800;${numStyle}`}>
            {tFor(lang, "quotes.ledger.publishPreviewTitle", {
              n: ledger.quote.version + 1,
            })}
          </div>
          <div
            data-cy="quote-publish-changes"
            style="margin-top:4px;font-size:13px;font-weight:700"
          >
            {previewLine ||
              (otherChanged
                ? tFor(lang, "quotes.ledger.publishOtherChanges")
                : tFor(lang, "quotes.ledger.nothingToPublish"))}
          </div>
          <div style={`margin-top:2px;font-size:12px;${mutedStyle}`}>
            {tFor(lang, "quotes.ledger.publishPreviewNote")}
          </div>
          <div class="qopen__actions" style="margin-top:10px">
            <button
              type="button"
              class="qopen__btn qopen__btn--primary"
              data-cy="quote-publish-confirm"
              disabled={publishing || nothingToPublish}
              onClick={publish}
            >
              {publishing
                ? tFor(lang, "quotes.ledger.publishing")
                : tFor(lang, "quotes.ledger.publishConfirm")}
            </button>
            <button
              type="button"
              class="qopen__btn"
              data-cy="quote-publish-cancel"
              disabled={publishing}
              onClick={() => setConfirming(false)}
            >
              {tFor(lang, "quotes.ledger.publishCancel")}
            </button>
          </div>
        </div>
      )}

      {/* Actions: one solid primary, the rest outlined */}
      <div
        class="qopen__actions"
        style="margin-top:14px;align-items:center"
      >
        {pending && !locked && !confirming
          ? (
            <button
              type="button"
              class="qopen__btn qopen__btn--primary"
              data-cy="quote-publish"
              disabled={publishing}
              onClick={() => {
                setPublishErr(null);
                setConfirming(true);
              }}
            >
              {publishing
                ? tFor(lang, "quotes.ledger.publishing")
                : tFor(lang, "quotes.ledger.publish")}
            </button>
          )
          : null}
        {summary.canCreateNextInvoice
          ? (
            <a
              class={`qopen__btn${
                pending && !locked ? "" : " qopen__btn--primary"
              }`}
              data-cy="quote-create-next-invoice"
              href={`/invoices?new=1&quoteId=${encodeURIComponent(q.id)}`}
            >
              {tFor(lang, "quotes.ledger.createNextInvoice")}
            </a>
          )
          : (
            <span
              data-cy="quote-create-next-invoice"
              aria-disabled="true"
              class="qopen__btn"
              style="opacity:.55;cursor:not-allowed"
              title={tFor(lang, "quotes.ledger.fullyInvoiced")}
            >
              {tFor(lang, "quotes.ledger.createNextInvoice")}
            </span>
          )}
        {!summary.canCreateNextInvoice && (
          <span style={`font-size:12px;${mutedStyle}`}>
            {tFor(lang, "quotes.ledger.fullyInvoiced")}
          </span>
        )}
      </div>
      {published && (
        <p
          data-cy="quote-published-note"
          style="margin:8px 0 0;font-size:12.5px;color:var(--brand-green,#519843);font-weight:700"
        >
          {tFor(lang, "quotes.ledger.published")}
        </p>
      )}
      {publishErr && (
        <p
          role="alert"
          style="margin:8px 0 0;font-size:12.5px;color:#a83b3b;font-weight:600"
        >
          {publishErr}
        </p>
      )}
    </section>
  );
}

/** REQ-315 (demo-loop cycle 1, B2) — "Edit → Version N+1" on an issued,
 *  unsigned quote: description / qty / price per line, add or remove lines,
 *  a live new total. Save PUTs the lines + total; the controller files them
 *  as the pending revision (REQ-201), and the panel's "Publish revision"
 *  takes over. The customer keeps seeing the published version meanwhile. */
function QuoteLineEditor(
  { lang, q, onCancel, onSaved }: {
    lang: "en" | "es";
    q: BackendQuoteCard;
    onCancel: () => void;
    onSaved: (version: number) => void;
  },
) {
  const [lines, setLines] = useState<EditableQuoteLine[]>(() =>
    editableLines(q)
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const n = nextVersionOf(q);
  const total = editorTotalCents(lines);
  const field =
    "padding:7px 9px;border:1px solid rgba(26,83,92,0.22);border-radius:8px;font:inherit;font-size:13px;min-width:0;width:100%;box-sizing:border-box;background:#fff";
  const grid =
    "display:grid;grid-template-columns:minmax(0,1fr) 64px 110px auto;gap:6px;align-items:center";
  const mutedStyle = "color:var(--fg-muted,#6b7560)";

  function patch(
    i: number,
    key: "description" | "quantity" | "price",
    value: string,
  ) {
    setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [key]: value } : l)));
  }

  async function save() {
    if (busy) return;
    const body = linesPatch(lines);
    if (!body.ok) {
      setErr(tFor(lang, "quotesPage.edit.invalid"));
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await quotesClient.update(q.id, {
        lineItems: body.lineItems,
        estimatedTotal: body.estimatedTotal,
      });
      onSaved(n);
    } catch {
      setErr(tFor(lang, "quotesPage.edit.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      class="qopen__edit"
      data-cy="quote-edit-form"
      style="margin-top:12px;padding:12px;border:1px solid rgba(26,83,92,0.16);border-radius:12px;background:rgba(26,83,92,0.03)"
    >
      <p style={`margin:0 0 8px;font-size:12.5px;${mutedStyle}`}>
        {tFor(lang, "quotesPage.edit.heading", { n })}
      </p>
      <div style={`${grid};font-size:11px;font-weight:700;${mutedStyle}`}>
        <span>{tFor(lang, "quotesPage.edit.description")}</span>
        <span>{tFor(lang, "quotesPage.edit.qty")}</span>
        <span>{tFor(lang, "quotesPage.edit.price")}</span>
        <span />
      </div>
      {lines.map((l, i) => (
        <div key={i} style={`${grid};margin-top:6px`}>
          <input
            type="text"
            data-cy={`quote-edit-line-desc-${i}`}
            aria-label={`${tFor(lang, "quotesPage.edit.description")} ${i + 1}`}
            placeholder={tFor(lang, "quotesPage.edit.descriptionPlaceholder")}
            value={l.description}
            disabled={busy}
            onInput={(e) =>
              patch(i, "description", (e.target as HTMLInputElement).value)}
            style={field}
          />
          <input
            type="number"
            min="1"
            step="1"
            data-cy={`quote-edit-line-qty-${i}`}
            aria-label={`${tFor(lang, "quotesPage.edit.qty")} ${i + 1}`}
            placeholder={tFor(lang, "quotesPage.edit.qty")}
            value={l.quantity}
            disabled={busy}
            onInput={(e) =>
              patch(i, "quantity", (e.target as HTMLInputElement).value)}
            style={field}
          />
          <input
            type="number"
            step="0.01"
            inputMode="decimal"
            data-cy={`quote-edit-line-price-${i}`}
            aria-label={`${tFor(lang, "quotesPage.edit.price")} ${i + 1}`}
            placeholder={tFor(lang, "quotesPage.edit.pricePlaceholder")}
            value={l.price}
            disabled={busy}
            onInput={(e) =>
              patch(i, "price", (e.target as HTMLInputElement).value)}
            style={field}
          />
          <button
            type="button"
            class="qopen__btn"
            data-cy={`quote-edit-line-remove-${i}`}
            disabled={busy || lines.length === 1}
            onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}
          >
            {tFor(lang, "quotesPage.edit.removeLine")}
          </button>
        </div>
      ))}
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;margin-top:10px;flex-wrap:wrap">
        <button
          type="button"
          class="qopen__btn"
          data-cy="quote-edit-add-line"
          disabled={busy}
          onClick={() =>
            setLines((ls) => [
              ...ls,
              { description: "", quantity: "1", unit: "ea", price: "" },
            ])}
        >
          {tFor(lang, "quotesPage.edit.addLine")}
        </button>
        <strong
          data-cy="quote-edit-total"
          style="font-variant-numeric:tabular-nums;color:var(--brand-teal,#144852)"
        >
          {tFor(lang, "quotesPage.edit.total", {
            amount: fmtMoneyExact(total),
          })}
        </strong>
      </div>
      {/* One solid primary (save), the cancel a quiet ghost. */}
      <div class="qopen__actions" style="margin-top:10px;align-items:center">
        <button
          type="button"
          class="qopen__btn qopen__btn--primary"
          data-cy="quote-edit-save"
          disabled={busy}
          onClick={save}
          style="background:var(--brand-teal,#144852);border-color:var(--brand-teal,#144852);color:#fff"
        >
          {busy
            ? tFor(lang, "quotesPage.edit.saving")
            : tFor(lang, "quotesPage.edit.save", { n })}
        </button>
        <button
          type="button"
          class="qopen__btn"
          data-cy="quote-edit-cancel"
          disabled={busy}
          onClick={onCancel}
          style="background:transparent;border-color:transparent;color:var(--fg-muted,#6b7560)"
        >
          {tFor(lang, "common.cancel")}
        </button>
      </div>
      {err && (
        <p
          role="alert"
          style="margin:8px 0 0;font-size:12.5px;color:#a83b3b;font-weight:600"
        >
          {err}
        </p>
      )}
    </div>
  );
}

/** Detail surface for /quotes?open=<id> — job name, lifecycle status badge,
 *  full-quote actions, and the "emailed to … / texted to …" receipt strip
 *  built from the per-document comms trail (roadmap p.8). */
function OpenQuotePanel(
  { lang, state, onClose, onRefresh }: {
    lang: "en" | "es";
    state: OpenQuoteState;
    /** REQ-034 (NW-43f): the panel can be closed — X strips ?open=. */
    onClose: () => void;
    /** REQ-201: after a publish the panel re-reads the quote + ledger. */
    onRefresh: () => void;
  },
) {
  const [copied, setCopied] = useState(false);
  // REQ-315 (B2): "Edit → Version N+1" on an issued, unsigned quote — the
  // editor and its "saved" note reset whenever another quote is opened.
  const [editing, setEditing] = useState(false);
  const [savedVersion, setSavedVersion] = useState<number | null>(null);
  const openedId = state.quote?.id;
  useEffect(() => {
    setEditing(false);
    setSavedVersion(null);
  }, [openedId]);

  if (state.loading) {
    return (
      <section class="qopen qopen--pending">
        {tFor(lang, "quotesPage.open.loading")}
      </section>
    );
  }
  const q = state.quote;
  if (!q) {
    return (
      <section class="qopen qopen--pending">
        {tFor(lang, "quotesPage.open.notFound")}
      </section>
    );
  }

  const badge = quoteBadgeStatus(q);
  const quoteId = q.id;
  // REQ-394 (cycle 2, p9): the title and summary in the app's language.
  const title = quoteJobTitle(q, lang) ??
    tFor(lang, "quotesPage.untitledQuote");
  const summaryText = q.summaryByLang?.[lang]?.trim() || q.summary;
  // REQ-315: while a revision waits, "Publish revision" is the one primary.
  const hasPending = Boolean(
    q.pendingRevision && Object.keys(q.pendingRevision).length > 0,
  );

  async function copyLink() {
    try {
      // Always the FULL public quote URL (/q/:id) — never a summary variant.
      await navigator.clipboard.writeText(
        `${globalThis.location.origin}/q/${quoteId}`,
      );
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable — leave the label as-is */ }
  }

  return (
    <section class="qopen" data-cy="quote-open-panel">
      <div class="qopen__head">
        <div class="qopen__id">
          <div class="qopen__eyebrow">{tFor(lang, "quoteCard.valueLabel")}</div>
          <h2 class="qopen__title">{title}</h2>
        </div>
        <span
          class={`qopen__badge qopen__badge--${badge}`}
          data-cy="quote-status-badge"
        >
          {tFor(lang, `quotesPage.status.${badge}`)}
        </span>
        {/* REQ-034 (NW-43f): a way back — the same X the invoice panel has. */}
        <button
          type="button"
          class="qopen__close"
          data-cy="quote-panel-close"
          onClick={onClose}
          aria-label={tFor(lang, "common.close")}
          title={tFor(lang, "common.close")}
        >
          <I d={ICN.x} size={16} sw={2.5} />
        </button>
      </div>
      {summaryText && q.jobName?.trim() && (
        <p class="qopen__summary">{summaryText}</p>
      )}
      {q.customerName && (
        <p class="qopen__client" style="font-size:13px;color:var(--fg-muted)">
          {tFor(lang, "quotesPage.open.customer", { name: q.customerName })}
        </p>
      )}
      <div class="qopen__meta">
        <div class="qopen__amount">{fmtMoney(q.estimatedTotal ?? 0)}</div>
        <div class="qopen__actions">
          <button type="button" class="qopen__btn" onClick={copyLink}>
            {copied
              ? tFor(lang, "quotesPage.open.linkCopied")
              : tFor(lang, "quotesPage.open.copyLink")}
          </button>
          <a
            class="qopen__btn"
            href={`/q/${q.id}`}
            target="_blank"
            rel="noopener"
          >
            {tFor(lang, "quotesPage.open.viewAsClient")}
          </a>
          {/* REQ-315 (B2): a sent, unsigned quote can be repriced here. */}
          {canReviseQuote(q) && !editing && (
            <button
              type="button"
              class={`qopen__btn${hasPending ? "" : " qopen__btn--primary"}`}
              data-cy="quote-edit"
              onClick={() => {
                setSavedVersion(null);
                setEditing(true);
              }}
            >
              {tFor(lang, "quotesPage.open.edit", { n: nextVersionOf(q) })}
            </button>
          )}
          {
            /* UX-02: the won quote's obvious next step — never a dead end.
              REQ-205: once the ledger is loaded its own CTA takes over. */
          }
          {badge === "accepted" && !state.ledger && (
            <a
              class="qopen__btn qopen__btn--primary"
              href={`/invoices?new=1&quoteId=${encodeURIComponent(q.id)}`}
            >
              {q.customerName
                ? tFor(lang, "quotesPage.open.createInvoiceFor", {
                  name: q.customerName,
                })
                : tFor(lang, "quotesPage.open.createInvoice")}
            </a>
          )}
        </div>
      </div>
      {editing && (
        <QuoteLineEditor
          lang={lang}
          q={q}
          onCancel={() => setEditing(false)}
          onSaved={(n) => {
            setEditing(false);
            setSavedVersion(n);
            onRefresh();
          }}
        />
      )}
      {/* REQ-395 (demo m27): only while that unpublished version still waits */}
      {savedVersion !== null && hasPending && !editing && (
        <p
          data-cy="quote-edit-saved"
          style="margin:10px 0 0;font-size:12.5px;color:var(--brand-green,#519843);font-weight:700"
        >
          {tFor(lang, "quotesPage.edit.saved", {
            n: savedVersion,
            name: q.customerName ?? tFor(lang, "quotesPage.edit.theCustomer"),
          })}
        </p>
      )}
      {(badge === "accepted" || state.receipts.length > 0 || state.viewed) && (
        <div class="qopen__receipts">
          {badge === "accepted" && (
            <div class="qopen__receipt qopen__receipt--signed">
              {tFor(lang, "quotesPage.open.receipt.signed")}
            </div>
          )}
          {state.viewed && (
            <div class="qopen__receipt qopen__receipt--viewed">
              {tFor(lang, "quotesPage.open.receipt.viewed")}
            </div>
          )}
          {state.receipts.map((r) => (
            <div class="qopen__receipt" key={`${r.channel}:${r.to}`}>
              {tFor(
                lang,
                r.channel === "email"
                  ? "quotesPage.open.receipt.emailedTo"
                  : "quotesPage.open.receipt.textedTo",
                { to: r.to },
              )}
            </div>
          ))}
        </div>
      )}
      {state.ledger && (
        <QuoteLedgerSection
          lang={lang}
          q={q}
          ledger={state.ledger}
          versions={state.versions}
          onPublished={() => {
            // REQ-395 (demo m27): the "Saved as unpublished Version N" line
            // is stale once that version is published (or discarded).
            setSavedVersion(null);
            onRefresh();
          }}
        />
      )}
    </section>
  );
}

const INITIAL: State = {
  loading: true,
  error: null,
  quotes: [],
  winRate: null,
  insight: null,
};

export default function QuotesPage(_props: { lang?: "en" | "es" }) {
  // Self-source the live UI language: reading langSignal.value during render
  // makes this island re-render when SettingsPage flips the language. The
  // optional `lang` prop is an ignored SSR seed.
  const lang = langSignal.value;
  // REQ-321: the periodic re-read words its cards in the language live now
  const langRef = useRef(lang);
  langRef.current = lang;
  const [s, setS] = useState<State>(INITIAL);

  // /quotes?open=<id> deep link — seeded from the URL; UX-08: also settable
  // from the list (tapping a decided row opens the same panel).
  const [openId, setOpenId] = useState<string | null>(() => {
    if (typeof globalThis.location === "undefined") return null;
    return new URLSearchParams(globalThis.location.search).get("open");
  });
  const [openQ, setOpenQ] = useState<OpenQuoteState>({
    loading: true,
    quote: null,
    receipts: [],
    viewed: null,
    ledger: null,
    versions: [],
  });
  // REQ-201: bumped after a publish so the panel re-reads quote + ledger.
  // REQ-396: also bumped by the 30 s list re-read when the open quote's card
  // moved under the panel (the client signed / declined / viewed it).
  const [openTick, setOpenTick] = useState(0);
  const openIdRef = useRef(openId);
  openIdRef.current = openId;
  const openQRef = useRef(openQ);
  openQRef.current = openQ;

  function openQuote(id: string) {
    setOpenQ({
      loading: true,
      quote: null,
      receipts: [],
      viewed: null,
      ledger: null,
      versions: [],
    });
    setOpenId(id);
    try {
      const url = new URL(globalThis.location.href);
      url.searchParams.set("open", id);
      globalThis.history.replaceState(null, "", url.toString());
    } catch { /* history unavailable — the panel still opens */ }
  }

  useEffect(() => {
    if (!openId) return;
    let alive = true;
    Promise.all([
      quotesClient.get(openId).catch(() => null),
      // Comms trail: outbound sends logged per document (paperworkId).
      api.get<TrailMessage[]>("/messages").catch(() => [] as TrailMessage[]),
      // Contractor's own contact info — classifyReceipts drops anything
      // addressed to it (P-32: accepted-alert self-notifications are not
      // customer deliveries).
      api.get<{ email?: string; phoneNumber?: string }>("/me")
        .catch(() => ({} as { email?: string; phoneNumber?: string })),
      // Engagement timeline — feeds the "Viewed by the client" receipt.
      api.get<{ opens?: { at: string }[] }>(`/quotes/${openId}/opens`)
        .catch(() => ({ opens: [] as { at: string }[] })),
      // UX-08: GET /quotes/:id is the raw row (customerId only) — join the
      // customer so the panel can say WHO the deal is with.
      api.get<{ id: string; name?: string }[]>("/customers")
        .catch(() => [] as { id: string; name?: string }[]),
      // REQ-205 / REQ-201: the documents ledger and the version history.
      quotesClient.ledger(openId).catch(() => null as QuoteLedger | null),
      quotesClient.versions(openId).catch(() => [] as QuoteVersion[]),
    ]).then((
      [quoteRaw, messages, me, opensRes, customersList, ledger, versions],
    ) => {
      if (!alive) return;
      let quote = quoteRaw as BackendQuoteCard | null;
      if (quote && !quote.customerName && quote.customerId) {
        const found = (Array.isArray(customersList) ? customersList : [])
          .find((c) => c.id === quote!.customerId);
        if (found?.name) quote = { ...quote, customerName: found.name };
      }
      const receipts = classifyReceipts(
        Array.isArray(messages) ? messages : [],
        { email: me.email ?? null, phone: me.phoneNumber ?? null },
        openId,
      );
      const opens = Array.isArray(opensRes?.opens) ? opensRes.opens : [];
      const q = quote as (BackendQuoteCard & { viewedAt?: string }) | null;
      const viewed = buildViewedReceipt({
        viewedAt: q?.viewedAt ?? null,
        lastOpenAt: opens[opens.length - 1]?.at ?? null,
        opens: opens.length,
      });
      setOpenQ({
        loading: false,
        quote,
        receipts,
        viewed,
        ledger: ledger && typeof ledger === "object" && "quote" in ledger
          ? ledger
          : null,
        versions: Array.isArray(versions) ? versions : [],
      });
    });
    return () => {
      alive = false;
    };
  }, [openId, openTick]);

  // UX-08: once the opened panel has data, make sure it is actually on
  // screen — at 390px it renders below the hero + 4 stacked KPI cells and a
  // deep link used to land the user on a viewport that never showed it.
  useEffect(() => {
    if (!openId || openQ.loading || !openQ.quote) return;
    document.querySelector("[data-cy=quote-open-panel]")?.scrollIntoView({
      block: "start",
      behavior: "auto",
    });
  }, [openId, openQ.loading, openQ.quote?.id]);

  // REQ-304 (demo M27): the cards / hero / KPI loader is a function, not a
  // mount-only effect — the panel calls it again after a publish (or any
  // money-changing mutation) so the pipeline's totals follow without a
  // reload. Returns a cancel so a stale answer never lands.
  function loadPipeline(): () => void {
    let alive = true;
    Promise.all([
      quotesClient.list().catch(() => [] as BackendQuoteCard[]),
      quotesClient.winRate(90).catch(() => null as WinRate | null),
      quotesClient.insight().catch(() => null as Insight | null),
    ]).then(([cards, winRate, insight]) => {
      if (!alive) return;
      const safeCards = Array.isArray(cards) ? cards : [];
      setS({
        loading: false,
        error: null,
        quotes: safeCards.map((c) => mapCard(c, lang)),
        winRate,
        insight,
      });
    }).catch((err: Error) => {
      if (!alive) return;
      setS({ ...INITIAL, loading: false, error: err.message });
    });
    return () => {
      alive = false;
    };
  }

  useEffect(() => loadPipeline(), [lang]);

  // REQ-321 (demo M14): the list above is read once at mount, so a quote
  // the customer signed in another tab stayed "Out for response" until a
  // manual reload. Re-read it every 30 s through REQ-221's scheduler (hidden
  // tabs wait, one catch-up when shown) and on the window's focus. A failed
  // re-read keeps the last list; the first paint stays loadPipeline's.
  // Reconciled with REQ-304 on demo-fixes: one scheduler per mount (not an
  // effect keyed on [lang]) — a language switch re-runs loadPipeline, and
  // this re-read words the cards in the language live at that moment.
  useEffect(() => {
    let alive = true;
    const refresh = async () => {
      const [cards, winRate] = await Promise.all([
        quotesClient.list(),
        quotesClient.winRate(90).catch(() => null as WinRate | null),
      ]);
      if (!alive || !Array.isArray(cards)) return;
      // REQ-396 (demo-loop c2 M13): the open panel reads its quote once per
      // [openId, openTick]; when the list says the open quote changed (the
      // client signed it while the panel said "Sent · Out for response"),
      // re-get it so the badge, the version and the actions follow.
      const openNow = openIdRef.current;
      const shown = openQRef.current;
      if (
        openNow && !shown.loading &&
        openQuoteMoved(shown.quote, cards.find((c) => c.id === openNow))
      ) setOpenTick((t) => t + 1);
      setS((prev) =>
        prev.loading || prev.error ? prev : {
          ...prev,
          quotes: cards.map((c) => mapCard(c, langRef.current)),
          winRate: winRate ?? prev.winRate,
        }
      );
    };
    const stop = startListRefresh(refresh, 30_000);
    return () => {
      alive = false;
      stop();
    };
  }, []);

  if (s.loading) {
    return (
      <>
        <ShimmerStyle />
        <PageHeaderSkeleton />
        <CardGridSkeleton rows={3} />
      </>
    );
  }
  if (s.error) {
    return (
      <div class="qpage-error">
        {tFor(lang, "quotesPage.loadError", { error: s.error })}
      </div>
    );
  }

  const { quotes, winRate, insight } = s;

  // P-15: the onboarding sample stays VISIBLE as a badged card, but it
  // contributes to NO aggregate — the hero, KPI strip, and side panels all
  // roll over real quotes only.
  const isReal = (q: Quote) => q.isSample !== true;
  const real = quotes.filter(isReal);

  // Card lists for the tracks (samples included — the card renders):
  // REQ-236: an undelivered quote is never "out for response".
  const outCards = quotes.filter((q) => OUT_STAGES.includes(q.stage));
  const draftCards = quotes.filter((q) => DRAFT_TRACK_STAGES.includes(q.stage));
  const decidedCards = quotes.filter((q) => ["won", "lost"].includes(q.stage));

  // Aggregates (real quotes only). REQ-404 (demo cycle 2, m13): the hero's
  // money and client count are what actually went out — unsent drafts are
  // reported apart, never as "work sitting with clients".
  const heroNums = quotesHeroNumbers(real);
  const out = outCards.filter(isReal);
  const outCounts = sampleTrackCounts(outCards);
  const outVal = out.reduce((acc, q) => acc + q.value, 0);
  const drafts = draftCards.filter(isReal);
  // REQ-360 (m11): the sample is a draft — the Drafting header says it is
  // there instead of "0 quotes" over its card.
  const draftCounts = sampleTrackCounts(draftCards);
  const decided = decidedCards.filter(isReal);

  // Inner sort: opened > sent > cooling > stale within "Out for response".
  const outSorted = [...outCards].sort((a, b) => {
    const av = STAGE_ORDER[a.stage as keyof typeof STAGE_ORDER] ?? 9;
    const bv = STAGE_ORDER[b.stage as keyof typeof STAGE_ORDER] ?? 9;
    return av - bv;
  });

  const won = winRate?.won ?? decided.filter((q) => q.stage === "won").length;
  const lost = winRate?.lost ??
    (decided.length -
      (winRate?.won ?? decided.filter((q) => q.stage === "won").length));
  const decidedCount = winRate?.decided ?? decided.length;
  const winRatePct = winRate?.winRate ??
    (decidedCount ? Math.round((won / decidedCount) * 100) : 0);

  return (
    <>
      <QuotesHero
        lang={lang}
        // P-37: "empty" means zero REAL quotes TOTAL (open or resolved) —
        // the giant empty-state hero never shouts above a real card.
        totalCount={real.length}
        openCount={heroNums.outCount}
        openTotal={heroNums.outTotal}
        staleCount={heroNums.staleCount}
        // REQ-243: count clients from the same field the card shows (the
        // linked customer, else the card's name). Placeholder "—" names count
        // for nobody, so unlinked quotes never become a phantom client (#31).
        // REQ-404: over the OUT quotes only (quotesHeroNumbers).
        clientCount={heroNums.outClients}
        draftCount={heroNums.draftCount}
        draftTotal={heroNums.draftTotal}
      />
      <QuotesKpis
        lang={lang}
        outValue={outVal}
        outCount={out.length}
        draftCount={drafts.length}
        decidedCount={decidedCount}
        wonCount={won}
        lostCount={lost}
        winRate={winRatePct}
      />
      {openId && (
        <OpenQuotePanel
          lang={lang}
          state={openQ}
          onRefresh={() => {
            setOpenTick((n) => n + 1);
            loadPipeline();
          }}
          onClose={() => {
            setOpenId(null);
            try {
              const url = new URL(globalThis.location.href);
              url.searchParams.delete("open");
              globalThis.history.replaceState(null, "", url.toString());
            } catch { /* history unavailable — the panel still closes */ }
          }}
        />
      )}
      <div class="qlay">
        <div>
          <QuoteTrack
            lang={lang}
            num="01"
            title={tFor(lang, "quotesPage.track.outForResponse")}
            // UX-17: header count agrees with the KPI — real quotes only
            // (the badged sample card stays visible but counts nowhere).
            // REQ-243: the header says the sample is there ("1 quote +
            // sample") so the count never reads short of the cards.
            count={out.length}
            sampleCount={outCounts.sample}
            defaultOpen
            forceOpen={openId != null && outCards.some((q) => q.id === openId)}
            storageKey="quotes:track:01"
          >
            <div class="qcards">
              {outSorted.map((q, i) => (
                <QuoteCard
                  key={q.id}
                  q={q}
                  idx={i}
                  lang={lang}
                  flipOnMount={q.id === openId}
                  onOpen={openQuote}
                />
              ))}
            </div>
          </QuoteTrack>

          <QuoteTrack
            lang={lang}
            num="02"
            title={tFor(lang, "quotesPage.track.drafting")}
            count={drafts.length}
            sampleCount={draftCounts.sample}
            /* A draft the user is mid-writing must not hide behind a
               collapsed track (same rule as the invoice tracks, P-31). */
            defaultOpen={draftCards.length > 0}
            forceOpen={openId != null &&
              draftCards.some((q) => q.id === openId)}
            storageKey="quotes:track:02"
          >
            <div class="qcards">
              {draftCards.map((q, i) => (
                <QuoteCard
                  key={q.id}
                  q={q}
                  idx={i}
                  lang={lang}
                  flipOnMount={q.id === openId}
                  onOpen={openQuote}
                />
              ))}
            </div>
          </QuoteTrack>

          <QuoteTrack
            lang={lang}
            num="03"
            title={tFor(lang, "quotesPage.track.decidedThisMonth")}
            count={decided.length}
            // Open by default when there are decided rows so the ≤3-word Job
            // Name stays visible on the list (roadmap p.8); a user's stored
            // collapse preference still wins via storageKey.
            defaultOpen={decidedCards.length > 0}
            forceOpen={openId != null &&
              decidedCards.some((q) => q.id === openId)}
            storageKey="quotes:track:03"
          >
            <div class="qdone">
              {decidedCards.map((q) => (
                <DecidedRow key={q.id} q={q} lang={lang} onOpen={openQuote} />
              ))}
            </div>
          </QuoteTrack>
        </div>

        <aside class="qside">
          <QSideBig open={out} lang={lang} />
          <QSideRate won={won} lost={lost} lang={lang} />
          <QSideTip text={insight?.text} lang={lang} />
        </aside>
      </div>
    </>
  );
}
