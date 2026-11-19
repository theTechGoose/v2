/**
 * REQ-924 — the customer page (/customers/<id>): one customer, everything on one page, in the main
 * screen of the app's shell. A header with the actions (Send invoice — the one solid primary —,
 * Record payment, New quote, More), the money summary on every tab, and the tabs: Overview, Invoices,
 * Quotes, Payments, Recurring, Jobs, Messages. Every action is the app's own flow, never a copy:
 * the Invoices page's new-invoice form, the payment form, the invoice send sheet, an assistant thread
 * bound to her, the Repeat visits form, the customer form. After an action the page re-reads
 * GET /customers/:id/workspace and tells the sidebar (its rows show what she owes).
 */
import { useEffect, useRef, useState } from "preact/hooks";
import { type Lang, langSignal, tFor } from "../lib/i18n.ts";
import { I, ICN } from "../lib/dash-icons.tsx";
import { Icon } from "../components/ui/Icon.tsx";
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
import { clientsClient } from "../clients/clients.ts";
import { assistantClient } from "../clients/assistant.ts";
import { commsClient, type ThreadDetail } from "../clients/communications.ts";
import { outboxClient, type OutboxRow } from "../clients/outbox.ts";
import {
  outboxChannelLabel,
  outboxLanguageLabel,
  outboxOpenHref,
  outboxStatusLabel,
  outboxWhat,
  outboxWhy,
} from "../lib/outbox.ts";
import { toE164 } from "../lib/communications.ts";
import { fmtDayYear } from "../lib/format.ts";
import { assistantThreadPath } from "../lib/quote-panel-send.ts";
import { sendInvoiceNudge } from "../lib/invoice-nudge.ts";
import { initialsOf, invoiceFormTarget } from "../lib/customer-nav.ts";
import { isIssuedState, zeroBalanceKey } from "../lib/clients-display.ts";
import { isPartlyPaid } from "../lib/invoice-status-pill.ts"; // REQ-1073
import { CUSTOMERS_CHANGED } from "../components/CustomersNav.tsx";
import {
  type DeleteOwes,
  owesAskVars,
  owesFromError,
  owesFromInvoices,
} from "../lib/customer-delete-owes.ts"; // REQ-1138
import Backdrop from "../components/Backdrop.tsx";
import PaymentReceivedForm from "../components/PaymentReceivedForm.tsx";
import InvoiceNudgeDialog from "../components/InvoiceNudgeDialog.tsx";
import CustomerFormDialog from "../components/CustomerForm.tsx";
import { NewInvoiceModal } from "./InvoicesPage.tsx";
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

const money = (cents: number, lang: Lang) =>
  new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
  }).format(cents / 100);
/** REQ-1072 (q2-61): a KPI total — owes, billed, paid, recurring, unbilled,
 *  open quotes — follows REQ-961's fmtMoneyTotal rule: whole dollars only
 *  when the total is whole ("$2,400"), to the cent otherwise ("$1,190.75"),
 *  so FACTURADO never reads "$1,191" beside a TE DEBE of "$1,190.75". */
const moneyTotal = (cents: number, lang: Lang) =>
  new Intl.NumberFormat(lang === "es" ? "es-US" : "en-US", {
    style: "currency",
    currency: "USD",
    ...(Math.round(cents) % 100 === 0 ? { minimumFractionDigits: 0 } : {}),
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
/**
 * REQ-1037 q2-21 (amending REQ-944): the day an instant (a sent message, a
 * text) happened, in the business's zone — `day()` above is for calendar
 * dates and reads the UTC date off the ISO string, so a 9 PM Central text
 * showed as tomorrow.
 */
const instantDay = (iso: string | undefined, lang: Lang, timeZone?: string) => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(+d)) return "—";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  try {
    return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", {
      ...opts,
      ...(timeZone ? { timeZone } : {}),
    });
  } catch { // an unknown zone — the device's day
    return d.toLocaleDateString(lang === "es" ? "es-US" : "en-US", opts);
  }
};
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
  // REQ-1073: the one partly-paid rule /invoices, search and /i read too
  if (
    isPartlyPaid({
      status: i.status,
      paidCents: i.paidCents,
      amount: i.amountCents,
    })
  ) {
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
  { customerId, timeZone }: {
    customerId: string;
    /** REQ-1037: the account's businessTimezone — message days follow it */
    timeZone?: string;
  },
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
  // REQ-1075: More → Delete customer asks inline (REQ-802's question, Delete / Keep)
  const [askDelete, setAskDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  // REQ-1108: does the business have a phone line? null = still asking. The More menu's text item
  // follows it (and the customer's phone) instead of always offering "Send a text"; a 409 (no
  // line) or any failure reads as "no line", quietly.
  const [hasLine, setHasLine] = useState<boolean | null>(null);
  // REQ-1108: bumped by More → Send a text; the Messages tab scrolls into view and focuses the composer
  const [landMessages, setLandMessages] = useState(0);
  // REQ-1138 (q3-69): what she still owes — the question names it and the confirm is "Delete anyway"
  const [deleteOwes, setDeleteOwes] = useState<DeleteOwes | null>(null);

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
    let live = true;
    commsClient.line()
      .then(({ line }) => live && setHasLine(!!line))
      .catch(() => live && setHasLine(false));
    return () => {
      live = false;
    };
  }, []);
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

  /** REQ-1075: REQ-039's soft delete; the sidebar drops her and the board flashes "<name> deleted" */
  async function onDeleteYes(id: string, name: string) {
    if (deleting) return;
    setDeleting(true);
    setDeleteErr(null);
    try {
      if (deleteOwes) await clientsClient.deleteAnyway(id);
      else await clientsClient.delete(id);
      globalThis.dispatchEvent(new Event(CUSTOMERS_CHANGED));
      globalThis.location.assign(
        `/customers?deleted=${encodeURIComponent(name)}`,
      );
    } catch (err) {
      setDeleting(false);
      // REQ-1138: she owes money we had not seen (another tab billed her) — ask again, naming it
      const owes = owesFromError(err);
      if (owes) setDeleteOwes(owes);
      else setDeleteErr((err as Error).message);
    }
  }

  /** re-read the page and the sidebar's rows */
  async function changed(text?: string) {
    await load();
    globalThis.dispatchEvent(new Event(CUSTOMERS_CHANGED));
    if (text) setToast({ text });
  }

  /** REQ-1108: `land` — after the switch, bring the tab's content into view (Messages: and focus the composer) */
  function setTab(t: WsTab, opts: { land?: boolean } = {}) {
    setTabState(t);
    if (opts.land) setLandMessages((n) => n + 1);
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
  // REQ-990 / REQ-323: the issued, non-void invoices — the "Invoices: N" count, and whether a zero
  // balance reads "Settled" or "Nothing billed yet" (the board's and the sidebar's word, zeroBalanceKey)
  const issuedCount =
    ws.invoices.filter((i) => isIssuedState(i.state) && i.status !== "void")
      .length;
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
              {tFor(lang, "customerWs.act.more")}{" "}
              <Icon name="chevron-down" size={14} />
            </button>
            {menuOpen && (
              <div class="cws-menu" role="menu" data-cy="cws-menu">
                {/* REQ-1108: the text item says what is true — no line → get one; no phone → add one */}
                {hasLine === false
                  ? (
                    <a
                      role="menuitem"
                      href="/communications"
                      data-cy="cws-text"
                    >
                      💬 {tFor(lang, "customerWs.act.getLineToText")}
                    </a>
                  )
                  : !c.phoneNumber
                  ? (
                    <button
                      type="button"
                      role="menuitem"
                      data-cy="cws-text"
                      onClick={() => setModal({ kind: "edit" })}
                    >
                      💬 {tFor(lang, "customerWs.act.addPhoneToText")}
                    </button>
                  )
                  : (
                    <button
                      type="button"
                      role="menuitem"
                      data-cy="cws-text"
                      onClick={() => setTab("messages", { land: true })}
                    >
                      💬 {tFor(lang, "customerWs.act.text")}
                    </button>
                  )}
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
                  <Icon name="pencil" size={14} />{" "}
                  {tFor(lang, "customerWs.act.edit")}
                </button>
                {/* REQ-1075: Delete customer — quiet danger, the question inline below */}
                <button
                  type="button"
                  role="menuitem"
                  class="cws-menu__danger"
                  data-cy="cws-delete"
                  onClick={() => {
                    setDeleteErr(null);
                    setDeleteOwes(owesFromInvoices(ws.invoices));
                    setAskDelete(true);
                  }}
                >
                  {tFor(lang, "clientsBoard.panel.delete")}
                </button>
              </div>
            )}
          </div>
        </div>
        {askDelete && (
          <div class="cws-ask" data-cy="cws-delete-ask" role="group">
            <div>
              {deleteOwes
                ? tFor(
                  lang,
                  "clientsBoard.panel.deleteAskOwes",
                  owesAskVars(c.name, deleteOwes),
                )
                : tFor(lang, "clientsBoard.panel.deleteAsk", { name: c.name })}
            </div>
            <div class="cws-ask__btns">
              <button
                type="button"
                class="cws-btn cws-btn--sm cws-btn--danger"
                data-cy="cws-delete-yes"
                disabled={deleting}
                onClick={() =>
                  onDeleteYes(c.id, c.name)}
              >
                <I d={ICN.trash} size={13} /> {tFor(
                  lang,
                  deleteOwes
                    ? "clientsBoard.panel.deleteAnyway"
                    : "clientsBoard.panel.deleteYes",
                )}
              </button>
              <button
                type="button"
                class="cws-btn cws-btn--sm cws-btn--ghost"
                data-cy="cws-delete-keep"
                disabled={deleting}
                onClick={() => {
                  setAskDelete(false);
                  setDeleteErr(null);
                  setDeleteOwes(null);
                }}
              >
                {tFor(lang, "clientsBoard.panel.deleteKeep")}
              </button>
            </div>
            {deleteErr && (
              <div class="cws-ask__err" data-cy="cws-delete-error" role="alert">
                {tFor(lang, "clientsBoard.panel.deleteError", {
                  message: deleteErr,
                })}
              </div>
            )}
          </div>
        )}
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
                  : tFor(lang, zeroBalanceKey(issuedCount > 0))}
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
                : issuedCount > 0
                ? tFor(lang, "customerWs.kpi.noBalance")
                : tFor(lang, "customerWs.kpi.noInvoicesYet")}
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
            <div class="cws-kpi__val">{moneyTotal(s.billedCents, lang)}</div>
            <div class="cws-kpi__hint">
              {tFor(lang, "customerWs.kpi.invoices", {
                // REQ-1090: the count of the very invoices summed into the amount above (the backend's
                // billed set) — a scheduled installment that has not gone out is in neither
                count: s.billedCount ?? 0,
              })}
            </div>
          </div>
          <div class="cws-kpi" data-cy="cws-paid">
            <div class="cws-kpi__lbl">{tFor(lang, "customerWs.kpi.paid")}</div>
            <div class="cws-kpi__val cws-kpi__val--green">
              {moneyTotal(s.paidCents, lang)}
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
                    {moneyTotal(s.recurringMonthlyCents, lang)}
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
                }) +
                  (s.recurringEndsOn
                    ? " · " + tFor(lang, "customerWs.kpi.until", {
                      date: day(s.recurringEndsOn, lang),
                    })
                    : "")
                : ws.services.length
                ? tFor(
                  lang,
                  ws.services.every((sv) => sv.ended)
                    ? "customerWs.kpi.ended"
                    : "customerWs.kpi.paused",
                )
                : tFor(lang, "customerWs.kpi.noService")}
              {s.unbilledCents > 0 && (
                <b class="cws-amber">
                  {" · "}
                  {tFor(lang, "customerWs.kpi.unbilled", {
                    amount: moneyTotal(s.unbilledCents, lang),
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
              {moneyTotal(s.openQuotesCents, lang)}
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
                  <dd>{fmtDayYear(c.createdAt, lang)}</dd>
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
                        <td data-label={tFor(lang, "customerWs.col.date")}>
                          {day(p.receivedAt, lang)}
                        </td>
                        <td
                          class="cws-doc"
                          data-label={tFor(lang, "customerWs.col.for")}
                        >
                          <a href={`/i/${p.invoiceId}`}>{p.invoiceNumber}</a>
                          {p.reference && <small>{p.reference}</small>}
                        </td>
                        <td data-label={tFor(lang, "customerWs.col.method")}>
                          {tFor(lang, `customerWs.method.${p.method}`)}
                        </td>
                        <td
                          class="num"
                          data-label={tFor(lang, "customerWs.col.amount")}
                        >
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
                            <td data-label={tFor(lang, "customerWs.col.date")}>
                              {day(v.date, lang)}
                            </td>
                            <td
                              class="cws-doc"
                              data-label={tFor(lang, "customerWs.col.service")}
                            >
                              {v.taskTypeName}
                            </td>
                            <td data-label={tFor(lang, "customerWs.col.crew")}>
                              {v.workerName || "—"}
                            </td>
                            <td
                              data-label={tFor(lang, "customerWs.col.status")}
                            >
                              <span class={`cws-pill cws-pill--${pill.cls}`}>
                                {pill.text}
                              </span>
                            </td>
                            <td
                              class="num"
                              data-label={tFor(lang, "customerWs.col.price")}
                            >
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
                        <td
                          class="cws-doc"
                          data-label={tFor(lang, "customerWs.col.workOrder")}
                        >
                          <a href={w.url}>{w.number}</a>
                          <small>{w.description}</small>
                        </td>
                        <td data-label={tFor(lang, "customerWs.col.date")}>
                          {day(w.scheduledFor ?? w.updatedAt, lang)}
                        </td>
                        <td data-label={tFor(lang, "customerWs.col.status")}>
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

        {tab === "messages" && (
          <Messages
            customerId={c.id}
            phone={c.phoneNumber}
            email={c.email}
            lang={lang}
            timeZone={timeZone}
            onAddPhone={() => setModal({ kind: "edit" })}
            land={landMessages}
          />
        )}
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
        // REQ-1031 (LOOP-007 q2-8; amends REQ-924(d)): Remind is the
        // invoice's reminder nudge (REQ-021 / REQ-477), the /invoices card's
        // "Send a nudge" — never the first-send email/text again.
        <InvoiceNudgeDialog
          lang={lang}
          invoice={{
            id: modal.invoice.id,
            number: modal.invoice.number,
            dueDate: modal.invoice.dueDate,
            status: modal.invoice.status,
          }}
          customerName={c.name}
          onCancel={() => setModal(null)}
          onSend={async (day) => {
            const inv = modal.invoice;
            const note = await sendInvoiceNudge(inv.id, day);
            setModal(null);
            if (note.tone === "fail") {
              setToast({ text: tFor(lang, note.key), err: true });
            } else {
              // the reminder lands in Activity: re-read the page
              // REQ-1113: an email-only send says so — the text didn't go
              await changed(
                note.key === "invoicesPage.nudge.sent"
                  ? tFor(lang, "customerWs.remind.sent", {
                    number: inv.number,
                  })
                  : note.key === "invoicesPage.nudge.sentEmailOnly"
                  ? tFor(lang, "customerWs.remind.sentEmailOnly", {
                    number: inv.number,
                  })
                  : tFor(lang, note.key),
              );
            }
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
              <td
                class="cws-doc"
                data-label={tFor(lang, "customerWs.col.invoice")}
              >
                <a href={i.url}>{i.number}</a>
                {i.title && <small>{i.title}</small>}
              </td>
              {!compact && (
                <td data-label={tFor(lang, "customerWs.col.sent")}>
                  {day(i.issuedDate, lang)}
                </td>
              )}
              <td data-label={tFor(lang, "customerWs.col.due")}>
                {day(i.dueDate, lang)}
              </td>
              <td data-label={tFor(lang, "customerWs.col.status")}>
                <span class={`cws-pill cws-pill--${pill.cls}`}>
                  {pill.text}
                </span>
              </td>
              <td class="num" data-label={tFor(lang, "customerWs.col.total")}>
                {money(i.amountCents, lang)}
              </td>
              <td class="num" data-label={tFor(lang, "customerWs.col.balance")}>
                <b>{i.balanceCents ? money(i.balanceCents, lang) : "—"}</b>
              </td>
              <td class="cws-actcell">
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
              <td
                class="cws-doc"
                data-label={tFor(lang, "customerWs.col.quote")}
              >
                <a href={q.url}>{q.number}</a>
                {q.title && <small>{q.title}</small>}
              </td>
              <td data-label={tFor(lang, "customerWs.col.date")}>
                {day(q.updatedAt, lang)}
              </td>
              <td data-label={tFor(lang, "customerWs.col.status")}>
                <span class={`cws-pill cws-pill--${pill.cls}`}>
                  {pill.text}
                </span>
              </td>
              <td class="num" data-label={tFor(lang, "customerWs.col.total")}>
                {money(q.amountCents, lang)}
              </td>
              <td class="cws-actcell">
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
  // REQ-1063 — past its end date it runs no more visits, though nobody paused it
  const running = sv.active && !sv.ended;
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
      class={`cws-svc ${running ? "" : "cws-svc--paused"}`}
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
            {!sv.active
              ? (
                <span class="cws-pill cws-pill--draft">
                  {tFor(lang, "customerWs.svc.pausedPill")}
                </span>
              )
              : sv.ended && (
                <span
                  class="cws-pill cws-pill--draft"
                  data-cy="cws-service-ended"
                >
                  {tFor(lang, "customerWs.svc.endedPill", {
                    date: day(sv.endDate, lang),
                  })}
                </span>
              )}
          </div>
        </div>
        <div class="cws-svc__price">
          {money(sv.perVisitCents, lang)}
          <small>
            {tFor(lang, "customerWs.svc.perVisit", {
              month: moneyTotal(sv.monthlyCents, lang),
            })}
            {running && sv.endDate && sv.remainingCents != null &&
              " · " + tFor(lang, "customerWs.svc.until", {
                  date: day(sv.endDate, lang),
                  left: moneyTotal(sv.remainingCents, lang),
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
                  : (
                    <span class="cws-vis__st">
                      <Icon name="check" size={12} />
                      {v.unbilled
                        ? tFor(lang, "customerWs.visit.doneShort")
                        : tFor(lang, "customerWs.visit.billedShort")}
                    </span>
                  )}
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
          {running && !sv.nextVisits.length && (
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

/**
 * REQ-924(c), amended by REQ-989 (q1-72): everything sent to the customer
 * (her REQ-784 outbox entries — every email and text, GET
 * /outbox?customerId=), whatever the phone-line state and also with no phone
 * on file; then the phone thread with her (REQ-906 Phone page's API) when the
 * business has a line. With no line (or no phone) only the compose box gives
 * way — to the get-a-line link / the no-phone note — never the history.
 * REQ-1076 (q2-64): the no-phone note is not a dead end — it offers Add phone
 * (the workspace's edit dialog, like the board card's "+ Add phone") and, when
 * she has an email, an Email action.
 */
function Messages(
  { customerId, phone, email, lang, timeZone, onAddPhone, land = 0 }: {
    customerId: string;
    phone?: string;
    email?: string;
    lang: Lang;
    timeZone?: string;
    onAddPhone: () => void;
    /** REQ-1108: a bump (More → Send a text) scrolls the thread card into view and focuses the composer */
    land?: number;
  },
) {
  const threadRef = useRef<HTMLDivElement>(null);
  const composeRef = useRef<HTMLInputElement>(null);
  const landed = useRef(0);
  const peer = phone ? toE164(phone) : null;
  const [state, setState] = useState<"loading" | "noLine" | "ready" | "failed">(
    "loading",
  );
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [sent, setSent] = useState<OutboxRow[] | null>(null);
  const [sentFailed, setSentFailed] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  async function loadSent() {
    try {
      setSent(await outboxClient.forCustomer(customerId));
      setSentFailed(false);
    } catch {
      setSentFailed(true);
    }
  }
  async function loadThread() {
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
    setSent(null);
    loadSent();
  }, [customerId]);
  useEffect(() => {
    loadThread();
  }, [peer]);
  // REQ-1108: land once per bump, after the thread settles (the card it shows is the one to see)
  useEffect(() => {
    if (!land || landed.current === land || state === "loading") return;
    landed.current = land;
    threadRef.current?.scrollIntoView({ block: "start" });
    composeRef.current?.focus({ preventScroll: true });
  }, [land, state]);

  const history = (
    <div class="cws-card" data-cy="cws-outbox">
      <div class="cws-card__hd">
        <h3>{tFor(lang, "customerWs.msg.sentTitle")}</h3>
        <a class="cws-btn cws-btn--ghost cws-btn--sm" href="/messages">
          {tFor(lang, "customerWs.msg.sentAll")}
        </a>
      </div>
      {sentFailed
        ? (
          <div class="cws-none" role="alert">
            {tFor(lang, "customerWs.msg.sentFailed")}
          </div>
        )
        : sent === null
        ? <div class="cws-none">{tFor(lang, "customerWs.loading")}</div>
        : sent.length === 0
        ? (
          <div class="cws-none" data-cy="cws-outbox-none">
            {tFor(lang, "customerWs.msg.sentNone")}
          </div>
        )
        : (
          <ul class="cws-outbox">
            {sent.map((r) => {
              const why = outboxWhy(r, lang);
              return (
                <li key={r.id}>
                  <a
                    class="cws-outbox__row"
                    data-cy="cws-outbox-row"
                    data-id={r.id}
                    href={outboxOpenHref(r.id)}
                  >
                    <span class="cws-outbox__icon" aria-hidden="true">
                      <I
                        d={r.channel === "text" ? ICN.msg : ICN.mail}
                        size={15}
                      />
                    </span>
                    <span class="cws-outbox__main">
                      <b>{outboxWhat(r, lang)}</b>
                      <span class="cws-outbox__preview">{r.preview}</span>
                      <span class="cws-muted">
                        {[
                          outboxChannelLabel(r.channel, lang),
                          outboxLanguageLabel(r.language, lang),
                          instantDay(r.createdAt, lang, timeZone),
                        ].join(" · ")}
                      </span>
                    </span>
                    <span
                      class={`cws-outbox__status${
                        r.status === "sent" ? "" : " cws-outbox__status--no"
                      }`}
                    >
                      {outboxStatusLabel(r, lang)}
                      {why && <small>{why}</small>}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
        )}
    </div>
  );

  let thread;
  if (!peer) {
    thread = (
      <div class="cws-card cws-none" data-cy="cws-msg-nophone">
        {tFor(lang, "customerWs.msg.noPhone")}
        <button
          type="button"
          class="cws-btn cws-btn--outline cws-btn--sm"
          data-cy="cws-msg-addphone"
          onClick={() => onAddPhone()}
        >
          + {tFor(lang, "customerWs.msg.addPhone")}
        </button>
        {email && (
          <a
            class="cws-btn cws-btn--ghost cws-btn--sm"
            data-cy="cws-msg-email"
            href={`mailto:${email}`}
          >
            <Icon name="mail" size={14} /> {tFor(lang, "customerWs.msg.email")}
          </a>
        )}
      </div>
    );
  } else if (state === "loading") {
    thread = (
      <div class="cws-card cws-none">{tFor(lang, "customerWs.loading")}</div>
    );
  } else if (state === "noLine") {
    thread = (
      <div class="cws-card cws-none" data-cy="cws-msg-noline">
        {tFor(lang, "customerWs.msg.noLine")}
        <a class="cws-btn cws-btn--outline cws-btn--sm" href="/communications">
          {tFor(lang, "customerWs.msg.getLine")}
        </a>
      </div>
    );
  } else if (state === "failed") {
    thread = (
      <div class="cws-card cws-none" role="alert">
        {tFor(lang, "customerWs.loadFailed")}
      </div>
    );
  } else {
    const texts = detail?.texts ?? [];
    thread = (
      <div class="cws-card" data-cy="cws-messages">
        <div class="cws-card__hd">
          <h3>{tFor(lang, "customerWs.msg.textsTitle")}</h3>
        </div>
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
              <div class="cws-muted">
                {instantDay(m.createdAt, lang, timeZone)}
              </div>
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
              await Promise.all([loadThread(), loadSent()]);
            } finally {
              setSending(false);
            }
          }}
        >
          <input
            ref={composeRef}
            value={draft}
            placeholder={tFor(lang, "customerWs.msg.placeholder")}
            onInput={(e) =>
              setDraft((e.currentTarget as HTMLInputElement).value)}
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
  return (
    <div class="cws-msgs">
      {history}
      <div class="cws-msgs__thread" ref={threadRef}>{thread}</div>
    </div>
  );
}
