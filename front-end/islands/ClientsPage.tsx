/**
 * Top-level data island for /clients. The SSR route renders only the page
 * shell (sidebar + topbar); this island fetches ONE PAGE of the roster from
 * the backend (REQ-135 — `GET /clients?page&q&status`) on mount and again on
 * every search, chip or page change, and renders the editorial board with
 * what it was handed. The hero's totals and the loop strip are the roster's,
 * computed by the backend — nothing here derives from a list.
 */
import {
  clientsClient,
  type ClientsFilter,
  type ClientsPageResponse,
  type CustomerCard,
  type TopClientsResponse,
} from "../clients/clients.ts";
import { useEffect, useState } from "preact/hooks";
import CustomerFormDialog from "../components/CustomerForm.tsx"; // REQ-625
import ClientSheet from "../components/ClientSheet.tsx"; // REQ-626
import {
  ClientsHero,
  LoopBar,
  TopClients,
} from "../components/ClientsSections.tsx";
import ClientsBoard, { filterFromSearch } from "./ClientsBoard.tsx";
import { openIdFromSearch } from "../lib/customer-card-edit.ts";
import { fieldClient, type SubscriptionView } from "../clients/field.ts";
import { subscriptionsByCustomer } from "../lib/field.ts";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";
import { langSignal, tFor } from "../lib/i18n.ts";
import { followChanges, isDocChange } from "../lib/change-feed.ts";
import type { TradeKind } from "../../shared/quote-flow/trade-fit.ts"; // REQ-743

interface State {
  loading: boolean;
  error: string | null;
  data: ClientsPageResponse | null;
  top: TopClientsResponse;
}

const INITIAL: State = {
  loading: true,
  error: null,
  data: null,
  top: { results: [] },
};

/** REQ-135 — a keystroke waits this long before it asks the API */
const SEARCH_DEBOUNCE_MS = 250;
/** REQ-352 — how long the "<name> added" confirmation stays up */
const FLASH_MS = 4000;

export default function ClientsPage(
  { lang: _lang, tradeKind = "project" }: {
    lang?: "en" | "es";
    /** REQ-743 — the business's trade kind, read off its name by the route */
    tradeKind?: TradeKind;
  },
) {
  const lang = langSignal.value;
  const [s, setS] = useState<State>(INITIAL);
  // REQ-145 — the account's subscriptions, once, grouped by customer for the cards
  const [subsByCustomer, setSubsByCustomer] = useState<
    Map<string, SubscriptionView[]>
  >(new Map());
  useEffect(() => {
    let alive = true;
    fieldClient.subscriptions().then((list) => {
      if (alive) setSubsByCustomer(subscriptionsByCustomer(list));
    }).catch(() => {
      // the cards simply show no subscriptions
    });
    return () => {
      alive = false;
    };
  }, []);
  const [addOpen, setAddOpen] = useState(false);
  // REQ-352 (demo p15-5): "<name> added" after a successful Add
  const [flash, setFlash] = useState("");
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);
  // REQ-625: the customer being edited (the shared form, prefilled)
  const [editing, setEditing] = useState<CustomerCard | null>(null);
  // REQ-626: the client sheet — "Open card", or /clients?open=<customerId>
  const [sheetId, setSheetId] = useState<string | null>(() =>
    typeof globalThis.location === "undefined"
      ? null
      : new URLSearchParams(globalThis.location.search).get("open")
  );
  const [sheet, setSheet] = useState<
    { customer: CustomerCard | null; failed: boolean }
  >({ customer: null, failed: false });
  useEffect(() => {
    if (!sheetId) return;
    let alive = true;
    // the board's card seeds the sheet (no "Loading…" flash); the read refreshes it
    setSheet((prev) =>
      prev.customer?.id === sheetId ? prev : { customer: null, failed: false }
    );
    clientsClient.get(sheetId).then((customer) => {
      if (alive) setSheet({ customer, failed: false });
    }).catch(() => {
      if (alive) setSheet({ customer: null, failed: true });
    });
    return () => {
      alive = false;
    };
  }, [sheetId]);
  function openSheet(id: string | null) {
    const seed = id ? s.data?.items.find((c) => c.id === id) : undefined;
    if (seed) setSheet({ customer: seed, failed: false });
    setSheetId(id);
    // REQ-799: the page has no search box; the REQ-600 by-name filter that found a linked card
    // is cleared when its sheet closes, so the roster comes back
    if (!id && query) setQuery("");
    if (typeof globalThis.location === "undefined") return;
    try {
      const url = new URL(globalThis.location.href);
      if (id) url.searchParams.set("open", id);
      else url.searchParams.delete("open");
      globalThis.history.replaceState(
        globalThis.history.state,
        "",
        url.toString(),
      );
    } catch { /* history unavailable — the sheet still opens */ }
  }
  // REQ-135 — what the API is asked for: the page, the chip (seeded from ?segment=) and — REQ-799:
  // with no search box on the page — only REQ-600's by-name search for a linked card
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState("");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<ClientsFilter>(() =>
    typeof globalThis.location === "undefined"
      ? "all"
      : filterFromSearch(globalThis.location.search)
  );

  async function refreshClients() {
    const data = await clientsClient.list({ page, q, status: filter }).catch(
      () => null,
    );
    if (data) setS((prev) => ({ ...prev, data }));
  }

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(query);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  function onFilter(next: ClientsFilter) {
    setFilter(next);
    setPage(1);
    if (typeof globalThis.location === "undefined") return;
    const url = new URL(globalThis.location.href);
    if (next === "all") url.searchParams.delete("segment");
    else url.searchParams.set("segment", next);
    globalThis.history.pushState({ segment: next }, "", url.toString());
  }
  // Browser back / forward re-applies the URL's chip.
  useEffect(() => {
    function onPop() {
      setFilter(filterFromSearch(globalThis.location.search));
      setPage(1);
    }
    globalThis.addEventListener("popstate", onPop);
    return () => globalThis.removeEventListener("popstate", onPop);
  }, []);

  /** REQ-625: a saved customer (new or edited) shows at once — the board and
   *  the open sheet are re-read. REQ-352 (demo p15-5): a new one says
   *  "<name> added". */
  async function onCustomerSaved(saved: CustomerCard, created = false) {
    setAddOpen(false);
    setEditing(null);
    if (created) {
      setFlash(tFor(lang, "clientsPage.added", { name: saved.name }));
    }
    if (sheetId && saved.id === sheetId) {
      setSheet({ customer: saved, failed: false });
    }
    await refreshClients();
  }

  useEffect(() => {
    let alive = true;
    clientsClient.top(5).catch(() => ({ results: [] } as TopClientsResponse))
      .then((top) => {
        if (alive) setS((prev) => ({ ...prev, top }));
      });
    return () => {
      alive = false;
    };
  }, []);

  // REQ-135 — one page from the API, again on every page, search or chip change
  useEffect(() => {
    let alive = true;
    clientsClient.list({ page, q, status: filter }).then((data) => {
      if (!alive) return;
      setS((prev) => ({ ...prev, loading: false, error: null, data }));
    }).catch((err: Error) => {
      if (!alive) return;
      setS((prev) => ({ ...prev, loading: false, error: err.message }));
    });
    return () => {
      alive = false;
    };
  }, [page, q, filter]);

  // REQ-696 (demo-loop cycle 5, M5): a signature, payment or new invoice
  // re-reads the page shown (REQ-493's change feed) — the roster read
  // "0 trabajos firmados" after a signature toast until a reload.
  useEffect(() => followChanges(isDocChange, refreshClients), [
    page,
    q,
    filter,
  ]);

  // REQ-600 (cycle 4, M5): a linked card (?open=<id>) that is not on the first
  // page is searched for by name, once, so the board can open it
  const [linkChecked, setLinkChecked] = useState(false);
  useEffect(() => {
    if (linkChecked || !s.data || typeof globalThis.location === "undefined") {
      return;
    }
    setLinkChecked(true);
    const id = openIdFromSearch(globalThis.location.search);
    if (!id || s.data.items.some((c) => c.id === id)) return;
    clientsClient.get(id).then((c) => {
      if (c?.name) setQuery(c.name);
    }).catch(() => {
      // a stale or foreign link simply opens nothing
    });
  }, [s.data, linkChecked]);

  if (s.loading || !s.data) {
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
      <div class="cpage-error">
        {tFor(lang, "clientsPage.loadError", { error: s.error })}
      </div>
    );
  }

  const { data, top } = s;
  const { summary } = data;

  return (
    <>
      <ClientsHero
        totalClients={summary.totalClients}
        activeJobs={summary.activeJobs}
        owedTotal={summary.owedCents / 100}
        quietCount={summary.quietCount}
        lang={lang}
        onAdd={() => setAddOpen(true)}
      />
      <LoopBar picks={data.loop} lang={lang} />
      <ClientsBoard
        cards={data.items}
        counts={data.counts}
        rosterEmpty={summary.totalClients === 0}
        filter={filter}
        onFilter={onFilter}
        page={data.page}
        totalPages={data.totalPages}
        onPage={setPage}
        lang={lang}
        subsByCustomer={subsByCustomer}
        tradeKind={tradeKind}
        onCustomerSaved={refreshClients}
        onOpenCard={(id) => openSheet(id)}
        onEdit={(c) => setEditing(c)}
      >
        <TopClients
          rows={top.results}
          unassigned={top.unassigned}
          lang={lang}
        />
        {
          /* NW-36 (REQ-013): the "Who's on your books" segments chart is gone —
            no part of the app ever collects a customer segment. */
        }
      </ClientsBoard>

      {sheetId && (
        <ClientSheet
          lang={lang}
          customer={sheet.customer}
          failed={sheet.failed}
          onClose={() => openSheet(null)}
          onEdit={(c) => setEditing(c)}
        />
      )}
      {addOpen && (
        <CustomerFormDialog
          mode="create"
          lang={lang}
          onSaved={(c) => onCustomerSaved(c, true)}
          onClose={() => setAddOpen(false)}
        />
      )}
      {editing && (
        <CustomerFormDialog
          key={editing.id}
          mode="edit"
          lang={lang}
          customer={editing}
          onSaved={onCustomerSaved}
          onClose={() => setEditing(null)}
        />
      )}
      {flash && (
        <div
          role="status"
          aria-live="polite"
          class="clients-flash"
          // REQ-379 — above the demo pill's band (--demo-pill-h, 0 when no demo)
          style="position:fixed;left:50%;bottom:calc(28px + var(--demo-pill-h, 0px));transform:translateX(-50%);z-index:1001;background:var(--brand-green,#519843);color:#fff;padding:12px 20px;border-radius:12px;font-weight:700;font-size:14.5px;box-shadow:0 12px 32px rgba(20,72,82,0.22)"
        >
          {flash}
        </div>
      )}
    </>
  );
}
