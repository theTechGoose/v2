/**
 * Top-level data island for /clients. The SSR route renders only the page
 * shell (sidebar + topbar); this island fetches ONE PAGE of the roster from
 * the backend (REQ-135 — `GET /clients?page&q&status`) on mount and again on
 * every search, chip or page change, and renders the editorial board with
 * what it was handed. The hero's totals and the loop strip are the roster's,
 * computed by the backend — nothing here derives from a list.
 */
import { useEffect, useState } from "preact/hooks";
import {
  clientsClient,
  type ClientsFilter,
  type ClientsPageResponse,
  type CustomerCard,
  type TopClientsResponse,
} from "../clients/clients.ts";
import CustomerFormDialog from "../components/CustomerForm.tsx"; // REQ-625
import ClientSheet from "../components/ClientSheet.tsx"; // REQ-626
import {
  ClientsHero,
  LoopBar,
  TopClients,
} from "../components/ClientsSections.tsx";
import ClientsBoard, { filterFromSearch } from "./ClientsBoard.tsx";
import { fieldClient, type SubscriptionView } from "../clients/field.ts";
import { subscriptionsByCustomer } from "../lib/field.ts";
import {
  CardGridSkeleton,
  PageHeaderSkeleton,
  ShimmerStyle,
} from "../components/Skeletons.tsx";
import { langSignal, tFor } from "../lib/i18n.ts";

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

export default function ClientsPage({ lang: _lang }: { lang?: "en" | "es" }) {
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
  // REQ-135 — what the API is asked for: the page, the search, the chip (seeded from ?segment=)
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

  function onQuery(next: string) {
    setQuery(next);
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
   *  the open sheet are re-read. */
  async function onCustomerSaved(saved: CustomerCard) {
    setAddOpen(false);
    setEditing(null);
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
        query={query}
        onQuery={onQuery}
        filter={filter}
        onFilter={onFilter}
        page={data.page}
        totalPages={data.totalPages}
        onPage={setPage}
        lang={lang}
        subsByCustomer={subsByCustomer}
        onOpenCard={(id) => openSheet(id)}
        onEdit={(c) => setEditing(c)}
      >
        <TopClients rows={top.results} lang={lang} />
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
          onSaved={onCustomerSaved}
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
    </>
  );
}
