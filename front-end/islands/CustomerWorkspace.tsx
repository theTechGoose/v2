/**
 * REQ-924 — the customer page (/customers/<id>): one customer, everything on one page, in the main
 * screen of the app's shell. A header with the actions (Send invoice — the one solid primary —,
 * Record payment, New quote, More), the money summary on every tab, and the tabs: Overview, Invoices,
 * Quotes, Payments, Recurring, Jobs, Messages. Every action is the app's own flow, never a copy:
 * the Invoices page's new-invoice form, the payment form, the invoice send sheet, an assistant thread
 * bound to her, the Repeat visits form, the customer form. After an action the page re-reads
 * GET /customers/:id/workspace and tells the sidebar (its rows show what she owes).
 */
import { useEffect, useState } from "preact/hooks";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import {
  type CustomerWorkspace as Workspace,
  customerWorkspaceClient,
  type WorkspaceInvoice,
  type WorkspaceService,
} from "../clients/customer-workspace.ts";
import {
  type Customer,
  dashboardClient,
  type Invoice,
} from "../clients/dashboard.ts";
import { fieldClient } from "../clients/field.ts";
import { assistantClient } from "../clients/assistant.ts";
import { commsClient, type ThreadDetail } from "../clients/communications.ts";
import { toE164 } from "../lib/communications.ts";
import { assistantThreadPath } from "../lib/quote-panel-send.ts";
import { invoiceSendContact } from "../lib/invoice-send-sheet.ts";
import { initialsOf, invoiceFormTarget } from "../lib/customer-nav.ts";
import { CUSTOMERS_CHANGED } from "../components/CustomersNav.tsx";
import Backdrop from "../components/Backdrop.tsx";
import PaymentReceivedForm from "../components/PaymentReceivedForm.tsx";
import InvoiceSendDialog from "../components/InvoiceSendDialog.tsx";
import CustomerFormDialog from "../components/CustomerForm.tsx";
import {
  dispatchFailureCopy,
  dispatchInvoice,
  NewInvoiceModal,
} from "./InvoicesPage.tsx";
import {
  formatPhoneDisplay,
  telHref,
} from "../../shared/quote-flow/format-helpers.ts";

export type WsTab =
  | "overview"
  | "invoices"
  | "quotes"
  | "payments"
  | "recurring"
  | "jobs"
  | "messages";
const TABS: WsTab[] = [
  "overview",
  "invoices",
  "quotes",
  "payments",
  "recurring",
  "jobs",
  "messages",
];

type Modal =
  | { kind: "invoice"; customers: Customer[]; invoices: Invoice[] }
  | { kind: "payment"; invoiceId: string }
  | { kind: "remind"; invoice: WorkspaceInvoice }
  | { kind: "edit" }
  | null;

const money = (cents: number, lang: Lang, whole = false) =>
  new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
    ...(whole ? { maximumFractionDigits: 0, minimumFractionDigits: 0 } : {}),
  }).format(cents / 100);
const day = (iso: string | undefined, lang: Lang) =>
  iso
    ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString(
      lang === "es" ? "es-US" : "en-US",
      {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      },
    )
    : "—";
const weekday = (iso: string, lang: Lang) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString(
    lang === "es" ? "es-US" : "en-US",
    {
      weekday: "short",
      timeZone: "UTC",
    },
  );

function tabFromUrl(): WsTab {
  if (typeof globalThis.location === "undefined") return "overview";
  const t = new URLSearchParams(globalThis.location.search).get("tab");
  return (TABS as string[]).includes(t ?? "") ? (t as WsTab) : "overview";
}

/** the pill for an invoice row */
function invoicePill(
  i: WorkspaceInvoice,
  lang: Lang,
): { text: string; cls: string } {
  if (i.status === "paid") {
    return { text: tFor(lang, "customerWs.state.paid"), cls: "paid" };
  }
  if (i.status === "void") {
    return { text: tFor(lang, "customerWs.state.void"), cls: "draft" };
  }
  if (i.status === "claimed") {
    return { text: tFor(lang, "customerWs.state.claimed"), cls: "part" };
  }
  if (i.overdueDays) {
    return {
      text: tFor(lang, "customerWs.state.overdue", { days: i.overdueDays }),
      cls: "late",
    };
  }
  if (i.state === "draft") {
    return { text: tFor(lang, "customerWs.state.draft"), cls: "draft" };
  }
  if (i.state === "scheduled") {
    return { text: tFor(lang, "customerWs.state.scheduled"), cls: "draft" };
  }
  if (i.paidCents > 0 && i.balanceCents > 0) {
    return { text: tFor(lang, "customerWs.state.partly"), cls: "part" };
  }
  return { text: tFor(lang, "customerWs.state.sent"), cls: "sent" };
}
function quotePill(state: string, lang: Lang): { text: string; cls: string } {
  if (state === "accepted") {
    return { text: tFor(lang, "customerWs.quote.accepted"), cls: "paid" };
  }
  if (state === "declined") {
    return { text: tFor(lang, "customerWs.quote.declined"), cls: "draft" };
  }
  if (state === "draft") {
    return { text: tFor(lang, "customerWs.state.draft"), cls: "draft" };
  }
  return { text: tFor(lang, "customerWs.quote.waiting"), cls: "sent" };
}

export default function CustomerWorkspace(
  { customerId }: { customerId: string },
) {
  const lang = langSignal.value;
  const [ws, setWs] = useState<Workspace | null>(null);
  const [loadErr, setLoadErr] = useState<"missing" | "failed" | null>(null);
  const [tab, setTabState] = useState<WsTab>(tabFromUrl);
  const [modal, setModal] = useState<Modal>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; err?: boolean } | null>(
    null,
  );
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      setWs(await customerWorkspaceClient.get(customerId));
      setLoadErr(null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setLoadErr(status === 404 ? "missing" : "failed");
    }
  }
  useEffect(() => {
    load();
    // REQ-993: a tab you come back to re-checks she still exists (deleted in another tab →
    // "Customer not found" before any click)
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [customerId]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    globalThis.addEventListener("click", close);
    return () => globalThis.removeEventListener("click", close);
  }, [menuOpen]);

  /** re-read the page and the sidebar's rows */
  async function changed(text?: string) {
    await load();
    globalThis.dispatchEvent(new Event(CUSTOMERS_CHANGED));
    if (text) setToast({ text });
  }

  function setTab(t: WsTab) {
    setTabState(t);
    try {
      const url = new URL(globalThis.location.href);
      if (t === "overview") url.searchParams.delete("tab");
      else url.searchParams.set("tab", t);
      globalThis.history.replaceState(
        globalThis.history.state,
        "",
        url.toString(),
      );
    } catch { /* history unavailable — the tab still switches */ }
  }

  if (loadErr === "missing") {
    return (
      <div class="cws-empty" data-cy="cws-missing">
        <h2>{tFor(lang, "customerWs.missing.title")}</h2>
        <p>{tFor(lang, "customerWs.missing.body")}</p>
        <a class="cws-btn cws-btn--outline" href="/customers">
          {tFor(lang, "customerWs.nav.all")}
        </a>
      </div>
    );
  }
  if (!ws) {
    return (
      <div class="cws-empty" data-cy="cws-loading">
        {loadErr
          ? (
            <>
              <p role="alert">{tFor(lang, "customerWs.loadFailed")}</p>
              <button
                type="button"
                class="cws-btn cws-btn--outline"
                onClick={() => load()}
              >
                {tFor(lang, "customerWs.retry")}
              </button>
            </>
          )
          : tFor(lang, "customerWs.loading")}
      </div>
    );
  }

  const c = ws.customer;
  const s = ws.summary;
  const open = ws.invoices.filter((i) => i.balanceCents > 0);
  const mostOverdue =
    [...open].sort((a, b) => (b.overdueDays ?? 0) - (a.overdueDays ?? 0))[0];
  const backHere = `/customers/${encodeURIComponent(c.id)}?tab=recurring`;
  const startServiceHref = `/field/subscriptions?new=1&customerId=${
    encodeURIComponent(c.id)
  }&back=${encodeURIComponent(backHere)}`;

  async function openInvoiceForm() {
    setBusy("invoice");
    try {
      const [customers, invoices] = await Promise.all([
        dashboardClient.customers(),
        dashboardClient.invoices(),
      ]);
      if (invoiceFormTarget(customers, c.id) === "missing") {
        // REQ-993: she was deleted elsewhere — re-read (404 → "Customer not found"), drop her
        // sidebar row, never open a blank form
        await changed();
        return;
      }
      setModal({ kind: "invoice", customers, invoices });
    } catch {
      setToast({ text: tFor(lang, "customerWs.err.generic"), err: true });
    } finally {
      setBusy(null);
    }
  }
  function openPayment(invoiceId?: string) {
    const target = invoiceId ?? mostOverdue?.id ?? open[0]?.id;
    if (!target) {
      setToast({
        text: tFor(lang, "customerWs.nothingOwed", { name: c.name }),
      });
      return;
    }
    setModal({ kind: "payment", invoiceId: target });
  }
  async function newQuote() {
    setBusy("quote");
    try {
      const conv = await assistantClient.startConversation({
        customerId: c.id,
      });
      globalThis.location.assign(assistantThreadPath(conv.id));
    } catch {
      await load(); // REQ-993: deleted elsewhere → "Customer not found"
      setBusy(null);
      setToast({ text: tFor(lang, "customerWs.err.generic"), err: true });
    }
  }
  async function billNow() {
    setBusy("bill");
    try {
      const r = await customerWorkspaceClient.billNow(c.id, ws!.today);
      if (!r) await changed(tFor(lang, "customerWs.bill.nothing"));
      else if (r.failed.length) {
        await changed();
        setToast({ text: tFor(lang, "customerWs.bill.failed"), err: true });
      } else {await changed(
          tFor(lang, "customerWs.bill.sent", { name: c.name }),
        );}
    } catch (err) {
      const status = (err as { status?: number }).status;
      await changed();
      setToast({
        text: tFor(
          lang,
          status === 409 ? "customerWs.bill.zero" : "customerWs.err.generic",
        ),
        err: true,
      });
    } finally {
      setBusy(null);
    }
  }
  async function toggleService(sv: WorkspaceService) {
    setBusy(`svc-${sv.id}`);
    try {
      await fieldClient.updateSubscription(sv.id, { active: !sv.active });
      await changed(
        tFor(
          lang,
          sv.active ? "customerWs.svc.paused" : "customerWs.svc.resumed",
        ),
      );
    } catch {
      setToast({ text: tFor(lang, "customerWs.err.generic"), err: true });
    } finally {
      setBusy(null);
    }
  }

  const counts: Record<WsTab, number | null> = {
    overview: null,
    invoices: ws.invoices.length,
    quotes: ws.quotes.length,
    payments: ws.payments.length,
    recurring: ws.services.length,
    jobs: ws.workOrders.length,
    messages: null,
  };

  return (
    <div class="cws" data-cy="customer-workspace" data-customer={c.id}>
      <header class="cws-hero">
        <div class="cws-av" aria-hidden="true">{initialsOf(c.name)}</div>
        <div class="cws-hero__who">
          <h1 data-cy="cws-name">{c.name}</h1>
          <div class="cws-contact">
            {c.businessName && <span>{c.businessName}</span>}
            {c.phoneNumber && (
              <a href={telHref(c.phoneNumber)} data-cy="cws-phone">
                <I d={ICN.phone} size={13} />{" "}
                {formatPhoneDisplay(c.phoneNumber)}
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`}>
                <I d={ICN.mail} size={13} /> {c.email}
              </a>
            )}
            {c.address && <span>📍 {c.address}</span>}
          </div>
        </div>
        <div class="cws-actions">
          <button
            type="button"
            class="cws-btn cws-btn--primary"
            data-cy="cws-send-invoice"
            disabled={busy === "invoice"}
            onClick={openInvoiceForm}
          >
            <I d={ICN.send} size={15} />{" "}
            {tFor(lang, "customerWs.act.sendInvoice")}
          </button>
          <button
            type="button"
            class="cws-btn cws-btn--outline"
            data-cy="cws-record-payment"
            onClick={() => openPayment()}
          >
            {tFor(lang, "customerWs.act.recordPayment")}
          </button>
          <button
            type="button"
            class="cws-btn cws-btn--outline"
            data-cy="cws-new-quote"
            disabled={busy === "quote"}
            onClick={newQuote}
          >
            {tFor(lang, "customerWs.act.newQuote")}
          </button>
          <div class="cws-more">
            <button
              type="button"
              class="cws-btn cws-btn--ghost"
              data-cy="cws-more"
              aria-expanded={menuOpen}
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((o) => !o);
              }}
            >
              {tFor(lang, "customerWs.act.more")} ▾
            </button>
            {menuOpen && (
              <div class="cws-menu" role="menu" data-cy="cws-menu">
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => setTab("messages")}
                >
                  💬 {tFor(lang, "customerWs.act.text")}
                </button>
                <a
                  role="menuitem"
                  href={startServiceHref}
                  data-cy="cws-start-service"
                >
                  🔁 {tFor(lang, "customerWs.act.startService")}
                </a>
                <button
                  type="button"
                  role="menuitem"
                  data-cy="cws-edit"
                  onClick={() => setModal({ kind: "edit" })}
                >
                  ✏️ {tFor(lang, "customerWs.act.edit")}
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <nav class="cws-tabs" role="tablist">
        {TABS.map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            class={`cws-tab ${tab === t ? "cws-tab--on" : ""}`}
            data-cy={`cws-tab-${t}`}
            onClick={() => setTab(t)}
          >
            {tFor(lang, `customerWs.tab.${t}`)}
            {counts[t] != null && <span class="cws-tab__n">{counts[t]}</span>}
          </button>
        ))}
      </nav>

      <div class="cws-body">
        <section class="cws-money" data-cy="cws-money">
          <div
            class={`cws-kpi cws-kpi--owes ${
              s.owedCents > 0 ? "" : "cws-kpi--clear"
            }`}
            data-cy="cws-owed"
          >
            <div class="cws-kpi__lbl">
              {tFor(
                lang,
                s.owedCents > 0
                  ? "customerWs.kpi.owes"
                  : "customerWs.kpi.balance",
              )}
            </div>
            <div class="cws-kpi__row">
              <div class="cws-kpi__val" data-cy="cws-owed-amount">
                {s.owedCents > 0
                  ? money(s.owedCents, lang)
                  : tFor(lang, "customerWs.kpi.paidUp")}
              </div>
              {mostOverdue && (
                <button
                  type="button"
                  class="cws-btn cws-btn--light cws-btn--sm"
                  data-cy="cws-remind"
                  onClick={() =>
                    setModal({ kind: "remind", invoice: mostOverdue })}
                >
                  <I d={ICN.bell} size={13} />{" "}
                  {tFor(lang, "customerWs.act.remind")}
                </button>
              )}
            </div>
            <div class="cws-kpi__hint">
              {s.overdueCents > 0
                ? tFor(lang, "customerWs.kpi.overdue", {
                  amount: money(s.overdueCents, lang),
                })
                : s.owedCents > 0
                ? tFor(lang, "customerWs.kpi.notOverdue")
                : tFor(lang, "customerWs.kpi.noBalance")}
            </div>
            {s.owedCents > 0 && (
              <div class="cws-bar">
                <i
                  style={`width:${
                    Math.min(
                      100,
                      Math.round((s.overdueCents / s.owedCents) * 100),
                    )
                  }%`}
                />
              </div>
            )}
          </div>
          <div class="cws-kpi" data-cy="cws-billed">
            <div class="cws-kpi__lbl">
              {tFor(lang, "customerWs.kpi.billed")}
            </div>
            <div class="cws-kpi__val">{money(s.billedCents, lang, true)}</div>
            <div class="cws-kpi__hint">
              {tFor(lang, "customerWs.kpi.invoices", {
                count: ws.invoices.filter((i) =>
                  i.state !== "draft" && i.status !== "void"
                ).length,
              })}
            </div>
          </div>
          <div class="cws-kpi" data-cy="cws-paid">
            <div class="cws-kpi__lbl">{tFor(lang, "customerWs.kpi.paid")}</div>
            <div class="cws-kpi__val cws-kpi__val--green">
              {money(s.paidCents, lang, true)}
            </div>
            <div class="cws-kpi__hint">
              {s.lastPayment
                ? tFor(lang, "customerWs.kpi.lastPayment", {
                  date: day(s.lastPayment.receivedAt, lang),
                  method: tFor(
                    lang,
                    `customerWs.method.${s.lastPayment.method}`,
                  ),
                })
                : tFor(lang, "customerWs.kpi.noPayments")}
            </div>
          </div>
          <button
            type="button"
            class="cws-kpi cws-kpi--link"
            data-cy="cws-recurring"
            onClick={() => setTab("recurring")}
          >
            <div class="cws-kpi__lbl">
              {tFor(lang, "customerWs.kpi.recurring")}
            </div>
            <div class="cws-kpi__val">
              {s.activeServices > 0
                ? (
                  <>
                    {money(s.recurringMonthlyCents, lang, true)}
                    <small>{tFor(lang, "customerWs.perMonth")}</small>
                  </>
                )
                : "—"}
            </div>
            <div class="cws-kpi__hint">
              {s.activeServices > 0
                ? tFor(lang, "customerWs.kpi.nextVisit", {
                  count: s.activeServices,
                  date: day(s.nextVisit, lang),
                })
                : ws.services.length
                ? tFor(lang, "customerWs.kpi.paused")
                : tFor(lang, "customerWs.kpi.noService")}
              {s.unbilledCents > 0 && (
                <b class="cws-amber">
                  {" · "}
                  {tFor(lang, "customerWs.kpi.unbilled", {
                    amount: money(s.unbilledCents, lang, true),
                  })}
                </b>
              )}
            </div>
          </button>
          <div class="cws-kpi" data-cy="cws-quotes">
            <div class="cws-kpi__lbl">
              {tFor(lang, "customerWs.kpi.openQuotes")}
            </div>
            <div class="cws-kpi__val">
              {money(s.openQuotesCents, lang, true)}
            </div>
            <div class="cws-kpi__hint">
              {s.openQuotes > 0
                ? tFor(lang, "customerWs.kpi.waiting", { count: s.openQuotes })
                : tFor(lang, "customerWs.kpi.noneWaiting")}
            </div>
          </div>
        </section>

        {tab === "overview" && (
          <div class="cws-grid">
            <div>
              <div class="cws-card">
                <div class="cws-card__hd">
                  <h3>{tFor(lang, "customerWs.ov.unpaid")}</h3>
                  <button
                    type="button"
                    class="cws-btn cws-btn--ghost cws-btn--sm"
                    onClick={() => setTab("invoices")}
                  >
                    {tFor(lang, "customerWs.ov.allInvoices")} →
                  </button>
                </div>
                <InvoiceTable
                  rows={open}
                  lang={lang}
                  compact
                  onPay={(id) => openPayment(id)}
                  onRemind={(inv) => setModal({ kind: "remind", invoice: inv })}
                  onNew={openInvoiceForm}
                />
              </div>
              <div class="cws-card">
                <div class="cws-card__hd">
                  <h3>{tFor(lang, "customerWs.ov.services")}</h3>
                  <button
                    type="button"
                    class="cws-btn cws-btn--ghost cws-btn--sm"
                    onClick={() => setTab("recurring")}
                  >
                    {tFor(lang, "customerWs.ov.manage")} →
                  </button>
                </div>
                {ws.services.length
                  ? ws.services.map((sv) => (
                    <ServiceCard
                      key={sv.id}
                      sv={sv}
                      ws={ws}
                      lang={lang}
                      compact
                      busy={busy}
                      onBill={billNow}
                      onToggle={toggleService}
                    />
                  ))
                  : (
                    <div class="cws-none">
                      {tFor(lang, "customerWs.svc.none")}
                      <a
                        class="cws-btn cws-btn--outline cws-btn--sm"
                        href={startServiceHref}
                      >
                        {tFor(lang, "customerWs.act.startService")}
                      </a>
                    </div>
                  )}
              </div>
              <div class="cws-card">
                <div class="cws-card__hd">
                  <h3>{tFor(lang, "customerWs.ov.openQuotes")}</h3>
                  <button
                    type="button"
                    class="cws-btn cws-btn--ghost cws-btn--sm"
                    onClick={() => setTab("quotes")}
                  >
                    {tFor(lang, "customerWs.ov.allQuotes")} →
                  </button>
                </div>
                <QuoteTable
                  rows={ws.quotes.filter((q) =>
                    q.state !== "accepted" && q.state !== "declined"
                  )}
                  lang={lang}
                  onNew={newQuote}
                />
              </div>
            </div>
            <div>
              <div class="cws-card cws-info">
                <div class="cws-card__hd">
                  <h3>{tFor(lang, "customerWs.ov.details")}</h3>
                  <button
                    type="button"
                    class="cws-btn cws-btn--ghost cws-btn--sm"
                    onClick={() => setModal({ kind: "edit" })}
                  >
                    {tFor(lang, "customerWs.act.editShort")}
                  </button>
                </div>
                <dl>
                  <dt>{tFor(lang, "customerForm.phone")}</dt>
                  <dd>
                    {c.phoneNumber ? formatPhoneDisplay(c.phoneNumber) : "—"}
                  </dd>
                  <dt>{tFor(lang, "customerForm.email")}</dt>
                  <dd>{c.email || "—"}</dd>
                  <dt>{tFor(lang, "customerWs.ov.address")}</dt>
                  <dd>{c.address || "—"}</dd>
                  <dt>{tFor(lang, "customerWs.ov.language")}</dt>
                  <dd>
                    {c.language
                      ? tFor(lang, `customerWs.lang.${c.language}`)
                      : "—"}
                  </dd>
                  {c.number && (
                    <>
                      <dt>{tFor(lang, "customerWs.ov.number")}</dt>
                      <dd>{c.number}</dd>
                    </>
                  )}
                  <dt>{tFor(lang, "customerWs.ov.since")}</dt>
                  <dd>{day(c.createdAt, lang)} {c.createdAt.slice(0, 4)}</dd>
                </dl>
                {c.notes && (
                  <p class="cws-notes" data-cy="cws-notes">{c.notes}</p>
                )}
              </div>
              <div class="cws-card">
                <div class="cws-card__hd">
                  <h3>{tFor(lang, "customerWs.ov.activity")}</h3>
                </div>
                <Activity ws={ws} lang={lang} />
              </div>
            </div>
          </div>
        )}

        {tab === "invoices" && (
          <div class="cws-card">
            <div class="cws-card__hd">
              <h3>{tFor(lang, "customerWs.tab.invoices")}</h3>
              <button
                type="button"
                class="cws-btn cws-btn--outline cws-btn--sm"
                onClick={openInvoiceForm}
              >
                + {tFor(lang, "customerWs.act.newInvoice")}
              </button>
            </div>
            <InvoiceTable
              rows={ws.invoices}
              lang={lang}
              onPay={(id) => openPayment(id)}
              onRemind={(inv) => setModal({ kind: "remind", invoice: inv })}
              onNew={openInvoiceForm}
            />
          </div>
        )}

        {tab === "quotes" && (
          <div class="cws-card">
            <div class="cws-card__hd">
              <h3>{tFor(lang, "customerWs.tab.quotes")}</h3>
              <button
                type="button"
                class="cws-btn cws-btn--outline cws-btn--sm"
                onClick={newQuote}
              >
                + {tFor(lang, "customerWs.act.newQuote")}
              </button>
            </div>
            <QuoteTable rows={ws.quotes} lang={lang} onNew={newQuote} />
          </div>
        )}

        {tab === "payments" && (
          <div class="cws-card">
            <div class="cws-card__hd">
              <h3>{tFor(lang, "customerWs.pay.title")}</h3>
              <button
                type="button"
                class="cws-btn cws-btn--outline cws-btn--sm"
                onClick={() => openPayment()}
              >
                + {tFor(lang, "customerWs.act.recordPayment")}
              </button>
            </div>
            {ws.payments.length
              ? (
                <table class="cws-table" data-cy="cws-payments">
                  <thead>
                    <tr>
                      <th>{tFor(lang, "customerWs.col.date")}</th>
                      <th>{tFor(lang, "customerWs.col.for")}</th>
                      <th>{tFor(lang, "customerWs.col.method")}</th>
                      <th class="num">{tFor(lang, "customerWs.col.amount")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ws.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{day(p.receivedAt, lang)}</td>
                        <td class="cws-doc">
                          <a href={`/i/${p.invoiceId}`}>{p.invoiceNumber}</a>
                          {p.reference && <small>{p.reference}</small>}
                        </td>
                        <td>{tFor(lang, `customerWs.method.${p.method}`)}</td>
                        <td class="num">
                          <b>{money(p.amountCents, lang)}</b>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
              : <div class="cws-none">{tFor(lang, "customerWs.pay.none")}</div>}
          </div>
        )}

        {tab === "recurring" && (
          <>
            <div class="cws-card__hd cws-card__hd--bare">
              <h3>{tFor(lang, "customerWs.ov.services")}</h3>
              <a
                class="cws-btn cws-btn--outline cws-btn--sm"
                href={startServiceHref}
              >
                + {tFor(lang, "customerWs.act.newService")}
              </a>
            </div>
            {ws.services.length
              ? ws.services.map((sv) => (
                <ServiceCard
                  key={sv.id}
                  sv={sv}
                  ws={ws}
                  lang={lang}
                  busy={busy}
                  onBill={billNow}
                  onToggle={toggleService}
                />
              ))
              : (
                <div class="cws-card cws-none">
                  {tFor(lang, "customerWs.svc.noneLong")}
                  <a
                    class="cws-btn cws-btn--outline cws-btn--sm"
                    href={startServiceHref}
                  >
                    {tFor(lang, "customerWs.act.startService")}
                  </a>
                </div>
              )}
            <div class="cws-card">
              <div class="cws-card__hd">
                <h3>{tFor(lang, "customerWs.visits.title")}</h3>
              </div>
              {ws.visits.length
                ? (
                  <table class="cws-table" data-cy="cws-visits">
                    <thead>
                      <tr>
                        <th>{tFor(lang, "customerWs.col.date")}</th>
                        <th>{tFor(lang, "customerWs.col.service")}</th>
                        <th>{tFor(lang, "customerWs.col.crew")}</th>
                        <th>{tFor(lang, "customerWs.col.status")}</th>
                        <th class="num">
                          {tFor(lang, "customerWs.col.price")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {ws.visits.map((v) => {
                        const pill = v.status === "skipped"
                          ? {
                            text: tFor(lang, "customerWs.visit.skipped"),
                            cls: "draft",
                          }
                          : v.status === "complete"
                          ? v.unbilled
                            ? {
                              text: tFor(lang, "customerWs.visit.unbilled"),
                              cls: "part",
                            }
                            : {
                              text: tFor(lang, "customerWs.visit.billed", {
                                number: v.invoiceNumber ?? "",
                              }),
                              cls: "paid",
                            }
                          : {
                            text: tFor(lang, "customerWs.visit.scheduled"),
                            cls: "sent",
                          };
                        return (
                          <tr key={v.id}>
                            <td>{day(v.date, lang)}</td>
                            <td class="cws-doc">{v.taskTypeName}</td>
                            <td>{v.workerName || "—"}</td>
                            <td>
                              <span class={`cws-pill cws-pill--${pill.cls}`}>
                                {pill.text}
                              </span>
                            </td>
                            <td class="num">
                              {v.status === "skipped"
                                ? "—"
                                : money(v.priceCents, lang)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )
                : (
                  <div class="cws-none">
                    {tFor(lang, "customerWs.visits.none")}
                  </div>
                )}
            </div>
          </>
        )}

        {tab === "jobs" && (
          <div class="cws-card">
            <div class="cws-card__hd">
              <h3>{tFor(lang, "customerWs.jobs.title")}</h3>
              <a
                class="cws-btn cws-btn--outline cws-btn--sm"
                href="/work-orders?new=1"
              >
                + {tFor(lang, "customerWs.jobs.new")}
              </a>
            </div>
            {ws.workOrders.length
              ? (
                <table class="cws-table" data-cy="cws-jobs">
                  <thead>
                    <tr>
                      <th>{tFor(lang, "customerWs.col.workOrder")}</th>
                      <th>{tFor(lang, "customerWs.col.date")}</th>
                      <th>{tFor(lang, "customerWs.col.status")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ws.workOrders.map((w) => (
                      <tr key={w.id}>
                        <td class="cws-doc">
                          <a href={w.url}>{w.number}</a>
                          <small>{w.description}</small>
                        </td>
                        <td>{day(w.scheduledFor ?? w.updatedAt, lang)}</td>
                        <td>
                          <span class="cws-pill cws-pill--sent">
                            {w.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )
              : (
                <div class="cws-none">{tFor(lang, "customerWs.jobs.none")}</div>
              )}
          </div>
        )}

        {tab === "messages" && <Messages phone={c.phoneNumber} lang={lang} />}
      </div>

      {modal?.kind === "invoice" && (
        <NewInvoiceModal
          customers={modal.customers}
          invoices={modal.invoices}
          lang={lang}
          customerId={c.id}
          onClose={() => setModal(null)}
        />
      )}
      {modal?.kind === "payment" && (
        <Backdrop
          onClose={() => setModal(null)}
          class="cws-scrim"
        >
          <section
            class="cws-sheet"
            role="dialog"
            aria-modal="true"
            data-cy="cws-payment-sheet"
            onClick={(e) => e.stopPropagation()}
          >
            <h2>{tFor(lang, "customerWs.act.recordPayment")}</h2>
            <label class="cws-field">
              {tFor(lang, "customerWs.pay.forInvoice")}
              <select
                data-cy="cws-payment-invoice"
                value={modal.invoiceId}
                onChange={(e) =>
                  setModal({
                    kind: "payment",
                    invoiceId: (e.currentTarget as HTMLSelectElement).value,
                  })}
              >
                {open.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.number}
                    {i.title ? ` · ${i.title}` : ""} ·{" "}
                    {tFor(lang, "customerWs.pay.owes", {
                      amount: money(i.balanceCents, lang),
                    })}
                  </option>
                ))}
              </select>
            </label>
            {(() => {
              const inv = ws.invoices.find((i) => i.id === modal.invoiceId);
              return inv
                ? (
                  <PaymentReceivedForm
                    key={inv.id}
                    invoiceId={inv.id}
                    amountCents={inv.amountCents}
                    paidCents={inv.paidCents}
                    lang={lang}
                    onCancel={() => setModal(null)}
                    onSaved={async (cents) => {
                      setModal(null);
                      await changed(tFor(lang, "customerWs.pay.recorded", {
                        amount: money(cents, lang),
                        number: inv.number,
                      }));
                    }}
                  />
                )
                : null;
            })()}
          </section>
        </Backdrop>
      )}
      {modal?.kind === "remind" && (
        <InvoiceSendDialog
          lang={lang}
          invoice={{ id: modal.invoice.id, number: modal.invoice.number }}
          customer={invoiceSendContact({ customerId: c.id }, c)}
          onCancel={() => setModal(null)}
          onSend={async (pick) => {
            const inv = modal.invoice;
            const d = await dispatchInvoice(inv.id, {
              ...pick,
              hasCustomer: true,
            });
            setModal(null);
            if (d.delivered) {
              await changed(
                tFor(lang, "customerWs.remind.sent", { number: inv.number }),
              );
            } else {setToast({
                text: dispatchFailureCopy(lang, d, { number: inv.number }),
                err: true,
              });}
          }}
        />
      )}
      {modal?.kind === "edit" && (
        <CustomerFormDialog
          mode="edit"
          lang={lang}
          customer={c}
          onClose={() => setModal(null)}
          onSaved={async () => {
            setModal(null);
            await changed(tFor(lang, "customerWs.saved"));
          }}
        />
      )}
      {toast && (
        <div
          class={`cws-toast ${toast.err ? "cws-toast--err" : ""}`}
          role="status"
          data-cy="cws-toast"
        >
          {toast.text}
        </div>
      )}
    </div>
  );
}

function InvoiceTable(
  { rows, lang, compact, onPay, onRemind, onNew }: {
    rows: WorkspaceInvoice[];
    lang: Lang;
    compact?: boolean;
    onPay: (id: string) => void;
    onRemind: (inv: WorkspaceInvoice) => void;
    onNew: () => void;
  },
) {
  if (!rows.length) {
    return (
      <div class="cws-none">
        {tFor(
          lang,
          compact ? "customerWs.inv.nothingUnpaid" : "customerWs.inv.none",
        )}
        <button
          type="button"
          class="cws-btn cws-btn--outline cws-btn--sm"
          onClick={onNew}
        >
          {tFor(lang, "customerWs.act.sendInvoice")}
        </button>
      </div>
    );
  }
  return (
    <table class="cws-table" data-cy={compact ? "cws-unpaid" : "cws-invoices"}>
      <thead>
        <tr>
          <th>{tFor(lang, "customerWs.col.invoice")}</th>
          {!compact && <th>{tFor(lang, "customerWs.col.sent")}</th>}
          <th>{tFor(lang, "customerWs.col.due")}</th>
          <th>{tFor(lang, "customerWs.col.status")}</th>
          <th class="num">{tFor(lang, "customerWs.col.total")}</th>
          <th class="num">{tFor(lang, "customerWs.col.balance")}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((i) => {
          const pill = invoicePill(i, lang);
          return (
            <tr key={i.id} data-cy="cws-invoice-row" data-id={i.id}>
              <td class="cws-doc">
                <a href={i.url}>{i.number}</a>
                {i.title && <small>{i.title}</small>}
              </td>
              {!compact && <td>{day(i.issuedDate, lang)}</td>}
              <td>{day(i.dueDate, lang)}</td>
              <td>
                <span class={`cws-pill cws-pill--${pill.cls}`}>
                  {pill.text}
                </span>
              </td>
              <td class="num">{money(i.amountCents, lang)}</td>
              <td class="num">
                <b>{i.balanceCents ? money(i.balanceCents, lang) : "—"}</b>
              </td>
              <td>
                <div class="cws-rowact">
                  {i.balanceCents > 0
                    ? (
                      <>
                        <button
                          type="button"
                          class="cws-btn cws-btn--outline cws-btn--sm"
                          onClick={() => onRemind(i)}
                        >
                          {tFor(lang, "customerWs.act.remind")}
                        </button>
                        <button
                          type="button"
                          class="cws-btn cws-btn--outline cws-btn--sm"
                          data-cy="cws-mark-paid"
                          onClick={() =>
                            onPay(i.id)}
                        >
                          {tFor(lang, "customerWs.act.markPaid")}
                        </button>
                      </>
                    )
                    : (
                      <a
                        class="cws-btn cws-btn--ghost cws-btn--sm"
                        href={`/invoices?open=${i.id}`}
                      >
                        {tFor(lang, "customerWs.act.open")}
                      </a>
                    )}
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function QuoteTable(
  { rows, lang, onNew }: {
    rows: Workspace["quotes"];
    lang: Lang;
    onNew: () => void;
  },
) {
  if (!rows.length) {
    return (
      <div class="cws-none">
        {tFor(lang, "customerWs.quote.none")}
        <button
          type="button"
          class="cws-btn cws-btn--outline cws-btn--sm"
          onClick={onNew}
        >
          {tFor(lang, "customerWs.act.newQuote")}
        </button>
      </div>
    );
  }
  return (
    <table class="cws-table" data-cy="cws-quote-table">
      <thead>
        <tr>
          <th>{tFor(lang, "customerWs.col.quote")}</th>
          <th>{tFor(lang, "customerWs.col.date")}</th>
          <th>{tFor(lang, "customerWs.col.status")}</th>
          <th class="num">{tFor(lang, "customerWs.col.total")}</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {rows.map((q) => {
          const pill = quotePill(q.state, lang);
          return (
            <tr key={q.id}>
              <td class="cws-doc">
                <a href={q.url}>{q.number}</a>
                {q.title && <small>{q.title}</small>}
              </td>
              <td>{day(q.updatedAt, lang)}</td>
              <td>
                <span class={`cws-pill cws-pill--${pill.cls}`}>
                  {pill.text}
                </span>
              </td>
              <td class="num">{money(q.amountCents, lang)}</td>
              <td>
                <div class="cws-rowact">
                  <a class="cws-btn cws-btn--outline cws-btn--sm" href={q.url}>
                    {tFor(lang, "customerWs.act.open")}
                  </a>
                </div>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ServiceCard(
  { sv, ws, lang, compact, busy, onBill, onToggle }: {
    sv: WorkspaceService;
    ws: Workspace;
    lang: Lang;
    compact?: boolean;
    busy: string | null;
    onBill: () => void;
    onToggle: (sv: WorkspaceService) => void;
  },
) {
  const name = sv.items.map((i) => i.taskTypeName).join(" + ") ||
    tFor(lang, "customerWs.svc.untitled");
  const past = ws.visits.filter((v) =>
    v.subscriptionId === sv.id && v.date < ws.today
  ).slice(0, 3).reverse();
  const editHref = `/field/subscriptions?edit=${
    encodeURIComponent(sv.id)
  }&back=${
    encodeURIComponent(
      `/customers/${encodeURIComponent(ws.customer.id)}?tab=recurring`,
    )
  }`;
  return (
    <div
      class={`cws-svc ${sv.active ? "" : "cws-svc--paused"}`}
      data-cy="cws-service"
      data-id={sv.id}
    >
      <div class="cws-svc__hd">
        <span class="cws-svc__icon">
          <I d={ICN.repeat} size={16} />
        </span>
        <div class="cws-svc__who">
          <div class="cws-svc__name">{name}</div>
          <div class="cws-svc__sub">
            {sv.schedule[lang]} · 📍 {sv.address}
            {!sv.active && (
              <span class="cws-pill cws-pill--draft">
                {tFor(lang, "customerWs.svc.pausedPill")}
              </span>
            )}
          </div>
        </div>
        <div class="cws-svc__price">
          {money(sv.perVisitCents, lang)}
          <small>
            {tFor(lang, "customerWs.svc.perVisit", {
              month: money(sv.monthlyCents, lang, true),
            })}
          </small>
        </div>
      </div>
      {!compact && (
        <div class="cws-chips">
          {sv.items.map((i) => (
            <span key={i.taskTypeId}>
              {i.taskTypeName} <b>{money(i.priceCents, lang)}</b>
            </span>
          ))}
          {
            /* no terms of its own: the account's days to pay apply — not said here */
          }
          {sv.netDays != null && (
            <span>
              {tFor(lang, "customerWs.svc.terms")}{" "}
              <b>
                {sv.netDays
                  ? tFor(lang, "customerWs.svc.net", { days: sv.netDays })
                  : tFor(lang, "customerWs.svc.onReceipt")}
              </b>
            </span>
          )}
          {sv.quoteNumber && (
            <span>
              {tFor(lang, "customerWs.svc.fromQuote")} <b>{sv.quoteNumber}</b>
            </span>
          )}
        </div>
      )}
      {(sv.active || !compact) && (
        <div class="cws-visits">
          {!compact &&
            past.map((v) => (
              <span
                key={v.id}
                class={`cws-vis cws-vis--${
                  v.status === "skipped"
                    ? "skip"
                    : v.status === "complete"
                    ? "done"
                    : "plan"
                }`}
              >
                <b>{day(v.date, lang)}</b>
                {v.status === "skipped"
                  ? tFor(lang, "customerWs.visit.skippedShort")
                  : v.unbilled
                  ? tFor(lang, "customerWs.visit.doneShort")
                  : tFor(lang, "customerWs.visit.billedShort")}
              </span>
            ))}
          {sv.nextVisits.slice(0, compact ? 3 : 5).map((d) => (
            <span
              key={d}
              class={`cws-vis ${d === ws.today ? "cws-vis--today" : ""}`}
              data-cy="cws-next-visit"
            >
              <b>
                {d === ws.today
                  ? tFor(lang, "customerWs.visit.today")
                  : day(d, lang)}
              </b>
              {weekday(d, lang)}
            </span>
          ))}
          {sv.active && !sv.nextVisits.length && (
            <span class="cws-muted">
              {tFor(lang, "customerWs.visit.noneAhead")}
            </span>
          )}
        </div>
      )}
      <div class="cws-svc__ft">
        {sv.unbilledVisits > 0
          ? (
            <div class="cws-unbilled" data-cy="cws-unbilled">
              {tFor(lang, "customerWs.svc.unbilled", {
                count: sv.unbilledVisits,
                amount: money(sv.unbilledCents, lang),
              })}
              <button
                type="button"
                class="cws-btn cws-btn--outline cws-btn--sm"
                data-cy="cws-bill-now"
                disabled={busy === "bill"}
                onClick={onBill}
              >
                {tFor(lang, "customerWs.svc.billNow")}
              </button>
            </div>
          )
          : <span class="cws-grow" />}
        {!compact && (
          <a class="cws-btn cws-btn--ghost cws-btn--sm" href={editHref}>
            {tFor(lang, "customerWs.act.editShort")}
          </a>
        )}
        <button
          type="button"
          class="cws-btn cws-btn--ghost cws-btn--sm"
          data-cy="cws-service-toggle"
          disabled={busy === `svc-${sv.id}`}
          onClick={() => onToggle(sv)}
        >
          {tFor(
            lang,
            sv.active ? "customerWs.svc.pause" : "customerWs.svc.resume",
          )}
        </button>
      </div>
    </div>
  );
}

function Activity({ ws, lang }: { ws: Workspace; lang: Lang }) {
  const items = [
    ...ws.payments.map((p) => ({
      when: p.receivedAt,
      icon: "💵",
      text: tFor(lang, "customerWs.act.paid", {
        amount: money(p.amountCents, lang),
        number: p.invoiceNumber,
      }),
    })),
    ...ws.invoices.filter((i) => i.issuedDate).map((i) => ({
      when: i.issuedDate!,
      icon: "🧾",
      text: tFor(lang, "customerWs.act.invoiced", {
        number: i.number,
        amount: money(i.amountCents, lang),
      }),
    })),
    ...ws.quotes.map((q) => ({
      when: q.updatedAt,
      icon: "📝",
      text: tFor(
        lang,
        `customerWs.act.quote.${
          q.state === "accepted"
            ? "accepted"
            : q.state === "draft"
            ? "draft"
            : "sent"
        }`,
        {
          number: q.number,
        },
      ),
    })),
    ...ws.visits.filter((v) => v.status === "complete").map((v) => ({
      when: v.date,
      icon: "🔁",
      text: tFor(
        lang,
        v.unbilled ? "customerWs.act.visitUnbilled" : "customerWs.act.visit",
        { service: v.taskTypeName },
      ),
    })),
  ].sort((a, b) => b.when.localeCompare(a.when)).slice(0, 8);
  if (!items.length) {
    return <div class="cws-none">{tFor(lang, "customerWs.act.none")}</div>;
  }
  return (
    <ul class="cws-timeline" data-cy="cws-activity">
      {items.map((a, n) => (
        <li key={n}>
          <span class="cws-dot" aria-hidden="true">{a.icon}</span>
          <div>
            <div>{a.text}</div>
            <div class="cws-muted">{day(a.when, lang)}</div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/** the phone thread with the customer (REQ-906 Phone page's API); a link to get a line when there is none */
function Messages({ phone, lang }: { phone?: string; lang: Lang }) {
  const peer = phone ? toE164(phone) : null;
  const [state, setState] = useState<"loading" | "noLine" | "ready" | "failed">(
    "loading",
  );
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  async function load() {
    if (!peer) return;
    try {
      const { line } = await commsClient.line();
      if (!line) {
        setState("noLine");
        return;
      }
      setDetail(await commsClient.thread(peer).catch(() => null));
      setState("ready");
    } catch (err) {
      setState(
        (err as { status?: number }).status === 409 ? "noLine" : "failed",
      );
    }
  }
  useEffect(() => {
    load();
  }, [peer]);

  if (!peer) {
    return (
      <div class="cws-card cws-none">
        {tFor(lang, "customerWs.msg.noPhone")}
      </div>
    );
  }
  if (state === "loading") {
    return (
      <div class="cws-card cws-none">{tFor(lang, "customerWs.loading")}</div>
    );
  }
  if (state === "noLine") {
    return (
      <div class="cws-card cws-none" data-cy="cws-msg-noline">
        {tFor(lang, "customerWs.msg.noLine")}
        <a class="cws-btn cws-btn--outline cws-btn--sm" href="/communications">
          {tFor(lang, "customerWs.msg.getLine")}
        </a>
      </div>
    );
  }
  if (state === "failed") {
    return (
      <div class="cws-card cws-none" role="alert">
        {tFor(lang, "customerWs.loadFailed")}
      </div>
    );
  }
  const texts = detail?.texts ?? [];
  return (
    <div class="cws-card" data-cy="cws-messages">
      <ul class="cws-thread">
        {texts.length === 0 && (
          <li class="cws-muted">{tFor(lang, "customerWs.msg.none")}</li>
        )}
        {texts.map((m) => (
          <li
            key={m.id}
            class={`cws-msg cws-msg--${
              m.direction === "outbound" ? "out" : "in"
            }`}
          >
            <div>{m.body}</div>
            <div class="cws-muted">{day(m.createdAt, lang)}</div>
          </li>
        ))}
      </ul>
      <form
        class="cws-compose"
        onSubmit={async (e) => {
          e.preventDefault();
          const body = draft.trim();
          if (!body || sending) return;
          setSending(true);
          try {
            await commsClient.sendText(peer, body);
            setDraft("");
            await load();
          } finally {
            setSending(false);
          }
        }}
      >
        <input
          value={draft}
          placeholder={tFor(lang, "customerWs.msg.placeholder")}
          onInput={(e) => setDraft((e.currentTarget as HTMLInputElement).value)}
        />
        <button
          type="submit"
          class="cws-btn cws-btn--primary cws-btn--sm"
          disabled={sending || !draft.trim()}
        >
          {tFor(lang, "customerWs.msg.send")}
        </button>
      </form>
    </div>
  );
}
