/** Shared bits of the field pages (REQ-143): money, dates, the <em> in a title. */
import type { Lang } from "./lang.ts";

/** "$65.00" — cents to an exact dollar string; "—" when there is no number */
export function fmtMoneyExact(cents: number | undefined | null): string {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "—";
  return `${cents < 0 ? "-" : ""}$${
    (Math.abs(cents) / 100).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
  }`;
}

/** the browser's local day as YYYY-MM-DD */
export function todayIso(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${
    String(now.getDate()).padStart(2, "0")
  }`;
}

/** YYYY-MM-DD ± n days */
export function shiftIso(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return todayIso(d);
}

/** one link of the /worker day navigator: where it goes and its label's i18n key */
export type DayLink = { href: string; key: string };

/**
 * REQ-528 (demo m51) — the /worker address for one day; the office's way back (?from=, REQ-417)
 * rides along. `null` for a blank or malformed day (a cleared date picker goes nowhere).
 */
export function workerDayHref(iso: string, from?: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  if (Number.isNaN(new Date(`${iso}T00:00:00`).getTime())) return null;
  return `/worker?date=${iso}${
    from ? `&from=${encodeURIComponent(from)}` : ""
  }`;
}

/**
 * REQ-362 (demo M35) — the /worker day navigator: "← Previous day · Next day →", plus "Today"
 * to jump back from any other day. REQ-528 (demo m51): the labels never change with the day —
 * no "Yesterday"/"Tomorrow" that rename after one tap. A day after today is a read-only preview
 * (REQ-141: no acting on the future).
 */
export function workerDayNav(date: string, today: string, from?: string): {
  prev: DayLink;
  today: string | null;
  next: DayLink;
  preview: boolean;
} {
  const onToday = date === today;
  // REQ-417 — a day change keeps the office's way back (?from=)
  const keep = from ? `from=${encodeURIComponent(from)}` : "";
  return {
    prev: {
      href: workerDayHref(shiftIso(date, -1), from) ?? "/worker",
      key: "worker.prevDay",
    },
    today: onToday ? null : `/worker${keep && `?${keep}`}`,
    next: {
      href: workerDayHref(shiftIso(date, 1), from) ?? "/worker",
      key: "worker.nextDay",
    },
    preview: date > today,
  };
}

/** REQ-417 — where "Back to office" goes when nothing says where the owner came from */
export const WORKER_OFFICE_FALLBACK = "/field/tasks";

/** the office app's own top-level sections — the only places "Back to office" may lead */
const OFFICE_SECTIONS = new Set([
  "dashboard",
  "field",
  "customers",
  "clients",
  "quotes",
  "invoices",
  "payments",
  "messages",
  "assistant",
  "settings",
  "contracts",
  "work-orders",
  "plan",
  "accounts-manager",
  "admin",
  "admins",
]);

/** a same-origin path into one of the office sections, or null */
function officePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // a plain absolute path: no scheme, no "//host", no backslash, no control chars
  if (!/^\/[A-Za-z0-9\-._~/]*(\?[A-Za-z0-9\-._~/%=&+]*)?$/.test(raw)) {
    return null;
  }
  if (raw.startsWith("//")) return null;
  const section = raw.slice(1).split(/[/?]/)[0];
  return OFFICE_SECTIONS.has(section) ? raw : null;
}

/**
 * REQ-417 (demo m44, cycle 2) — /worker's "Back to office" link goes back to
 * the office page the owner opened the worker view from: the `?from=` param
 * (the office's "Open the worker view" links set it), else a same-origin
 * Referer, each allow-listed to the office's own sections; else /field/tasks.
 */
export function workerOfficeHref(
  from: string | null | undefined,
  referer: string | null | undefined,
  origin: string,
): string {
  const fromParam = officePath(from);
  if (fromParam) return fromParam;
  if (referer) {
    try {
      const u = new URL(referer);
      if (u.origin === origin) {
        const p = officePath(`${u.pathname}${u.search}`);
        if (p) return p;
      }
    } catch {
      // not a URL — ignore it
    }
  }
  return WORKER_OFFICE_FALLBACK;
}

/** "Mon, Oct 12" / "lun, 12 oct" */
export function fmtDay(iso: string, lang: Lang): string {
  const d = new Date(`${iso}T00:00:00`);
  return d.toLocaleDateString(lang === "es" ? "es-MX" : "en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** Split "Each client's <em>recurring</em> maintenance." into text and the emphasised run. */
export function splitEm(
  s: string,
): { before: string; em: string; after: string } | null {
  const m = /^(.*?)<em>(.*?)<\/em>(.*)$/s.exec(s);
  return m ? { before: m[1], em: m[2], after: m[3] } : null;
}

/**
 * REQ-363 — the one sample phone number for a phone box: the neutral 555 area
 * code, so no business is shown somebody else's town (it was a Myrtle Beach SC number).
 */
export const PHONE_PLACEHOLDER = "(555) 123-4567";

/** last 10 digits as (555) 123-4567; anything else as typed */
export function fmtCell(digits: string): string {
  const d = digits.replace(/\D/g, "").slice(-10);
  return d.length === 10
    ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`
    : digits;
}

/**
 * REQ-144 — picking a customer on a new subscription fills the service
 * address with the customer's address on file. Never over what the owner
 * typed: only an empty box, or one still holding the previous pick's
 * address, is written; a pick with no address on file changes nothing.
 */
export function prefillAddress(
  current: string,
  previous: { address?: string } | undefined,
  next: { address?: string } | undefined,
): string {
  const picked = next?.address?.trim();
  if (!picked) return current;
  const untouched = !current.trim() ||
    (!!previous?.address && current.trim() === previous.address.trim());
  return untouched ? picked : current;
}

/** REQ-152 — the customers as SearchSelect rows: the name is the label, the address on file the hint */
export function customerOptions(
  customers: { id: string; name: string; address?: string }[],
): { id: string; label: string; hint?: string }[] {
  return customers.map((c) => {
    const hint = c.address?.trim();
    return hint
      ? { id: c.id, label: c.name, hint }
      : { id: c.id, label: c.name };
  });
}

/** REQ-145 — the account's subscriptions by customer, oldest first; a customer with none is absent */
export function subscriptionsByCustomer<
  T extends { customerId: string; createdAt: string },
>(list: T[]): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (
    const s of [...list].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  ) {
    const rows = m.get(s.customerId);
    if (rows) rows.push(s);
    else m.set(s.customerId, [s]);
  }
  return m;
}

/** REQ-145 — what one visit of a subscription bills: its items' sum */
export function perVisitCents(s: { items: { priceCents: number }[] }): number {
  return s.items.reduce((sum, i) => sum + i.priceCents, 0);
}

/**
 * REQ-285 — the language the /worker screen switches to once a worker is
 * signed in: the worker's own (the backend answers it, REQ-155's rule), unless
 * the person already chose one (the EN/ES switch, or ?lang= in the address).
 * null = leave the screen as it is.
 */
export function workerScreenLang(
  who: { language?: string } | null,
  chosen: boolean,
): Lang | null {
  if (chosen || !who) return null;
  return who.language === "en" || who.language === "es" ? who.language : null;
}

/** REQ-288 — the continental US: the map's view when nothing better is known (never the dev seed's town) */
export const US_MAP_VIEW = { lat: 39.5, lng: -98.35, zoom: 4 } as const;

export type MapViewPlan =
  | { fit: [number, number][] }
  | { center: [number, number]; zoom: number };

/** REQ-288 — the assignments map: fit the subscriptions; with none, the business's
 *  own place (GET /field/regions/center); with neither, the whole US */
export function assignmentsMapView(
  pts: [number, number][],
  center: { lat: number; lng: number; zoom: number } | null,
): MapViewPlan {
  if (pts.length) return { fit: pts };
  const at = center ?? US_MAP_VIEW;
  return { center: [at.lat, at.lng], zoom: at.zoom };
}

/** "120" / "120.50" → cents, or null when it is not a price */
export function centsOf(raw: string): number | null {
  const n = Number(raw);
  if (raw.trim() === "" || !Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

/** REQ-283 — the first thing the one-off "Add task" form is missing, by field, with its message key; null when it can be sent */
export function addTaskProblem(
  f: { customerId: string; typeName: string; price: string },
):
  | { field: "customer"; key: "field.tk.needCustomer" }
  | { field: "type"; key: "field.tk.needType" }
  | { field: "price"; key: "field.tk.badPrice" }
  | null {
  if (!f.customerId) return { field: "customer", key: "field.tk.needCustomer" };
  if (!f.typeName.trim()) return { field: "type", key: "field.tk.needType" };
  if (centsOf(f.price) === null) {
    return { field: "price", key: "field.tk.badPrice" };
  }
  return null;
}

/** REQ-415 (demo p11, cycle 2) — the Service examples on /field/tasks are the account's OWN task
 *  types (a fence builder sees "Fence install, Gate repair…", not lawn care): the first `max`
 *  distinct non-blank names, or "" when the account has none yet. */
export function serviceExamples(types: { name: string }[], max = 3): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of types) {
    const name = x.name.trim();
    const k = name.toLowerCase();
    if (!name || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
    if (out.length >= max) break;
  }
  return out.join(", ");
}

/** REQ-415 — which dictionary line the Service placeholder ("ph") or the missing-service error
 *  ("need") reads: the account's examples when it has task types, else the neutral
 *  "e.g. Weekly service, Repair visit…" line. */
export function serviceHint(
  types: { name: string }[],
  which: "ph" | "need",
): { key: string; vars?: { examples: string } } {
  const examples = serviceExamples(types);
  const base = which === "ph" ? "field.tk.typePh" : "field.tk.needType";
  return examples ? { key: `${base}From`, vars: { examples } } : { key: base };
}

/** REQ-283 — a server refusal of the one-off task that names a field of the form: "workerId required"
 *  is a customer with no staffed zone (a new one), so the office has to pick the worker */
export function addTaskServerProblem(
  error: string | undefined,
): { field: "worker"; key: "field.tk.needWorker" } | null {
  return error === "workerId required"
    ? { field: "worker", key: "field.tk.needWorker" }
    : null;
}
