/**
 * Top-level data island for /clients. The SSR route renders only the page
 * shell (sidebar + topbar); this island fetches ONE PAGE of the roster from
 * the backend (REQ-135 — `GET /clients?page&q&status`) on mount and again on
 * every search, chip or page change, and renders the editorial board with
 * what it was handed. The hero's totals and the loop strip are the roster's,
 * computed by the backend — nothing here derives from a list.
 */
import Backdrop from "../components/Backdrop.tsx";
import AddressAutocomplete from "../components/AddressAutocomplete.tsx";
import { useEffect, useState } from "preact/hooks";
import { formatPhoneInput } from "../../shared/quote-flow/format-helpers.ts";
import {
  customerDraftDirty,
  type CustomerFormErrors,
  customerFormErrors,
  newCustomerPayload,
} from "../../shared/quote-flow/customer-contact.ts"; // REQ-278, REQ-300, REQ-352, REQ-599
import { ApiError } from "../lib/api.ts";
import {
  clientsClient,
  type ClientsFilter,
  type ClientsPageResponse,
  type TopClientsResponse,
} from "../clients/clients.ts";
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

type AddField = keyof CustomerFormErrors;

/** REQ-352 — a modal input, red-bordered while its field carries a message */
function inputStyle(bad: boolean): string {
  return `padding:11px 13px;border:1px solid ${
    bad ? "#a83b3b" : "var(--border,#d8dcd5)"
  };border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)`;
}

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
  const [adding, setAdding] = useState(false);
  const [addErr, setAddErr] = useState<string | null>(null);
  // REQ-352 (demo M38): one message per field, under that field
  const [fieldErrs, setFieldErrs] = useState<CustomerFormErrors>({});
  // REQ-352 (demo p15-5): "<name> added" after a successful Add
  const [flash, setFlash] = useState("");
  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(""), FLASH_MS);
    return () => clearTimeout(t);
  }, [flash]);
  const [addName, setAddName] = useState("");
  // REQ-289: the New customer modal is a dialog — Escape closes it, as the
  // backdrop click does (not while the save is in flight)
  useEffect(() => {
    if (!addOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !adding) setAddOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [addOpen, adding]);
  const [addBusiness, setAddBusiness] = useState("");
  const [addPhone, setAddPhone] = useState("");
  const [addEmail, setAddEmail] = useState("");
  // REQ-599 (demo-loop cycle 4, m30): the customer's address, optional
  const [addAddress, setAddAddress] = useState("");
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

  /** REQ-352: the rule over the modal's values, `over` replacing one being typed */
  function errorsFor(over: Partial<Record<AddField, string>> = {}) {
    return customerFormErrors({
      name: over.name ?? addName,
      phoneNumber: over.phone ?? addPhone,
      email: over.email ?? addEmail,
    });
  }
  /** REQ-352: re-check ONE field (on blur, or while it already shows a message) */
  function checkField(field: AddField, value?: string) {
    const key = errorsFor(value === undefined ? {} : { [field]: value })[field];
    setFieldErrs((prev) => {
      const next = { ...prev };
      if (key) (next as Record<string, string>)[field] = key;
      else delete next[field];
      return next;
    });
  }

  async function submitAddClient(e: Event) {
    e.preventDefault();
    if (adding) return;
    // REQ-278 (demo M16) / REQ-352 (demo M38): the backend's own rule, run
    // here per field — the form is novalidate, so the browser's bubble (which
    // the demo stage cannot show) never pre-empts these messages.
    const errs = errorsFor();
    setFieldErrs(errs);
    if (Object.keys(errs).length > 0) return;
    setAdding(true);
    setAddErr(null);
    const name = addName.trim();
    try {
      await clientsClient.create(newCustomerPayload({
        name,
        businessName: addBusiness,
        phoneNumber: addPhone,
        email: addEmail,
        address: addAddress,
      }));
      setAddName("");
      setAddBusiness("");
      setAddPhone("");
      setAddEmail("");
      setAddAddress("");
      setFieldErrs({});
      setAddOpen(false);
      setFlash(tFor(lang, "clientsPage.added", { name }));
      await refreshClients();
    } catch (err) {
      // REQ-278: the backend names a refused contact by dictionary key —
      // REQ-352: shown under the field it names.
      const key = err instanceof ApiError
        ? (err.body as { message?: unknown } | null)?.message
        : undefined;
      if (key === "customer.invalidPhone") {
        setFieldErrs((prev) => ({ ...prev, phone: key }));
      } else if (key === "customer.invalidEmail") {
        setFieldErrs((prev) => ({ ...prev, email: key }));
      } else {
        setAddErr(
          err instanceof Error
            ? err.message
            : tFor(lang, "clientsPage.addError"),
        );
      }
    } finally {
      setAdding(false);
    }
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
        onAdd={() => {
          setAddErr(null);
          setFieldErrs({});
          setAddOpen(true);
        }}
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
        tradeKind={tradeKind}
        onCustomerSaved={refreshClients}
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

      {addOpen && (
        <Backdrop
          data-cy="add-client-backdrop"
          // REQ-300 (demo M20): a click beside the form closes it only while nothing is typed;
          // a dirty draft stays up (Cancel / Escape still close it, and the draft is kept).
          // REQ-354: the Backdrop's guard ignores the opener's double-click.
          onClose={() =>
            !adding && !customerDraftDirty({
              name: addName,
              businessName: addBusiness,
              phoneNumber: addPhone,
              email: addEmail,
              address: addAddress,
            }) && setAddOpen(false)}
          style="position:fixed;inset:0;background:rgba(20,40,45,0.45);display:flex;align-items:center;justify-content:center;z-index:1000;padding:20px"
        >
          <form
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-client-title"
            onClick={(e) => e.stopPropagation()}
            onSubmit={submitAddClient}
            noValidate
            style="background:#fff;border-radius:16px;padding:24px 26px;max-width:440px;width:100%;box-shadow:0 24px 64px rgba(20,72,82,0.22);display:flex;flex-direction:column;gap:14px"
          >
            <h2
              id="add-client-title"
              style="margin:0;font-size:20px;font-weight:800;color:var(--fg,#144852)"
            >
              {tFor(lang, "clientsHero.addClient")}
            </h2>
            <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)">
              {tFor(lang, "settings.name")}
              <input
                type="text"
                autoFocus
                required
                value={addName}
                aria-invalid={fieldErrs.name ? "true" : undefined}
                aria-describedby={fieldErrs.name
                  ? "add-client-name-err"
                  : undefined}
                onInput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  setAddName(v);
                  if (fieldErrs.name) checkField("name", v);
                }}
                style={inputStyle(Boolean(fieldErrs.name))}
              />
            </label>
            <FieldError
              id="add-client-name-err"
              msg={fieldErrs.name && tFor(lang, fieldErrs.name)}
            />
            <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)">
              {tFor(lang, "clientsPage.businessName")}
              <input
                type="text"
                value={addBusiness}
                onInput={(e) =>
                  setAddBusiness((e.target as HTMLInputElement).value)}
                style="padding:11px 13px;border:1px solid var(--border,#d8dcd5);border-radius:10px;font:inherit;font-size:15px;font-weight:400;color:var(--fg)"
              />
            </label>
            <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)">
              {tFor(lang, "settings.phone")}
              <input
                type="tel"
                value={formatPhoneInput(
                  addPhone,
                )} /* NW-34 (REQ-012): (555) 123-4567 as you type */
                aria-invalid={fieldErrs.phone ? "true" : undefined}
                aria-describedby={fieldErrs.phone
                  ? "add-client-phone-err"
                  : undefined}
                onInput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  setAddPhone(v);
                  if (fieldErrs.phone) checkField("phone", v);
                }}
                onBlur={() => checkField("phone")}
                style={inputStyle(Boolean(fieldErrs.phone))}
              />
            </label>
            <FieldError
              id="add-client-phone-err"
              msg={fieldErrs.phone && tFor(lang, fieldErrs.phone)}
            />
            <label style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)">
              {tFor(lang, "settings.email")}
              <input
                type="email"
                value={addEmail}
                aria-invalid={fieldErrs.email ? "true" : undefined}
                aria-describedby={fieldErrs.email
                  ? "add-client-email-err"
                  : undefined}
                onInput={(e) => {
                  const v = (e.target as HTMLInputElement).value;
                  setAddEmail(v);
                  if (fieldErrs.email) checkField("email", v);
                }}
                onBlur={() => checkField("email")}
                style={inputStyle(Boolean(fieldErrs.email))}
              />
            </label>
            <FieldError
              id="add-client-email-err"
              msg={fieldErrs.email && tFor(lang, fieldErrs.email)}
            />
            {/* REQ-599 (demo-loop cycle 4, m30): optional, with the street autocomplete */}
            <div style="display:flex;flex-direction:column;gap:5px;font-size:13px;font-weight:700;color:var(--fg-muted,#6b7560)">
              <span>{tFor(lang, "clientsPage.address")}</span>
              <AddressAutocomplete
                id="add-client-address"
                data-cy="add-client-address"
                label={tFor(lang, "clientsPage.address")}
                useTypedLabel={tFor(lang, "welcome.address.useTyped")}
                lang={lang}
                value={addAddress}
                onInput={setAddAddress}
                inputStyle={inputStyle(false) +
                  ";width:100%;box-sizing:border-box"}
              />
            </div>
            {addErr && (
              <p
                role="alert"
                style="margin:0;color:#a83b3b;font-size:13.5px;font-weight:600"
              >
                {addErr}
              </p>
            )}
            <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:6px">
              <button
                type="button"
                disabled={adding}
                onClick={() => setAddOpen(false)}
                style="padding:10px 16px;border:0;background:transparent;color:var(--fg-muted,#6b7560);font:inherit;font-weight:700;cursor:pointer;border-radius:10px"
              >
                {tFor(lang, "common.cancel")}
              </button>
              <button
                type="submit"
                disabled={adding}
                style="padding:10px 20px;border:0;border-radius:10px;background:var(--brand-green,#519843);color:#fff;font:inherit;font-weight:800;cursor:pointer;opacity:1"
              >
                {adding ? "…" : tFor(lang, "common.add")}
              </button>
            </div>
          </form>
        </Backdrop>
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

/** REQ-352 — a field's in-app message, right under that field */
function FieldError({ id, msg }: { id: string; msg?: string | false }) {
  if (!msg) return null;
  return (
    <p
      id={id}
      role="alert"
      style="margin:-8px 0 0;color:#a83b3b;font-size:13px;font-weight:600"
    >
      {msg}
    </p>
  );
}
